"""End-to-end tests of the API: collect → train → evaluate → live / trial prediction."""
import os
import tempfile
import time

os.environ["SIGNIA_DATA_DIR"] = tempfile.mkdtemp(prefix="signia-test-")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import config, dataset  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)
FRAME = cv2.imencode(".jpg", np.full((240, 320, 3), 128, np.uint8))[1].tobytes()


def receive_until(ws, kind):
    for _ in range(100):
        msg = ws.receive_json()
        if msg["type"] == kind:
            return msg
    raise AssertionError(f"never received {kind}")


def test_status_and_base_model():
    st = client.get("/api/status").json()
    assert st["device"] == "CPU"
    assert st["active_model"]["id"] == config.PRETRAINED_MODEL_ID
    models = client.get("/api/models").json()
    assert models[0]["builtin"] and len(models[0]["labels"]) == 10


def test_collect_sample_over_websocket():
    with client.websocket_connect("/ws/vision") as ws:
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"type": "record", "purpose": "collect", "sign": "Thank you"})
        assert ws.receive_json()["type"] == "record_started"
        for _ in range(config.SEQUENCE_LENGTH):
            ws.send_bytes(FRAME)
            frame = ws.receive_json()
            assert frame["type"] == "frame" and "recording" in frame
        saved = ws.receive_json()
    assert saved["type"] == "sample_saved" and saved["sign"] == "Thank you" and saved["samples"] == 1
    assert saved["hands_ratio"] == 0.0
    assert client.get("/api/dataset").json()[0]["samples"] == 1


def test_live_prediction_window():
    with client.websocket_connect("/ws/vision") as ws:
        ws.receive_json()
        ws.send_json({"type": "config", "mode": "live", "threshold": 0.5})
        receive_until(ws, "configured")
        last = None
        for _ in range(config.SEQUENCE_LENGTH):
            ws.send_bytes(FRAME)
            last = ws.receive_json()
        assert last["live"]["ready"] is True
        assert len(last["live"]["probabilities"]) == 10
        assert last["timing"]["model_ms"] is not None
        assert last["live"]["no_hands"] is True and last["live"]["stable"] is False


def _fake_samples(name, offset, n=8):
    rng = np.random.default_rng(int(offset * 100))
    for _ in range(n):
        seq = np.zeros((config.SEQUENCE_LENGTH, config.NUM_KEYPOINTS), np.float32)
        seq[:, :132] = offset + rng.normal(0, 0.01, (config.SEQUENCE_LENGTH, 132))
        dataset.add_sample(name, seq)


def test_train_evaluate_activate_and_trial():
    _fake_samples("Alpha", 0.2)
    _fake_samples("Beta", 0.8)
    res = client.post("/api/training/start", json={
        "name": "Test model", "signs": ["Alpha", "Beta"], "epochs": 3, "use_pretrained": True,
    })
    assert res.status_code == 200, res.text
    for _ in range(300):
        job = client.get("/api/training/status").json()
        if job["state"] in ("completed", "failed", "cancelled"):
            break
        time.sleep(0.2)
    assert job["state"] == "completed", job["message"]
    assert len(job["history"]) == 3
    model_id = job["model_id"]

    meta = client.get(f"/api/models/{model_id}").json()
    assert meta["labels"] == ["Alpha", "Beta"]
    assert meta["metrics"]["source"] == "held-out"

    ev = client.post(f"/api/models/{model_id}/evaluate").json()
    assert ev["samples"] == 16 and len(ev["confusion_matrix"]) == 2

    assert client.post(f"/api/models/{model_id}/activate").json()["active"] is True

    with client.websocket_connect("/ws/vision") as ws:
        ws.receive_json()
        ws.send_json({"type": "record", "purpose": "predict", "model_id": model_id, "expected": "Alpha"})
        receive_until(ws, "record_started")
        for _ in range(config.SEQUENCE_LENGTH):
            ws.send_bytes(FRAME)
        result = receive_until(ws, "trial_result")
    assert result["expected"] == "Alpha" and result["prediction"] in ("Alpha", "Beta")

    assert client.delete(f"/api/models/{model_id}").json()["ok"]
    assert client.get("/api/status").json()["active_model"]["id"] == config.PRETRAINED_MODEL_ID


def test_training_validation_errors():
    res = client.post("/api/training/start", json={"signs": ["Alpha"], "epochs": 1})
    assert res.status_code == 400
    with pytest.raises(ValueError):
        dataset.normalize_name("   ")


def test_feedback():
    res = client.post("/api/feedback", data={"name": "A", "email": "a@b.c", "message": "Great", "rating": "5"})
    assert res.json()["ok"]
