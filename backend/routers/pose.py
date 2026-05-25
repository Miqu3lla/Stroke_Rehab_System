import base64

from fastapi import APIRouter, HTTPException

from core.mediapipe_vision import estimate_pose_from_image_bytes
from schemas.pose import PoseEstimateRequest, MAX_DECODED_IMAGE_BYTES
from services.pose_service import score_pose

router = APIRouter()


@router.post("/pose/estimate")
def estimate_pose(payload: PoseEstimateRequest) -> dict:
    """Run MediaPipe Pose on a single mobile camera frame and return keypoints,
    per-segment colours, an overall form score, and a corrective hint."""
    try:
        image_bytes = base64.b64decode(payload.image_base64, validate=False)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64 image: {exc}") from exc

    if len(image_bytes) > MAX_DECODED_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image too large: {len(image_bytes)} bytes (max {MAX_DECODED_IMAGE_BYTES})",
        )

    try:
        result = estimate_pose_from_image_bytes(image_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    keypoints = result["keypoints"]
    image_width = result["image_width"]
    image_height = result["image_height"]

    if not keypoints:
        return {
            "score": 0,
            "keypoints": [],
            "angles": {},
            "colors": {},
            "hint": "Step back — show your full body",
            "imageWidth": image_width,
            "imageHeight": image_height,
        }

    scored = score_pose(keypoints, payload.exercise_type, payload.affected_side)

    return {
        "score": scored["score"],
        "keypoints": keypoints,
        "angles": scored["angles"],
        "colors": scored["colors"],
        "hint": scored["hint"],
        "imageWidth": image_width,
        "imageHeight": image_height,
    }
