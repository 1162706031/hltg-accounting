from sqlalchemy import Boolean, Enum, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin


class Item(TimestampMixin, Base):
    __tablename__ = "item"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    item_type: Mapped[str] = mapped_column(
        Enum("steel_grade", "raw_material", "alloy", "finished_product", "semi_finished", "scrap"),
        nullable=False,
    )
    spec: Mapped[str | None] = mapped_column(String(80))
    default_unit: Mapped[str] = mapped_column(String(10), default="吨")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text)

    inventories = relationship("Inventory", back_populates="item")
