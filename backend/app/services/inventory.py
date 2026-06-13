from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.inventory import Inventory, InventoryLog
from app.models.item import Item
from app.models.party import Party
from app.models.user import User


def _normalize_spec(spec: str | None) -> str:
    return spec or ""


async def _snapshot(db: AsyncSession, inventory: Inventory, created_by: int | None) -> dict[str, str | None]:
    """读取写入日志所需的快照信息（物品名/类型、归属名、操作人名）。

    日志行自包含，写入时即固化这些信息，之后不依赖任何表。
    """
    item_name = await db.scalar(select(Item.name).where(Item.id == inventory.item_id))
    item_type = await db.scalar(select(Item.item_type).where(Item.id == inventory.item_id))
    owner_name = await db.scalar(select(Party.name).where(Party.id == inventory.owner_id))
    operator_name = (
        await db.scalar(select(User.real_name).where(User.id == created_by)) if created_by else None
    )
    return {
        "item_id": inventory.item_id,
        "item_name": item_name,
        "item_spec": inventory.spec,
        "item_type": item_type,
        "owner_name": owner_name,
        "operator_name": operator_name,
    }


async def get_inventory_for_update(db: AsyncSession, inventory_id: int) -> Inventory:
    stmt = select(Inventory).where(Inventory.id == inventory_id).with_for_update()
    inventory = await db.scalar(stmt)
    if inventory is None:
        raise HTTPException(status_code=404, detail="库存不存在")
    return inventory


async def find_or_create_inventory(
    db: AsyncSession,
    *,
    item_id: int,
    owner_id: int,
    spec: str | None,
    unit: str,
    created_by: int | None,
) -> Inventory:
    stmt = (
        select(Inventory)
        .where(
            Inventory.item_id == item_id,
            Inventory.owner_id == owner_id,
            Inventory.spec == _normalize_spec(spec),
        )
        .with_for_update()
    )
    inventory = await db.scalar(stmt)
    if inventory:
        return inventory

    inventory = Inventory(
        item_id=item_id,
        owner_id=owner_id,
        spec=_normalize_spec(spec),
        unit=unit,
        current_quantity=Decimal("0"),
        created_by=created_by,
    )
    db.add(inventory)
    await db.flush()
    return inventory


async def stock_in(
    db: AsyncSession,
    *,
    item_id: int,
    owner_id: int,
    spec: str | None,
    unit: str,
    quantity: Decimal,
    change_date: date,
    notes: str | None,
    ref_type: str | None,
    ref_id: int | None,
    created_by: int | None,
) -> Inventory:
    if quantity == 0:
        raise HTTPException(status_code=400, detail="入库数量不能为 0")

    inventory = await find_or_create_inventory(
        db,
        item_id=item_id,
        owner_id=owner_id,
        spec=spec,
        unit=unit,
        created_by=created_by,
    )
    before_quantity = inventory.current_quantity
    inventory.current_quantity += quantity

    db.add(
        InventoryLog(
            inventory_id=inventory.id,
            **await _snapshot(db, inventory, created_by),
            change_type="in",
            change_date=change_date,
            unit=inventory.unit,
            delta_quantity=quantity,
            before_quantity=before_quantity,
            after_quantity=inventory.current_quantity,
            ref_type=ref_type,
            ref_id=ref_id,
            notes=notes,
            created_by=created_by,
        )
    )
    await db.flush()
    return inventory


async def stock_out(
    db: AsyncSession,
    *,
    inventory_id: int,
    quantity: Decimal,
    change_date: date,
    notes: str | None,
    ref_type: str | None,
    ref_id: int | None,
    created_by: int | None,
) -> Inventory:
    if quantity == 0:
        raise HTTPException(status_code=400, detail="出库数量不能为 0")

    inventory = await get_inventory_for_update(db, inventory_id)
    return await stock_out_inventory_obj(
        db,
        inventory=inventory,
        quantity=quantity,
        change_date=change_date,
        notes=notes,
        ref_type=ref_type,
        ref_id=ref_id,
        created_by=created_by,
    )


async def stock_out_inventory_obj(
    db: AsyncSession,
    *,
    inventory: Inventory,
    quantity: Decimal,
    change_date: date,
    notes: str | None,
    ref_type: str | None,
    ref_id: int | None,
    created_by: int | None,
) -> Inventory:
    """对已加锁的库存对象执行出库。调用方须确保 inventory 已通过 with_for_update 加锁。"""
    if inventory.current_quantity < quantity:
        raise HTTPException(status_code=409, detail="库存不足")

    before_quantity = inventory.current_quantity
    inventory.current_quantity -= quantity

    db.add(
        InventoryLog(
            inventory_id=inventory.id,
            **await _snapshot(db, inventory, created_by),
            change_type="out",
            change_date=change_date,
            unit=inventory.unit,
            delta_quantity=-quantity,
            before_quantity=before_quantity,
            after_quantity=inventory.current_quantity,
            ref_type=ref_type,
            ref_id=ref_id,
            notes=notes,
            created_by=created_by,
        )
    )
    await db.flush()
    return inventory


async def stock_adjust(
    db: AsyncSession,
    *,
    inventory_id: int,
    actual_quantity: Decimal,
    change_date: date,
    notes: str | None,
    created_by: int | None,
) -> Inventory:
    inventory = await get_inventory_for_update(db, inventory_id)
    before_quantity = inventory.current_quantity

    inventory.current_quantity = actual_quantity

    db.add(
        InventoryLog(
            inventory_id=inventory.id,
            **await _snapshot(db, inventory, created_by),
            change_type="adjust",
            change_date=change_date,
            unit=inventory.unit,
            delta_quantity=actual_quantity - before_quantity,
            before_quantity=before_quantity,
            after_quantity=actual_quantity,
            notes=notes,
            created_by=created_by,
        )
    )
    await db.flush()
    return inventory


def inventory_with_relations_stmt() -> Select[tuple[Inventory]]:
    return select(Inventory).options(selectinload(Inventory.item), selectinload(Inventory.owner))


async def delete_inventory_with_log(
    db: AsyncSession,
    *,
    inventory: Inventory,
    change_date: date,
    created_by: int | None,
) -> None:
    """删除库存项，并追加一条自包含的删除日志。

    日志表独立自治：删除日志写入时即固化物品/归属/操作人快照，因此可以
    直接删除库存行而无需保留外键或回填——历史日志不受影响。
    """
    db.add(
        InventoryLog(
            inventory_id=inventory.id,
            **await _snapshot(db, inventory, created_by),
            change_type="delete",
            change_date=change_date,
            unit=inventory.unit,
            delta_quantity=Decimal("0"),
            before_quantity=inventory.current_quantity,
            after_quantity=Decimal("0"),
            notes="库存项删除",
            created_by=created_by,
        )
    )
    await db.delete(inventory)
    await db.flush()
