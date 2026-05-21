import logging
import os

from fastapi import APIRouter

from core import supabase_db as supabase_db_module
from core.supabase_db import save_patient_profile
from schemas.patient import PatientProfileRequest

logger = logging.getLogger("uvicorn.error")
router = APIRouter()


@router.post("/patients")
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
    try:
        logger.info(
            "SUPABASE configured? %s, SERVICE_ROLE_KEY present? %s",
            supabase_db_module._configured(),
            bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY")),
        )
    except Exception:
        logger.info("Could not evaluate supabase config state")

    database_result = save_patient_profile(record)
    saved_patient_id = None
    if database_result.get("stored") and database_result.get("data"):
        saved_patient_id = database_result["data"][0].get("id")
    return {"patient_id": saved_patient_id, "patient_profile": record, "database": database_result}
