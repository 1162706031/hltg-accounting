from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.item import Item
from app.models.party import Party
from app.models.sales import SalesOrder, SalesOrderItem
from app.models.user import User
from app.schemas.common import BatchDeleteRequest, PageResult
from app.schemas.sales import (
    RejectRequest,
    SalesOrderCreate,
    SalesOrderListItem,
    SalesOrderRead,
    SalesOrderUpdate,
)
from app.services.batch import generate_batch_no
from app.services.inventory import stock_out
from app.services.order_status import (
    DELETABLE_STATUSES,
    UNAUDITABLE_STATUSES,
    assert_editable,
    check_transition,
    compute_tax_totals,
    rollback_inventory_by_ref,
)
from app.utils.deps import get_current_user, require_roles

router = APIRouter(prefix="/sales-orders", tags=["sales"], dependencies=[Depends(get_current_user)])


def _recompute(order: SalesOrder) -> None:
    subtotal = Decimal("0")
    for line in order.items:
        line.amount = (Decimal(line.quantity or 0) * Decimal(line.unit_price or 0)).quantize(Decimal("0.01"))
        subtotal += line.amount
    order.subtotal, order.tax_amount, order.total_amount = compute_tax_totals(
        subtotal, order.tax_rate, order.need_invoice
    )


async def _load(db: AsyncSession, order_id: int) -> SalesOrder:
    stmt = (
        select(SalesOrder)
        .where(SalesOrder.id == order_id)
        .options(selectinload(SalesOrder.party), selectinload(SalesOrder.items).selectinload(SalesOrderItem.item))
    )
    order = await db.scalar(stmt)
    if order is None:
        raise HTTPException(status_code=404, detail="销售订单不存在")
    return order


@router.get("", response_model=PageResult[SalesOrderListItem])
async def list_orders(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    party_id: int | None = None,
    order_status: str | None = Query(default=None, alias="status"),
    ship_date_from: date | None = None,
    ship_date_to: date | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(SalesOrder).options(selectinload(SalesOrder.party)).order_by(SalesOrder.id.desc())
    if party_id:
        stmt = stmt.where(SalesOrder.party_id == party_id)
    if order_status:
        stmt = stmt.where(SalesOrder.status == order_status)
    if ship_date_from:
        stmt = stmt.where(SalesOrder.ship_date >= ship_date_from)
    if ship_date_to:
        stmt = stmt.where(SalesOrder.ship_date <= ship_date_to)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                SalesOrder.batch_no.like(like),
                SalesOrder.notes.like(like),
                SalesOrder.party.has(or_(Party.name.like(like), Party.short_name.like(like))),
                SalesOrder.items.any(
                    or_(
                        SalesOrderItem.spec.like(like),
                        SalesOrderItem.notes.like(like),
                        SalesOrderItem.item.has(Item.name.like(like)),
                    )
                ),
            )
        )

    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(
        items=[SalesOrderListItem.model_validate(r) for r in rows], total=total or 0, page=page, page_size=page_size
    )


@router.get("/{order_id}", response_model=SalesOrderRead)
async def get_order(order_id: int, db: AsyncSession = Depends(get_db)):
    return await _load(db, order_id)


@router.post("", response_model=SalesOrderRead, status_code=status.HTTP_201_CREATED)
async def create_order(
    payload: SalesOrderCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_roles("admin", "accountant"))
):
    async with db.begin():
        if await db.get(Party, payload.party_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="客户不存在")
        batch_no = await generate_batch_no(db, column=SalesOrder.batch_no, prefix="S", width=4)
        order = SalesOrder(
            batch_no=batch_no,
            party_id=payload.party_id,
            ship_date=payload.ship_date,
            tax_rate=payload.tax_rate,
            need_invoice=payload.need_invoice,
            notes=payload.notes,
            status="draft",
            created_by=current_user.id,
        )
        for line in payload.items:
            order.items.append(SalesOrderItem(**line.model_dump(exclude={"amount"})))
        _recompute(order)
        db.add(order)

    return await _load(db, order.id)


@router.put("/{order_id}", response_model=SalesOrderRead)
async def update_order(
    order_id: int,
    payload: SalesOrderUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        order = await _load(db, order_id)
        assert_editable(order.status)
        for key, value in payload.model_dump(exclude_unset=True, exclude={"items"}).items():
            setattr(order, key, value)
        if payload.items is not None:
            order.items.clear()
            for line in payload.items:
                order.items.append(SalesOrderItem(**line.model_dump(exclude={"amount"})))
        _recompute(order)
    return await _load(db, order_id)


@router.delete("/{order_id}")
async def delete_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    order = await db.get(SalesOrder, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="销售订单不存在")
    if order.status not in DELETABLE_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="仅草稿/驳回状态的订单可删除")
    await db.delete(order)
    await db.commit()
    return {"message": "销售订单已删除"}


@router.post("/batch-delete")
async def batch_delete_orders(
    payload: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    rows = list(await db.scalars(select(SalesOrder).where(SalesOrder.id.in_(payload.ids))))
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
@router.post("/{order_id}/submit", response_model=SalesOrderRead)
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


@router.post("/{order_id}/approve", response_model=SalesOrderRead)
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


@router.post("/{order_id}/reject", response_model=SalesOrderRead)
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


@router.post("/{order_id}/start", response_model=SalesOrderRead)
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


@router.post("/{order_id}/complete", response_model=SalesOrderRead)
async def complete_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    """完成：按每条明细的 inventory_id 扣减库存。"""
    async with db.begin():
        order = await _load(db, order_id)
        check_transition(order.status, "completed")
        for line in order.items:
            if line.inventory_id is None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"明细(line_no={line.line_no})未指定库存项，无法出库",
                )
            await stock_out(
                db,
                inventory_id=line.inventory_id,
                quantity=Decimal(line.quantity or 0),
                change_date=line.ship_date or order.ship_date or datetime.utcnow().date(),
                notes=f"批次号：{order.batch_no}；销售出库",
                ref_type="sales_order",
                ref_id=order.id,
                created_by=order.created_by,
            )
        order.status = "completed"
    return await _load(db, order_id)


@router.post("/{order_id}/unaudit", response_model=SalesOrderRead)
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
        await rollback_inventory_by_ref(db, ref_type="sales_order", ref_id=order.id)
        order.status = "draft"
        order.audited_by = None
        order.audited_at = None
    return await _load(db, order_id)
