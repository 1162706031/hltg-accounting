from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

ORDER_STATUS = ("draft", "pending_review", "approved", "in_progress", "completed", "rejected")


class ProcurementOrder(Base):
    __tablename__ = "procurement_order"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    batch_no: Mapped[str] = mapped_column(String(30), nullable=False)
    party_id: Mapped[int] = mapped_column(ForeignKey("party.id"), nullable=False)
    owner_id: Mapped[int] = mapped_column(ForeignKey("party.id"), nullable=False)
    purchase_date: Mapped[date | None] = mapped_column(Date)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("item.id"))
    item_spec: Mapped[str | None] = mapped_column(String(80))
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 3), default=0)
    unit: Mapped[str] = mapped_column(String(10), default="吨")
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
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

    party = relationship("Party", foreign_keys=[party_id])
    owner = relationship("Party", foreign_keys=[owner_id])
    item = relationship("Item")
    items = relationship(
        "ProcurementOrderItem",
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="ProcurementOrderItem.line_no",
    )


class ProcurementOrderItem(Base):
    __tablename__ = "procurement_order_item"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("procurement_order.id", ondelete="RESTRICT"), nullable=False)
    line_no: Mapped[int] = mapped_column(default=1)
    in_date: Mapped[date] = mapped_column(Date, nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id", ondelete="RESTRICT"), nullable=False)
    item_spec: Mapped[str | None] = mapped_column(String(80))
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False, default=0)
    unit: Mapped[str] = mapped_column(String(10), nullable=False, default="吨")
    unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=0)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=0)
    owner_id: Mapped[int] = mapped_column(ForeignKey("party.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    order = relationship("ProcurementOrder", back_populates="items")
    item = relationship("Item")
    owner = relationship("Party")
