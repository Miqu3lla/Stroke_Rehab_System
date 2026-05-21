from typing import List
from pydantic import BaseModel, Field


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
