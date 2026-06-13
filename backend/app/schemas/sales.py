from datetime import date as date_type
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from app.schemas.item import ItemRead
from app.schemas.party import PartyRead

OrderStatus = Literal["draft", "pending_review", "approved", "in_progress", "completed", "rejected"]


class SalesItemBase(BaseModel):
    line_no: int = 1
    inventory_id: int | None = None
    item_id: int | None = None
    spec: str | None = Field(default=None, max_length=80)
    weight_ton: Decimal = Field(default=Decimal("0"), ge=0)
    pieces: int | None = Field(default=None, ge=0)
    unit_price: Decimal = Field(default=Decimal("0"), ge=0)
    amount: Decimal | None = None
    notes: str | None = None


class SalesItemRead(SalesItemBase, ORMModel):
    id: int
    amount: Decimal
    item: ItemRead | None = None


class SalesOrderBase(BaseModel):
    party_id: int
    ship_date: date_type | None = None
    tax_rate: Decimal | None = Field(default=Decimal("13.00"), ge=0, le=100)
    need_invoice: bool = False
    notes: str | None = None


class SalesOrderCreate(SalesOrderBase):
    items: list[SalesItemBase] = Field(default_factory=list)


class SalesOrderUpdate(BaseModel):
    party_id: int | None = None
    ship_date: date_type | None = None
    tax_rate: Decimal | None = Field(default=None, ge=0, le=100)
    need_invoice: bool | None = None
    notes: str | None = None
    items: list[SalesItemBase] | None = None


class SalesOrderListItem(ORMModel):
    id: int
    batch_no: str
    party_id: int
    ship_date: date_type | None
    total_amount: Decimal | None
    status: OrderStatus
    notes: str | None
    created_at: datetime
    party: PartyRead | None = None


class SalesOrderRead(SalesOrderBase, ORMModel):
    id: int
    batch_no: str
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
    items: list[SalesItemRead] = Field(default_factory=list)


class RejectRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=200)
