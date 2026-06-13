from datetime import date, datetime
from decimal import Decimal

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


class PartyBalanceLine(BaseModel):
    """单位往来明细行（来自对账明细），用于列表展开面板。"""

    id: int
    ref_type: str | None = None
    biz_date: date | None = None
    biz_desc: str | None = None
    steel_grade: str | None = None
    debit: Decimal = Decimal("0")
    credit: Decimal = Decimal("0")
    invoice_direction: str | None = None
    invoice_amount: Decimal | None = None
    recon_status: str


class PartyBalanceDetail(BaseModel):
    """单位往来明细汇总 + 明细行，对应设计 §5.2 展开面板。"""

    party_id: int
    party_name: str
    net_receivable: Decimal = Decimal("0")
    net_payable: Decimal = Decimal("0")
    net_to_issue: Decimal = Decimal("0")
    net_to_receive: Decimal = Decimal("0")
    lines: list[PartyBalanceLine] = []
