from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import JSON, Boolean, Date, DateTime, Enum, ForeignKey, Index, Numeric, String, Text, Time, UniqueConstraint, func
from sqlalchemy.dialects.mysql import BIGINT
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SteelmakingRecord(Base):
    __tablename__ = "steelmaking_record"
    __table_args__ = (
        Index("idx_steelmaking_record_date", "record_date"),
        Index("idx_steelmaking_batch_no", "batch_no"),
        Index("idx_steelmaking_furnace_no", "furnace_no"),
        Index("idx_steelmaking_furnace_date", "furnace_no", "record_date"),
        Index("idx_steelmaking_steel_grade", "steel_grade"),
        Index("idx_steelmaking_owner", "owner_id"),
        Index("idx_steelmaking_status", "status"),
        Index("idx_steelmaking_deleted", "deleted"),
    )

    id: Mapped[int] = mapped_column(BIGINT(unsigned=True), primary_key=True, autoincrement=True)
    batch_no: Mapped[str] = mapped_column(String(30), nullable=False)
    record_date: Mapped[date] = mapped_column(Date, nullable=False)
    furnace_no: Mapped[str] = mapped_column(String(50), nullable=False)
    steel_grade: Mapped[str] = mapped_column(String(100), nullable=False)
    owner_id: Mapped[int] = mapped_column(BIGINT(unsigned=True), ForeignKey("party.id", ondelete="RESTRICT"), nullable=False)
    ingot_type: Mapped[str | None] = mapped_column(String(100))
    furnace_weight: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    furnace_weight_unit: Mapped[str] = mapped_column(Enum("kg", "ton"), nullable=False)
    furnace_weight_kg: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    power_on_time: Mapped[time | None] = mapped_column(Time)
    tap_time: Mapped[time | None] = mapped_column(Time)
    tap_temperature: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    pouring_time: Mapped[time | None] = mapped_column(Time)
    total_cost: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    cost_per_ton: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    cost_complete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    status: Mapped[str] = mapped_column(Enum("draft", "confirmed"), nullable=False, default="draft")
    remark: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(BIGINT(unsigned=True), ForeignKey("user.id"))
    updated_by: Mapped[int | None] = mapped_column(BIGINT(unsigned=True), ForeignKey("user.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    owner = relationship("Party")

    materials = relationship(
        "SteelmakingRecordMaterial",
        back_populates="record",
        cascade="all, delete-orphan",
        order_by="SteelmakingRecordMaterial.sort_order",
    )
    compositions = relationship(
        "SteelmakingRecordComposition",
        back_populates="record",
        cascade="all, delete-orphan",
        order_by="SteelmakingRecordComposition.id",
    )


class SteelmakingRecordMaterial(Base):
    __tablename__ = "steelmaking_record_material"
    __table_args__ = (
        Index("idx_steelmaking_material_record", "record_id"),
        Index("idx_steelmaking_material_item", "item_id"),
    )

    id: Mapped[int] = mapped_column(BIGINT(unsigned=True), primary_key=True, autoincrement=True)
    record_id: Mapped[int] = mapped_column(BIGINT(unsigned=True), ForeignKey("steelmaking_record.id", ondelete="RESTRICT"), nullable=False)
    item_id: Mapped[int] = mapped_column(BIGINT(unsigned=True), ForeignKey("item.id", ondelete="RESTRICT"), nullable=False)
    item_name_snapshot: Mapped[str] = mapped_column(String(100), nullable=False)
    item_code_snapshot: Mapped[str | None] = mapped_column(String(50))
    chemical_composition_snapshot: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False)
    default_price_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    custom_price: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    custom_price_unit: Mapped[str] = mapped_column(
        Enum("yuan_per_kg", "yuan_per_ton"), nullable=False, default="yuan_per_ton"
    )
    final_unit_price: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    input_weight: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    input_weight_unit: Mapped[str] = mapped_column(Enum("kg", "ton"), nullable=False)
    weight_kg: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    material_cost: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    sort_order: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    record = relationship("SteelmakingRecord", back_populates="materials")
    item = relationship("Item")


class SteelmakingRecordComposition(Base):
    __tablename__ = "steelmaking_record_composition"
    __table_args__ = (
        UniqueConstraint("record_id", "element_code", name="uk_steelmaking_record_element"),
        Index("idx_steelmaking_composition_record", "record_id"),
        Index("idx_steelmaking_element_code", "element_code"),
    )

    id: Mapped[int] = mapped_column(BIGINT(unsigned=True), primary_key=True, autoincrement=True)
    record_id: Mapped[int] = mapped_column(BIGINT(unsigned=True), ForeignKey("steelmaking_record.id", ondelete="RESTRICT"), nullable=False)
    element_code: Mapped[str] = mapped_column(String(10), nullable=False)
    element_name: Mapped[str] = mapped_column(String(30), nullable=False)
    element_weight_kg: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False, default=0)
    theoretical_percentage: Mapped[Decimal] = mapped_column(Numeric(12, 6), nullable=False, default=0)
    actual_percentage: Mapped[Decimal | None] = mapped_column(Numeric(12, 6))
    deviation_percentage: Mapped[Decimal | None] = mapped_column(Numeric(12, 6))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    record = relationship("SteelmakingRecord", back_populates="compositions")
