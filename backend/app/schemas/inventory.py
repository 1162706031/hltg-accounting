from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from app.schemas.item import ItemRead
from app.schemas.party import PartyRead

ChangeType = Literal["in", "out", "adjust", "init"]


class InventoryRead(ORMModel):
    id: int
    item_id: int | None
    spec: str | None
    unit: str
    owner_id: int
    current_pieces: int
    current_weight: Decimal
    notes: str | None
    created_at: datetime
    updated_at: datetime
    item: ItemRead | None = None
    owner: PartyRead | None = None


class InventoryInRequest(BaseModel):
    item_id: int
    owner_id: int
    spec: str | None = Field(default=None, max_length=80)
    unit: str = Field(default="吨", max_length=10)
    pieces: int = 0
    weight: Decimal = Field(default=Decimal("0"), ge=0)
    change_date: date
    notes: str | None = Field(default=None, max_length=200)
    ref_type: str | None = Field(default=None, max_length=30)
    ref_id: int | None = None


class InventoryOutRequest(BaseModel):
    pieces: int = Field(default=0, ge=0)
    weight: Decimal = Field(default=Decimal("0"), ge=0)
    change_date: date
    notes: str | None = Field(default=None, max_length=200)
    ref_type: str | None = Field(default=None, max_length=30)
    ref_id: int | None = None


class InventoryAdjustRequest(BaseModel):
    actual_pieces: int = Field(ge=0)
    actual_weight: Decimal = Field(ge=0)
    change_date: date
    notes: str | None = Field(default=None, max_length=200)


class InventoryLogRead(ORMModel):
    id: int
    inventory_id: int
    change_type: ChangeType
    change_date: date
    delta_pieces: int
    delta_weight: Decimal
    before_pieces: int
    before_weight: Decimal
    after_pieces: int
    after_weight: Decimal
    ref_type: str | None
    ref_id: int | None
    notes: str | None
    created_by: int | None
    created_at: datetime
