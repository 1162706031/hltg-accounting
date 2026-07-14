from datetime import date as date_type
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from app.schemas.item import ItemRead
from app.schemas.party import PartyRead

OrderStatus = Literal["draft", "pending_review", "approved", "in_progress", "completed", "rejected"]


class ProcurementItemInput(BaseModel):
    line_no: int = Field(default=1, ge=1)
    in_date: date_type
    item_id: int
    item_spec: str | None = Field(default=None, max_length=50)
    quantity: Decimal = Field(gt=0)
    unit: str = Field(default="吨", max_length=10)
    unit_price: Decimal = Field(default=Decimal("0"), ge=0)
    owner_id: int


class ProcurementItemRead(ProcurementItemInput, ORMModel):
    id: int
    order_id: int
    amount: Decimal
    created_at: datetime
    updated_at: datetime
    item: ItemRead | None = None
    owner: PartyRead | None = None


class ProcurementOrderBase(BaseModel):
    party_id: int
    tax_rate: Decimal | None = Field(default=Decimal("13.00"), ge=0, le=100)
    need_invoice: bool = False
    notes: str | None = None


class ProcurementOrderCreate(ProcurementOrderBase):
    items: list[ProcurementItemInput] = Field(min_length=1)


class ProcurementOrderUpdate(BaseModel):
    party_id: int | None = None
    tax_rate: Decimal | None = Field(default=None, ge=0, le=100)
    need_invoice: bool | None = None
    notes: str | None = None
    items: list[ProcurementItemInput] | None = Field(default=None, min_length=1)


class ProcurementOrderRead(ProcurementOrderBase, ORMModel):
    id: int
    batch_no: str
    owner_id: int
    purchase_date: date_type | None
    item_id: int | None
    item_spec: str | None
    quantity: Decimal
    unit: str
    unit_price: Decimal
    amount: Decimal
    tax_amount: Decimal | None
    subtotal: Decimal | None
    total_amount: Decimal | None
    status: OrderStatus
    created_by: int | None
    audited_by: int | None
    audited_at: datetime | None
    created_at: datetime
    updated_at: datetime
    party: PartyRead | None = None
    owner: PartyRead | None = None
    item: ItemRead | None = None
    items: list[ProcurementItemRead] = Field(default_factory=list)


class RejectRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=200)
