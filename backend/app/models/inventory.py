from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Inventory(Base):
    __tablename__ = "inventory"
    __table_args__ = (UniqueConstraint("item_id", "spec", "owner_id", name="uk_item_owner"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("item.id"))
    spec: Mapped[str] = mapped_column(String(80), default="")
    unit: Mapped[str] = mapped_column(String(10), default="吨")
    owner_id: Mapped[int] = mapped_column(ForeignKey("party.id"), nullable=False)
    current_pieces: Mapped[int] = mapped_column(default=0)
    current_weight: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    item = relationship("Item", back_populates="inventories")
    owner = relationship("Party", back_populates="inventories")
    logs = relationship("InventoryLog", back_populates="inventory")


class InventoryLog(Base):
    __tablename__ = "inventory_log"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    inventory_id: Mapped[int] = mapped_column(ForeignKey("inventory.id"), nullable=False)
    change_type: Mapped[str] = mapped_column(Enum("in", "out", "adjust", "init"), nullable=False)
    change_date: Mapped[date] = mapped_column(Date, nullable=False)
    delta_pieces: Mapped[int] = mapped_column(default=0)
    delta_weight: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0)
    before_pieces: Mapped[int] = mapped_column(default=0)
    before_weight: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0)
    after_pieces: Mapped[int] = mapped_column(default=0)
    after_weight: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0)
    ref_type: Mapped[str | None] = mapped_column(String(30))
    ref_id: Mapped[int | None] = mapped_column()
    notes: Mapped[str | None] = mapped_column(String(200))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    inventory = relationship("Inventory", back_populates="logs")
