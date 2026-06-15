from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

ORDER_STATUS = ("draft", "pending_review", "approved", "in_progress", "completed", "rejected")


class SalesOrder(Base):
    __tablename__ = "sales_order"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    batch_no: Mapped[str] = mapped_column(String(30), nullable=False)
    party_id: Mapped[int] = mapped_column(ForeignKey("party.id"), nullable=False)
    ship_date: Mapped[date | None] = mapped_column(Date)
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
    items = relationship(
        "SalesOrderItem",
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="SalesOrderItem.id",
    )


class SalesOrderItem(Base):
    __tablename__ = "sales_order_item"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("sales_order.id", ondelete="CASCADE"), nullable=False)
    line_no: Mapped[int] = mapped_column(default=1)
    ship_date: Mapped[date | None] = mapped_column(Date)
    inventory_id: Mapped[int | None] = mapped_column(ForeignKey("inventory.id", ondelete="SET NULL"))
    item_id: Mapped[int | None] = mapped_column(ForeignKey("item.id"))
    spec: Mapped[str | None] = mapped_column(String(80))
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 3), default=0)
    unit: Mapped[str] = mapped_column(String(10), default="吨")
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    notes: Mapped[str | None] = mapped_column(Text)

    order = relationship("SalesOrder", back_populates="items")
    item = relationship("Item")
