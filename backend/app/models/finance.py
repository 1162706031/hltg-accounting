from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Date, DateTime, Enum, ForeignKey, JSON, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Payment(Base):
    __tablename__ = "payment"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    party_id: Mapped[int] = mapped_column(ForeignKey("party.id"), nullable=False)
    direction: Mapped[str] = mapped_column(Enum("pay", "receive"), nullable=False)
    pay_date: Mapped[date | None] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    method: Mapped[str | None] = mapped_column(String(20))
    ref_type: Mapped[str | None] = mapped_column(String(30))
    ref_id: Mapped[int | None] = mapped_column()
    linked_orders: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)
    notes: Mapped[str | None] = mapped_column(String(200))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    party = relationship("Party", back_populates="payments")


class Invoice(Base):
    __tablename__ = "invoice"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    party_id: Mapped[int] = mapped_column(ForeignKey("party.id"), nullable=False)
    direction: Mapped[str] = mapped_column(Enum("issue", "receive"), nullable=False)
    invoice_date: Mapped[date | None] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    invoice_no: Mapped[str | None] = mapped_column(String(50))
    ref_type: Mapped[str | None] = mapped_column(String(30))
    ref_id: Mapped[int | None] = mapped_column()
    linked_orders: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)
    notes: Mapped[str | None] = mapped_column(String(200))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    party = relationship("Party", back_populates="invoices")
