import tempfile
import re
from pathlib import Path
from typing import Any, Dict, List

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from core.mediapipe_vision import extract_sequence_from_video
from core.neural_network import classify_form_sequence
from core.recommender import recommend_next_plan
import os
import logging
from core import supabase_db as supabase_db_module
from core.supabase_db import save_patient_profile, save_recommendation_log
from supabase import create_client

logger = logging.getLogger("uvicorn.error")
app = FastAPI(title="Stroke Rehab API", version="0.1.0")

supabase = create_client(
    os.getenv("SUPABASE_URL"), 
    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
)


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
    stroke_type: str
    months_in_recovery: int = Field(..., ge=0)
    latest_form_score: float = Field(..., ge=0.0, le=1.0)
    affected_area: str = Field(..., description="arms | legs | both")
    affected_side: str = Field(..., description="left | right | both")


class PatientProfileRequest(BaseModel):
    name: str
    stroke_type: str
    months_in_recovery: int = Field(..., description="1 Month | 2 months | 3 months")
    affected_part: str = Field(..., description="Arms | Legs | Both")
    affected_side: str = Field(..., description="Left | Right | Both")


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok", "service": "stroke-rehab-backend"}





@app.post("/patients")
def create_patient_profile(payload: PatientProfileRequest) -> dict:
    record = {
        "name": payload.name,
        "stroke_type": payload.stroke_type,
        "months_in_recovery": payload.months_in_recovery,
        "months_in_recovery_value": payload.months_in_recovery,
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


# This endpoint accepts already-extracted pose sequences from the app.
@app.post("/predict/form")
def predict_form(payload: FormRequest) -> dict:
    prediction = classify_form_sequence(payload.exercise_type, payload.sequence)
    return {
        "patient_id": payload.patient_id,
        "exercise_type": payload.exercise_type,
        "prediction": prediction,
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
        prediction = classify_form_sequence(exercise_type, sequence_data["sequence"])
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Video processing failed: {exc}") from exc
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)

    return {
        "patient_id": patient_id,
        "exercise_type": exercise_type,
        "prediction": prediction,
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
        stroke_type=payload.stroke_type,
        months_in_recovery=payload.months_in_recovery,
        latest_form_score=payload.latest_form_score,
        affected_area=payload.affected_area,
        affected_side=payload.affected_side,
    )
    database_result = save_recommendation_log(
        {
            "patient_id": payload.patient_id,
            "stroke_type": payload.stroke_type,
            "months_in_recovery": payload.months_in_recovery,
            "latest_form_score": payload.latest_form_score,
            "affected_area": payload.affected_area,
            "affected_side": payload.affected_side,
            "recommendation": recommendation,
        }
    )
    return {"patient_id": payload.patient_id, "recommendation": recommendation, "database": database_result}
