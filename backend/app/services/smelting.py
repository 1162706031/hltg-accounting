"""冶炼加工业务逻辑：费用计算、状态机、库存联动。

库存联动节点（设计 §8.5.2）：
- draft → in_progress：扣减来料库存（side=in）+ 合金库存
- approved → completed：出钢入库（side=out，按明细 owner_id 归属）
- 撤销/反审核（任意 → draft）：回滚已扣来料/合金 + 移除已入出钢库存

所有联动都在调用方的事务内执行，保证原子性。
"""

from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.inventory import Inventory, InventoryLog
from app.models.item import Item
from app.models.party import Party
from app.models.smelting import AlloyAddition, SmeltingInbound, SmeltingOrder
from app.services.inventory import stock_in, stock_out

# 状态机允许的迁移
_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"in_progress"},
    "in_progress": {"pending_review", "draft"},
    "pending_review": {"approved", "in_progress"},
    "approved": {"completed", "rejected"},
    "completed": set(),
    "rejected": {"draft", "in_progress"},
}

_EDITABLE_STATUSES = {"draft", "in_progress", "rejected"}
STOCK_OUT_LOCKED_STATUSES = {"in_progress", "pending_review", "approved", "completed"}
YIELD_EXCLUDED_ITEM_TYPES = {"raw_material", "scrap"}


def assert_editable(order: SmeltingOrder) -> None:
    if order.status not in _EDITABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="当前状态禁止修改业务字段",
        )


def _normalize_stock_out_lines(lines) -> list[dict[str, object]]:
    fields = ("side", "date", "item_id", "inventory_id", "quantity", "unit", "spec", "unit_price")
    stock_out_lines = [line for line in lines if line.side == "in"]
    return [
        {field: getattr(line, field) for field in fields}
        for line in sorted(stock_out_lines, key=lambda line: (line.line_no, getattr(line, "id", 0)))
    ]


def _normalize_alloy_lines(lines) -> list[dict[str, object]]:
    fields = ("item_id", "inventory_id", "date", "quantity", "unit", "spec", "unit_price")
    return [
        {field: getattr(line, field) for field in fields}
        for line in sorted(lines, key=lambda line: (line.date or datetime.min.date(), getattr(line, "id", 0)))
    ]


def assert_stock_out_lines_unchanged(
    order: SmeltingOrder,
    inbound_lines,
    alloy_lines,
) -> None:
    """已扣库存的投料/合金明细不允许被修改、删除或新增。"""
    if order.status not in STOCK_OUT_LOCKED_STATUSES:
        return
    if inbound_lines is not None and _normalize_stock_out_lines(order.inbound_lines) != _normalize_stock_out_lines(
        inbound_lines
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="订单已开始加工，投料明细已扣库，禁止修改")
    if alloy_lines is not None and _normalize_alloy_lines(order.alloy_lines) != _normalize_alloy_lines(alloy_lines):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="订单已开始加工，合金明细已扣库，禁止修改")


def _line_amount(quantity, unit_price) -> Decimal | None:
    if unit_price is None:
        return None
    return (Decimal(quantity) * Decimal(unit_price)).quantize(Decimal("0.01"))


async def get_yield_excluded_item_ids(db: AsyncSession, item_ids) -> set[int]:
    ids = {int(item_id) for item_id in item_ids if item_id}
    if not ids:
        return set()
    rows = await db.scalars(select(Item.id).where(Item.id.in_(ids), Item.item_type.in_(YIELD_EXCLUDED_ITEM_TYPES)))
    return set(rows)


def recompute_amounts(order: SmeltingOrder, yield_excluded_item_ids: set[int] | None = None) -> None:
    """重算订单日期、每行金额与费用汇总。"""
    yield_excluded_item_ids = yield_excluded_item_ids or set()
    feed_dates = [line.date for line in order.inbound_lines if line.side == "in" and line.date]
    feed_dates.extend(alloy.date for alloy in order.alloy_lines if alloy.date)
    tap_dates = [line.date for line in order.inbound_lines if line.side == "out" and line.date]
    order.feed_date = max(feed_dates, default=None)
    order.tap_date = max(tap_dates, default=None)
    feed_total = Decimal("0")
    yield_tap_total = Decimal("0")
    inbound_amount = Decimal("0")
    outbound_amount = Decimal("0")

    for line in order.inbound_lines:
        line.amount = _line_amount(line.quantity, line.unit_price)
        if line.side == "in":
            feed_total += Decimal(line.quantity or 0)
            if line.amount:
                inbound_amount += line.amount
        else:
            if line.item_id not in yield_excluded_item_ids:
                yield_tap_total += Decimal(line.quantity or 0)
            if line.amount:
                outbound_amount += line.amount

    alloy_amount = Decimal("0")
    for alloy in order.alloy_lines:
        alloy.amount = _line_amount(alloy.quantity, alloy.unit_price)
        if alloy.amount:
            alloy_amount += alloy.amount

    # 成锭率：有效出钢总量 / 投料总量；raw_material/scrap 产出不计为成品。
    order.yield_pct = (yield_tap_total / feed_total * 100).quantize(Decimal("0.01")) if feed_total > 0 else None
    if order.yield_pct is not None and order.yield_pct > Decimal("100"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"有效出钢量不能超过投料量，当前成锭率为 {order.yield_pct}%",
        )

    # 加工金额 = 有效出钢总重 × 加工单价；raw_material/scrap 产出不计加工费。
    if order.unit_price is not None:
        order.processing_amount = (yield_tap_total * Decimal(order.unit_price)).quantize(Decimal("0.01"))
    else:
        order.processing_amount = None

    subtotal = inbound_amount + outbound_amount + alloy_amount + (order.processing_amount or Decimal("0"))
    order.subtotal = subtotal
    # 不开票不计税，与销售口径一致
    if order.need_invoice:
        tax_rate = Decimal(order.tax_rate) if order.tax_rate is not None else Decimal("0")
        order.tax_amount = (subtotal * tax_rate / 100).quantize(Decimal("0.01"))
    else:
        order.tax_amount = Decimal("0.00")
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


async def apply_start_inventory(db: AsyncSession, order: SmeltingOrder) -> None:
    """开始加工：按明细所选 inventory_id 直接扣减来料（side=in）+ 合金库存。

    前端在创建/编辑时已让用户从现存库存中选定具体库存项并存入 inventory_id，
    开始时按此 id 精确出库，存什么扣什么，不再凭 item_id+owner+spec 反查。
    """
    for line in order.inbound_lines:
        if line.side != "in":
            continue
        if not line.inventory_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"来料明细(line_no={line.line_no})未选择库存项，无法扣减",
            )
        await stock_out(
            db,
            inventory_id=line.inventory_id,
            quantity=Decimal(line.quantity or 0),
            change_date=line.date or order.feed_date or datetime.utcnow().date(),
            notes=f"批次号：{order.batch_no}；冶炼投料出库",
            ref_type="smelting_order",
            ref_id=order.id,
            created_by=order.created_by,
        )

    for alloy in order.alloy_lines:
        if not alloy.inventory_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"合金物料(item_id={alloy.item_id})未选择库存项，无法扣减",
            )
        await stock_out(
            db,
            inventory_id=alloy.inventory_id,
            quantity=Decimal(alloy.quantity or 0),
            change_date=alloy.date or order.feed_date or datetime.utcnow().date(),
            notes=f"批次号：{order.batch_no}；冶炼补加合金出库",
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
            unit=line.unit or "吨",
            quantity=Decimal(line.quantity or 0),
            change_date=line.date or order.tap_date or datetime.utcnow().date(),
            notes=f"批次号：{order.batch_no}；冶炼出钢入库",
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
        inv.current_quantity -= log.delta_quantity

    # 删除本订单的库存日志（联动整体撤销，不保留半截轨迹）
    await db.execute(
        delete(InventoryLog).where(InventoryLog.ref_type == "smelting_order", InventoryLog.ref_id == order.id)
    )
    await db.flush()
