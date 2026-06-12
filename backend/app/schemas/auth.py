from pydantic import BaseModel

from app.schemas.user import UserRead


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class LoginResponse(TokenPair):
    user: UserRead


class RefreshRequest(BaseModel):
    refresh_token: str
