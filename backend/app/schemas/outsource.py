from datetime import date as date_type
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import ORMModel
from app.schemas.item import ItemRead
from app.schemas.party import PartyRead

ProcessType = str
OrderStatus = Literal["draft", "pending_review", "approved", "in_progress", "completed", "rejected"]


# ---- 发出明细 ----
class OutboundLineBase(BaseModel):
    line_no: int = 1
    out_date: date_type | None = None
    item_id: int | None = None
    inventory_id: int | None = None
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
    owner_id: int | None = None
    quantity: Decimal = Field(default=Decimal("0"), ge=0)
    unit: str = Field(default="吨", max_length=10)
    spec: str | None = Field(default=None, max_length=80)
    unit_price: Decimal | None = Field(default=None, ge=0)
    amount: Decimal | None = None
    notes: str | None = None


class InboundLineRead(InboundLineBase, ORMModel):
    id: int
    item: ItemRead | None = None
    owner: PartyRead | None = None


# ---- 主表 ----
class OutsourceOrderBase(BaseModel):
    party_id: int
    process_type: ProcessType = Field(min_length=1, max_length=80)
    out_date: date_type | None = None
    in_date: date_type | None = None
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

    @model_validator(mode="after")
    def validate_line_dates(self):
        _validate_line_dates(self.outbound_lines, self.inbound_lines)
        return self


class OutsourceOrderUpdate(BaseModel):
    party_id: int | None = None
    process_type: ProcessType | None = Field(default=None, min_length=1, max_length=80)
    out_date: date_type | None = None
    in_date: date_type | None = None
    unit_price: Decimal | None = Field(default=None, ge=0)
    tax_rate: Decimal | None = Field(default=None, ge=0, le=100)
    saw_head_ton: Decimal | None = Field(default=None, ge=0)
    loss_ton: Decimal | None = Field(default=None, ge=0)
    yield_rate: Decimal | None = Field(default=None, ge=0, le=1)
    need_invoice: bool | None = None
    notes: str | None = None
    outbound_lines: list[OutboundLineBase] | None = None
    inbound_lines: list[InboundLineBase] | None = None

    @model_validator(mode="after")
    def validate_line_dates(self):
        _validate_line_dates(self.outbound_lines, self.inbound_lines)
        return self


def _validate_line_dates(
    outbound_lines: list[OutboundLineBase] | None,
    inbound_lines: list[InboundLineBase] | None,
) -> None:
    for line in outbound_lines or []:
        if line.out_date is None:
            raise ValueError(f"发出明细第 {line.line_no} 行必须填写发出日期")
        if line.item_id is None:
            raise ValueError(f"发出明细第 {line.line_no} 行必须选择钢种")
    for line in inbound_lines or []:
        if line.in_date is None:
            raise ValueError(f"回厂明细第 {line.line_no} 行必须填写回厂日期")
        if line.item_id is None:
            raise ValueError(f"回厂明细第 {line.line_no} 行必须选择钢种")
        if line.owner_id is None:
            raise ValueError(f"回厂明细第 {line.line_no} 行必须选择所属单位")
        if not (line.spec or "").strip():
            raise ValueError(f"回厂明细第 {line.line_no} 行必须选择规格")


class OutsourceOrderListItem(ORMModel):
    id: int
    batch_no: str
    party_id: int
    process_type: ProcessType
    out_date: date_type | None = None
    in_date: date_type | None = None
    yield_rate: Decimal | None
    total_amount: Decimal | None
    status: OrderStatus
    notes: str | None
    created_at: datetime
    party: PartyRead | None = None


class OutsourceOrderRead(OutsourceOrderBase, ORMModel):
    # 写入时严格限制 <= 100%；读取时容纳修复上线前已落库的异常值，便于用户打开并纠正。
    yield_rate: Decimal | None = Field(default=None, ge=0)
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
