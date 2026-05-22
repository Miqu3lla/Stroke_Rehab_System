from typing import List
from pydantic import BaseModel, Field


class JointFrame(BaseModel):
    frame_index: int = Field(..., ge=0)
    keypoints: List[float] = Field(..., description="Flattened 33x3 keypoints")


class FormRequest(BaseModel):
    patient_id: str
    exercise_type: str
    sequence: List[JointFrame]
