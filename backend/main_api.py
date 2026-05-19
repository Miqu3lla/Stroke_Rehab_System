import base64
import math
import tempfile
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from core.mediapipe_vision import (
    estimate_pose_from_image_bytes,
    extract_sequence_from_video,
)
from core.neural_network import classify_form_sequence
from core.recommender import recommend_next_plan, recommend_session_v2
from core.exercise_catalog import is_lstm_supported
import os
import logging
from core import supabase_db as supabase_db_module
from core.supabase_db import (
    save_patient_profile,
    save_recommendation_log,
    save_form_prediction,
    get_patient_by_id,
    recommendation_log_exists,
)


logger = logging.getLogger("uvicorn.error")
app = FastAPI(title="Stroke Rehab API", version="0.1.0")

# API request models keep the input shape strict for the mobile client.
class JointFrame(BaseModel):
    frame_index: int = Field(..., ge=0)
    keypoints: List[float] = Field(..., description="Flattened 33x3 keypoints")


class FormRequest(BaseModel):
    patient_id: str
    exercise_type: str
    sequence: List[JointFrame]


class RecommendationRequest(BaseModel):
    patient_id: str
    months_in_recovery: int = Field(..., ge=0)
    latest_form_score: float = Field(..., ge=0.0, le=1.0)
    affected_area: str = Field(..., description="arms | legs | both")
    affected_side: str = Field(..., description="left | right | both")


class PatientProfileRequest(BaseModel):
    name: str
    months_in_recovery: int = Field(..., description="1 Month | 2 months | 3 months")
    affected_part: str = Field(..., description="Arms | Legs | Both")
    affected_side: str = Field(..., description="Left | Right | Both")
    id: str = Field(..., description="Supabase Auth user UUID")


# 1 MB decoded ≈ 1.4 M base64 chars (3 bytes per 4 chars + padding). iOS
# frames at quality=0.1 land around 30–80 KB, but some Android phones send
# the full sensor resolution which can be several megabytes. Bumped the cap
# to 10 million characters (≈ 7.5 MB decoded) to accommodate those phones
# while still rejecting payloads big enough to OOM the inference worker.
_MAX_IMAGE_BASE64_CHARS = 10_000_000
_MAX_DECODED_IMAGE_BYTES = 7_500_000


class PoseEstimateRequest(BaseModel):
    image_base64: str = Field(
        ...,
        description="Base64-encoded JPEG/PNG frame",
        max_length=_MAX_IMAGE_BASE64_CHARS,
    )
    exercise_type: str = Field("", description="Exercise hint string (name + focus + area)")
    affected_side: str = Field("right", description="left | right | both")


# MediaPipe BlazePose landmark indices used by realtime form scoring.
_LEFT_SHOULDER, _LEFT_ELBOW, _LEFT_WRIST, _LEFT_HIP, _LEFT_KNEE, _LEFT_ANKLE = 11, 13, 15, 23, 25, 27
_RIGHT_SHOULDER, _RIGHT_ELBOW, _RIGHT_WRIST, _RIGHT_HIP, _RIGHT_KNEE, _RIGHT_ANKLE = 12, 14, 16, 24, 26, 28


def _angle_at_vertex(a: Dict[str, float], b: Dict[str, float], c: Dict[str, float]) -> Optional[float]:
    v1x, v1y = a["x"] - b["x"], a["y"] - b["y"]
    v2x, v2y = c["x"] - b["x"], c["y"] - b["y"]
    m1 = math.hypot(v1x, v1y)
    m2 = math.hypot(v2x, v2y)
    if m1 == 0 or m2 == 0:
        return None
    dot = max(-1.0, min(1.0, (v1x * v2x + v1y * v2y) / (m1 * m2)))
    return round(math.degrees(math.acos(dot)))


def _color_and_score(angle: Optional[float], target: float, green: float, yellow: float) -> Dict[str, Any]:
    if angle is None:
        return {"color": "#888888", "score": 0}
    diff = abs(angle - target)
    if diff <= green:
        return {"color": "#4CAF50", "score": max(90, round(100 - (diff / green) * 5))}
    if diff <= yellow:
        return {"color": "#FFC107", "score": max(50, round(70 - ((diff - green) / (yellow - green)) * 20))}
    return {"color": "#F44336", "score": max(20, round(50 - (diff - yellow) * 0.5))}


def _joint_triple(keypoints: List[Dict[str, float]], i1: int, i2: int, i3: int, min_conf: float = 0.3):
    if len(keypoints) <= max(i1, i2, i3):
        return None
    a, b, c = keypoints[i1], keypoints[i2], keypoints[i3]
    if min(a.get("score", 0), b.get("score", 0), c.get("score", 0)) < min_conf:
        return None
    return a, b, c


def _arm_hint(angle: Optional[float]) -> str:
    if angle is None:
        return "Show your full arm — elbow must be visible"
    diff = angle - 90
    abs_diff = abs(diff)
    if abs_diff <= 10:
        return "Great form! Hold it"
    if abs_diff <= 25:
        return "Curl a little more" if diff > 0 else "Open your arm slightly"
    return "Bend your elbow higher" if diff > 0 else "Lower your arm a bit"


def _leg_hint(angle: Optional[float]) -> str:
    if angle is None:
        return "Show your full leg — knee must be visible"
    diff = angle - 90
    abs_diff = abs(diff)
    if abs_diff <= 15:
        return "Great form! Hold it"
    if abs_diff <= 30:
        return "Bend your knee a bit more" if diff > 0 else "Straighten slightly"
    return "Bend your knee deeper" if diff > 0 else "Straighten your leg"


def _overall_visibility_score(keypoints: List[Dict[str, float]]) -> int:
    if not keypoints:
        return 0
    confidences = [kp.get("score", 0) for kp in keypoints]
    avg = sum(confidences) / len(confidences)
    return round(max(0, min(100, avg * 100)))


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok", "service": "stroke-rehab-backend"}


@app.post("/pose/estimate")
def estimate_pose(payload: PoseEstimateRequest) -> dict:
    """Run MediaPipe Pose on a single mobile camera frame and return keypoints,
    per-segment colours, an overall form score, and a corrective hint. The
    mobile client just draws what comes back — no on-device ML required."""
    try:
        image_bytes = base64.b64decode(payload.image_base64, validate=False)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64 image: {exc}") from exc

    # Belt-and-braces check after decode — the schema's max_length already
    # rejects oversized payloads, but verifying the actual decoded length
    # catches edge cases (e.g. odd padding) before we hand the bytes to
    # cv2.imdecode and acquire MediaPipe's serialised inference lock.
    if len(image_bytes) > _MAX_DECODED_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image too large: {len(image_bytes)} bytes (max {_MAX_DECODED_IMAGE_BYTES})",
        )

    try:
        result = estimate_pose_from_image_bytes(image_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    keypoints = result["keypoints"]
    image_width = result["image_width"]
    image_height = result["image_height"]

    # No body detected — return an empty payload the client can render as "step back".
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

    hint_lower = (payload.exercise_type or "").lower()
    is_arm = any(kw in hint_lower for kw in (
        "upper-limb", "upper limb", "bicep", "arm", "reach", "fine motor",
    )) and "lower" not in hint_lower
    is_leg = any(kw in hint_lower for kw in (
        "lower-limb", "lower limb", "leg", "knee", "ankle", "gait", "squat", "walk", "balance",
    ))

    side = (payload.affected_side or "right").lower()
    left_side = side == "left"

    angles: Dict[str, Any] = {}
    colors: Dict[str, str] = {}
    overall_score = _overall_visibility_score(keypoints)
    hint: Optional[str] = None

    if is_arm:
        sh, el, wr = (_LEFT_SHOULDER, _LEFT_ELBOW, _LEFT_WRIST) if left_side else (_RIGHT_SHOULDER, _RIGHT_ELBOW, _RIGHT_WRIST)
        triple = _joint_triple(keypoints, sh, el, wr)
        if triple:
            angle = _angle_at_vertex(*triple)
            angles["bicepCurl"] = angle
            cs = _color_and_score(angle, target=90, green=10, yellow=25)
            colors["bicepCurl"] = cs["color"]
            overall_score = round((overall_score + cs["score"]) / 2)
        else:
            angles["bicepCurl"] = None
            colors["bicepCurl"] = "#FFC107"
        hint = _arm_hint(angles.get("bicepCurl"))
    elif is_leg:
        hp, kn, an = (_LEFT_HIP, _LEFT_KNEE, _LEFT_ANKLE) if left_side else (_RIGHT_HIP, _RIGHT_KNEE, _RIGHT_ANKLE)
        triple = _joint_triple(keypoints, hp, kn, an)
        if triple:
            angle = _angle_at_vertex(*triple)
            angles["kneeFlexion"] = angle
            cs = _color_and_score(angle, target=90, green=15, yellow=30)
            colors["kneeFlexion"] = cs["color"]
            overall_score = round((overall_score + cs["score"]) / 2)
        else:
            angles["kneeFlexion"] = None
            colors["kneeFlexion"] = "#FFC107"
        hint = _leg_hint(angles.get("kneeFlexion"))
    else:
        # Mixed / full-body: report whichever side is most visible.
        arm_sh, arm_el, arm_wr = (_LEFT_SHOULDER, _LEFT_ELBOW, _LEFT_WRIST) if left_side else (_RIGHT_SHOULDER, _RIGHT_ELBOW, _RIGHT_WRIST)
        leg_hp, leg_kn, leg_an = (_LEFT_HIP, _LEFT_KNEE, _LEFT_ANKLE) if left_side else (_RIGHT_HIP, _RIGHT_KNEE, _RIGHT_ANKLE)
        arm_triple = _joint_triple(keypoints, arm_sh, arm_el, arm_wr)
        leg_triple = _joint_triple(keypoints, leg_hp, leg_kn, leg_an)
        if arm_triple:
            arm_angle = _angle_at_vertex(*arm_triple)
            angles["bicepCurl"] = arm_angle
            cs = _color_and_score(arm_angle, target=90, green=10, yellow=25)
            colors["bicepCurl"] = cs["color"]
            overall_score = round((overall_score + cs["score"]) / 2)
        if leg_triple:
            leg_angle = _angle_at_vertex(*leg_triple)
            angles["kneeFlexion"] = leg_angle
            cs = _color_and_score(leg_angle, target=90, green=15, yellow=30)
            colors["kneeFlexion"] = cs["color"]
            overall_score = round((overall_score + cs["score"]) / 2)
        if angles.get("bicepCurl") is not None:
            hint = _arm_hint(angles["bicepCurl"])
        elif angles.get("kneeFlexion") is not None:
            hint = _leg_hint(angles["kneeFlexion"])
        else:
            hint = "Step back — show your full body"

    return {
        "score": overall_score,
        "keypoints": keypoints,
        "angles": angles,
        "colors": colors,
        "hint": hint,
        "imageWidth": image_width,
        "imageHeight": image_height,
    }





@app.post("/patients")
def create_patient_profile(payload: PatientProfileRequest) -> dict:
    record = {
        "name": payload.name,
        "id": payload.id,
        "stroke_type": "ischemic",
        "months_in_recovery": payload.months_in_recovery,
        "affected_part": payload.affected_part,
        "affected_side": payload.affected_side,
        "source_app": "frontend",
    }
    # Log supabase env/config status for debugging
    try:
        logger.info("SUPABASE configured? %s, SERVICE_ROLE_KEY present? %s", supabase_db_module._configured(), bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY")))
    except Exception:
        logger.info("Could not evaluate supabase config state")

    database_result = save_patient_profile(record)
    saved_patient_id = None
    if database_result.get("stored") and database_result.get("data"):
        saved_patient_id = database_result["data"][0].get("id")
    return {"patient_id": saved_patient_id, "patient_profile": record, "database": database_result}


# This endpoint accepts already-extracted pose sequences from the app and
# runs the StrokeLSTMClassifier. The mobile session orchestrator buffers
# per-frame keypoints from /pose/estimate and flushes them here when the
# patient finishes an exercise. The verdict is persisted to
# `public.form_predictions` so the trajectory recommender (and any future
# analytics) can read per-session LSTM classifications.
#
# For exercise_types the LSTM was never trained on (e.g. shoulder_flexion),
# we skip the call entirely and return a 'skipped' marker rather than
# polluting form_predictions with out-of-distribution guesses.
@app.post("/predict/form")
def predict_form(payload: FormRequest) -> dict:
    if not is_lstm_supported(payload.exercise_type):
        return {
            "patient_id": payload.patient_id,
            "exercise_type": payload.exercise_type,
            "prediction": None,
            "skipped": True,
            "reason": "exercise_type_not_in_lstm_training_set",
        }

    # _normalize_keypoints_to_hip_center treats each frame as a dict (uses
    # frame["keypoints"]), but FormRequest validates incoming frames into
    # JointFrame Pydantic models. Convert to plain dicts before handing off.
    sequence_dicts = [
        {"frame_index": frame.frame_index, "keypoints": frame.keypoints}
        for frame in payload.sequence
    ]
    prediction = classify_form_sequence(payload.exercise_type, sequence_dicts)

    db_result = {"stored": False, "reason": "not_attempted"}
    try:
        # Confidence is float in [0,1] — schema check constraint requires it.
        confidence = float(prediction.get("confidence") or 0.0)
        confidence = max(0.0, min(1.0, confidence))
        db_result = save_form_prediction({
            "patient_id": payload.patient_id,
            "exercise_type": payload.exercise_type,
            "label": prediction.get("label") or "insufficient_data",
            "confidence": confidence,
            "frame_count": int(prediction.get("frame_count") or 0),
            "device": prediction.get("device") or "",
            "model_source": prediction.get("model_source") or "",
            "prediction": prediction,
        })
    except Exception as exc:
        logger.exception("Failed to persist form_prediction: %s", exc)
        db_result = {"stored": False, "error": str(exc)}

    return {
        "patient_id": payload.patient_id,
        "exercise_type": payload.exercise_type,
        "prediction": prediction,
        "database": db_result,
    }


@app.post("/predict/form-from-video")
async def predict_form_from_video(
    patient_id: str = Form(...),
    exercise_type: str = Form(...),
    video: UploadFile = File(...),
) -> Dict[str, Any]:
    # Save the uploaded video temporarily so OpenCV can process it frame by frame.
    suffix = Path(video.filename or "session.mp4").suffix or ".mp4"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
        temp.write(await video.read())
        temp_path = Path(temp.name)

    try:
        sequence_data = extract_sequence_from_video(str(temp_path), sample_every_n=2)
        if is_lstm_supported(exercise_type):
            prediction = classify_form_sequence(exercise_type, sequence_data["sequence"])
        else:
            prediction = None
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Video processing failed: {exc}") from exc
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)

    db_result = {"stored": False, "reason": "skipped"}
    if prediction is not None:
        try:
            confidence = float(prediction.get("confidence") or 0.0)
            confidence = max(0.0, min(1.0, confidence))
            db_result = save_form_prediction({
                "patient_id": patient_id,
                "exercise_type": exercise_type,
                "label": prediction.get("label") or "insufficient_data",
                "confidence": confidence,
                "frame_count": int(prediction.get("frame_count") or 0),
                "device": prediction.get("device") or "",
                "model_source": prediction.get("model_source") or "",
                "prediction": prediction,
            })
        except Exception as exc:
            logger.exception("Failed to persist form_prediction (video): %s", exc)
            db_result = {"stored": False, "error": str(exc)}

    return {
        "patient_id": patient_id,
        "exercise_type": exercise_type,
        "prediction": prediction,
        "skipped": prediction is None,
        "database": db_result,
        "video_meta": {
            "num_frames": sequence_data["num_frames"],
            "fps": sequence_data["fps"],
            "width": sequence_data["width"],
            "height": sequence_data["height"],
        },
    }


# Recommendation endpoint adapts exercise difficulty based on patient context.
@app.post("/recommendation")
def get_recommendation(payload: RecommendationRequest) -> dict:
    recommendation = recommend_next_plan(
        stroke_type="ischemic",
        months_in_recovery=payload.months_in_recovery,
        latest_form_score=payload.latest_form_score,
        affected_area=payload.affected_area,
        affected_side=payload.affected_side,
    )
    database_result = save_recommendation_log(
        {
            "patient_id": payload.patient_id,
            "stroke_type": "ischemic",
            "months_in_recovery": payload.months_in_recovery,
            "latest_form_score": payload.latest_form_score,
            "affected_area": payload.affected_area,
            "affected_side": payload.affected_side,
            "recommendation": recommendation,
        }
    )
    return {"patient_id": payload.patient_id, "recommendation": recommendation, "database": database_result}


# GET recommendation endpoint — Patient X loop: trajectory-aware selection.
# Pulls real history from recommendation_logs, classifies the patient's
# recovery state (progressing / plateauing / deteriorating + signals),
# then downgrades / maintains / upgrades the prescription accordingly.
# Exercise IDs returned are the real `public.exercises` UUIDs so logs
# written later can join cleanly.
@app.get("/recommendation/{patient_id}")
def get_recommended_exercise(patient_id: str) -> dict:
    """Return 3 trajectory-adapted recommended exercises for the patient."""
    result = recommend_session_v2(patient_id, count=3)
    if result.get("error") == "patient_not_found":
        raise HTTPException(status_code=404, detail="Patient not found")

    # Preserve the shape the frontend already consumes ({patient_id, exercises})
    # while exposing trajectory + action metadata for future "Why this?" UI.
    return {
        "patient_id": result["patient_id"],
        "exercises": result["exercises"],
        "trajectory": result.get("trajectory"),
        "action": result.get("action"),
        "recovery_phase": result.get("recovery_phase"),
        "side_guidance": result.get("side_guidance"),
        "model_source": result.get("model_source"),
    }


# POST endpoint to log when a patient starts or completes an exercise
@app.post("/recommendation_logs")
def log_exercise_event(payload: dict) -> dict:
    """Log an exercise event (started, completed, etc.) for tracking.
    
    Expected payload:
    {
        "patient_id": "uuid",
        "recommendation_id": "rec-xxx",
        "action": "started" | "completed",
        "duration_seconds": 300,
        "avg_form_score": 85.5,
        "ts": "2024-05-10T15:30:00Z"
    }
    """
    try:
        # Ensure required fields
        patient_id = payload.get("patient_id")
        recommendation_id = payload.get("recommendation_id")
        action = payload.get("action", "started")
        ts = payload.get("ts")
        duration_seconds = int(payload.get("duration_seconds") or 0)
        avg_form_score = float(payload.get("avg_form_score") or 0.0)
        
        if not all([patient_id, recommendation_id, action]):
            raise HTTPException(
                status_code=400,
                detail="Missing required fields: patient_id, recommendation_id, action"
            )

        patient = get_patient_by_id(patient_id)
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")
        
        # Keep raw event details inside JSONB while writing only the columns
        # that are known to exist in the live recommendation_logs table.
        event_timestamp = ts or __import__("datetime").datetime.utcnow().isoformat()
        # Only completed sessions carry a meaningful form score. Started
        # events have no score yet, and abandoned events were quit before
        # the patient earned one — both must leave latest_form_score NULL
        # so the trajectory recommender can query real scores cleanly.
        score_for_column = avg_form_score if action == "completed" else None

        recommendation_payload = {
            "patient_id": patient_id,
            "recommendation_id": recommendation_id,
            "action": action,
            "duration_seconds": duration_seconds,
            "avg_form_score": score_for_column,
            "timestamp": event_timestamp,
            "patient_snapshot": {
                "stroke_type": patient.get("stroke_type") or "ischemic",
                "months_in_recovery": int(patient.get("months_in_recovery") or 0),
                "affected_area": (patient.get("affected_area") or "both").strip().lower(),
                "affected_side": (patient.get("affected_side") or "both").strip().lower(),
            },
        }

        log_entry = {
            "patient_id": patient_id,
            "latest_form_score": score_for_column,
            "recommendation": recommendation_payload,
        }
        
        # Save to database
        database_result = save_recommendation_log(log_entry)
        
        if database_result.get("stored"):
            return {
                "status": "ok",
                "message": f"Exercise event '{action}' logged for patient {patient_id}",
                "data": recommendation_payload,
            }
        else:
            return {
                "status": "warning",
                "message": f"Event logged locally but database save may have failed",
                "data": recommendation_payload,
                "database_error": database_result,
            }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to log exercise event: {str(exc)}") from exc


@app.post("/sessions")
def save_session(payload: dict) -> dict:
    """Batch-save a completed workout session.

    The frontend buffers per-exercise results in Zustand during a session
    and flushes them here when the patient hits End Workout (or finishes
    the last exercise). Each result becomes one row in recommendation_logs
    with the session_id stored inside the JSONB so all rows in a session
    can be queried together.

    Expected payload:
    {
        "patient_id": "uuid",
        "session_id": "uuid",
        "started_at": "ISO timestamp",
        "ended_at": "ISO timestamp",
        "results": [
            {
                "recommendation_id": "exercise-uuid",
                "exercise_name": "Arm Raise",
                "session_index": 0,
                "ended_via": "finish" | "end_early",
                "avg_form_score": 85.5,
                "duration_seconds": 180
            },
            ...
        ]
    }
    """
    try:
        patient_id = payload.get("patient_id")
        session_id = payload.get("session_id")
        started_at = payload.get("started_at")
        ended_at = payload.get("ended_at")
        results = payload.get("results") or []

        if not patient_id or not session_id:
            raise HTTPException(
                status_code=400,
                detail="Missing required fields: patient_id, session_id",
            )

        if not isinstance(results, list):
            raise HTTPException(status_code=400, detail="results must be a list")

        patient = get_patient_by_id(patient_id)
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")

        patient_snapshot = {
            "stroke_type": patient.get("stroke_type") or "ischemic",
            "months_in_recovery": int(patient.get("months_in_recovery") or 0),
            "affected_area": (patient.get("affected_area") or "both").strip().lower(),
            "affected_side": (patient.get("affected_side") or "both").strip().lower(),
        }

        stored_rows = []
        failed_rows = []
        for result in results:
            try:
                avg_form_score = float(result.get("avg_form_score") or 0.0)
                duration_seconds = int(result.get("duration_seconds") or 0)
                recommendation_id = result.get("recommendation_id")
                exercise_name = result.get("exercise_name") or ""
                session_index = int(result.get("session_index") or 0)
                ended_via = result.get("ended_via") or "finish"

                if not recommendation_id:
                    failed_rows.append({"result": result, "error": "missing recommendation_id"})
                    continue

                recommendation_payload = {
                    "patient_id": patient_id,
                    "session_id": session_id,
                    "recommendation_id": recommendation_id,
                    "exercise_name": exercise_name,
                    "session_index": session_index,
                    "ended_via": ended_via,
                    "avg_form_score": avg_form_score,
                    "duration_seconds": duration_seconds,
                    "started_at": started_at,
                    "ended_at": ended_at,
                    "patient_snapshot": patient_snapshot,
                }

                log_entry = {
                    "patient_id": patient_id,
                    # Both 'finish' and 'end_early' earned a real score, so
                    # both populate the column. Skipped exercises never
                    # reach this endpoint at all (no row, no NULL noise).
                    "latest_form_score": avg_form_score,
                    "recommendation": recommendation_payload,
                }
                # Idempotency: if this (patient_id, session_id, session_index)
                # tuple was already saved, skip the insert so a mobile retry
                # or double-submit doesn't duplicate trajectory history.
                if recommendation_log_exists(patient_id, session_id, session_index):
                    stored_rows.append({
                        "recommendation_id": recommendation_id,
                        "score": avg_form_score,
                        "deduped": True,
                    })
                    continue

                db_result = save_recommendation_log(log_entry)
                if db_result.get("stored"):
                    stored_rows.append({"recommendation_id": recommendation_id, "score": avg_form_score})
                else:
                    failed_rows.append({"recommendation_id": recommendation_id, "db_result": db_result})
            except Exception as exc:
                failed_rows.append({"result": result, "error": str(exc)})

        return {
            "status": "ok" if not failed_rows else "partial",
            "session_id": session_id,
            "stored_count": len(stored_rows),
            "failed_count": len(failed_rows),
            "stored": stored_rows,
            "failed": failed_rows,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save session: {str(exc)}") from exc
