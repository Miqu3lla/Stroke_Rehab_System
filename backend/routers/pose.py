import base64
import os
from typing import Any, Dict

import jwt  # PyJWT
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect

from core.auth import verify_jwt
from core.mediapipe_vision import estimate_pose_from_image_bytes
from schemas.pose import PoseEstimateRequest, MAX_DECODED_IMAGE_BYTES
from services.pose_service import score_pose

router = APIRouter()


# WebSocket close codes for the realtime pose channel. The WS protocol
# doesn't have HTTP status codes — the 4000-4999 range is application-
# defined. 4401 = "unauthorized" (matches HTTP 401's intent), 1011 =
# "internal server error" (standard).
_WS_CLOSE_UNAUTHORIZED = 4401
_WS_CLOSE_SERVER_ERROR = 1011

# Duplicated from core/auth.py so the WS handshake doesn't reach into
# that module's private constants. If the algorithm or audience ever
# changes, update both call sites.
_JWT_ALGORITHMS = ["HS256"]
_JWT_AUDIENCE = "authenticated"


@router.post("/pose/estimate")
def estimate_pose(
    payload: PoseEstimateRequest,
    _claims: Dict[str, Any] = Depends(verify_jwt),
) -> dict:
    # No patient_id check — pose scoring is stateless. We just want to
    # ensure the caller is logged in so anonymous traffic can't burn
    # MediaPipe / GPU time on the tunnel.
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


@router.websocket("/ws/pose")
async def pose_ws(
    websocket: WebSocket,
    token: str = Query(...),
    exercise_type: str = Query(""),
    affected_side: str = Query("right"),
) -> None:
    """Persistent pose-estimation channel for realtime tracking.

    Phase 2 of the live skeleton optimization. The mobile client opens
    one WebSocket per exercise, streams raw JPEG frames as binary
    messages, and receives JSON pose results. Eliminates ~80-150ms of
    per-frame HTTP + base64 overhead that the /pose/estimate path pays.

    Auth: the JWT comes in as a query param because React Native's
    WebSocket constructor can't carry a custom Authorization header on
    handshake. Same Supabase JWT secret + same HS256 + same
    "authenticated" audience as the HTTP path — validated once on
    accept; reused implicitly for every frame on this connection.

    `exercise_type` and `affected_side` are locked for the life of the
    connection. Switching exercises closes + reopens the socket — the
    frontend already remounts CameraComponent per exercise via
    key=exercise.id so the close happens automatically.
    """
    secret = os.getenv("SUPABASE_JWT_SECRET", "").strip()
    if not secret:
        # Server misconfig — refuse the handshake before upgrade.
        await websocket.close(code=_WS_CLOSE_SERVER_ERROR)
        return

    try:
        jwt.decode(
            token,
            secret,
            algorithms=_JWT_ALGORITHMS,
            audience=_JWT_AUDIENCE,
            options={"require": ["exp", "sub"]},
        )
    except jwt.InvalidTokenError:
        # Catches expired / wrong-audience / bad-signature / malformed.
        await websocket.close(code=_WS_CLOSE_UNAUTHORIZED)
        return

    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_bytes()
            if not data:
                continue
            if len(data) > MAX_DECODED_IMAGE_BYTES:
                # Drop the frame but keep the connection — the client
                # may just be on a sensor preset that's too large for
                # one frame. No reason to tear down the channel.
                await websocket.send_json({"error": "frame_too_large"})
                continue

            try:
                result = estimate_pose_from_image_bytes(data)
            except ValueError:
                # Corrupt JPEG bytes — skip this frame, keep listening.
                continue

            keypoints = result["keypoints"]
            image_width = result["image_width"]
            image_height = result["image_height"]

            if not keypoints:
                await websocket.send_json({
                    "score": 0,
                    "keypoints": [],
                    "angles": {},
                    "colors": {},
                    "hint": "Step back — show your full body",
                    "imageWidth": image_width,
                    "imageHeight": image_height,
                })
                continue

            scored = score_pose(keypoints, exercise_type, affected_side)
            await websocket.send_json({
                "score": scored["score"],
                "keypoints": keypoints,
                "angles": scored["angles"],
                "colors": scored["colors"],
                "hint": scored["hint"],
                "imageWidth": image_width,
                "imageHeight": image_height,
            })
    except WebSocketDisconnect:
        # Normal client close — nothing to clean up.
        return
    except Exception:
        # Any unexpected error: close with a server-error code so the
        # client can decide whether to reconnect. Swallow the close
        # exception in case the socket is already gone.
        try:
            await websocket.close(code=_WS_CLOSE_SERVER_ERROR)
        except Exception:
            pass
        return
