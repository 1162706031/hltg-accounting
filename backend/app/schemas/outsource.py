from datetime import date as date_type
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from app.schemas.item import ItemRead
from app.schemas.party import PartyRead

ProcessType = Literal["forging", "esr", "turning", "annealing"]
OrderStatus = Literal["draft", "pending_review", "approved", "in_progress", "completed", "rejected"]


# ---- 发出明细 ----
class OutboundLineBase(BaseModel):
    line_no: int = 1
    out_date: date_type | None = None
    item_id: int | None = None
    quantity: Decimal = Field(default=Decimal("0"), ge=0)
    unit: str = Field(default="吨", max_length=10)
    spec: str | None = Field(default=None, max_length=80)
    unit_price: Decimal | None = Field(default=None, ge=0)
    amount: Decimal | None = None
    notes: str | None = None


class OutboundLineRead(OutboundLineBase, ORMModel):
    id: int
    item: ItemRead | None = None


# ---- 回厂明细 ----
class InboundLineBase(BaseModel):
    line_no: int = 1
    in_date: date_type | None = None
    item_id: int | None = None
    quantity: Decimal = Field(default=Decimal("0"), ge=0)
    unit: str = Field(default="吨", max_length=10)
    spec: str | None = Field(default=None, max_length=80)
    unit_price: Decimal | None = Field(default=None, ge=0)
    amount: Decimal | None = None
    notes: str | None = None


class InboundLineRead(InboundLineBase, ORMModel):
    id: int
    item: ItemRead | None = None


# ---- 主表 ----
class OutsourceOrderBase(BaseModel):
    party_id: int
    process_type: ProcessType
    unit_price: Decimal | None = Field(default=None, ge=0)
    tax_rate: Decimal | None = Field(default=Decimal("13.00"), ge=0, le=100)
    saw_head_ton: Decimal | None = Field(default=None, ge=0)
    loss_ton: Decimal | None = Field(default=None, ge=0)
    yield_rate: Decimal | None = Field(default=None, ge=0, le=1)
    need_invoice: bool = False
    notes: str | None = None


class OutsourceOrderCreate(OutsourceOrderBase):
    outbound_lines: list[OutboundLineBase] = Field(default_factory=list)
    inbound_lines: list[InboundLineBase] = Field(default_factory=list)


class OutsourceOrderUpdate(BaseModel):
    party_id: int | None = None
    process_type: ProcessType | None = None
    unit_price: Decimal | None = Field(default=None, ge=0)
    tax_rate: Decimal | None = Field(default=None, ge=0, le=100)
    saw_head_ton: Decimal | None = Field(default=None, ge=0)
    loss_ton: Decimal | None = Field(default=None, ge=0)
    yield_rate: Decimal | None = Field(default=None, ge=0, le=1)
    need_invoice: bool | None = None
    notes: str | None = None
    outbound_lines: list[OutboundLineBase] | None = None
    inbound_lines: list[InboundLineBase] | None = None


class OutsourceOrderListItem(ORMModel):
    id: int
    batch_no: str
    party_id: int
    process_type: ProcessType
    yield_rate: Decimal | None
    total_amount: Decimal | None
    status: OrderStatus
    notes: str | None
    created_at: datetime
    party: PartyRead | None = None


class OutsourceOrderRead(OutsourceOrderBase, ORMModel):
    id: int
    batch_no: str
    amount: Decimal | None
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
    outbound_lines: list[OutboundLineRead] = Field(default_factory=list)
    inbound_lines: list[InboundLineRead] = Field(default_factory=list)


class RejectRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=200)
