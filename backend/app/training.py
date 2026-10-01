"""Background training job for new signs, plus evaluation helpers."""
from __future__ import annotations

import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field

import numpy as np

from . import config, dataset
from .registry import registry
from .tf_setup import tf

MIN_SAMPLES_PER_SIGN = 5


def build_model(num_classes: int):
    """Same LSTM architecture as the shipped base model."""
    layers = tf.keras.layers
    return tf.keras.Sequential([
        layers.Input(shape=(config.SEQUENCE_LENGTH, config.NUM_KEYPOINTS)),
        layers.LSTM(64, return_sequences=True, activation="relu"),
        layers.Dropout(0.2),
        layers.LSTM(128, return_sequences=True, activation="relu"),
        layers.Dropout(0.2),
        layers.LSTM(64, return_sequences=False, activation="relu"),
        layers.Dropout(0.2),
        layers.Dense(64, activation="relu"),
        layers.Dense(32, activation="relu"),
        layers.Dense(num_classes, activation="softmax"),
    ])


def transfer_base_weights(model) -> int:
    """Copy every layer except the classifier head from the base model (transfer learning)."""
    base = tf.keras.models.load_model(config.PRETRAINED_MODEL_PATH, compile=False)
    copied = 0
    for src, dst in zip(base.layers[:-1], model.layers[:-1]):
        weights = src.get_weights()
        if weights and [w.shape for w in weights] == [w.shape for w in dst.get_weights()]:
            dst.set_weights(weights)
            copied += 1
    return copied


def stratified_split(y: np.ndarray, test_fraction: float, seed: int = 42) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    train_idx, test_idx = [], []
    for cls in np.unique(y):
        idx = rng.permutation(np.where(y == cls)[0])
        n_test = int(round(len(idx) * test_fraction))
        n_test = min(max(n_test, 1 if len(idx) >= 4 else 0), len(idx) - 1)
        test_idx.extend(idx[:n_test])
        train_idx.extend(idx[n_test:])
    return np.array(train_idx, int), np.array(test_idx, int)


def augment(x: np.ndarray, y: np.ndarray, copies: int, seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """Add jittered copies (small noise + scale/shift) to make small datasets more robust."""
    rng = np.random.default_rng(seed)
    xs, ys = [x], [y]
    for _ in range(copies):
        scale = rng.uniform(0.95, 1.05, size=(len(x), 1, 1))
        shift = rng.normal(0, 0.01, size=(len(x), 1, 1))
        noise = rng.normal(0, 0.003, size=x.shape)
        mask = (x != 0).astype(np.float32)  # keep missing landmarks at zero
        xs.append(((x * scale + shift + noise) * mask).astype(np.float32))
        ys.append(y)
    return np.concatenate(xs), np.concatenate(ys)


def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray, labels: list[str]) -> dict:
    n = len(labels)
    cm = np.zeros((n, n), int)
    for t, p in zip(y_true, y_pred):
        cm[t, p] += 1
    per_class = []
    for i, label in enumerate(labels):
        tp = cm[i, i]
        support = int(cm[i].sum())
        predicted = int(cm[:, i].sum())
        precision = tp / predicted if predicted else 0.0
        recall = tp / support if support else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per_class.append({
            "label": label, "precision": round(float(precision), 4), "recall": round(float(recall), 4),
            "f1": round(float(f1), 4), "support": support,
        })
    total = int(cm.sum())
    return {
        "accuracy": round(float(np.trace(cm) / total), 4) if total else None,
        "samples": total,
        "labels": labels,
        "confusion_matrix": cm.tolist(),
        "per_class": per_class,
    }


def evaluate_model(model_id: str) -> dict:
    """Evaluate a model on every recorded sample whose sign name matches one of its labels."""
    loaded = registry.load(model_id)
    recorded = {s["name"].lower(): s["name"] for s in dataset.list_signs() if s["samples"] > 0}
    matched = [label for label in loaded.labels if label.lower() in recorded]
    if not matched:
        raise ValueError("No recorded samples match this model's signs. Record samples in the Training section first.")
    x, y_local, _ = dataset.load([recorded[m.lower()] for m in matched])
    label_index = {label: i for i, label in enumerate(loaded.labels)}
    y_true = np.array([label_index[matched[i]] for i in y_local])
    y_pred = np.argmax(loaded.predict_batch(x), axis=1)
    metrics = compute_metrics(y_true, y_pred, loaded.labels)
    metrics["evaluated_signs"] = matched
    metrics["source"] = "dataset"
    metrics["evaluated_at"] = time.time()
    return metrics


@dataclass
class TrainingJob:
    id: str
    name: str
    signs: list[str]
    epochs: int
    use_pretrained: bool
    augment: bool
    test_fraction: float
    state: str = "pending"  # pending | preparing | training | evaluating | completed | failed | cancelled
    message: str = ""
    epoch: int = 0
    history: list[dict] = field(default_factory=list)
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    model_id: str | None = None
    metrics: dict | None = None
    cancel_requested: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "signs": self.signs, "epochs": self.epochs,
            "use_pretrained": self.use_pretrained, "augment": self.augment,
            "test_fraction": self.test_fraction, "state": self.state, "message": self.message,
            "epoch": self.epoch, "history": self.history, "started_at": self.started_at,
            "finished_at": self.finished_at, "model_id": self.model_id, "metrics": self.metrics,
        }


class _ProgressCallback(tf.keras.callbacks.Callback):
    def __init__(self, job: TrainingJob):
        super().__init__()
        self.job = job

    def on_epoch_end(self, epoch, logs=None):
        logs = logs or {}
        self.job.epoch = epoch + 1
        self.job.history.append({
            "epoch": epoch + 1,
            **{k: round(float(v), 4) for k, v in logs.items() if isinstance(v, (int, float, np.floating))},
        })
        acc = logs.get("categorical_accuracy")
        self.job.message = f"Epoch {epoch + 1}/{self.job.epochs}" + (f" · accuracy {acc:.0%}" if acc is not None else "")
        if self.job.cancel_requested:
            self.model.stop_training = True


class Trainer:
    def __init__(self) -> None:
        self.job: TrainingJob | None = None
        self._lock = threading.Lock()

    def is_running(self) -> bool:
        return self.job is not None and self.job.state in ("pending", "preparing", "training", "evaluating")

    def start(self, name: str, signs: list[str], epochs: int, use_pretrained: bool,
              augment: bool, test_fraction: float) -> TrainingJob:
        with self._lock:
            if self.is_running():
                raise RuntimeError("A training job is already running.")
            if len(signs) < 2:
                raise ValueError("Select at least two signs to train a classifier.")
            counts = {s["name"].lower(): s["samples"] for s in dataset.list_signs()}
            for sign in signs:
                if sign.lower() not in counts:
                    raise ValueError(f"Unknown sign '{sign}'.")
                if counts[sign.lower()] < MIN_SAMPLES_PER_SIGN:
                    raise ValueError(f"'{sign}' needs at least {MIN_SAMPLES_PER_SIGN} samples (has {counts[sign.lower()]}).")
            job = TrainingJob(
                id=uuid.uuid4().hex[:8], name=name.strip() or "Custom model", signs=signs,
                epochs=int(np.clip(epochs, 1, 1000)), use_pretrained=use_pretrained, augment=augment,
                test_fraction=float(np.clip(test_fraction, 0.0, 0.5)),
            )
            self.job = job
        threading.Thread(target=self._run, args=(job,), daemon=True).start()
        return job

    def cancel(self) -> None:
        if self.is_running():
            self.job.cancel_requested = True
            self.job.message = "Cancelling after the current epoch…"

    def _run(self, job: TrainingJob) -> None:
        try:
            job.state, job.message = "preparing", "Loading recorded samples…"
            x, y, labels = dataset.load(job.signs)
            train_idx, test_idx = stratified_split(y, job.test_fraction)
            x_train, y_train = x[train_idx], y[train_idx]
            if job.augment:
                x_train, y_train = augment(x_train, y_train, copies=2)

            model = build_model(len(labels))
            if job.use_pretrained:
                job.message = "Initialising from the base model (transfer learning)…"
                transfer_base_weights(model)
            model.compile(
                optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3 if not job.use_pretrained else 5e-4, clipnorm=1.0),
                loss="categorical_crossentropy",
                metrics=["categorical_accuracy"],
            )

            job.state, job.message = "training", "Training started…"
            num_classes = len(labels)
            fit_kwargs = {}
            if len(test_idx):
                fit_kwargs["validation_data"] = (x[test_idx], tf.keras.utils.to_categorical(y[test_idx], num_classes))
            model.fit(
                x_train, tf.keras.utils.to_categorical(y_train, num_classes),
                epochs=job.epochs, batch_size=16, shuffle=True, verbose=0,
                callbacks=[_ProgressCallback(job)], **fit_kwargs,
            )
            if job.cancel_requested:
                job.state, job.message = "cancelled", "Training cancelled. No model was saved."
                return

            job.state, job.message = "evaluating", "Evaluating on held-out samples…"
            eval_idx = test_idx if len(test_idx) else train_idx
            y_pred = np.argmax(model.predict(x[eval_idx], verbose=0), axis=1)
            metrics = compute_metrics(y[eval_idx], y_pred, labels)
            metrics["source"] = "held-out" if len(test_idx) else "training"
            metrics["evaluated_at"] = time.time()

            model_id = f"{dataset.slugify(job.name)[:24]}-{job.id}"
            meta = {
                "id": model_id, "name": job.name, "labels": labels, "created_at": time.time(),
                "builtin": False, "description": f"Trained on {len(labels)} signs ({len(x)} samples).",
                "metrics": metrics, "history": job.history,
                "params": {
                    "epochs": job.epoch, "use_pretrained": job.use_pretrained, "augment": job.augment,
                    "test_fraction": job.test_fraction, "train_samples": int(len(train_idx)),
                    "test_samples": int(len(test_idx)),
                },
            }
            registry.save_meta(meta)
            model.save(registry.model_path(model_id))
            job.model_id, job.metrics = model_id, metrics
            acc = metrics["accuracy"]
            job.state = "completed"
            job.message = "Model saved." + (f" Held-out accuracy: {acc:.0%}." if acc is not None and len(test_idx) else "")
        except Exception as exc:  # surface any failure in the UI
            traceback.print_exc()
            job.state, job.message = "failed", f"Training failed: {exc}"
        finally:
            job.finished_at = time.time()


trainer = Trainer()
