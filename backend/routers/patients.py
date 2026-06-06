import logging
import os
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from core import supabase_db as supabase_db_module
from core.auth import assert_patient_match, verify_jwt
from core.supabase_db import save_patient_profile
from schemas.patient import PatientProfileRequest

logger = logging.getLogger("uvicorn.error")
router = APIRouter()


@router.post("/patients")
def create_patient_profile(
    payload: PatientProfileRequest,
    claims: Dict[str, Any] = Depends(verify_jwt),
) -> dict:
    # The JWT is issued at signup time, BEFORE this endpoint runs to
    # create the patients row — so the auth user exists but the patient
    # row doesn't yet. The token's sub IS the user id we'll insert as
    # the patient_id; reject any request trying to set a different one.
    assert_patient_match(claims, payload.id)
    record = {
        "first_name": payload.first_name,
        "last_name": payload.last_name,
        "id": payload.id,
        "stroke_type": "ischemic",
        "months_in_recovery": payload.months_in_recovery,
        "affected_area": payload.affected_area,
        "affected_side": payload.affected_side,
        "source_app": "frontend",
    }
    try:
        logger.info(
            "SUPABASE configured? %s, SERVICE_ROLE_KEY present? %s",
            supabase_db_module._configured(),
            bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY")),
        )
    except Exception:
        logger.info("Could not evaluate supabase config state")

    database_result = save_patient_profile(record)
    if not database_result.get("stored"):
        logger.error("Patient insert failed: %s", database_result)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save patient profile: {database_result}",
        )
    saved_patient_id = None
    if database_result.get("data"):
        saved_patient_id = database_result["data"][0].get("id")
    return {"patient_id": saved_patient_id, "patient_profile": record, "database": database_result}
