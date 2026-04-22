import tempfile
from pathlib import Path
from typing import Any, Dict, List

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from core.mediapipe_vision import extract_sequence_from_video
from core.neural_network import classify_form_sequence
from core.recommender import recommend_next_plan

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
    stroke_type: str
    months_in_recovery: int = Field(..., ge=0)
    latest_form_score: float = Field(..., ge=0.0, le=1.0)


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok", "service": "stroke-rehab-backend"}


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
    )
    return {"patient_id": payload.patient_id, "recommendation": recommendation}
