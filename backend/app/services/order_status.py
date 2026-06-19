"""订单状态机与库存回滚的通用工具，供采购/销售等单表订单复用。

冶炼/外协因子表复杂各自实现，这里覆盖结构较简单的订单。
"""

from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inventory import Inventory, InventoryLog

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"in_progress"},
    "in_progress": {"pending_review", "draft"},
    "pending_review": {"approved", "in_progress"},
    "approved": {"completed", "rejected"},
    "completed": set(),
    "rejected": {"draft", "in_progress"},
}

EDITABLE_STATUSES = {"draft", "in_progress", "rejected"}
DELETABLE_STATUSES = {"draft", "rejected"}
UNAUDITABLE_STATUSES = {"in_progress", "pending_review", "approved", "completed"}


def check_transition(current: str, target: str) -> None:
    if target not in ALLOWED_TRANSITIONS.get(current, set()):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"非法状态流转：{current} → {target}")


def assert_editable(current: str) -> None:
    if current not in EDITABLE_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="当前状态禁止修改业务字段")


async def rollback_inventory_by_ref(db: AsyncSession, *, ref_type: str, ref_id: int) -> None:
    """按 inventory_log 反向冲销指定订单的全部库存影响，并删除其日志。"""
    logs = list(
        await db.scalars(
            select(InventoryLog)
            .where(InventoryLog.ref_type == ref_type, InventoryLog.ref_id == ref_id)
            .order_by(InventoryLog.id.desc())
        )
    )
    for log in logs:
        inv = await db.get(Inventory, log.inventory_id, with_for_update=True)
        if inv is None:
            continue
        inv.current_quantity -= log.delta_quantity
    await db.execute(delete(InventoryLog).where(InventoryLog.ref_type == ref_type, InventoryLog.ref_id == ref_id))
    await db.flush()


def compute_tax_totals(
    amount: Decimal, tax_rate: Decimal | None, need_invoice: bool = True
) -> tuple[Decimal, Decimal, Decimal]:
    """返回 (subtotal, tax_amount, total)。subtotal=amount(税前)。

    need_invoice=False 时不计税：tax_amount=0，total=subtotal。
    """
    subtotal = Decimal(amount).quantize(Decimal("0.01"))
    if not need_invoice:
        return subtotal, Decimal("0.00"), subtotal
    rate = Decimal(tax_rate) if tax_rate is not None else Decimal("0")
    tax_amount = (subtotal * rate / 100).quantize(Decimal("0.01"))
    return subtotal, tax_amount, subtotal + tax_amount
