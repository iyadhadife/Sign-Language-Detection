"""Model registry: the shipped base model plus models trained from the UI."""
from __future__ import annotations

import json
import shutil
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import config
from .tf_setup import tf

ACTIVE_FILE_NAME = "active_model.txt"


@dataclass
class LoadedModel:
    id: str
    labels: list[str]
    keras_model: object
    _fn: object

    def predict(self, sequence: np.ndarray) -> tuple[np.ndarray, float]:
        """Run one (30, 1662) sequence through the model. Returns (probabilities, ms)."""
        start = time.perf_counter()
        x = tf.convert_to_tensor(sequence[np.newaxis, ...], dtype=tf.float32)
        probs = self._fn(x).numpy()[0]
        return probs, (time.perf_counter() - start) * 1000

    def predict_batch(self, sequences: np.ndarray) -> np.ndarray:
        return self.keras_model.predict(sequences, verbose=0)


def _base_meta() -> dict:
    return {
        "id": config.PRETRAINED_MODEL_ID,
        "name": "Pretrained base model",
        "labels": config.PRETRAINED_LABELS,
        "created_at": None,
        "builtin": True,
        "description": "Pretrained LSTM shipped with the application.",
        "metrics": None,
        "history": None,
        "params": None,
    }


class ModelRegistry:
    def __init__(self) -> None:
        self._cache: dict[str, LoadedModel] = {}
        self._lock = threading.Lock()

    # ---- metadata -------------------------------------------------------
    def _model_dir(self, model_id: str) -> Path:
        return config.MODELS_DIR / model_id

    def list(self) -> list[dict]:
        models = [_base_meta()]
        if config.MODELS_DIR.exists():
            trained = []
            for d in config.MODELS_DIR.iterdir():
                meta_file = d / "meta.json"
                if d.is_dir() and meta_file.exists():
                    try:
                        trained.append(json.loads(meta_file.read_text()))
                    except json.JSONDecodeError:
                        continue
            trained.sort(key=lambda m: m.get("created_at") or 0, reverse=True)
            models.extend(trained)
        active = self.active_id()
        for m in models:
            m["active"] = m["id"] == active
        return models

    def get_meta(self, model_id: str) -> dict | None:
        if model_id == config.PRETRAINED_MODEL_ID:
            meta = _base_meta()
        else:
            meta_file = self._model_dir(model_id) / "meta.json"
            if not meta_file.exists():
                return None
            meta = json.loads(meta_file.read_text())
        meta["active"] = meta["id"] == self.active_id()
        return meta

    def save_meta(self, meta: dict) -> None:
        d = self._model_dir(meta["id"])
        d.mkdir(parents=True, exist_ok=True)
        (d / "meta.json").write_text(json.dumps(meta, indent=2))

    def active_id(self) -> str:
        f = config.DATA_DIR / ACTIVE_FILE_NAME
        if f.exists():
            model_id = f.read_text().strip()
            if model_id == config.PRETRAINED_MODEL_ID or (self._model_dir(model_id) / "meta.json").exists():
                return model_id
        return config.PRETRAINED_MODEL_ID

    def set_active(self, model_id: str) -> None:
        if self.get_meta(model_id) is None:
            raise KeyError(model_id)
        self.load(model_id)  # fail early if the file is broken
        (config.DATA_DIR / ACTIVE_FILE_NAME).write_text(model_id)

    def delete(self, model_id: str) -> None:
        if model_id == config.PRETRAINED_MODEL_ID:
            raise ValueError("The built-in model cannot be deleted.")
        d = self._model_dir(model_id)
        if not d.exists():
            raise KeyError(model_id)
        with self._lock:
            self._cache.pop(model_id, None)
        shutil.rmtree(d)

    # ---- loading --------------------------------------------------------
    def model_path(self, model_id: str) -> Path:
        if model_id == config.PRETRAINED_MODEL_ID:
            return config.PRETRAINED_MODEL_PATH
        return self._model_dir(model_id) / "model.keras"

    def load(self, model_id: str | None = None) -> LoadedModel:
        model_id = model_id or self.active_id()
        with self._lock:
            if model_id in self._cache:
                return self._cache[model_id]
            meta = self.get_meta(model_id)
            if meta is None:
                raise KeyError(model_id)
            keras_model = tf.keras.models.load_model(self.model_path(model_id), compile=False)

            # A traced tf.function avoids the heavy per-call overhead of model.predict(),
            # which matters when predicting on every frame on a CPU.
            @tf.function(input_signature=[tf.TensorSpec([1, config.SEQUENCE_LENGTH, config.NUM_KEYPOINTS], tf.float32)])
            def fn(x):
                return keras_model(x, training=False)

            loaded = LoadedModel(model_id, list(meta["labels"]), keras_model, fn)
            loaded.predict(np.zeros((config.SEQUENCE_LENGTH, config.NUM_KEYPOINTS), np.float32))  # warm-up trace
            self._cache[model_id] = loaded
            return loaded


registry = ModelRegistry()
