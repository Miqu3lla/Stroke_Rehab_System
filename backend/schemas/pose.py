from pydantic import BaseModel, Field

_MAX_IMAGE_BASE64_CHARS = 10_000_000
_MAX_DECODED_IMAGE_BYTES = 7_500_000


class PoseEstimateRequest(BaseModel):
    image_base64: str = Field(
        ...,
        description="Base64-encoded JPEG/PNG frame",
        max_length=_MAX_IMAGE_BASE64_CHARS,
    )
    exercise_type: str = Field("", description="Exercise hint string (name + focus + area)")
    affected_side: str = Field("right", description="left | right | both")
