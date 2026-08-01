import asyncio
import base64
import os
import threading
from typing import Any, Dict, Optional

import jwt  # PyJWT
from fastapi import APIRouter, Depends, HTTPException, Request, Response, WebSocket, WebSocketDisconnect

from core.auth import verify_jwt
from core.mediapipe_vision import create_realtime_pose, estimate_pose_from_image_bytes
from core.rate_limit import limiter
from core.session_video import SessionClipRecorder, store_clip_async
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

# How long we wait for the client's auth message after accept(). The
# mobile client sends it within a few hundred ms in normal conditions;
# 10s gives plenty of slack for slow networks before we close as
# unauthorized.
_WS_AUTH_TIMEOUT_SECONDS = 10.0


@router.post("/pose/estimate")
@limiter.limit("90/minute")  # legacy single-frame MediaPipe path (realtime uses /ws/pose)
def estimate_pose(
    request: Request,
    response: Response,
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
            "hint_key": "fallback.show_full_body",
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
        "hint_key": scored.get("hint_key"),
        "imageWidth": image_width,
        "imageHeight": image_height,
    }


def _decode_ws_token(token: str) -> Optional[Dict[str, Any]]:
    """Validate a Supabase JWT supplied via the WS auth message.

    Returns the decoded claims on success, None on failure. The caller
    uses the verified `sub` claim as the patient_id for evidence-clip
    capture — never a client-supplied field — so one connection can't
    store to or delete another patient's clips.
    """
    if not token:
        return None
    secret = os.getenv("SUPABASE_JWT_SECRET", "").strip()
    if not secret:
        return None
    try:
        return jwt.decode(
            token,
            secret,
            algorithms=_JWT_ALGORITHMS,
            audience=_JWT_AUDIENCE,
            options={"require": ["exp", "sub"]},
        )
    except jwt.InvalidTokenError:
        return None


def _run_pose_with_lock(pose_instance: Any, lock: threading.Lock, data: bytes) -> Dict[str, Any]:
    """Run MediaPipe under the per-connection lock. Designed to be called
    inside asyncio.to_thread so the event loop can serve other I/O while
    one frame is in flight. The lock prevents concurrent .process() calls
    on the same Pose object — MediaPipe Pose is not thread-safe and the
    underlying C++ graph crashes on concurrent access."""
    with lock:
        return estimate_pose_from_image_bytes(data, pose_instance=pose_instance)


@router.websocket("/ws/pose")
async def pose_ws(websocket: WebSocket) -> None:
    """Persistent pose-estimation channel for realtime tracking.

    Phase 2 of the live skeleton optimization. The mobile client opens
    one WebSocket per exercise, streams raw JPEG frames as binary
    messages, and receives JSON pose results. Eliminates ~80-150ms of
    per-frame HTTP + base64 overhead that the /pose/estimate path pays.

    Protocol:
      1. Client connects to /ws/pose (no query params).
      2. Server accepts the upgrade.
      3. Client sends an auth JSON message:
            {"type": "auth", "token": "<jwt>",
             "exercise_type": "...", "affected_side": "left|right|both",
             "session_id": "<session key>", "exercise_slug": "..."}
         When session_id is present the backend records a short evidence
         clip from this stream (core/session_video). The patient_id it
         files the clip under comes from the VERIFIED token subject, not
         any client-supplied field.
      4. Server validates JWT (within _WS_AUTH_TIMEOUT_SECONDS) and
         replies {"type": "auth_ok"}. On failure: close 4401.
      5. Client streams JPEG bytes as binary frames; server replies
         with one JSON pose result per frame (always — even on decode
         failures we send an error payload so the client's
         backpressure loop never stalls on a dropped frame).

    Why first-message auth instead of ?token= in the URL: the URL ends
    up in reverse-proxy logs, error traces, and any other place that
    records request URLs, which would leak the bearer token. The
    handshake-message approach keeps the JWT in the message body where
    standard secret-scrubbing applies.

    `exercise_type` and `affected_side` are locked for the life of the
    connection. Switching exercises closes + reopens the socket — the
    frontend already remounts CameraComponent per exercise via
    key=exercise.id so the close happens automatically.

    Each connection owns its own MediaPipe Pose instance via
    create_realtime_pose(). That isolates per-frame tracking + landmark
    smoothing state so one patient's last frame never affects another
    patient's first frame.
    """
    await websocket.accept()

    # ── Step 1: auth handshake ─────────────────────────────────────────
    exercise_type = ""
    affected_side = "right"
    try:
        auth_msg = await asyncio.wait_for(
            websocket.receive_json(),
            timeout=_WS_AUTH_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        await websocket.close(code=_WS_CLOSE_UNAUTHORIZED)
        return
    except WebSocketDisconnect:
        return
    except Exception:
        # Bad JSON / non-text first message → reject.
        await websocket.close(code=_WS_CLOSE_UNAUTHORIZED)
        return

    if not isinstance(auth_msg, dict) or auth_msg.get("type") != "auth":
        await websocket.close(code=_WS_CLOSE_UNAUTHORIZED)
        return
    claims = _decode_ws_token(str(auth_msg.get("token") or ""))
    if not claims:
        await websocket.close(code=_WS_CLOSE_UNAUTHORIZED)
        return
    # patient_id comes from the VERIFIED token subject, never the client's
    # auth-message field. Trusting the client field would let an
    # authenticated user record to — or purge — another patient's clips.
    authed_patient_id = str(claims.get("sub") or "")

    exercise_type = str(auth_msg.get("exercise_type") or "")
    affected_side = str(auth_msg.get("affected_side") or "right")
    await websocket.send_json({"type": "auth_ok"})

    # ── Step 2: per-connection MediaPipe instance ──────────────────────
    pose_instance = create_realtime_pose()
    pose_lock = threading.Lock()

    # Evidence clip recorder (Option A). Buffers the first ~10s of frames
    # where the patient is visible — their first set — then encodes +
    # uploads on a background thread. No-op unless the client supplied a
    # patient_id + session_id in the auth message.
    recorder = SessionClipRecorder(
        patient_id=authed_patient_id,
        session_id=str(auth_msg.get("session_id") or ""),
        # Prefer the clean slug (e.g. "shoulder_flexion"); exercise_type
        # here is the long scoring hint, which makes an ugly filename.
        exercise_type=str(auth_msg.get("exercise_slug") or exercise_type),
    )

    # ── Step 3: frame loop ─────────────────────────────────────────────
    try:
        while True:
            data = await websocket.receive_bytes()
            if not data:
                # Empty payload — reply to keep the client's backpressure
                # loop moving rather than letting its watchdog fire.
                await websocket.send_json({"error": "empty_frame"})
                continue
            if len(data) > MAX_DECODED_IMAGE_BYTES:
                # Drop the frame but keep the connection — the client
                # may just be on a sensor preset that's too large for
                # one frame. No reason to tear down the channel.
                await websocket.send_json({"error": "frame_too_large"})
                continue

            try:
                # Offload to the threadpool so the JPEG decode + MediaPipe
                # C++ call (synchronous, CPU-bound) doesn't block the
                # async event loop. Other connections keep getting their
                # turn while this one's frame is in flight.
                result = await asyncio.to_thread(
                    _run_pose_with_lock, pose_instance, pose_lock, data
                )
            except ValueError:
                # Corrupt JPEG bytes — reply with an error payload so
                # the client clears its in-flight flag instead of
                # waiting out its 2-second watchdog.
                await websocket.send_json({"error": "decode_failed"})
                continue
            except Exception:
                # Unexpected MediaPipe failure — reply with an error so
                # the client loop survives a single bad frame.
                await websocket.send_json({"error": "inference_failed"})
                continue

            keypoints = result["keypoints"]
            image_width = result["image_width"]
            image_height = result["image_height"]

            # Buffer this frame for the evidence clip. The clip only OPENS
            # once a pose is detected (so it doesn't start on blank "step
            # back" frames), but once open it keeps every frame — including
            # brief pose drop-outs — so the video stays continuous rather
            # than stuttering on occlusions. add_frame() returns True the
            # moment the capture window closes → store it off-thread.
            if recorder.add_frame(data, bool(keypoints)):
                store_clip_async(recorder)

            if not keypoints:
                await websocket.send_json({
                    "score": 0,
                    "keypoints": [],
                    "angles": {},
                    "colors": {},
                    "hint": "Step back — show your full body",
                    "hint_key": "fallback.show_full_body",
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
                "hint_key": scored.get("hint_key"),
                "imageWidth": image_width,
                "imageHeight": image_height,
            })
    except WebSocketDisconnect:
        # Normal client close — nothing to clean up beyond the Pose.
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
    finally:
        # Flush a short evidence clip if the exercise ended before the
        # capture window filled (patient finished a quick set / dropped
        # the socket). Skips cleanly when nothing was buffered or the
        # clip already stored mid-stream.
        if recorder.enabled and not recorder.done and recorder.has_frames():
            recorder.finalize()
            store_clip_async(recorder)

        # Tear down the per-connection MediaPipe Pose instance so its
        # C++ graph is freed promptly.
        try:
            pose_instance.close()
        except Exception:
            pass
