import datetime
import logging

from fastapi import APIRouter, HTTPException

from core.recommender import recommend_next_plan, recommend_session_v2
from core.supabase_db import save_recommendation_log, get_patient_by_id
from schemas.prediction import RecommendationRequest

logger = logging.getLogger("uvicorn.error")
router = APIRouter()


@router.post("/recommendation")
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


@router.get("/recommendation/{patient_id}")
def get_recommended_exercise(patient_id: str) -> dict:
    """Return 3 trajectory-adapted recommended exercises for the patient."""
    result = recommend_session_v2(patient_id, count=3)
    if result.get("error") == "patient_not_found":
        raise HTTPException(status_code=404, detail="Patient not found")

    return {
        "patient_id": result["patient_id"],
        "exercises": result["exercises"],
        "trajectory": result.get("trajectory"),
        "action": result.get("action"),
        "recovery_phase": result.get("recovery_phase"),
        "side_guidance": result.get("side_guidance"),
        "model_source": result.get("model_source"),
    }


@router.post("/recommendation_logs")
def log_exercise_event(payload: dict) -> dict:
    """Log an exercise event (started, completed, etc.) for tracking."""
    try:
        patient_id = payload.get("patient_id")
        recommendation_id = payload.get("recommendation_id")
        action = payload.get("action", "started")
        ts = payload.get("ts")
        duration_seconds = int(payload.get("duration_seconds") or 0)
        avg_form_score = float(payload.get("avg_form_score") or 0.0)

        if not all([patient_id, recommendation_id, action]):
            raise HTTPException(
                status_code=400,
                detail="Missing required fields: patient_id, recommendation_id, action",
            )

        patient = get_patient_by_id(patient_id)
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")

        event_timestamp = ts or datetime.datetime.utcnow().isoformat()
        # Only completed sessions carry a meaningful form score.
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
                "message": "Event logged locally but database save may have failed",
                "data": recommendation_payload,
                "database_error": database_result,
            }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected error while logging exercise event: %s", exc)
        raise HTTPException(status_code=500, detail="Internal server error while logging exercise event") from exc
