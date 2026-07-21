from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.mixins import TimestampMixin


class MasterDataOption(TimestampMixin, Base):
    __tablename__ = "master_data_option"
    __table_args__ = (
        UniqueConstraint("category", "code", name="uk_master_data_category_code"),
        UniqueConstraint("category", "name", name="uk_master_data_category_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"))
