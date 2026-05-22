from pydantic import BaseModel, Field

# Bumped from 1.4M/1M base64 chars to 10M/7.5M to accommodate Android
# phones that send full sensor-resolution frames (iOS quality=0.1 lands
# around 30-80 KB). The ceiling still rejects payloads big enough to
# OOM the inference worker.
MAX_IMAGE_BASE64_CHARS = 10_000_000
MAX_DECODED_IMAGE_BYTES = 7_500_000


class PoseEstimateRequest(BaseModel):
    image_base64: str = Field(
        ...,
        description="Base64-encoded JPEG/PNG frame",
        max_length=MAX_IMAGE_BASE64_CHARS,
    )
    exercise_type: str = Field("", description="Exercise hint string (name + focus + area)")
    affected_side: str = Field("right", description="left | right | both")
