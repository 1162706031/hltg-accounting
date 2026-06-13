from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

ORDER_STATUS = ("draft", "pending_review", "approved", "in_progress", "completed", "rejected")


class SmeltingOrder(Base):
    __tablename__ = "smelting_order"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    batch_no: Mapped[str] = mapped_column(String(30), nullable=False)
    party_id: Mapped[int] = mapped_column(ForeignKey("party.id"), nullable=False)
    order_type: Mapped[str] = mapped_column(Enum("ext_smelting", "inhouse"), nullable=False)
    feed_date: Mapped[date | None] = mapped_column(Date)
    tap_date: Mapped[date | None] = mapped_column(Date)
    casting_loss_kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 1))
    casting_loss_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    yield_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    processing_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    tax_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), default=Decimal("13.00"))
    tax_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    subtotal: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    total_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    need_invoice: Mapped[bool] = mapped_column(default=False)
    status: Mapped[str] = mapped_column(Enum(*ORDER_STATUS), nullable=False, default="draft")
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"))
    audited_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"))
    audited_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    party = relationship("Party")
    inbound_lines = relationship(
        "SmeltingInbound",
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="SmeltingInbound.id",
    )
    alloy_lines = relationship(
        "AlloyAddition",
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="AlloyAddition.id",
    )


class SmeltingInbound(Base):
    __tablename__ = "smelting_inbound"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("smelting_order.id", ondelete="CASCADE"), nullable=False)
    side: Mapped[str] = mapped_column(Enum("in", "out"), nullable=False)
    line_no: Mapped[int] = mapped_column(default=1)
    date: Mapped[date | None] = mapped_column(Date)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("item.id"))
    weight_ton: Mapped[Decimal] = mapped_column(Numeric(10, 3), default=0)
    pieces: Mapped[int | None] = mapped_column()
    spec: Mapped[str | None] = mapped_column(String(80))
    furnace_no: Mapped[str | None] = mapped_column(String(20))
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("party.id"))
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    notes: Mapped[str | None] = mapped_column(Text)

    order = relationship("SmeltingOrder", back_populates="inbound_lines")
    item = relationship("Item")
    owner = relationship("Party")


class AlloyAddition(Base):
    __tablename__ = "alloy_addition"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("smelting_order.id", ondelete="CASCADE"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    weight_kg: Mapped[Decimal] = mapped_column(Numeric(10, 1), default=0)
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    notes: Mapped[str | None] = mapped_column(String(100))

    order = relationship("SmeltingOrder", back_populates="alloy_lines")
    item = relationship("Item")
