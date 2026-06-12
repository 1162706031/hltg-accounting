from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.inventory import Inventory, InventoryLog


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
