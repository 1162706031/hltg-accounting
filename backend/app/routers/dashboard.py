from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.outsource import OutsourceOrder
from app.models.procurement import ProcurementOrder
from app.models.sales import SalesOrder
from app.models.smelting import SmeltingOrder
from app.services.party_balance import list_party_balances
from app.utils.deps import get_current_user, require_roles

router = APIRouter(prefix="/dashboard", tags=["dashboard"], dependencies=[Depends(get_current_user)])


class PendingAuditItem(BaseModel):
    order_kind: str  # smelting / outsource / procurement / sales
    order_id: int
    batch_no: str
    party_name: str | None
    amount: float | None
    created_by: int | None
    created_at: str | None
    status: str


class DashboardStats(BaseModel):
    smelting_this_month: int
    outsource_this_month: int
    procurement_this_month: int
    sales_this_month: int
    pending_audit_count: int


# 业务类别 → (模型, 中文名)
_ORDER_KINDS = {
    "smelting": (SmeltingOrder, "冶炼"),
    "outsource": (OutsourceOrder, "外协"),
    "procurement": (ProcurementOrder, "采购"),
    "sales": (SalesOrder, "销售"),
}


@router.get("/stats", response_model=DashboardStats)
async def get_stats(db: AsyncSession = Depends(get_db)):
    today = date.today()
    month_start = today.replace(day=1)

    async def count_month(model) -> int:
        return await db.scalar(
            select(func.count()).select_from(model).where(model.created_at >= month_start)
        ) or 0

    async def count_pending(model) -> int:
        return await db.scalar(
            select(func.count()).select_from(model).where(model.status == "pending_review")
        ) or 0

    pending = 0
    for model, _ in _ORDER_KINDS.values():
        pending += await count_pending(model)

    return DashboardStats(
        smelting_this_month=await count_month(SmeltingOrder),
        outsource_this_month=await count_month(OutsourceOrder),
        procurement_this_month=await count_month(ProcurementOrder),
        sales_this_month=await count_month(SalesOrder),
        pending_audit_count=pending,
    )


@router.get("/party-balances")
async def party_balances(db: AsyncSession = Depends(get_db)):
    """各往来单位余额。"""
    return await list_party_balances(db)


@router.get("/pending-audits", response_model=list[PendingAuditItem])
async def pending_audits(
    kind: str | None = Query(default=None, description="smelting/outsource/procurement/sales，空=全部"),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("reviewer", "admin")),
):
    """审核中心：聚合 4 类订单的待审核(pending_review)记录。"""
    from app.models.party import Party

    kinds = {kind: _ORDER_KINDS[kind]} if kind in _ORDER_KINDS else _ORDER_KINDS

    items: list[PendingAuditItem] = []
    for order_kind, (model, _name) in kinds.items():
        stmt = (
            select(
                model.id,
                model.batch_no,
                model.created_by,
                model.created_at,
                model.status,
                model.total_amount.label("amount"),
                Party.name.label("party_name"),
            )
            .join(Party, Party.id == model.party_id, isouter=True)
            .where(model.status == "pending_review")
            .order_by(model.created_at.asc())
        )
        rows = await db.execute(stmt)
        for row in rows:
            m = row._mapping
            items.append(
                PendingAuditItem(
                    order_kind=order_kind,
                    order_id=m["id"],
                    batch_no=m["batch_no"],
                    party_name=m["party_name"],
                    amount=float(m["amount"]) if m["amount"] is not None else None,
                    created_by=m["created_by"],
                    created_at=m["created_at"].isoformat() if m["created_at"] else None,
                    status=m["status"],
                )
            )

    items.sort(key=lambda x: x.created_at or "")
    return items
