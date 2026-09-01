from pydantic import BaseModel, Field


class PatientProfileRequest(BaseModel):
    first_name: str
    last_name: str
    months_in_recovery: int = Field(..., description="1 Month | 2 months | 3 months | 4-6 months")
    affected_area: str = Field(..., description="Arms | Legs | Both")
    affected_side: str = Field(..., description="Left | Right | Both")
    id: str = Field(..., description="Supabase Auth user UUID")
