from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.inventory import Inventory, InventoryLog
from app.models.item import Item
from app.models.user import User
from app.schemas.common import BatchDeleteRequest, PageResult
from app.schemas.inventory import InventoryAdjustRequest, InventoryInRequest, InventoryLogRead, InventoryOutRequest, InventoryRead
from app.services.inventory import inventory_with_relations_stmt, stock_adjust, stock_in, stock_out
from app.utils.deps import get_current_user

router = APIRouter(prefix="/inventory", tags=["inventory"], dependencies=[Depends(get_current_user)])


async def paginate_inventory(db: AsyncSession, stmt: Select[tuple[Inventory]], page: int, page_size: int) -> PageResult[InventoryRead]:
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(items=[InventoryRead.model_validate(row) for row in rows], total=total or 0, page=page, page_size=page_size)


@router.get("", response_model=PageResult[InventoryRead])
async def list_inventory(
    page: int = 1,
    page_size: int = 20,
    item_type: str | None = None,
    owner_id: int | None = None,
    q: str | None = None,
    only_positive: bool = False,
    db: AsyncSession = Depends(get_db),
):
    stmt = inventory_with_relations_stmt().join(Item, isouter=True).order_by(Inventory.id.desc())
    if item_type:
        stmt = stmt.where(Item.item_type == item_type)
    if owner_id:
        stmt = stmt.where(Inventory.owner_id == owner_id)
    if q:
        stmt = stmt.where(Item.name.like(f"%{q}%") | Inventory.spec.like(f"%{q}%"))
    if only_positive:
        stmt = stmt.where((Inventory.current_pieces > 0) | (Inventory.current_weight > 0))
    return await paginate_inventory(db, stmt, page, page_size)


@router.get("/logs", response_model=PageResult[InventoryLogRead])
async def list_inventory_logs(
    page: int = 1,
    page_size: int = 20,
    change_type: str | None = None,
    inventory_id: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(InventoryLog).order_by(InventoryLog.id.desc())
    if change_type:
        stmt = stmt.where(InventoryLog.change_type == change_type)
    if inventory_id:
        stmt = stmt.where(InventoryLog.inventory_id == inventory_id)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(items=[InventoryLogRead.model_validate(row) for row in rows], total=total or 0, page=page, page_size=page_size)


@router.post("/in", response_model=InventoryRead)
async def create_stock_in(
    payload: InventoryInRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    async with db.begin():
        inventory = await stock_in(db, **payload.model_dump(), created_by=current_user.id)
    stmt = inventory_with_relations_stmt().where(Inventory.id == inventory.id)
    return await db.scalar(stmt)


@router.post("/{inventory_id}/out", response_model=InventoryRead)
async def create_stock_out(
    inventory_id: int,
    payload: InventoryOutRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    async with db.begin():
        inventory = await stock_out(db, inventory_id=inventory_id, **payload.model_dump(), created_by=current_user.id)
    stmt = inventory_with_relations_stmt().where(Inventory.id == inventory.id)
    return await db.scalar(stmt)


@router.post("/{inventory_id}/adjust", response_model=InventoryRead)
async def create_stock_adjust(
    inventory_id: int,
    payload: InventoryAdjustRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    async with db.begin():
        inventory = await stock_adjust(db, inventory_id=inventory_id, **payload.model_dump(), created_by=current_user.id)
    stmt = inventory_with_relations_stmt().where(Inventory.id == inventory.id)
    return await db.scalar(stmt)


@router.delete("/{inventory_id}")
async def delete_inventory(inventory_id: int, db: AsyncSession = Depends(get_db)):
    inventory = await db.get(Inventory, inventory_id)
    if inventory is None:
        raise HTTPException(status_code=404, detail="库存不存在")
    await db.delete(inventory)
    await db.commit()
    return {"message": "库存已删除"}


@router.post("/batch-delete")
async def batch_delete_inventory(payload: BatchDeleteRequest, db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(select(Inventory).where(Inventory.id.in_(payload.ids)))
    count = 0
    for row in rows:
        await db.delete(row)
        count += 1
    await db.commit()
    return {"message": f"已删除 {count} 条库存"}
