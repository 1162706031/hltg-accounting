from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel

ReconStatus = Literal["unreconciled", "verified", "completed", "disabled"]
InvoiceDirection = Literal["issue", "receive"]


class ReconciliationBase(BaseModel):
    party_id: int
    period: str = Field(max_length=20)
    period_start: date | None = None
    period_end: date | None = None
    ref_type: str | None = Field(default=None, max_length=30)
    ref_id: int | None = None
    line_no: int = 1
    biz_date: date | None = None
    biz_desc: str | None = Field(default=None, max_length=200)
    steel_grade: str | None = Field(default=None, max_length=50)
    quantity: Decimal = Decimal("0")
    unit: str = Field(default="吨", max_length=10)
    unit_price: Decimal | None = None
    debit: Decimal = Decimal("0")
    credit: Decimal = Decimal("0")
    invoice_amount: Decimal | None = None
    invoice_direction: InvoiceDirection | None = None
    recon_status: ReconStatus = "unreconciled"
    notes: str | None = None


class ReconciliationCreate(ReconciliationBase):
    pass


class ReconciliationUpdate(BaseModel):
    party_id: int | None = None
    period: str | None = Field(default=None, max_length=20)
    period_start: date | None = None
    period_end: date | None = None
    ref_type: str | None = Field(default=None, max_length=30)
    ref_id: int | None = None
    line_no: int | None = None
    biz_date: date | None = None
    biz_desc: str | None = Field(default=None, max_length=200)
    steel_grade: str | None = Field(default=None, max_length=50)
    quantity: Decimal | None = None
    unit: str | None = Field(default=None, max_length=10)
    unit_price: Decimal | None = None
    debit: Decimal | None = None
    credit: Decimal | None = None
    invoice_amount: Decimal | None = None
    invoice_direction: InvoiceDirection | None = None
    recon_status: ReconStatus | None = None
    notes: str | None = None


class ReconciliationStatusUpdate(BaseModel):
    recon_status: ReconStatus


class ReconciliationRead(ReconciliationBase, ORMModel):
    id: int
    created_by: int | None
    created_at: datetime
    updated_at: datetime


class PartyBalanceRead(BaseModel):
    party_id: int
    party_name: str
    party_type: str | None
    total_receivable: Decimal
    total_payable: Decimal
    total_received: Decimal
    total_paid: Decimal
    net_receivable: Decimal
    net_payable: Decimal
    net_to_issue: Decimal
    net_to_receive: Decimal
