import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from core.auth import assert_patient_match, verify_jwt
from core.recommender import recommend_session_v2

logger = logging.getLogger("uvicorn.error")
router = APIRouter()


@router.get("/recommendation/{patient_id}")
def get_recommended_exercise(
    patient_id: str,
    claims: Dict[str, Any] = Depends(verify_jwt),
) -> dict:
    assert_patient_match(claims, patient_id)
    """Return trajectory-adapted recommended exercises for the patient.

    Trajectory-aware Patient X loop:
      - fetch_patient_history pulls the patient's scored sessions
      - trajectory.analyze_trajectory classifies the recovery state
      - recommender picks exercises + scales duration accordingly
    """
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
