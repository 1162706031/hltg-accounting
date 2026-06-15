from datetime import date as date_type
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from app.schemas.item import ItemRead
from app.schemas.party import PartyRead

OrderType = Literal["ext_smelting", "inhouse"]
OrderStatus = Literal["draft", "pending_review", "approved", "in_progress", "completed", "rejected"]
Side = Literal["in", "out"]


# ---- 子表：来料/出钢明细 ----
class InboundLineBase(BaseModel):
    side: Side
    line_no: int = 1
    date: date_type | None = None
    item_id: int | None = None
    inventory_id: int | None = None
    quantity: Decimal = Field(default=Decimal("0"), ge=0)
    unit: str = Field(default="吨", max_length=10)
    spec: str | None = Field(default=None, max_length=80)
    furnace_no: str | None = Field(default=None, max_length=20)
    owner_id: int | None = None
    unit_price: Decimal | None = Field(default=None, ge=0)
    amount: Decimal | None = None
    notes: str | None = None


class InboundLineRead(InboundLineBase, ORMModel):
    id: int
    item: ItemRead | None = None
    owner: PartyRead | None = None


# ---- 子表：补加合金 ----
class AlloyLineBase(BaseModel):
    item_id: int
    inventory_id: int | None = None
    date: date_type | None = None
    quantity: Decimal = Field(default=Decimal("0"), ge=0)
    unit: str = Field(default="千克", max_length=10)
    spec: str | None = Field(default=None, max_length=80)
    unit_price: Decimal | None = Field(default=None, ge=0)
    amount: Decimal | None = None
    notes: str | None = Field(default=None, max_length=100)


class AlloyLineRead(AlloyLineBase, ORMModel):
    id: int
    item: ItemRead | None = None


# ---- 主表 ----
class SmeltingOrderBase(BaseModel):
    party_id: int
    order_type: OrderType
    feed_date: date_type | None = None
    tap_date: date_type | None = None
    casting_loss_kg: Decimal | None = None
    casting_loss_pct: Decimal | None = None
    yield_pct: Decimal | None = None
    unit_price: Decimal | None = Field(default=None, ge=0)
    tax_rate: Decimal | None = Field(default=Decimal("13.00"), ge=0, le=100)
    need_invoice: bool = False
    notes: str | None = None


class SmeltingOrderCreate(SmeltingOrderBase):
    """新建批次头；子表可选，通常先建头再在详情页补子表。"""

    inbound_lines: list[InboundLineBase] = Field(default_factory=list)
    alloy_lines: list[AlloyLineBase] = Field(default_factory=list)


class SmeltingOrderUpdate(BaseModel):
    """全量更新：主表字段 + 完整子表（替换式保存）。"""

    party_id: int | None = None
    order_type: OrderType | None = None
    feed_date: date_type | None = None
    tap_date: date_type | None = None
    casting_loss_kg: Decimal | None = None
    casting_loss_pct: Decimal | None = None
    yield_pct: Decimal | None = None
    unit_price: Decimal | None = Field(default=None, ge=0)
    tax_rate: Decimal | None = Field(default=None, ge=0, le=100)
    need_invoice: bool | None = None
    notes: str | None = None
    inbound_lines: list[InboundLineBase] | None = None
    alloy_lines: list[AlloyLineBase] | None = None


class SmeltingOrderListItem(ORMModel):
    id: int
    batch_no: str
    party_id: int
    order_type: OrderType
    feed_date: date_type | None
    tap_date: date_type | None
    yield_pct: Decimal | None
    total_amount: Decimal | None
    status: OrderStatus
    notes: str | None
    created_at: datetime
    party: PartyRead | None = None


class SmeltingOrderRead(SmeltingOrderBase, ORMModel):
    id: int
    batch_no: str
    processing_amount: Decimal | None
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
    inbound_lines: list[InboundLineRead] = Field(default_factory=list)
    alloy_lines: list[AlloyLineRead] = Field(default_factory=list)


class RejectRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=200)
