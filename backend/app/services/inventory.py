from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import Select, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.inventory import Inventory, InventoryLog
from app.models.item import Item
from app.models.party import Party


def _normalize_spec(spec: str | None) -> str:
    return spec or ""


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
        current_pieces=0,
        current_weight=Decimal("0"),
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
    pieces: int,
    weight: Decimal,
    change_date: date,
    notes: str | None,
    ref_type: str | None,
    ref_id: int | None,
    created_by: int | None,
) -> Inventory:
    if pieces == 0 and weight == 0:
        raise HTTPException(status_code=400, detail="入库支数和重量不能同时为 0")

    inventory = await find_or_create_inventory(
        db,
        item_id=item_id,
        owner_id=owner_id,
        spec=spec,
        unit=unit,
        created_by=created_by,
    )
    before_pieces = inventory.current_pieces
    before_weight = inventory.current_weight
    inventory.current_pieces += pieces
    inventory.current_weight += weight

    db.add(
        InventoryLog(
            inventory_id=inventory.id,
            change_type="in",
            change_date=change_date,
            delta_pieces=pieces,
            delta_weight=weight,
            before_pieces=before_pieces,
            before_weight=before_weight,
            after_pieces=inventory.current_pieces,
            after_weight=inventory.current_weight,
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
    pieces: int,
    weight: Decimal,
    change_date: date,
    notes: str | None,
    ref_type: str | None,
    ref_id: int | None,
    created_by: int | None,
) -> Inventory:
    if pieces == 0 and weight == 0:
        raise HTTPException(status_code=400, detail="出库支数和重量不能同时为 0")

    inventory = await get_inventory_for_update(db, inventory_id)
    return await stock_out_inventory_obj(
        db,
        inventory=inventory,
        pieces=pieces,
        weight=weight,
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
    pieces: int,
    weight: Decimal,
    change_date: date,
    notes: str | None,
    ref_type: str | None,
    ref_id: int | None,
    created_by: int | None,
) -> Inventory:
    """对已加锁的库存对象执行出库。调用方须确保 inventory 已通过 with_for_update 加锁。"""
    if inventory.current_pieces < pieces or inventory.current_weight < weight:
        raise HTTPException(status_code=409, detail="库存不足")

    before_pieces = inventory.current_pieces
    before_weight = inventory.current_weight
    inventory.current_pieces -= pieces
    inventory.current_weight -= weight

    db.add(
        InventoryLog(
            inventory_id=inventory.id,
            change_type="out",
            change_date=change_date,
            delta_pieces=-pieces,
            delta_weight=-weight,
            before_pieces=before_pieces,
            before_weight=before_weight,
            after_pieces=inventory.current_pieces,
            after_weight=inventory.current_weight,
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
    actual_pieces: int,
    actual_weight: Decimal,
    change_date: date,
    notes: str | None,
    created_by: int | None,
) -> Inventory:
    inventory = await get_inventory_for_update(db, inventory_id)
    before_pieces = inventory.current_pieces
    before_weight = inventory.current_weight

    inventory.current_pieces = actual_pieces
    inventory.current_weight = actual_weight

    db.add(
        InventoryLog(
            inventory_id=inventory.id,
            change_type="adjust",
            change_date=change_date,
            delta_pieces=actual_pieces - before_pieces,
            delta_weight=actual_weight - before_weight,
            before_pieces=before_pieces,
            before_weight=before_weight,
            after_pieces=actual_pieces,
            after_weight=actual_weight,
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
    """删除库存项，同时保留其历史变动日志并追加一条删除日志。

    库存行删除后，日志查询无法再 JOIN 出物品/归属信息，因此先把这些信息
    以快照形式回填到该库存的所有历史日志，再写一条 change_type='delete' 的
    日志，最后将日志的 inventory_id 解绑（置空）并删除库存行。
    """
    item_name = await db.scalar(select(Item.name).where(Item.id == inventory.item_id))
    item_type = await db.scalar(select(Item.item_type).where(Item.id == inventory.item_id))
    owner_name = await db.scalar(select(Party.name).where(Party.id == inventory.owner_id))

    # 1) 把快照回填到该库存已有的所有日志
    await db.execute(
        update(InventoryLog)
        .where(InventoryLog.inventory_id == inventory.id)
        .values(
            item_name=item_name,
            item_spec=inventory.spec,
            item_type=item_type,
            owner_name=owner_name,
        )
    )

    # 2) 追加一条删除日志（自带快照）
    db.add(
        InventoryLog(
            inventory_id=inventory.id,
            item_name=item_name,
            item_spec=inventory.spec,
            item_type=item_type,
            owner_name=owner_name,
            change_type="delete",
            change_date=change_date,
            delta_pieces=0,
            delta_weight=Decimal("0"),
            before_pieces=inventory.current_pieces,
            before_weight=inventory.current_weight,
            after_pieces=0,
            after_weight=Decimal("0"),
            notes="库存项删除",
            created_by=created_by,
        )
    )
    await db.flush()

    # 3) 解绑日志并删除库存行（ON DELETE SET NULL 会自动置空，这里显式置空以兼容）
    await db.execute(
        update(InventoryLog)
        .where(InventoryLog.inventory_id == inventory.id)
        .values(inventory_id=None)
    )
    await db.delete(inventory)
    await db.flush()
