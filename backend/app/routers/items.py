from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.inventory import Inventory
from app.models.item import Item
from app.schemas.common import BatchDeleteRequest, PageResult
from app.schemas.item import ItemCreate, ItemRead, ItemType, ItemUpdate
from app.utils.deps import get_current_user

router = APIRouter(prefix="/items", tags=["items"], dependencies=[Depends(get_current_user)])


async def paginate(db: AsyncSession, stmt: Select[tuple[Item]], page: int, page_size: int) -> PageResult[ItemRead]:
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(items=[ItemRead.model_validate(row) for row in rows], total=total or 0, page=page, page_size=page_size)


@router.get("", response_model=PageResult[ItemRead])
async def list_items(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    q: str | None = None,
    item_type: ItemType | None = None,
    is_active: bool | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Item).order_by(Item.id.desc())
    if q:
        stmt = stmt.where(or_(Item.name.like(f"%{q}%"), Item.spec.like(f"%{q}%")))
    if item_type:
        stmt = stmt.where(Item.item_type == item_type)
    if is_active is not None:
        stmt = stmt.where(Item.is_active == is_active)
    return await paginate(db, stmt, page, page_size)


@router.post("", response_model=ItemRead, status_code=status.HTTP_201_CREATED)
async def create_item(payload: ItemCreate, db: AsyncSession = Depends(get_db)):
    item = Item(**payload.model_dump())
    db.add(item)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="同名称+类型+规格的物品已存在")
    await db.refresh(item)
    return item


@router.get("/{item_id}", response_model=ItemRead)
async def get_item(item_id: int, db: AsyncSession = Depends(get_db)):
    item = await db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="物品不存在")
    return item


@router.put("/{item_id}", response_model=ItemRead)
async def update_item(item_id: int, payload: ItemUpdate, db: AsyncSession = Depends(get_db)):
    item = await db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="物品不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="同名称+类型+规格的物品已存在")
    await db.refresh(item)
    return item


@router.delete("/{item_id}")
async def delete_item(item_id: int, db: AsyncSession = Depends(get_db)):
    item = await db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="物品不存在")
    inventory_count = await db.scalar(select(func.count()).select_from(Inventory).where(Inventory.item_id == item_id))
    if inventory_count:
        item.is_active = False
        await db.commit()
        return {"message": "物品已有库存引用，已自动停用"}
    await db.delete(item)
    await db.commit()
    return {"message": "物品已删除"}


@router.post("/batch-delete")
async def batch_delete_items(payload: BatchDeleteRequest, db: AsyncSession = Depends(get_db)):
    items = await db.scalars(select(Item).where(Item.id.in_(payload.ids)))
    deleted = 0
    disabled = 0
    for item in items:
        inventory_count = await db.scalar(select(func.count()).select_from(Inventory).where(Inventory.item_id == item.id))
        if inventory_count:
            item.is_active = False
            disabled += 1
        else:
            await db.delete(item)
            deleted += 1
    await db.commit()
    return {"message": f"已删除 {deleted} 个物品，停用 {disabled} 个已有引用物品"}
