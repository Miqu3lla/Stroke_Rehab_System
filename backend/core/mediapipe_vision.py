import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import mediapipe as mp
import numpy as np

LANDMARK_COUNT = 33
KEYPOINT_DIM = LANDMARK_COUNT * 3

# Single reusable Pose instance for realtime single-frame requests from the
# mobile client. MediaPipe Pose isn't thread-safe, so serialize access with a
# lock — FastAPI runs sync endpoints in a thread pool and concurrent .process()
# calls on the same Pose object crash the underlying C++ graph.
_realtime_pose_lock = threading.Lock()
_realtime_pose_instance: Optional[Any] = None


def _get_realtime_pose():
    global _realtime_pose_instance
    if _realtime_pose_instance is None:
        # static_image_mode=False enables MediaPipe's per-frame tracking — it
        # only runs the heavy detector once, then tracks landmarks frame-to-
        # frame. 2-5x faster than re-detecting from scratch every call.
        # model_complexity=0 is the Lite model — ~2-3x faster than Full (1)
        # with minor accuracy loss that doesn't matter for slow rehab motion.
        _realtime_pose_instance = mp.solutions.pose.Pose(
            static_image_mode=False,
            model_complexity=0,
            smooth_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
    return _realtime_pose_instance


def estimate_pose_from_image_bytes(image_bytes: bytes) -> Dict[str, Any]:
    """
    Decode a single JPEG/PNG and run MediaPipe Pose on it. Returns 33 keypoints
    in PIXEL coordinates (matching the input image dimensions) so the mobile
    client can map them directly to its camera view.
    """
    np_arr = np.frombuffer(image_bytes, np.uint8)
    bgr_frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if bgr_frame is None:
        raise ValueError("Failed to decode image bytes")

    # Mirror the frame to match the mirrored selfie preview on the phone.
    # expo-camera's CameraView shows the front-camera feed flipped (so raising
    # your right hand appears on the screen-left), but takePictureAsync returns
    # the un-mirrored photo. Without this flip the skeleton draws on the
    # opposite side of the body from what the user actually sees on screen.
    bgr_frame = cv2.flip(bgr_frame, 1)

    h, w = bgr_frame.shape[:2]
    rgb_frame = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)

    with _realtime_pose_lock:
        results = _get_realtime_pose().process(rgb_frame)

    if not results.pose_landmarks:
        return {"keypoints": [], "image_width": w, "image_height": h}

    keypoints: List[Dict[str, float]] = []
    for landmark in results.pose_landmarks.landmark:
        keypoints.append({
            "x": float(landmark.x) * w,
            "y": float(landmark.y) * h,
            "z": float(landmark.z) * w,
            "score": float(landmark.visibility),
        })

    return {"keypoints": keypoints, "image_width": w, "image_height": h}


def _empty_keypoints() -> List[float]:
    # MediaPipe returns 33 landmarks; zeros mark frames where pose detection fails.
    return [0.0] * KEYPOINT_DIM


def _normalize_keypoints_to_hip_center(sequence: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Normalize all keypoints in a sequence to be centered at the hip midpoint.
    This makes the pose invariant to camera position and scale.
    
    The algorithm:
    1. For each frame, extract left hip (index 23) and right hip (index 24)
    2. Calculate the center point between the two hips
    3. Subtract that center from all 33 landmarks
    4. This anchors the skeleton at (0,0,0) regardless of room position
    """
    normalized_sequence = []
    
    for frame_dict in sequence:
        keypoints = frame_dict["keypoints"]
        
        # Skip frames with no valid pose (all zeros)
        if not any(keypoints):
            normalized_sequence.append(frame_dict)
            continue
        
        # Unflatten: convert 99 floats → 33 landmarks × 3 coordinates
        landmarks = [[keypoints[i + j] for j in range(3)] for i in range(0, KEYPOINT_DIM, 3)]
        
        # Extract hip centers (MediaPipe indices 23 and 24)
        left_hip = landmarks[23]
        right_hip = landmarks[24]
        
        # Calculate center point
        center = [(left_hip[i] + right_hip[i]) / 2.0 for i in range(3)]
        
        # Translate all landmarks so center becomes (0, 0, 0)
        normalized_landmarks = [[lm[i] - center[i] for i in range(3)] for lm in landmarks]
        
        # Re-flatten to 99 floats
        normalized_keypoints = [v for lm in normalized_landmarks for v in lm]
        
        # Update frame dict with normalized keypoints
        normalized_frame = frame_dict.copy()
        normalized_frame["keypoints"] = normalized_keypoints
        normalized_sequence.append(normalized_frame)
    
    return normalized_sequence


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

    # Normalize all keypoints to be anchored at hip center
    normalized_sequence = _normalize_keypoints_to_hip_center(sequence)

    return {
        "video_path": str(resolved),
        "num_frames": len(normalized_sequence),
        "fps": fps,
        "width": frame_width,
        "height": frame_height,
        "sequence": normalized_sequence,
    }
