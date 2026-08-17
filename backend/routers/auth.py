import logging

from fastapi import APIRouter, HTTPException, Request

from core.rate_limit import limiter
from core.supabase_db import email_exists_in_auth
from schemas.auth import CheckEmailRequest

logger = logging.getLogger("uvicorn.error")
router = APIRouter()


@router.post("/auth/check-email")
@limiter.limit("5/minute")  # unauthenticated + enumeration-prone, tighter than the 200/min floor
def check_email(request: Request, payload: CheckEmailRequest) -> dict:
    exists = email_exists_in_auth(payload.email)
    if exists is None:
        # Every DB tier was unreachable/inconclusive - don't guess either
        # way, since "not found" would wrongly lock a real patient out.
        logger.error("check-email: could not determine existence for submitted email")
        raise HTTPException(status_code=503, detail="Could not verify email right now. Please try again.")
    return {"exists": exists}
