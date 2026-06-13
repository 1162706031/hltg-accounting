"""外协加工业务逻辑：费用计算、成材率、状态机、库存联动。

库存联动节点（设计 §8.5.2）：
- pending_review → approved：发出扣本厂库存（outbound）
- in_progress → completed：回厂入本厂库存（inbound）
- 反审核（仅 admin）：按 inventory_log 反向冲销
"""

from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.inventory import Inventory, InventoryLog
from app.models.outsource import OutsourceOrder, ProcessingInbound, ProcessingOutbound
from app.services.inventory import stock_in, stock_out_inventory_obj
from app.services.smelting import resolve_internal_party_id

_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"pending_review"},
    "pending_review": {"approved", "rejected"},
    "approved": {"in_progress"},
    "in_progress": {"completed"},
    "completed": set(),
    "rejected": {"draft", "pending_review"},
}

_LOCKED_STATUSES = {"approved", "in_progress", "completed"}


def assert_editable(order: OutsourceOrder) -> None:
    if order.status in _LOCKED_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="订单已审核/进行中/已完成，禁止修改业务字段")


def _line_amount(quantity, unit_price) -> Decimal | None:
    if unit_price is None:
        return None
    return (Decimal(quantity) * Decimal(unit_price)).quantize(Decimal("0.01"))


def recompute_amounts(order: OutsourceOrder) -> None:
    """重算费用与成材率。成材率 = 回厂总量 / 发出总量（未手动填写时自动算，假定同单位）。"""
    out_total = Decimal("0")
    in_total = Decimal("0")
    line_amount_sum = Decimal("0")

    for line in order.outbound_lines:
        line.amount = _line_amount(line.quantity, line.unit_price)
        out_total += Decimal(line.quantity or 0)
        if line.amount:
            line_amount_sum += line.amount
    for line in order.inbound_lines:
        line.amount = _line_amount(line.quantity, line.unit_price)
        in_total += Decimal(line.quantity or 0)
        if line.amount:
            line_amount_sum += line.amount

    if order.yield_rate is None and out_total > 0:
        order.yield_rate = (in_total / out_total).quantize(Decimal("0.0001"))

    # 加工金额 = 发出总量 × 加工单价（外协按发出计费）
    if order.unit_price is not None:
        order.amount = (out_total * Decimal(order.unit_price)).quantize(Decimal("0.01"))
    else:
        order.amount = None

    subtotal = (order.amount or Decimal("0")) + line_amount_sum
    order.subtotal = subtotal
    tax_rate = Decimal(order.tax_rate) if order.tax_rate is not None else Decimal("0")
    order.tax_amount = (subtotal * tax_rate / 100).quantize(Decimal("0.01"))
    order.total_amount = subtotal + order.tax_amount


def check_transition(order: OutsourceOrder, target: str) -> None:
    if target not in _ALLOWED_TRANSITIONS.get(order.status, set()):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"非法状态流转：{order.status} → {target}")


async def load_order(db: AsyncSession, order_id: int) -> OutsourceOrder:
    stmt = (
        select(OutsourceOrder)
        .where(OutsourceOrder.id == order_id)
        .options(
            selectinload(OutsourceOrder.party),
            selectinload(OutsourceOrder.outbound_lines).selectinload(ProcessingOutbound.item),
            selectinload(OutsourceOrder.inbound_lines).selectinload(ProcessingInbound.item),
        )
    )
    order = await db.scalar(stmt)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="外协订单不存在")
    return order


# ---------- 库存联动 ----------
async def _find_inventory_for_update(db: AsyncSession, *, item_id: int, owner_id: int, spec: str | None):
    stmt = (
        select(Inventory)
        .where(Inventory.item_id == item_id, Inventory.owner_id == owner_id, Inventory.spec == (spec or ""))
        .with_for_update()
    )
    return await db.scalar(stmt)


async def apply_approve_inventory(db: AsyncSession, order: OutsourceOrder) -> None:
    """审核通过：发出扣本厂库存。"""
    internal_party_id = await resolve_internal_party_id(db)
    for line in order.outbound_lines:
        if not line.item_id:
            continue
        inv = await _find_inventory_for_update(db, item_id=line.item_id, owner_id=internal_party_id, spec=line.spec)
        if inv is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"发出物料(item_id={line.item_id})无对应本厂库存，无法扣减",
            )
        await stock_out_inventory_obj(
            db,
            inventory=inv,
            quantity=Decimal(line.quantity or 0),
            change_date=line.out_date or datetime.utcnow().date(),
            notes=f"外协#{order.batch_no}发出",
            ref_type="outsource_order",
            ref_id=order.id,
            created_by=order.created_by,
        )


async def apply_complete_inventory(db: AsyncSession, order: OutsourceOrder) -> None:
    """标记完成：回厂入本厂库存。"""
    internal_party_id = await resolve_internal_party_id(db)
    for line in order.inbound_lines:
        if not line.item_id:
            continue
        await stock_in(
            db,
            item_id=line.item_id,
            owner_id=internal_party_id,
            spec=line.spec,
            unit=line.unit or "吨",
            quantity=Decimal(line.quantity or 0),
            change_date=line.in_date or datetime.utcnow().date(),
            notes=f"外协#{order.batch_no}回厂入库",
            ref_type="outsource_order",
            ref_id=order.id,
            created_by=order.created_by,
        )


async def rollback_inventory(db: AsyncSession, order: OutsourceOrder) -> None:
    """反审核回滚：按 inventory_log 反向冲销本订单的库存影响。"""
    logs = list(
        await db.scalars(
            select(InventoryLog)
            .where(InventoryLog.ref_type == "outsource_order", InventoryLog.ref_id == order.id)
            .order_by(InventoryLog.id.desc())
        )
    )
    for log in logs:
        inv = await db.get(Inventory, log.inventory_id, with_for_update=True)
        if inv is None:
            continue
        inv.current_quantity -= log.delta_quantity
    await db.execute(
        delete(InventoryLog).where(InventoryLog.ref_type == "outsource_order", InventoryLog.ref_id == order.id)
    )
    await db.flush()
