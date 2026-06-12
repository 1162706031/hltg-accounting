from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PartyReconciliation(Base):
    __tablename__ = "party_reconciliation"
    __table_args__ = (UniqueConstraint("ref_type", "ref_id", name="uk_ref"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    party_id: Mapped[int] = mapped_column(ForeignKey("party.id"), nullable=False)
    period: Mapped[str] = mapped_column(String(20), nullable=False)
    period_start: Mapped[date | None] = mapped_column(Date)
    period_end: Mapped[date | None] = mapped_column(Date)
    ref_type: Mapped[str | None] = mapped_column(String(30))
    ref_id: Mapped[int | None] = mapped_column()
    line_no: Mapped[int] = mapped_column(default=1)
    biz_date: Mapped[date | None] = mapped_column(Date)
    biz_desc: Mapped[str | None] = mapped_column(String(200))
    steel_grade: Mapped[str | None] = mapped_column(String(50))
    weight_ton: Mapped[Decimal] = mapped_column(Numeric(10, 3), default=0)
    pieces: Mapped[int | None] = mapped_column()
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    debit: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    credit: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    invoice_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    invoice_direction: Mapped[str | None] = mapped_column(Enum("issue", "receive"))
    recon_status: Mapped[str] = mapped_column(
        Enum("unreconciled", "verified", "completed", "disabled"),
        nullable=False,
        default="unreconciled",
    )
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    party = relationship("Party", back_populates="reconciliations")
