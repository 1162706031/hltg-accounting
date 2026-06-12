from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class PartyBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    short_name: str | None = Field(default=None, max_length=50)
    is_customer: bool = False
    is_supplier: bool = False
    is_processor: bool = False
    is_internal: bool = False
    contact: str | None = Field(default=None, max_length=50)
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=200)
    notes: str | None = None


class PartyCreate(PartyBase):
    pass


class PartyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    short_name: str | None = Field(default=None, max_length=50)
    is_customer: bool | None = None
    is_supplier: bool | None = None
    is_processor: bool | None = None
    is_internal: bool | None = None
    contact: str | None = Field(default=None, max_length=50)
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=200)
    notes: str | None = None


class PartyRead(PartyBase, ORMModel):
    id: int
    created_at: datetime
    updated_at: datetime
