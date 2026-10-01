"""Runtime configuration, read from environment variables."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# Writable storage: recorded samples, trained models, feedback.
DATA_DIR = Path(os.environ.get("SIGNIA_DATA_DIR", BASE_DIR / "data")).resolve()
DATASET_DIR = DATA_DIR / "dataset"
MODELS_DIR = DATA_DIR / "models"
FEEDBACK_FILE = DATA_DIR / "feedback.jsonl"

# Read-only pretrained model shipped with the application.
PRETRAINED_MODEL_PATH = BASE_DIR / "pretrained" / "9mots500.h5"
PRETRAINED_MODEL_ID = "base-10-signs"
PRETRAINED_LABELS = [
    "Hello", "Well done", "How are you?", "No", "Yes",
    "Goodbye", "Sorry", "Please", "Good", "Not good",
]

# Built frontend (served by FastAPI in production / Docker).
FRONTEND_DIST = Path(os.environ.get("SIGNIA_FRONTEND_DIST", BASE_DIR.parent / "frontend" / "dist")).resolve()

# Model input: 30 frames x 1662 keypoints (pose 33*4 + face 468*3 + 2 hands 21*3).
SEQUENCE_LENGTH = 30
NUM_KEYPOINTS = 33 * 4 + 468 * 3 + 21 * 3 * 2

# MediaPipe Holistic complexity: 0 = fastest (recommended on CPU), 1 = balanced, 2 = accurate.
MODEL_COMPLEXITY = int(os.environ.get("SIGNIA_MODEL_COMPLEXITY", "1"))

# CPU threading for TensorFlow (0 = let TF decide).
TF_THREADS = int(os.environ.get("SIGNIA_TF_THREADS", "0"))


def ensure_dirs() -> None:
    for d in (DATA_DIR, DATASET_DIR, MODELS_DIR):
        d.mkdir(parents=True, exist_ok=True)
