from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import mediapipe as mp

LANDMARK_COUNT = 33
KEYPOINT_DIM = LANDMARK_COUNT * 3


def _empty_keypoints() -> List[float]:
    # MediaPipe returns 33 landmarks; zeros mark frames where pose detection fails.
    return [0.0] * KEYPOINT_DIM


def extract_pose_keypoints_from_frame(frame: Any, pose_estimator: Optional[Any] = None) -> List[float]:
    """
    Extract flattened 33x3 (x, y, z) landmarks from one BGR frame.
    Returns a zero vector when no pose is detected.
    """
    # The frontend/backend video pipeline feeds OpenCV BGR frames here.
    if frame is None:
        return _empty_keypoints()

    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    if pose_estimator is not None:
        results = pose_estimator.process(frame_rgb)
    else:
        with mp.solutions.pose.Pose(
            static_image_mode=False,
            model_complexity=1,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        ) as pose:
            results = pose.process(frame_rgb)

    if not results.pose_landmarks:
        return _empty_keypoints()

    values: List[float] = []
    for landmark in results.pose_landmarks.landmark:
        values.extend([float(landmark.x), float(landmark.y), float(landmark.z)])
    return values


def extract_sequence_from_video(
    video_path: str,
    max_frames: Optional[int] = None,
    sample_every_n: int = 1,
) -> Dict[str, Any]:
    """
    Parse video into a sequence of keypoint frames for downstream LSTM inference.
    """
    # Resolve and validate the file before opening it with OpenCV.
    resolved = Path(video_path)
    if not resolved.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    capture = cv2.VideoCapture(str(resolved))
    if not capture.isOpened():
        raise RuntimeError(f"Unable to open video: {video_path}")

    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
    frame_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    frame_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)

    sequence: List[Dict[str, Any]] = []
    frame_index = 0
    processed_frames = 0

    with mp.solutions.pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as pose:
        # Sample frames so the model gets a compact motion sequence instead of raw video.
        while True:
            has_frame, frame = capture.read()
            if not has_frame:
                break

            if sample_every_n > 1 and (frame_index % sample_every_n) != 0:
                frame_index += 1
                continue

            keypoints = extract_pose_keypoints_from_frame(frame, pose_estimator=pose)
            sequence.append({"frame_index": frame_index, "keypoints": keypoints})

            processed_frames += 1
            frame_index += 1

            if max_frames and processed_frames >= max_frames:
                break

    capture.release()

    return {
        "video_path": str(resolved),
        "num_frames": len(sequence),
        "fps": fps,
        "width": frame_width,
        "height": frame_height,
        "sequence": sequence,
    }
