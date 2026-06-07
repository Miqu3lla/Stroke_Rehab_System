import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from core.auth import assert_patient_match, verify_jwt
from core.supabase_db import save_recommendation_log, get_patient_by_id, recommendation_log_exists

logger = logging.getLogger("uvicorn.error")
router = APIRouter()


@router.post("/sessions")
def save_session(payload: dict, claims: Dict[str, Any] = Depends(verify_jwt)) -> dict:
    """Batch-save a completed workout session.

    The frontend buffers per-exercise results in Zustand during a session
    and flushes them here when the patient hits End Workout (or finishes
    the last exercise). Each result becomes one row in recommendation_logs
    with the session_id stored inside the JSONB so all rows in a session
    can be queried together.
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

        # Token must own the patient_id being written to — otherwise an
        # authenticated user could batch-write into another patient's history.
        assert_patient_match(claims, patient_id)

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
                exercise_type = result.get("exercise_type") or ""
                # Safely parse session_index — default to None when missing or
                # invalid so we don't accidentally collide with index 0 during dedupe.
                try:
                    _raw_idx = result.get("session_index")
                    session_index = int(_raw_idx) if _raw_idx is not None else None
                    if session_index is not None and session_index < 0:
                        session_index = None
                except (ValueError, TypeError):
                    session_index = None
                ended_via = result.get("ended_via") or "finish"

                if not recommendation_id:
                    failed_rows.append({"result": result, "error": "missing recommendation_id"})
                    continue

                recommendation_payload = {
                    "patient_id": patient_id,
                    "session_id": session_id,
                    "recommendation_id": recommendation_id,
                    "exercise_name": exercise_name,
                    "exercise_type": exercise_type,
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
                    "latest_form_score": avg_form_score,
                    "exercise_type": exercise_type,
                    "recommendation": recommendation_payload,
                }

                # Idempotency: skip duplicates so a mobile retry doesn't
                # double-write trajectory history. Only dedupe when session_index
                # is a valid non-negative integer — skip if it could not be parsed.
                if session_index is not None and recommendation_log_exists(patient_id, session_id, session_index):
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
                logger.exception("Failed to process session result %s: %s", result.get("recommendation_id"), exc)
                failed_rows.append({"result": result, "error": "Failed to save exercise result"})

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
        logger.exception("Unexpected error while saving session: %s", exc)
        raise HTTPException(status_code=500, detail="Internal server error while saving session") from exc
