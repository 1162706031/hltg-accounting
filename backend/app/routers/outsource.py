from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.item import Item
from app.models.outsource import OutsourceOrder, ProcessingInbound, ProcessingOutbound
from app.models.party import Party
from app.models.user import User
from app.schemas.common import BatchDeleteRequest, PageResult
from app.schemas.outsource import (
    OutsourceOrderCreate,
    OutsourceOrderListItem,
    OutsourceOrderRead,
    OutsourceOrderUpdate,
    RejectRequest,
)
from app.services.batch import generate_batch_no
from app.services.outsource import (
    apply_complete_inventory,
    apply_start_inventory,
    assert_editable,
    assert_stock_out_lines_unchanged,
    check_transition,
    load_order,
    recompute_amounts,
    rollback_inventory,
    STOCK_OUT_LOCKED_STATUSES,
)
from app.services.smelting import get_yield_excluded_item_ids
from app.utils.deps import get_current_user, require_roles

router = APIRouter(prefix="/outsource-orders", tags=["outsource"], dependencies=[Depends(get_current_user)])

_DELETABLE_STATUSES = {"draft", "rejected"}
# 工艺 → 批次号前缀（设计 §6.5 / §7.3）
_BATCH_PREFIX = {"forging": "2", "esr": "4", "turning": "5", "annealing": "T"}


@router.get("", response_model=PageResult[OutsourceOrderListItem])
async def list_orders(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=500),
    process_type: str | None = None,
    party_id: int | None = None,
    order_status: str | None = Query(default=None, alias="status"),
    out_date_from: date | None = None,
    out_date_to: date | None = None,
    in_date_from: date | None = None,
    in_date_to: date | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(OutsourceOrder).options(selectinload(OutsourceOrder.party)).order_by(OutsourceOrder.id.desc())
    if process_type:
        stmt = stmt.where(OutsourceOrder.process_type == process_type)
    if party_id:
        stmt = stmt.where(OutsourceOrder.party_id == party_id)
    if order_status:
        stmt = stmt.where(OutsourceOrder.status == order_status)
    if out_date_from:
        stmt = stmt.where(OutsourceOrder.out_date >= out_date_from)
    if out_date_to:
        stmt = stmt.where(OutsourceOrder.out_date <= out_date_to)
    if in_date_from:
        stmt = stmt.where(OutsourceOrder.in_date >= in_date_from)
    if in_date_to:
        stmt = stmt.where(OutsourceOrder.in_date <= in_date_to)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                OutsourceOrder.batch_no.like(like),
                OutsourceOrder.process_type.like(like),
                OutsourceOrder.notes.like(like),
                OutsourceOrder.party.has(or_(Party.name.like(like), Party.short_name.like(like))),
                OutsourceOrder.outbound_lines.any(
                    or_(
                        ProcessingOutbound.spec.like(like),
                        ProcessingOutbound.notes.like(like),
                        ProcessingOutbound.item.has(Item.name.like(like)),
                    )
                ),
                OutsourceOrder.inbound_lines.any(
                    or_(
                        ProcessingInbound.spec.like(like),
                        ProcessingInbound.notes.like(like),
                        ProcessingInbound.item.has(Item.name.like(like)),
                        ProcessingInbound.owner.has(or_(Party.name.like(like), Party.short_name.like(like))),
                    )
                ),
            )
        )

    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(
        items=[OutsourceOrderListItem.model_validate(row) for row in rows],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


@router.get("/{order_id}", response_model=OutsourceOrderRead)
async def get_order(order_id: int, db: AsyncSession = Depends(get_db)):
    return await load_order(db, order_id)


@router.post("", response_model=OutsourceOrderRead, status_code=status.HTTP_201_CREATED)
async def create_order(
    payload: OutsourceOrderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        if await db.get(Party, payload.party_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="外协厂不存在")
        prefix = _BATCH_PREFIX[payload.process_type]
        batch_no = await generate_batch_no(db, column=OutsourceOrder.batch_no, prefix=prefix, width=6)
        order = OutsourceOrder(
            batch_no=batch_no,
            party_id=payload.party_id,
            process_type=payload.process_type,
            unit_price=payload.unit_price,
            tax_rate=payload.tax_rate,
            saw_head_ton=payload.saw_head_ton,
            loss_ton=payload.loss_ton,
            yield_rate=payload.yield_rate,
            need_invoice=payload.need_invoice,
            notes=payload.notes,
            status="draft",
            created_by=current_user.id,
        )
        for line in payload.outbound_lines:
            order.outbound_lines.append(ProcessingOutbound(**line.model_dump()))
        for line in payload.inbound_lines:
            order.inbound_lines.append(ProcessingInbound(**line.model_dump()))
        excluded_item_ids = await get_yield_excluded_item_ids(db, (line.item_id for line in order.inbound_lines))
        recompute_amounts(order, excluded_item_ids)
        db.add(order)

    return await load_order(db, order.id)


@router.put("/{order_id}", response_model=OutsourceOrderRead)
async def update_order(
    order_id: int,
    payload: OutsourceOrderUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        order = await load_order(db, order_id)
        assert_editable(order)
        assert_stock_out_lines_unchanged(order, payload.outbound_lines)

        data = payload.model_dump(
            exclude_unset=True,
            exclude={"outbound_lines", "inbound_lines", "out_date", "in_date"},
        )
        for key, value in data.items():
            setattr(order, key, value)

        if payload.outbound_lines is not None:
            if order.status not in STOCK_OUT_LOCKED_STATUSES:
                order.outbound_lines.clear()
                for line in payload.outbound_lines:
                    order.outbound_lines.append(ProcessingOutbound(**line.model_dump()))
        if payload.inbound_lines is not None:
            order.inbound_lines.clear()
            for line in payload.inbound_lines:
                order.inbound_lines.append(ProcessingInbound(**line.model_dump()))

        excluded_item_ids = await get_yield_excluded_item_ids(db, (line.item_id for line in order.inbound_lines))
        recompute_amounts(order, excluded_item_ids)

    return await load_order(db, order_id)


@router.delete("/{order_id}")
async def delete_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    order = await db.get(OutsourceOrder, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="外协订单不存在")
    if order.status not in _DELETABLE_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="仅草稿/驳回状态的订单可删除")
    await db.delete(order)
    await db.commit()
    return {"message": "外协订单已删除"}


@router.post("/batch-delete")
async def batch_delete_orders(
    payload: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    rows = list(await db.scalars(select(OutsourceOrder).where(OutsourceOrder.id.in_(payload.ids))))
    deleted = 0
    skipped: list[dict[str, object]] = []
    for order in rows:
        if order.status not in _DELETABLE_STATUSES:
            skipped.append({"id": order.id, "reason": "仅草稿/驳回状态的订单可删除"})
            continue
        await db.delete(order)
        deleted += 1
    await db.commit()
    return {"deleted_count": deleted, "skipped": skipped}


# ---------- 状态机 ----------
@router.post("/{order_id}/submit", response_model=OutsourceOrderRead)
async def submit_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        order = await load_order(db, order_id)
        check_transition(order, "pending_review")
        order.status = "pending_review"
    return await load_order(db, order_id)


@router.post("/{order_id}/approve", response_model=OutsourceOrderRead)
async def approve_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("reviewer", "admin")),
):
    async with db.begin():
        order = await load_order(db, order_id)
        check_transition(order, "approved")
        order.status = "approved"
        order.audited_by = current_user.id
        order.audited_at = datetime.utcnow()
    return await load_order(db, order_id)


@router.post("/{order_id}/reject", response_model=OutsourceOrderRead)
async def reject_order(
    order_id: int,
    payload: RejectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("reviewer", "admin")),
):
    async with db.begin():
        order = await load_order(db, order_id)
        check_transition(order, "in_progress")
        order.status = "in_progress"
        order.audited_by = current_user.id
        order.audited_at = datetime.utcnow()
        order.notes = f"{order.notes or ''}\n[驳回] {payload.reason}".strip()
    return await load_order(db, order_id)


@router.post("/{order_id}/start", response_model=OutsourceOrderRead)
async def start_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        order = await load_order(db, order_id)
        check_transition(order, "in_progress")
        await apply_start_inventory(db, order)
        order.status = "in_progress"
    return await load_order(db, order_id)


@router.post("/{order_id}/complete", response_model=OutsourceOrderRead)
async def complete_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        order = await load_order(db, order_id)
        check_transition(order, "completed")
        await apply_complete_inventory(db, order)
        order.status = "completed"
    return await load_order(db, order_id)


@router.post("/{order_id}/unaudit", response_model=OutsourceOrderRead)
async def unaudit_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    async with db.begin():
        order = await load_order(db, order_id)
        if order.status in {"in_progress", "pending_review"}:
            if current_user.role not in {"admin", "accountant"}:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="没有权限撤销该订单")
        elif order.status in {"approved", "completed"}:
            if current_user.role != "admin":
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅管理员可反审核该订单")
        else:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="当前状态不可撤销")
        await rollback_inventory(db, order)
        order.status = "draft"
        order.audited_by = None
        order.audited_at = None
    return await load_order(db, order_id)
