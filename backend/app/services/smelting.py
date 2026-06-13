"""冶炼加工业务逻辑：费用计算、状态机、库存联动。

库存联动节点（设计 §8.5.2）：
- pending_review → approved：扣减来料库存（side=in）+ 合金库存
- in_progress → completed：出钢入库（side=out，按明细 owner_id 归属）
- 反审核（任意 → draft，仅 admin）：回滚已扣来料/合金 + 移除已入出钢库存

所有联动都在调用方的事务内执行，保证原子性。
"""

from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.inventory import Inventory, InventoryLog
from app.models.party import Party
from app.models.smelting import AlloyAddition, SmeltingInbound, SmeltingOrder
from app.services.inventory import stock_in, stock_out_inventory_obj

# 状态机允许的迁移
_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"pending_review"},
    "pending_review": {"approved", "rejected"},
    "approved": {"in_progress"},
    "in_progress": {"completed"},
    "completed": set(),
    "rejected": {"draft", "pending_review"},
}

# 已审核及之后不可再编辑业务字段
_LOCKED_STATUSES = {"approved", "in_progress", "completed"}


def assert_editable(order: SmeltingOrder) -> None:
    if order.status in _LOCKED_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="订单已审核/进行中/已完成，禁止修改业务字段",
        )


def _line_amount(weight, unit_price) -> Decimal | None:
    if unit_price is None:
        return None
    return (Decimal(weight) * Decimal(unit_price)).quantize(Decimal("0.01"))


def recompute_amounts(order: SmeltingOrder) -> None:
    """重算每行金额与费用汇总（设计 §5.4 计算逻辑）。单价为空的行不计入。"""
    feed_total = Decimal("0")
    tap_total = Decimal("0")
    inbound_amount = Decimal("0")
    outbound_amount = Decimal("0")

    for line in order.inbound_lines:
        line.amount = _line_amount(line.weight_ton, line.unit_price)
        if line.side == "in":
            feed_total += Decimal(line.weight_ton or 0)
            if line.amount:
                inbound_amount += line.amount
        else:
            tap_total += Decimal(line.weight_ton or 0)
            if line.amount:
                outbound_amount += line.amount

    alloy_amount = Decimal("0")
    for alloy in order.alloy_lines:
        alloy.amount = _line_amount(alloy.weight_kg, alloy.unit_price)
        if alloy.amount:
            alloy_amount += alloy.amount

    # 成锭率：出钢总重 / 投料总重；仅在未手动填写时自动计算
    if order.yield_pct is None and feed_total > 0:
        order.yield_pct = (tap_total / feed_total * 100).quantize(Decimal("0.01"))

    # 加工金额 = 出钢总重 × 加工单价
    if order.unit_price is not None:
        order.processing_amount = (tap_total * Decimal(order.unit_price)).quantize(Decimal("0.01"))
    else:
        order.processing_amount = None

    subtotal = inbound_amount + outbound_amount + alloy_amount + (order.processing_amount or Decimal("0"))
    order.subtotal = subtotal
    tax_rate = Decimal(order.tax_rate) if order.tax_rate is not None else Decimal("0")
    order.tax_amount = (subtotal * tax_rate / 100).quantize(Decimal("0.01"))
    order.total_amount = subtotal + order.tax_amount


def check_transition(order: SmeltingOrder, target: str) -> None:
    if target not in _ALLOWED_TRANSITIONS.get(order.status, set()):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"非法状态流转：{order.status} → {target}",
        )


async def load_order(db: AsyncSession, order_id: int) -> SmeltingOrder:
    stmt = (
        select(SmeltingOrder)
        .where(SmeltingOrder.id == order_id)
        .options(
            selectinload(SmeltingOrder.party),
            selectinload(SmeltingOrder.inbound_lines).selectinload(SmeltingInbound.item),
            selectinload(SmeltingOrder.inbound_lines).selectinload(SmeltingInbound.owner),
            selectinload(SmeltingOrder.alloy_lines).selectinload(AlloyAddition.item),
        )
    )
    order = await db.scalar(stmt)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="冶炼订单不存在")
    return order


# ---------- 库存联动 ----------
async def resolve_internal_party_id(db: AsyncSession) -> int:
    """取本厂 party（is_internal=true）。合金默认从本厂库存扣减。"""
    pid = await db.scalar(select(Party.id).where(Party.is_internal.is_(True)).limit(1))
    if pid is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="系统未配置本厂单位(is_internal)，无法扣减合金库存")
    return pid


async def _find_inventory_for_update(db: AsyncSession, *, item_id: int, owner_id: int, spec: str | None):
    stmt = (
        select(Inventory)
        .where(
            Inventory.item_id == item_id,
            Inventory.owner_id == owner_id,
            Inventory.spec == (spec or ""),
        )
        .with_for_update()
    )
    return await db.scalar(stmt)


async def apply_approve_inventory(db: AsyncSession, order: SmeltingOrder) -> None:
    """审核通过：扣减来料（side=in，归属 owner/订单 party）+ 合金（本厂）库存。"""
    internal_party_id = await resolve_internal_party_id(db)

    for line in order.inbound_lines:
        if line.side != "in" or not line.item_id:
            continue
        owner_id = line.owner_id or order.party_id
        inv = await _find_inventory_for_update(db, item_id=line.item_id, owner_id=owner_id, spec=line.spec)
        if inv is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"来料物料(item_id={line.item_id})无对应库存，无法扣减",
            )
        await stock_out_inventory_obj(
            db,
            inventory=inv,
            pieces=line.pieces or 0,
            weight=Decimal(line.weight_ton or 0),
            change_date=line.date or order.feed_date or datetime.utcnow().date(),
            notes=f"冶炼#{order.batch_no}投料",
            ref_type="smelting_order",
            ref_id=order.id,
            created_by=order.created_by,
        )

    for alloy in order.alloy_lines:
        inv = await _find_inventory_for_update(db, item_id=alloy.item_id, owner_id=internal_party_id, spec=None)
        if inv is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"合金物料(item_id={alloy.item_id})无对应本厂库存，无法扣减",
            )
        await stock_out_inventory_obj(
            db,
            inventory=inv,
            pieces=0,
            weight=Decimal(alloy.weight_kg or 0),
            change_date=order.feed_date or datetime.utcnow().date(),
            notes=f"冶炼#{order.batch_no}补合金",
            ref_type="smelting_order",
            ref_id=order.id,
            created_by=order.created_by,
        )


async def apply_complete_inventory(db: AsyncSession, order: SmeltingOrder) -> None:
    """标记完成：出钢入库（side=out，按明细 owner_id 归属，缺省订单 party）。"""
    for line in order.inbound_lines:
        if line.side != "out" or not line.item_id:
            continue
        owner_id = line.owner_id or order.party_id
        await stock_in(
            db,
            item_id=line.item_id,
            owner_id=owner_id,
            spec=line.spec,
            unit="吨",
            pieces=line.pieces or 0,
            weight=Decimal(line.weight_ton or 0),
            change_date=line.date or order.tap_date or datetime.utcnow().date(),
            notes=f"冶炼#{order.batch_no}出钢入库",
            ref_type="smelting_order",
            ref_id=order.id,
            created_by=order.created_by,
        )


async def rollback_inventory(db: AsyncSession, order: SmeltingOrder) -> None:
    """反审核回滚：根据已写入的 inventory_log 反向冲销本订单的全部库存影响。

    对该订单产生的每条日志做反向操作（in→减、out→加），并删除原始日志，
    使库存恢复到联动前的状态。仅 admin 调用。
    """
    logs = list(
        await db.scalars(
            select(InventoryLog)
            .where(InventoryLog.ref_type == "smelting_order", InventoryLog.ref_id == order.id)
            .order_by(InventoryLog.id.desc())
        )
    )
    for log in logs:
        inv = await db.get(Inventory, log.inventory_id, with_for_update=True)
        if inv is None:
            continue
        # 反向冲销：减去当初的 delta
        inv.current_pieces -= log.delta_pieces
        inv.current_weight -= log.delta_weight

    # 删除本订单的库存日志（联动整体撤销，不保留半截轨迹）
    await db.execute(
        delete(InventoryLog).where(InventoryLog.ref_type == "smelting_order", InventoryLog.ref_id == order.id)
    )
    await db.flush()
