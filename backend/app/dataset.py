"""Recorded training samples: one .npy file of shape (30, 1662) per sequence."""
from __future__ import annotations

import json
import re
import shutil
import time
import uuid
from pathlib import Path

import numpy as np

from . import config

SIGN_META = "sign.json"
MAX_NAME_LENGTH = 40


def normalize_name(name: str) -> str:
    name = " ".join(name.strip().split())
    if not name:
        raise ValueError("Sign name cannot be empty.")
    if len(name) > MAX_NAME_LENGTH:
        raise ValueError(f"Sign name must be at most {MAX_NAME_LENGTH} characters.")
    return name


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or uuid.uuid4().hex[:8]


def _sign_dir(name: str) -> Path:
    return config.DATASET_DIR / slugify(normalize_name(name))


def _samples(d: Path) -> list[Path]:
    return sorted(d.glob("*.npy"))


def list_signs() -> list[dict]:
    if not config.DATASET_DIR.exists():
        return []
    signs = []
    for d in sorted(config.DATASET_DIR.iterdir()):
        meta_file = d / SIGN_META
        if not d.is_dir() or not meta_file.exists():
            continue
        meta = json.loads(meta_file.read_text())
        files = _samples(d)
        signs.append({
            "name": meta["name"],
            "slug": d.name,
            "samples": len(files),
            "updated_at": max((f.stat().st_mtime for f in files), default=meta.get("created_at")),
        })
    signs.sort(key=lambda s: s["name"].lower())
    return signs


def add_sample(name: str, sequence: np.ndarray) -> int:
    name = normalize_name(name)
    if sequence.shape != (config.SEQUENCE_LENGTH, config.NUM_KEYPOINTS):
        raise ValueError(f"Unexpected sequence shape {sequence.shape}.")
    d = _sign_dir(name)
    d.mkdir(parents=True, exist_ok=True)
    meta_file = d / SIGN_META
    if not meta_file.exists():
        meta_file.write_text(json.dumps({"name": name, "created_at": time.time()}))
    np.save(d / f"{time.time_ns()}.npy", sequence.astype(np.float32))
    return len(_samples(d))


def delete_sign(name: str) -> None:
    d = _sign_dir(name)
    if not d.exists():
        raise KeyError(name)
    shutil.rmtree(d)


def delete_last_sample(name: str) -> int:
    d = _sign_dir(name)
    files = _samples(d) if d.exists() else []
    if not files:
        raise KeyError(name)
    files[-1].unlink()
    return len(files) - 1


def load(names: list[str]) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Load samples for the given signs. Returns (X, y_index, labels)."""
    labels: list[str] = []
    xs: list[np.ndarray] = []
    ys: list[int] = []
    by_slug = {s["slug"]: s for s in list_signs()}
    for name in names:
        slug = slugify(normalize_name(name))
        if slug not in by_slug:
            raise KeyError(name)
        labels.append(by_slug[slug]["name"])
        for f in _samples(config.DATASET_DIR / slug):
            xs.append(np.load(f))
            ys.append(len(labels) - 1)
    if not xs:
        return np.zeros((0, config.SEQUENCE_LENGTH, config.NUM_KEYPOINTS), np.float32), np.zeros(0, int), labels
    return np.stack(xs).astype(np.float32), np.array(ys), labels
