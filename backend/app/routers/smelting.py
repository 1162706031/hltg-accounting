from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.item import Item
from app.models.party import Party
from app.models.smelting import AlloyAddition, SmeltingInbound, SmeltingOrder
from app.models.user import User
from app.schemas.common import BatchDeleteRequest, PageResult
from app.schemas.smelting import (
    RejectRequest,
    SmeltingOrderCreate,
    SmeltingOrderListItem,
    SmeltingOrderRead,
    SmeltingOrderUpdate,
)
from app.services.batch import generate_batch_no
from app.services.smelting import (
    apply_complete_inventory,
    apply_start_inventory,
    assert_editable,
    assert_stock_out_lines_unchanged,
    check_transition,
    get_yield_excluded_item_ids,
    load_order,
    recompute_amounts,
    rollback_inventory,
    STOCK_OUT_LOCKED_STATUSES,
)
from app.utils.deps import get_current_user, require_roles

router = APIRouter(prefix="/smelting-orders", tags=["smelting"], dependencies=[Depends(get_current_user)])

# 仅 draft / rejected 可删除
_DELETABLE_STATUSES = {"draft", "rejected"}


@router.get("", response_model=PageResult[SmeltingOrderListItem])
async def list_orders(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    order_type: str | None = None,
    party_id: int | None = None,
    order_status: str | None = Query(default=None, alias="status"),
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(SmeltingOrder).options(selectinload(SmeltingOrder.party)).order_by(SmeltingOrder.id.desc())
    if order_type:
        stmt = stmt.where(SmeltingOrder.order_type == order_type)
    if party_id:
        stmt = stmt.where(SmeltingOrder.party_id == party_id)
    if order_status:
        stmt = stmt.where(SmeltingOrder.status == order_status)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                SmeltingOrder.batch_no.like(like),
                SmeltingOrder.notes.like(like),
                SmeltingOrder.party.has(or_(Party.name.like(like), Party.short_name.like(like))),
                SmeltingOrder.inbound_lines.any(
                    or_(
                        SmeltingInbound.spec.like(like),
                        SmeltingInbound.furnace_no.like(like),
                        SmeltingInbound.notes.like(like),
                        SmeltingInbound.item.has(Item.name.like(like)),
                        SmeltingInbound.owner.has(or_(Party.name.like(like), Party.short_name.like(like))),
                    )
                ),
                SmeltingOrder.alloy_lines.any(
                    or_(
                        AlloyAddition.spec.like(like),
                        AlloyAddition.notes.like(like),
                        AlloyAddition.item.has(Item.name.like(like)),
                    )
                ),
            )
        )

    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(
        items=[SmeltingOrderListItem.model_validate(row) for row in rows],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


@router.get("/{order_id}", response_model=SmeltingOrderRead)
async def get_order(order_id: int, db: AsyncSession = Depends(get_db)):
    return await load_order(db, order_id)


@router.post("", response_model=SmeltingOrderRead, status_code=status.HTTP_201_CREATED)
async def create_order(
    payload: SmeltingOrderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        if await db.get(Party, payload.party_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="业务单位不存在")
        batch_no = await generate_batch_no(db, column=SmeltingOrder.batch_no, prefix="3", width=6)
        order = SmeltingOrder(
            batch_no=batch_no,
            party_id=payload.party_id,
            order_type=payload.order_type,
            feed_date=payload.feed_date,
            tap_date=payload.tap_date,
            casting_loss_kg=payload.casting_loss_kg,
            casting_loss_pct=payload.casting_loss_pct,
            yield_pct=payload.yield_pct,
            unit_price=payload.unit_price,
            tax_rate=payload.tax_rate,
            need_invoice=payload.need_invoice,
            notes=payload.notes,
            status="draft",
            created_by=current_user.id,
        )
        for line in payload.inbound_lines:
            order.inbound_lines.append(SmeltingInbound(**line.model_dump()))
        for alloy in payload.alloy_lines:
            order.alloy_lines.append(AlloyAddition(**alloy.model_dump()))
        excluded_item_ids = await get_yield_excluded_item_ids(
            db, (line.item_id for line in order.inbound_lines if line.side == "out")
        )
        recompute_amounts(order, excluded_item_ids)
        db.add(order)

    return await load_order(db, order.id)


@router.put("/{order_id}", response_model=SmeltingOrderRead)
async def update_order(
    order_id: int,
    payload: SmeltingOrderUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        order = await load_order(db, order_id)
        assert_editable(order)
        assert_stock_out_lines_unchanged(order, payload.inbound_lines, payload.alloy_lines)

        data = payload.model_dump(exclude_unset=True, exclude={"inbound_lines", "alloy_lines"})
        if order.status in STOCK_OUT_LOCKED_STATUSES and data.get("feed_date", order.feed_date) != order.feed_date:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="订单已开始加工，投料日期已扣库，禁止修改")
        for key, value in data.items():
            setattr(order, key, value)

        # 全量替换子表
        if payload.inbound_lines is not None:
            if order.status in STOCK_OUT_LOCKED_STATUSES:
                for line in list(order.inbound_lines):
                    if line.side == "out":
                        order.inbound_lines.remove(line)
                lines_to_save = [line for line in payload.inbound_lines if line.side == "out"]
            else:
                order.inbound_lines.clear()
                lines_to_save = payload.inbound_lines
            for line in lines_to_save:
                order.inbound_lines.append(SmeltingInbound(**line.model_dump()))
        if payload.alloy_lines is not None:
            if order.status not in STOCK_OUT_LOCKED_STATUSES:
                order.alloy_lines.clear()
                for alloy in payload.alloy_lines:
                    order.alloy_lines.append(AlloyAddition(**alloy.model_dump()))

        excluded_item_ids = await get_yield_excluded_item_ids(
            db, (line.item_id for line in order.inbound_lines if line.side == "out")
        )
        recompute_amounts(order, excluded_item_ids)

    return await load_order(db, order_id)


@router.delete("/{order_id}")
async def delete_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    order = await db.get(SmeltingOrder, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="冶炼订单不存在")
    if order.status not in _DELETABLE_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="仅草稿/驳回状态的订单可删除")
    await db.delete(order)
    await db.commit()
    return {"message": "冶炼订单已删除"}


@router.post("/batch-delete")
async def batch_delete_orders(
    payload: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    rows = list(await db.scalars(select(SmeltingOrder).where(SmeltingOrder.id.in_(payload.ids))))
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
@router.post("/{order_id}/submit", response_model=SmeltingOrderRead)
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


@router.post("/{order_id}/approve", response_model=SmeltingOrderRead)
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


@router.post("/{order_id}/reject", response_model=SmeltingOrderRead)
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


@router.post("/{order_id}/start", response_model=SmeltingOrderRead)
async def start_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        order = await load_order(db, order_id)
        check_transition(order, "in_progress")
        await apply_start_inventory(db, order)  # 扣减投料 + 合金库存
        order.status = "in_progress"
    return await load_order(db, order_id)


@router.post("/{order_id}/complete", response_model=SmeltingOrderRead)
async def complete_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        order = await load_order(db, order_id)
        check_transition(order, "completed")
        await apply_complete_inventory(db, order)  # 出钢入库
        order.status = "completed"
    return await load_order(db, order_id)


@router.post("/{order_id}/unaudit", response_model=SmeltingOrderRead)
async def unaudit_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """撤销/反审核：回滚全部库存联动并回到 draft。"""
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
