from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.inventory import Inventory
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
from app.services.creator import apply_creation_filters, serialize_with_creator_names
from app.services.inventory import stock_out, stock_out_inventory_obj
from app.services.master_data import require_specification
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
    line_dates = [line.ship_date for line in order.items if line.ship_date is not None]
    if len(line_dates) != len(order.items) or not line_dates:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="每条销售明细都必须填写发货日期",
        )
    order.ship_date = max(line_dates)
    subtotal = Decimal("0")
    for line in order.items:
        line.amount = (Decimal(line.quantity or 0) * Decimal(line.unit_price or 0)).quantize(Decimal("0.01"))
        subtotal += line.amount
    order.subtotal, order.tax_amount, order.total_amount = compute_tax_totals(
        subtotal, order.tax_rate, order.need_invoice
    )


def _normalized_spec(spec: str | None) -> str:
    return (spec or "").strip()


def _validate_mode_lines(order: SalesOrder) -> None:
    """校验两种销售模式的必填字段，避免订单流转后才暴露无效明细。"""
    for line in order.items:
        if order.sales_mode == "inventory":
            if line.inventory_id is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"第 {line.line_no} 条销售明细未指定库存项",
                )
            continue
        if line.item_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"第 {line.line_no} 条销售明细未指定物品",
            )
        if Decimal(line.quantity or 0) <= 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"第 {line.line_no} 条销售明细数量必须大于 0",
            )
        if not (line.unit or "").strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"第 {line.line_no} 条销售明细未指定单位",
            )
        line.spec = _normalized_spec(line.spec)
        if not line.spec:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"第 {line.line_no} 条销售明细未指定规格",
            )


async def _ensure_auto_mode_items_exist(db: AsyncSession, order: SalesOrder) -> None:
    if order.sales_mode != "item_spec":
        return
    item_ids = {line.item_id for line in order.items if line.item_id is not None}
    existing_ids = set(await db.scalars(select(Item.id).where(Item.id.in_(item_ids))))
    if missing_ids := item_ids - existing_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"销售明细中的物品不存在：{', '.join(str(item_id) for item_id in sorted(missing_ids))}",
        )
    for line in order.items:
        specification = await require_specification(db, line.spec)
        line.spec = specification.code


async def _hydrate_inventory_mode_lines(db: AsyncSession, order: SalesOrder) -> None:
    """指定库存模式始终以库存主数据回填物品、规格和单位，防止客户端快照不一致。"""
    if order.sales_mode != "inventory":
        return
    inventory_ids = {line.inventory_id for line in order.items if line.inventory_id is not None}
    inventories = list(await db.scalars(select(Inventory).where(Inventory.id.in_(inventory_ids))))
    by_id = {inventory.id: inventory for inventory in inventories}
    if missing_ids := inventory_ids - by_id.keys():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"销售明细中的库存项不存在：{', '.join(str(inventory_id) for inventory_id in sorted(missing_ids))}",
        )
    for line in order.items:
        inventory = by_id[int(line.inventory_id or 0)]
        line.item_id = inventory.item_id
        line.spec = inventory.spec
        line.unit = inventory.unit


async def _match_auto_mode_inventory(
    db: AsyncSession, order: SalesOrder
) -> dict[tuple[int, str, str], Inventory]:
    """锁定并校验自动销售所需的本厂库存；全部满足后调用方才开始逐行扣减。"""
    internal_party_id = await db.scalar(
        select(Party.id).where(Party.is_internal.is_(True)).order_by(Party.id).limit(1)
    )
    if internal_party_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="系统未配置本厂单位，无法自动匹配销售库存",
        )

    required: dict[tuple[int, str, str], Decimal] = {}
    first_line: dict[tuple[int, str, str], SalesOrderItem] = {}
    for line in order.items:
        key = (int(line.item_id or 0), _normalized_spec(line.spec), line.unit)
        required[key] = required.get(key, Decimal("0")) + Decimal(line.quantity or 0)
        first_line.setdefault(key, line)

    matched: dict[tuple[int, str, str], Inventory] = {}
    for key in sorted(required):
        item_id, spec, unit = key
        inventory = await db.scalar(
            select(Inventory)
            .where(
                Inventory.owner_id == internal_party_id,
                Inventory.item_id == item_id,
                Inventory.spec == spec,
                Inventory.unit == unit,
            )
            .with_for_update()
        )
        line = first_line[key]
        item_name = line.item.name if line.item is not None else f"物品#{item_id}"
        item_label = f"{item_name} / {spec} / {unit}"
        if inventory is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"本厂库存没有“{item_label}”，销售单无法完成",
            )
        available = Decimal(inventory.current_quantity or 0)
        if available < required[key]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"本厂库存“{item_label}”不足：需要 {required[key]}，当前仅有 {available}，"
                    "销售单无法完成"
                ),
            )
        matched[key] = inventory
    return matched


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
    page_size: int = Query(default=20, ge=1, le=500),
    party_id: int | None = None,
    order_status: str | None = Query(default=None, alias="status"),
    ship_date_from: date | None = None,
    ship_date_to: date | None = None,
    created_by: int | None = None,
    created_by_name: str | None = None,
    created_at_from: date | None = None,
    created_at_to: date | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(SalesOrder).options(selectinload(SalesOrder.party)).order_by(SalesOrder.id.desc())
    stmt = apply_creation_filters(
        stmt,
        SalesOrder,
        created_by=created_by,
        created_by_name=created_by_name,
        created_at_from=created_at_from,
        created_at_to=created_at_to,
    )
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
    rows = list(await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)))
    return PageResult(
        items=await serialize_with_creator_names(db, rows, SalesOrderListItem),
        total=total or 0,
        page=page,
        page_size=page_size,
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
            sales_mode=payload.sales_mode,
            tax_rate=payload.tax_rate,
            need_invoice=payload.need_invoice,
            notes=payload.notes,
            status="draft",
            created_by=current_user.id,
        )
        for line in payload.items:
            line_data = line.model_dump(exclude={"amount"})
            if payload.sales_mode == "item_spec":
                line_data["inventory_id"] = None
                line_data["spec"] = _normalized_spec(line.spec)
            order.items.append(SalesOrderItem(**line_data))
        _validate_mode_lines(order)
        await _hydrate_inventory_mode_lines(db, order)
        await _ensure_auto_mode_items_exist(db, order)
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
        target_mode = payload.sales_mode or order.sales_mode
        for key, value in payload.model_dump(exclude_unset=True, exclude={"items", "ship_date"}).items():
            setattr(order, key, value)
        if payload.items is not None:
            order.items.clear()
            for line in payload.items:
                line_data = line.model_dump(exclude={"amount"})
                if target_mode == "item_spec":
                    line_data["inventory_id"] = None
                    line_data["spec"] = _normalized_spec(line.spec)
                order.items.append(SalesOrderItem(**line_data))
        elif target_mode == "item_spec":
            for line in order.items:
                line.inventory_id = None
                line.spec = _normalized_spec(line.spec)
        _validate_mode_lines(order)
        await _hydrate_inventory_mode_lines(db, order)
        await _ensure_auto_mode_items_exist(db, order)
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
    """完成：指定库存模式精确扣库；按物品规格模式自动匹配本厂库存后扣库。"""
    async with db.begin():
        order = await _load(db, order_id)
        check_transition(order.status, "completed")
        _validate_mode_lines(order)
        auto_inventory = (
            await _match_auto_mode_inventory(db, order)
            if order.sales_mode == "item_spec"
            else None
        )
        for line in order.items:
            if auto_inventory is not None:
                key = (int(line.item_id or 0), _normalized_spec(line.spec), line.unit)
                inventory = auto_inventory[key]
                line.inventory_id = inventory.id
                await stock_out_inventory_obj(
                    db,
                    inventory=inventory,
                    quantity=Decimal(line.quantity or 0),
                    change_date=line.ship_date or order.ship_date or datetime.utcnow().date(),
                    notes=f"批次号：{order.batch_no}；销售自动匹配出库",
                    ref_type="sales_order",
                    ref_id=order.id,
                    created_by=order.created_by,
                )
            else:
                await stock_out(
                    db,
                    inventory_id=int(line.inventory_id or 0),
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
        if order.sales_mode == "item_spec":
            for line in order.items:
                line.inventory_id = None
        order.status = "draft"
        order.audited_by = None
        order.audited_at = None
    return await _load(db, order_id)
