from pydantic import BaseModel, Field


class CheckEmailRequest(BaseModel):
    # 254 = RFC 5321 max email length; cheap defense-in-depth before the
    # regex check on this public, lightly-rate-limited route.
    email: str = Field(max_length=254)
