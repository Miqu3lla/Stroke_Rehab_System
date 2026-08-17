from pydantic import BaseModel


class CheckEmailRequest(BaseModel):
    email: str
