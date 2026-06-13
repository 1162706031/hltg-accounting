from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
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
    apply_approve_inventory,
    apply_complete_inventory,
    assert_editable,
    check_transition,
    load_order,
    recompute_amounts,
    rollback_inventory,
)
from app.utils.deps import get_current_user, require_roles

router = APIRouter(prefix="/outsource-orders", tags=["outsource"], dependencies=[Depends(get_current_user)])

_DELETABLE_STATUSES = {"draft", "rejected"}
# 工艺 → 批次号前缀（设计 §6.5 / §7.3）
_BATCH_PREFIX = {"forging": "2", "esr": "4", "turning": "5", "annealing": "T"}


@router.get("", response_model=PageResult[OutsourceOrderListItem])
async def list_orders(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    process_type: str | None = None,
    party_id: int | None = None,
    order_status: str | None = Query(default=None, alias="status"),
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
    if q:
        stmt = stmt.where(OutsourceOrder.batch_no.like(f"%{q}%"))

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
    current_user: User = Depends(get_current_user),
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
        recompute_amounts(order)
        db.add(order)

    return await load_order(db, order.id)


@router.put("/{order_id}", response_model=OutsourceOrderRead)
async def update_order(order_id: int, payload: OutsourceOrderUpdate, db: AsyncSession = Depends(get_db)):
    async with db.begin():
        order = await load_order(db, order_id)
        assert_editable(order)

        data = payload.model_dump(exclude_unset=True, exclude={"outbound_lines", "inbound_lines"})
        for key, value in data.items():
            setattr(order, key, value)

        if payload.outbound_lines is not None:
            order.outbound_lines.clear()
            for line in payload.outbound_lines:
                order.outbound_lines.append(ProcessingOutbound(**line.model_dump()))
        if payload.inbound_lines is not None:
            order.inbound_lines.clear()
            for line in payload.inbound_lines:
                order.inbound_lines.append(ProcessingInbound(**line.model_dump()))

        recompute_amounts(order)

    return await load_order(db, order_id)


@router.delete("/{order_id}")
async def delete_order(order_id: int, db: AsyncSession = Depends(get_db)):
    order = await db.get(OutsourceOrder, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="外协订单不存在")
    if order.status not in _DELETABLE_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="仅草稿/驳回状态的订单可删除")
    await db.delete(order)
    await db.commit()
    return {"message": "外协订单已删除"}


@router.post("/batch-delete")
async def batch_delete_orders(payload: BatchDeleteRequest, db: AsyncSession = Depends(get_db)):
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
async def submit_order(order_id: int, db: AsyncSession = Depends(get_db)):
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
        await apply_approve_inventory(db, order)
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
        check_transition(order, "rejected")
        order.status = "rejected"
        order.audited_by = current_user.id
        order.audited_at = datetime.utcnow()
        order.notes = f"{order.notes or ''}\n[驳回] {payload.reason}".strip()
    return await load_order(db, order_id)


@router.post("/{order_id}/start", response_model=OutsourceOrderRead)
async def start_order(order_id: int, db: AsyncSession = Depends(get_db)):
    async with db.begin():
        order = await load_order(db, order_id)
        check_transition(order, "in_progress")
        order.status = "in_progress"
    return await load_order(db, order_id)


@router.post("/{order_id}/complete", response_model=OutsourceOrderRead)
async def complete_order(order_id: int, db: AsyncSession = Depends(get_db)):
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
    current_user: User = Depends(require_roles("admin")),
):
    async with db.begin():
        order = await load_order(db, order_id)
        if order.status not in {"approved", "in_progress", "completed"}:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="仅已审核/进行中/已完成订单可反审核")
        await rollback_inventory(db, order)
        order.status = "draft"
        order.audited_by = None
        order.audited_at = None
    return await load_order(db, order_id)
