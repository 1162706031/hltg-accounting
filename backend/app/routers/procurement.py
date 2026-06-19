from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.party import Party
from app.models.procurement import ProcurementOrder
from app.models.user import User
from app.schemas.common import BatchDeleteRequest, PageResult
from app.schemas.procurement import (
    ProcurementOrderCreate,
    ProcurementOrderRead,
    ProcurementOrderUpdate,
    RejectRequest,
)
from app.services.batch import generate_batch_no
from app.services.inventory import stock_in
from app.services.order_status import (
    DELETABLE_STATUSES,
    UNAUDITABLE_STATUSES,
    assert_editable,
    check_transition,
    compute_tax_totals,
    rollback_inventory_by_ref,
)
from app.services.smelting import resolve_internal_party_id
from app.utils.deps import get_current_user, require_roles

router = APIRouter(prefix="/procurement-orders", tags=["procurement"], dependencies=[Depends(get_current_user)])


def _recompute(order: ProcurementOrder) -> None:
    order.amount = (Decimal(order.quantity or 0) * Decimal(order.unit_price or 0)).quantize(Decimal("0.01"))
    order.subtotal, order.tax_amount, order.total_amount = compute_tax_totals(
        order.amount, order.tax_rate, order.need_invoice
    )


async def _load(db: AsyncSession, order_id: int) -> ProcurementOrder:
    stmt = (
        select(ProcurementOrder)
        .where(ProcurementOrder.id == order_id)
        .options(
            selectinload(ProcurementOrder.party),
            selectinload(ProcurementOrder.owner),
            selectinload(ProcurementOrder.item),
        )
    )
    order = await db.scalar(stmt)
    if order is None:
        raise HTTPException(status_code=404, detail="采购订单不存在")
    return order


@router.get("", response_model=PageResult[ProcurementOrderRead])
async def list_orders(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    party_id: int | None = None,
    order_status: str | None = Query(default=None, alias="status"),
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(ProcurementOrder)
        .options(
            selectinload(ProcurementOrder.party),
            selectinload(ProcurementOrder.owner),
            selectinload(ProcurementOrder.item),
        )
        .order_by(ProcurementOrder.id.desc())
    )
    if party_id:
        stmt = stmt.where(ProcurementOrder.party_id == party_id)
    if order_status:
        stmt = stmt.where(ProcurementOrder.status == order_status)
    if q:
        stmt = stmt.where(ProcurementOrder.batch_no.like(f"%{q}%"))

    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(
        items=[ProcurementOrderRead.model_validate(r) for r in rows], total=total or 0, page=page, page_size=page_size
    )


@router.get("/{order_id}", response_model=ProcurementOrderRead)
async def get_order(order_id: int, db: AsyncSession = Depends(get_db)):
    return await _load(db, order_id)


@router.post("", response_model=ProcurementOrderRead, status_code=status.HTTP_201_CREATED)
async def create_order(
    payload: ProcurementOrderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        if await db.get(Party, payload.party_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="供应商不存在")
        owner_id = payload.owner_id or await resolve_internal_party_id(db)
        batch_no = await generate_batch_no(db, column=ProcurementOrder.batch_no, prefix="P", width=4)
        order = ProcurementOrder(
            batch_no=batch_no,
            party_id=payload.party_id,
            owner_id=owner_id,
            purchase_date=payload.purchase_date,
            item_id=payload.item_id,
            item_spec=payload.item_spec,
            quantity=payload.quantity,
            unit=payload.unit,
            unit_price=payload.unit_price,
            tax_rate=payload.tax_rate,
            need_invoice=payload.need_invoice,
            notes=payload.notes,
            status="draft",
            created_by=current_user.id,
        )
        _recompute(order)
        db.add(order)

    return await _load(db, order.id)


@router.put("/{order_id}", response_model=ProcurementOrderRead)
async def update_order(
    order_id: int,
    payload: ProcurementOrderUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        order = await _load(db, order_id)
        assert_editable(order.status)
        for key, value in payload.model_dump(exclude_unset=True).items():
            setattr(order, key, value)
        _recompute(order)
    return await _load(db, order_id)


@router.delete("/{order_id}")
async def delete_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    order = await db.get(ProcurementOrder, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="采购订单不存在")
    if order.status not in DELETABLE_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="仅草稿/驳回状态的订单可删除")
    await db.delete(order)
    await db.commit()
    return {"message": "采购订单已删除"}


@router.post("/batch-delete")
async def batch_delete_orders(
    payload: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    rows = list(await db.scalars(select(ProcurementOrder).where(ProcurementOrder.id.in_(payload.ids))))
    deleted = 0
    skipped: list[dict[str, object]] = []
    for order in rows:
        if order.status not in DELETABLE_STATUSES:
            skipped.append({"id": order.id, "reason": "仅草稿/驳回状态的订单可删除"})
            continue
        await db.delete(order)
        deleted += 1
    await db.commit()
    return {"deleted_count": deleted, "skipped": skipped}


# ---------- 状态机 ----------
@router.post("/{order_id}/submit", response_model=ProcurementOrderRead)
async def submit_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        order = await _load(db, order_id)
        check_transition(order.status, "pending_review")
        order.status = "pending_review"
    return await _load(db, order_id)


@router.post("/{order_id}/approve", response_model=ProcurementOrderRead)
async def approve_order(
    order_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_roles("reviewer", "admin"))
):
    async with db.begin():
        order = await _load(db, order_id)
        check_transition(order.status, "approved")
        order.status = "approved"
        order.audited_by = current_user.id
        order.audited_at = datetime.utcnow()
    return await _load(db, order_id)


@router.post("/{order_id}/reject", response_model=ProcurementOrderRead)
async def reject_order(
    order_id: int,
    payload: RejectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("reviewer", "admin")),
):
    async with db.begin():
        order = await _load(db, order_id)
        check_transition(order.status, "in_progress")
        order.status = "in_progress"
        order.audited_by = current_user.id
        order.audited_at = datetime.utcnow()
        order.notes = f"{order.notes or ''}\n[驳回] {payload.reason}".strip()
    return await _load(db, order_id)


@router.post("/{order_id}/start", response_model=ProcurementOrderRead)
async def start_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        order = await _load(db, order_id)
        check_transition(order.status, "in_progress")
        order.status = "in_progress"
    return await _load(db, order_id)


@router.post("/{order_id}/complete", response_model=ProcurementOrderRead)
async def complete_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    """完成：采购入库到 owner。"""
    async with db.begin():
        order = await _load(db, order_id)
        check_transition(order.status, "completed")
        if order.item_id:
            await stock_in(
                db,
                item_id=order.item_id,
                owner_id=order.owner_id,
                spec=order.item_spec,
                unit=order.unit,
                quantity=Decimal(order.quantity or 0),
                change_date=order.purchase_date or datetime.utcnow().date(),
                notes=f"采购#{order.batch_no}入库",
                ref_type="procurement_order",
                ref_id=order.id,
                created_by=order.created_by,
            )
        order.status = "completed"
    return await _load(db, order_id)


@router.post("/{order_id}/unaudit", response_model=ProcurementOrderRead)
async def unaudit_order(
    order_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
):
    async with db.begin():
        order = await _load(db, order_id)
        if order.status not in UNAUDITABLE_STATUSES:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="当前状态不可撤销")
        if order.status in {"in_progress", "pending_review"}:
            if current_user.role not in {"admin", "accountant"}:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="没有权限撤销该订单")
        elif current_user.role != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅管理员可反审核该订单")
        await rollback_inventory_by_ref(db, ref_type="procurement_order", ref_id=order.id)
        order.status = "draft"
        order.audited_by = None
        order.audited_at = None
    return await _load(db, order_id)
