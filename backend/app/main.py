"""SignIA API: real-time sign prediction, data collection, training and evaluation."""
from __future__ import annotations

import asyncio
import json
import os
import platform
import time
import uuid
from collections import deque

import mediapipe as mp
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config, dataset
from .registry import registry
from .tf_setup import tf
from .training import evaluate_model, trainer
from .vision import HolisticDetector

config.ensure_dirs()
app = FastAPI(title="SignIA", version="2.0.0")
STARTED_AT = time.time()
# Live predictions are only accepted when hands are visible in at least this share of the window.
MIN_HANDS_RATIO = 0.2


# --------------------------------------------------------------------------- status
@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/status")
def status():
    signs = dataset.list_signs()
    return {
        "device": "CPU",
        "cpu_count": os.cpu_count(),
        "platform": platform.platform(terse=True),
        "python": platform.python_version(),
        "tensorflow": tf.__version__,
        "mediapipe": mp.__version__,
        "model_complexity": config.MODEL_COMPLEXITY,
        "sequence_length": config.SEQUENCE_LENGTH,
        "active_model": registry.get_meta(registry.active_id()),
        "models": len(registry.list()),
        "dataset": {"signs": len(signs), "samples": sum(s["samples"] for s in signs)},
        "training": trainer.job.to_dict() if trainer.job else None,
        "uptime_s": round(time.time() - STARTED_AT),
    }


# --------------------------------------------------------------------------- models
@app.get("/api/models")
def list_models():
    return registry.list()


@app.get("/api/models/{model_id}")
def get_model(model_id: str):
    meta = registry.get_meta(model_id)
    if meta is None:
        raise HTTPException(404, "Model not found.")
    return meta


@app.post("/api/models/{model_id}/activate")
async def activate_model(model_id: str):
    try:
        await asyncio.to_thread(registry.set_active, model_id)
    except KeyError:
        raise HTTPException(404, "Model not found.")
    return registry.get_meta(model_id)


@app.delete("/api/models/{model_id}")
def delete_model(model_id: str):
    try:
        registry.delete(model_id)
    except KeyError:
        raise HTTPException(404, "Model not found.")
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"ok": True}


@app.post("/api/models/{model_id}/evaluate")
async def evaluate(model_id: str):
    if registry.get_meta(model_id) is None:
        raise HTTPException(404, "Model not found.")
    try:
        return await asyncio.to_thread(evaluate_model, model_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


# --------------------------------------------------------------------------- dataset
@app.get("/api/dataset")
def get_dataset():
    return dataset.list_signs()


@app.delete("/api/dataset/{name}")
def delete_sign(name: str):
    try:
        dataset.delete_sign(name)
    except KeyError:
        raise HTTPException(404, "Sign not found.")
    return {"ok": True}


@app.delete("/api/dataset/{name}/last")
def delete_last(name: str):
    try:
        return {"samples": dataset.delete_last_sample(name)}
    except KeyError:
        raise HTTPException(404, "No samples to delete.")


# --------------------------------------------------------------------------- training
class TrainRequest(BaseModel):
    name: str = "Custom model"
    signs: list[str]
    epochs: int = Field(150, ge=1, le=1000)
    use_pretrained: bool = True
    augment: bool = True
    test_fraction: float = Field(0.2, ge=0.0, le=0.5)


@app.post("/api/training/start")
def start_training(req: TrainRequest):
    try:
        job = trainer.start(req.name, req.signs, req.epochs, req.use_pretrained, req.augment, req.test_fraction)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(400, str(exc))
    return job.to_dict()


@app.get("/api/training/status")
def training_status():
    return trainer.job.to_dict() if trainer.job else None


@app.post("/api/training/cancel")
def cancel_training():
    trainer.cancel()
    return training_status()


# --------------------------------------------------------------------------- feedback
@app.post("/api/feedback")
async def feedback(
    name: str = Form(...), email: str = Form(...), message: str = Form(...),
    rating: int = Form(5), image: UploadFile | None = File(None),
):
    entry = {"id": uuid.uuid4().hex, "name": name, "email": email, "message": message,
             "rating": max(1, min(5, rating)), "created_at": time.time(), "image": None}
    if image is not None and image.filename:
        folder = config.DATA_DIR / "feedback"
        folder.mkdir(parents=True, exist_ok=True)
        suffix = os.path.splitext(image.filename)[1][:8]
        path = folder / f"{entry['id']}{suffix}"
        path.write_bytes(await image.read())
        entry["image"] = path.name
    with open(config.FEEDBACK_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")
    return {"ok": True}


# --------------------------------------------------------------------------- real-time vision
class VisionSession:
    """Per-connection state: tracking detector, sliding window and recording buffer."""

    def __init__(self) -> None:
        self.detector = HolisticDetector()
        self.mode = "idle"  # idle | live
        self.model_id: str | None = None
        self.threshold = 0.8
        self.stability = 5
        self.include_face = True
        self.require_hands = True
        self.window: deque = deque(maxlen=config.SEQUENCE_LENGTH)
        self.window_hands: deque = deque(maxlen=config.SEQUENCE_LENGTH)
        self.recent: deque = deque(maxlen=self.stability)
        self.record: dict | None = None
        self.record_buffer: list[np.ndarray] = []
        self.record_hands: list[bool] = []

    def configure(self, msg: dict) -> None:
        if "mode" in msg:
            self.mode = msg["mode"]
            self.window.clear()
            self.window_hands.clear()
            self.recent.clear()
        if "model_id" in msg:
            self.model_id = msg["model_id"] or None
        if "threshold" in msg:
            self.threshold = float(msg["threshold"])
        if "stability" in msg:
            self.stability = max(1, int(msg["stability"]))
            self.recent = deque(self.recent, maxlen=self.stability)
        if "include_face" in msg:
            self.include_face = bool(msg["include_face"])
        if "require_hands" in msg:
            self.require_hands = bool(msg["require_hands"])

    def process(self, data: bytes) -> list[dict]:
        t0 = time.perf_counter()
        result = self.detector.process_jpeg(data, self.include_face)
        if result is None:
            return [{"type": "error", "message": "Could not decode the camera frame."}]
        out = {"type": "frame", "landmarks": result.landmarks, "hands": result.hands,
               "timing": {"detect_ms": round(result.detect_ms, 1), "model_ms": None}}
        messages = [out]

        if self.record is not None:
            self.record_buffer.append(result.keypoints)
            self.record_hands.append(result.hands > 0)
            out["recording"] = {**self.record, "frame": len(self.record_buffer)}
            if len(self.record_buffer) >= self.record["frames"]:
                messages.append(self._finish_record())
        elif self.mode == "live":
            self.window.append(result.keypoints)
            self.window_hands.append(result.hands > 0)
            out["live"] = self._live_prediction(out["timing"])

        out["timing"]["total_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        return messages

    def _live_prediction(self, timing: dict) -> dict:
        live = {"buffer": len(self.window), "ready": len(self.window) == config.SEQUENCE_LENGTH}
        if not live["ready"]:
            return live
        model = registry.load(self.model_id)
        probs, ms = model.predict(np.stack(self.window))
        timing["model_ms"] = round(ms, 1)
        best = int(np.argmax(probs))
        self.recent.append(best)
        # Without visible hands there is no sign to read: never accept a prediction then.
        hands_ratio = float(np.mean(self.window_hands))
        no_hands = self.require_hands and hands_ratio < MIN_HANDS_RATIO
        if no_hands:
            self.recent.clear()
        confident = float(probs[best]) >= self.threshold and not no_hands
        stable = confident and len(self.recent) == self.recent.maxlen and len(set(self.recent)) == 1
        order = np.argsort(probs)[::-1]
        live.update({
            "model_id": model.id,
            "probabilities": [{"label": model.labels[i], "p": round(float(probs[i]), 4)} for i in order],
            "prediction": model.labels[best],
            "confidence": round(float(probs[best]), 4),
            "confident": confident,
            "stable": stable,
            "no_hands": no_hands,
        })
        return live

    def _finish_record(self) -> dict:
        record = self.record
        seq = np.stack(self.record_buffer[: record["frames"]])
        hands_ratio = round(float(np.mean(self.record_hands)), 3) if self.record_hands else 0.0
        self.record, self.record_buffer, self.record_hands = None, [], []
        if record["purpose"] == "collect":
            count = dataset.add_sample(record["sign"], seq)
            return {"type": "sample_saved", "sign": dataset.normalize_name(record["sign"]),
                    "samples": count, "hands_ratio": hands_ratio}
        model = registry.load(record.get("model_id"))
        probs, ms = model.predict(seq)
        best = int(np.argmax(probs))
        order = np.argsort(probs)[::-1]
        return {
            "type": "trial_result", "model_id": model.id, "expected": record.get("expected"),
            "prediction": model.labels[best], "confidence": round(float(probs[best]), 4),
            "probabilities": [{"label": model.labels[i], "p": round(float(probs[i]), 4)} for i in order],
            "model_ms": round(ms, 1), "hands_ratio": hands_ratio,
        }

    def start_record(self, msg: dict) -> dict:
        purpose = msg.get("purpose")
        if purpose not in ("collect", "predict"):
            raise ValueError("Unknown recording purpose.")
        if purpose == "collect":
            dataset.normalize_name(msg.get("sign", ""))
        else:
            registry.load(msg.get("model_id"))  # load before the clip starts so timing is not skewed
        self.record = {
            "purpose": purpose, "sign": msg.get("sign"), "expected": msg.get("expected"),
            "model_id": msg.get("model_id"), "frames": config.SEQUENCE_LENGTH,
        }
        self.record_buffer, self.record_hands = [], []
        return {"type": "record_started", **self.record}


@app.websocket("/ws/vision")
async def vision_socket(ws: WebSocket):
    await ws.accept()
    session = await asyncio.to_thread(VisionSession)
    await ws.send_json({"type": "ready", "sequence_length": config.SEQUENCE_LENGTH})
    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            try:
                if msg.get("bytes") is not None:
                    for reply in await asyncio.to_thread(session.process, msg["bytes"]):
                        await ws.send_json(reply)
                elif msg.get("text"):
                    data = json.loads(msg["text"])
                    kind = data.get("type")
                    if kind == "config":
                        if data.get("mode") == "live":
                            await ws.send_json({"type": "status", "message": "Loading model…"})
                            await asyncio.to_thread(registry.load, data.get("model_id"))
                        session.configure(data)
                        await ws.send_json({"type": "configured", "mode": session.mode})
                    elif kind == "reset":
                        session.window.clear()
                        session.recent.clear()
                    elif kind == "record":
                        await ws.send_json(await asyncio.to_thread(session.start_record, data))
                    elif kind == "cancel_record":
                        session.record, session.record_buffer, session.record_hands = None, [], []
                        await ws.send_json({"type": "record_cancelled"})
            except (ValueError, KeyError) as exc:
                await ws.send_json({"type": "error", "message": str(exc) or "Invalid request."})
    except WebSocketDisconnect:
        pass
    finally:
        session.detector.close()


# --------------------------------------------------------------------------- frontend
if config.FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=config.FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith(("api/", "ws/")):
            raise HTTPException(404)
        candidate = (config.FRONTEND_DIST / path).resolve()
        if path and candidate.is_file() and config.FRONTEND_DIST in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(config.FRONTEND_DIST / "index.html")
