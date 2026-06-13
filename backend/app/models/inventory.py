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
    current_quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    item = relationship("Item", back_populates="inventories")
    owner = relationship("Party", back_populates="inventories")


class InventoryLog(Base):
    """库存变动日志：独立自包含，不与其他表外键联动。

    每次仓库操作（入库/出库/调整/删除）完成时追加一行，写入时即把物品、
    规格、归属、操作人等信息快照进本行。日志只增不改不删，查询时直接读取
    本表字段，无需 JOIN，因此库存项被删除也不影响历史日志。
    """

    __tablename__ = "inventory_log"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # 仅记录来源库存 id 供追溯，非外键（库存删除后此值保留）
    inventory_id: Mapped[int | None] = mapped_column()
    item_id: Mapped[int | None] = mapped_column()
    item_name: Mapped[str | None] = mapped_column(String(100))
    item_spec: Mapped[str | None] = mapped_column(String(80))
    item_type: Mapped[str | None] = mapped_column(String(30))
    owner_name: Mapped[str | None] = mapped_column(String(100))
    operator_name: Mapped[str | None] = mapped_column(String(50))
    change_type: Mapped[str] = mapped_column(Enum("in", "out", "adjust", "init", "delete"), nullable=False)
    change_date: Mapped[date] = mapped_column(Date, nullable=False)
    unit: Mapped[str] = mapped_column(String(10), default="吨")
    delta_quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0)
    before_quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0)
    after_quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0)
    ref_type: Mapped[str | None] = mapped_column(String(30))
    ref_id: Mapped[int | None] = mapped_column()
    notes: Mapped[str | None] = mapped_column(String(200))
    # 仅记录操作人 id 供追溯，非外键
    created_by: Mapped[int | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
