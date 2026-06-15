from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

ORDER_STATUS = ("draft", "pending_review", "approved", "in_progress", "completed", "rejected")


class OutsourceOrder(Base):
    __tablename__ = "outsource_order"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    batch_no: Mapped[str] = mapped_column(String(30), nullable=False)
    party_id: Mapped[int] = mapped_column(ForeignKey("party.id"), nullable=False)
    process_type: Mapped[str] = mapped_column(Enum("forging", "esr", "turning", "annealing"), nullable=False)
    out_date: Mapped[date | None] = mapped_column(Date)
    in_date: Mapped[date | None] = mapped_column(Date)
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    tax_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), default=Decimal("13.00"))
    tax_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    subtotal: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    total_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    yield_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    saw_head_ton: Mapped[Decimal | None] = mapped_column(Numeric(10, 3))
    loss_ton: Mapped[Decimal | None] = mapped_column(Numeric(10, 3))
    need_invoice: Mapped[bool] = mapped_column(default=False)
    status: Mapped[str] = mapped_column(Enum(*ORDER_STATUS), nullable=False, default="draft")
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"))
    audited_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"))
    audited_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    party = relationship("Party")
    outbound_lines = relationship(
        "ProcessingOutbound",
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="ProcessingOutbound.id",
    )
    inbound_lines = relationship(
        "ProcessingInbound",
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="ProcessingInbound.id",
    )


class ProcessingOutbound(Base):
    __tablename__ = "processing_outbound"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("outsource_order.id", ondelete="CASCADE"), nullable=False)
    line_no: Mapped[int] = mapped_column(default=1)
    out_date: Mapped[date | None] = mapped_column(Date)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("item.id"))
    inventory_id: Mapped[int | None] = mapped_column(ForeignKey("inventory.id"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 3), default=0)
    unit: Mapped[str] = mapped_column(String(10), default="吨")
    spec: Mapped[str | None] = mapped_column(String(80))
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    notes: Mapped[str | None] = mapped_column(Text)

    order = relationship("OutsourceOrder", back_populates="outbound_lines")
    item = relationship("Item")


class ProcessingInbound(Base):
    __tablename__ = "processing_inbound"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("outsource_order.id", ondelete="CASCADE"), nullable=False)
    line_no: Mapped[int] = mapped_column(default=1)
    in_date: Mapped[date | None] = mapped_column(Date)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("item.id"))
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("party.id"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 3), default=0)
    unit: Mapped[str] = mapped_column(String(10), default="吨")
    spec: Mapped[str | None] = mapped_column(String(80))
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    notes: Mapped[str | None] = mapped_column(Text)

    order = relationship("OutsourceOrder", back_populates="inbound_lines")
    item = relationship("Item")
    owner = relationship("Party")
