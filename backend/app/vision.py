"""MediaPipe Holistic landmark detection and keypoint extraction."""
from __future__ import annotations

import time
from dataclasses import dataclass

import cv2
import mediapipe as mp
import numpy as np

from . import config

mp_holistic = mp.solutions.holistic


def extract_keypoints(results) -> np.ndarray:
    """Flatten Holistic results into the 1662-value vector the model expects.

    The order (pose, face, left hand, right hand) must match the one used
    when the training data was recorded.
    """
    pose = (
        np.array([[r.x, r.y, r.z, r.visibility] for r in results.pose_landmarks.landmark]).flatten()
        if results.pose_landmarks else np.zeros(33 * 4)
    )
    face = (
        np.array([[r.x, r.y, r.z] for r in results.face_landmarks.landmark]).flatten()
        if results.face_landmarks else np.zeros(468 * 3)
    )
    lh = (
        np.array([[r.x, r.y, r.z] for r in results.left_hand_landmarks.landmark]).flatten()
        if results.left_hand_landmarks else np.zeros(21 * 3)
    )
    rh = (
        np.array([[r.x, r.y, r.z] for r in results.right_hand_landmarks.landmark]).flatten()
        if results.right_hand_landmarks else np.zeros(21 * 3)
    )
    return np.concatenate([pose, face, lh, rh]).astype(np.float32)


def _xy(landmark_list, step: int = 1) -> list[float] | None:
    """Compact [x0, y0, x1, y1, ...] list for drawing on the client."""
    if landmark_list is None:
        return None
    out: list[float] = []
    for lm in landmark_list.landmark[::step]:
        out.append(round(lm.x, 4))
        out.append(round(lm.y, 4))
    return out


@dataclass
class FrameResult:
    keypoints: np.ndarray
    landmarks: dict
    hands: int
    detect_ms: float


class HolisticDetector:
    """One detector per client session: Holistic keeps tracking state between frames."""

    def __init__(self, model_complexity: int | None = None):
        self._holistic = mp_holistic.Holistic(
            static_image_mode=False,
            model_complexity=config.MODEL_COMPLEXITY if model_complexity is None else model_complexity,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

    def process_jpeg(self, data: bytes, include_face: bool = True) -> FrameResult | None:
        frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            return None
        return self.process_bgr(frame, include_face)

    def process_bgr(self, frame: np.ndarray, include_face: bool = True) -> FrameResult:
        start = time.perf_counter()
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        results = self._holistic.process(rgb)
        detect_ms = (time.perf_counter() - start) * 1000

        landmarks = {
            "pose": _xy(results.pose_landmarks),
            "face": _xy(results.face_landmarks, step=2) if include_face else None,
            "left_hand": _xy(results.left_hand_landmarks),
            "right_hand": _xy(results.right_hand_landmarks),
        }
        hands = int(results.left_hand_landmarks is not None) + int(results.right_hand_landmarks is not None)
        return FrameResult(extract_keypoints(results), landmarks, hands, detect_ms)

    def close(self) -> None:
        self._holistic.close()
