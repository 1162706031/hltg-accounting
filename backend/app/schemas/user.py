from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel

UserRole = Literal["admin", "accountant", "reviewer", "viewer"]


class UserRead(ORMModel):
    id: int
    username: str
    real_name: str | None
    role: UserRole
    is_active: bool
    created_at: datetime


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=50)
    password: str = Field(min_length=6, max_length=128)
    real_name: str | None = Field(default=None, max_length=50)
    role: UserRole = "accountant"
    is_active: bool = True


class UserUpdate(BaseModel):
    real_name: str | None = Field(default=None, max_length=50)
    role: UserRole | None = None
    is_active: bool | None = None


class ResetPasswordRequest(BaseModel):
    password: str = Field(min_length=6, max_length=128)
