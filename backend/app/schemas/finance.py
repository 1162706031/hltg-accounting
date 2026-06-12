from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel

PaymentDirection = Literal["pay", "receive"]
InvoiceDirection = Literal["issue", "receive"]


class LinkedOrder(BaseModel):
    ref_type: str
    ref_id: int
    batch_no: str | None = None


class PaymentBase(BaseModel):
    party_id: int
    direction: PaymentDirection
    pay_date: date | None = None
    amount: Decimal = Field(ge=0)
    method: str | None = Field(default=None, max_length=20)
    ref_type: str | None = Field(default=None, max_length=30)
    ref_id: int | None = None
    linked_orders: list[LinkedOrder] | None = None
    notes: str | None = Field(default=None, max_length=200)


class PaymentCreate(PaymentBase):
    pass


class PaymentUpdate(BaseModel):
    party_id: int | None = None
    direction: PaymentDirection | None = None
    pay_date: date | None = None
    amount: Decimal | None = Field(default=None, ge=0)
    method: str | None = Field(default=None, max_length=20)
    ref_type: str | None = Field(default=None, max_length=30)
    ref_id: int | None = None
    linked_orders: list[LinkedOrder] | None = None
    notes: str | None = Field(default=None, max_length=200)


class PaymentRead(PaymentBase, ORMModel):
    id: int
    linked_orders: list[dict[str, Any]] | None = None
    created_by: int | None
    created_at: datetime


class InvoiceBase(BaseModel):
    party_id: int
    direction: InvoiceDirection
    invoice_date: date | None = None
    amount: Decimal = Field(ge=0)
    invoice_no: str | None = Field(default=None, max_length=50)
    ref_type: str | None = Field(default=None, max_length=30)
    ref_id: int | None = None
    linked_orders: list[LinkedOrder] | None = None
    notes: str | None = Field(default=None, max_length=200)


class InvoiceCreate(InvoiceBase):
    pass


class InvoiceUpdate(BaseModel):
    party_id: int | None = None
    direction: InvoiceDirection | None = None
    invoice_date: date | None = None
    amount: Decimal | None = Field(default=None, ge=0)
    invoice_no: str | None = Field(default=None, max_length=50)
    ref_type: str | None = Field(default=None, max_length=30)
    ref_id: int | None = None
    linked_orders: list[LinkedOrder] | None = None
    notes: str | None = Field(default=None, max_length=200)


class InvoiceRead(InvoiceBase, ORMModel):
    id: int
    linked_orders: list[dict[str, Any]] | None = None
    created_by: int | None
    created_at: datetime
