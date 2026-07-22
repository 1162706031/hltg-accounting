from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.item import Item
from app.models.party import Party
from app.models.procurement import ProcurementOrder, ProcurementOrderItem
from app.models.user import User
from app.schemas.common import BatchDeleteRequest, PageResult
from app.schemas.procurement import (
    ProcurementOrderCreate,
    ProcurementOrderRead,
    ProcurementOrderUpdate,
    RejectRequest,
)
from app.services.batch import generate_batch_no
from app.services.creator import apply_creation_filters, serialize_with_creator_names
from app.services.inventory import stock_in
from app.services.master_data import require_specification
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
    for line in order.items:
        line.amount = (Decimal(line.quantity or 0) * Decimal(line.unit_price or 0)).quantize(Decimal("0.0001"))
    order.amount = sum((Decimal(line.amount or 0) for line in order.items), Decimal("0")).quantize(Decimal("0.01"))
    order.subtotal, order.tax_amount, order.total_amount = compute_tax_totals(
        order.amount, order.tax_rate, order.need_invoice
    )

    # 保留采购主表旧字段作为历史接口兼容摘要；业务明细以 items 为准。
    first = order.items[0] if order.items else None
    order.purchase_date = max((line.in_date for line in order.items), default=None)
    order.owner_id = first.owner_id if first else order.owner_id
    order.item_id = first.item_id if first else None
    order.item_spec = first.item_spec if first else None
    units = {line.unit for line in order.items}
    order.quantity = (
        sum((Decimal(line.quantity or 0) for line in order.items), Decimal("0"))
        if len(units) == 1 else Decimal("0")
    )
    order.unit = next(iter(units)) if len(units) == 1 else "多单位"
    order.unit_price = first.unit_price if len(order.items) == 1 and first else Decimal("0")


async def _replace_items(db: AsyncSession, order: ProcurementOrder, payload_items) -> None:
    item_ids = {line.item_id for line in payload_items}
    owner_ids = {line.owner_id for line in payload_items}
    existing_item_ids = set(await db.scalars(select(Item.id).where(Item.id.in_(item_ids))))
    existing_owner_ids = set(await db.scalars(select(Party.id).where(Party.id.in_(owner_ids))))
    if missing := item_ids - existing_item_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"物品不存在：{sorted(missing)}")
    if missing := owner_ids - existing_owner_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"所属单位不存在：{sorted(missing)}")

    validated_items = []
    for index, line in enumerate(payload_items, start=1):
        specification = await require_specification(db, line.item_spec or "")
        validated_items.append(
            ProcurementOrderItem(
                line_no=index,
                in_date=line.in_date,
                item_id=line.item_id,
                item_spec=specification.code,
                quantity=line.quantity,
                unit=line.unit,
                unit_price=line.unit_price,
                owner_id=line.owner_id,
            )
        )

    order.items.clear()
    order.items.extend(validated_items)
    _recompute(order)


async def _load(db: AsyncSession, order_id: int) -> ProcurementOrder:
    stmt = (
        select(ProcurementOrder)
        .where(ProcurementOrder.id == order_id)
        .options(
            selectinload(ProcurementOrder.party),
            selectinload(ProcurementOrder.owner),
            selectinload(ProcurementOrder.item),
            selectinload(ProcurementOrder.items).selectinload(ProcurementOrderItem.item),
            selectinload(ProcurementOrder.items).selectinload(ProcurementOrderItem.owner),
        )
    )
    order = await db.scalar(stmt)
    if order is None:
        raise HTTPException(status_code=404, detail="采购订单不存在")
    return order


@router.get("", response_model=PageResult[ProcurementOrderRead])
async def list_orders(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=500),
    party_id: int | None = None,
    order_status: str | None = Query(default=None, alias="status"),
    purchase_date_from: date | None = None,
    purchase_date_to: date | None = None,
    created_by: int | None = None,
    created_by_name: str | None = None,
    created_at_from: date | None = None,
    created_at_to: date | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(ProcurementOrder)
        .options(
            selectinload(ProcurementOrder.party),
            selectinload(ProcurementOrder.owner),
            selectinload(ProcurementOrder.item),
            selectinload(ProcurementOrder.items).selectinload(ProcurementOrderItem.item),
            selectinload(ProcurementOrder.items).selectinload(ProcurementOrderItem.owner),
        )
        .order_by(ProcurementOrder.id.desc())
    )
    stmt = apply_creation_filters(
        stmt,
        ProcurementOrder,
        created_by=created_by,
        created_by_name=created_by_name,
        created_at_from=created_at_from,
        created_at_to=created_at_to,
    )
    if party_id:
        stmt = stmt.where(ProcurementOrder.party_id == party_id)
    if order_status:
        stmt = stmt.where(ProcurementOrder.status == order_status)
    if purchase_date_from:
        stmt = stmt.where(ProcurementOrder.purchase_date >= purchase_date_from)
    if purchase_date_to:
        stmt = stmt.where(ProcurementOrder.purchase_date <= purchase_date_to)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                ProcurementOrder.batch_no.like(like),
                ProcurementOrder.item_spec.like(like),
                ProcurementOrder.unit.like(like),
                ProcurementOrder.notes.like(like),
                ProcurementOrder.party.has(or_(Party.name.like(like), Party.short_name.like(like))),
                ProcurementOrder.owner.has(or_(Party.name.like(like), Party.short_name.like(like))),
                ProcurementOrder.item.has(Item.name.like(like)),
                ProcurementOrder.items.any(ProcurementOrderItem.item_spec.like(like)),
                ProcurementOrder.items.any(ProcurementOrderItem.item.has(Item.name.like(like))),
            )
        )

    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = list(await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)))
    return PageResult(
        items=await serialize_with_creator_names(db, rows, ProcurementOrderRead),
        total=total or 0,
        page=page,
        page_size=page_size,
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
        owner_id = payload.items[0].owner_id if payload.items else await resolve_internal_party_id(db)
        batch_no = await generate_batch_no(db, column=ProcurementOrder.batch_no, prefix="P", width=4)
        order = ProcurementOrder(
            batch_no=batch_no,
            party_id=payload.party_id,
            owner_id=owner_id,
            tax_rate=payload.tax_rate,
            need_invoice=payload.need_invoice,
            notes=payload.notes,
            status="draft",
            created_by=current_user.id,
        )
        await _replace_items(db, order, payload.items)
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
        data = payload.model_dump(exclude_unset=True, exclude={"items"})
        for key, value in data.items():
            setattr(order, key, value)
        if payload.items is not None:
            await _replace_items(db, order, payload.items)
        else:
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
        for line in order.items:
            await stock_in(
                db,
                item_id=line.item_id,
                owner_id=line.owner_id,
                spec=line.item_spec,
                unit=line.unit,
                quantity=Decimal(line.quantity or 0),
                change_date=line.in_date,
                notes=f"批次号：{order.batch_no}；采购入库",
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
