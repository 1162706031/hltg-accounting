from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.inventory import Inventory, InventoryLog
from app.models.item import Item
from app.models.user import User
from app.schemas.common import BatchDeleteRequest, PageResult
from app.schemas.inventory import (
    InventoryAdjustRequest,
    InventoryInRequest,
    InventoryLogRead,
    InventoryLogWithRelations,
    InventoryOutRequest,
    InventoryRead,
)
from app.services.inventory import (
    delete_inventory_with_log,
    inventory_with_relations_stmt,
    stock_adjust,
    stock_in,
    stock_out,
)
from app.utils.deps import get_current_user, require_roles

router = APIRouter(prefix="/inventory", tags=["inventory"], dependencies=[Depends(get_current_user)])


def inventory_delete_reason(inventory: Inventory) -> str | None:
    """返回库存项不可删除的原因；None 表示可删。"""
    if inventory.current_quantity != 0:
        return "该库存项仍有结余，请先出库清空后再删除"
    return None


async def paginate_inventory(db: AsyncSession, stmt: Select[tuple[Inventory]], page: int, page_size: int) -> PageResult[InventoryRead]:
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(items=[InventoryRead.model_validate(row) for row in rows], total=total or 0, page=page, page_size=page_size)


@router.get("", response_model=PageResult[InventoryRead])
async def list_inventory(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
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
        stmt = stmt.where(Inventory.current_quantity > 0)
    return await paginate_inventory(db, stmt, page, page_size)


@router.get("/logs", response_model=PageResult[InventoryLogWithRelations])
async def list_inventory_logs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    change_type: str | None = None,
    inventory_id: int | None = None,
    item_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    # 日志表自包含：每行写入时已固化物品/归属/操作人快照，查询直接读取本表，无需 JOIN。
    stmt = select(InventoryLog).order_by(InventoryLog.id.desc())
    if change_type:
        stmt = stmt.where(InventoryLog.change_type == change_type)
    if inventory_id:
        stmt = stmt.where(InventoryLog.inventory_id == inventory_id)
    if item_id:
        stmt = stmt.where(InventoryLog.item_id == item_id)
    if date_from:
        stmt = stmt.where(InventoryLog.change_date >= date_from)
    if date_to:
        stmt = stmt.where(InventoryLog.change_date <= date_to)
    if q:
        stmt = stmt.where(InventoryLog.item_name.like(f"%{q}%") | InventoryLog.item_spec.like(f"%{q}%"))

    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    items = [InventoryLogWithRelations.model_validate(row) for row in rows]
    return PageResult(items=items, total=total or 0, page=page, page_size=page_size)


@router.post("/in", response_model=InventoryRead)
async def create_stock_in(
    payload: InventoryInRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "accountant")),
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
    current_user: User = Depends(require_roles("admin", "accountant")),
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
    current_user: User = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        inventory = await stock_adjust(db, inventory_id=inventory_id, **payload.model_dump(), created_by=current_user.id)
    stmt = inventory_with_relations_stmt().where(Inventory.id == inventory.id)
    return await db.scalar(stmt)


@router.delete("/{inventory_id}")
async def delete_inventory(
    inventory_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        inventory = await db.get(Inventory, inventory_id)
        if inventory is None:
            raise HTTPException(status_code=404, detail="库存不存在")
        reason = inventory_delete_reason(inventory)
        if reason:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=reason)
        await delete_inventory_with_log(
            db, inventory=inventory, change_date=date.today(), created_by=current_user.id
        )
    return {"message": "库存已删除"}


@router.post("/batch-delete")
async def batch_delete_inventory(
    payload: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "accountant")),
):
    deleted = 0
    skipped: list[dict[str, object]] = []
    async with db.begin():
        rows = list(await db.scalars(select(Inventory).where(Inventory.id.in_(payload.ids))))
        for row in rows:
            reason = inventory_delete_reason(row)
            if reason:
                skipped.append({"id": row.id, "reason": reason})
                continue
            await delete_inventory_with_log(
                db, inventory=row, change_date=date.today(), created_by=current_user.id
            )
            deleted += 1
    return {"deleted_count": deleted, "skipped": skipped}
