from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.inventory import Inventory
from app.models.item import Item
from app.models.user import User
from app.models.outsource import OutsourceOrder, ProcessingOutbound
from app.models.sales import SalesOrder, SalesOrderItem
from app.models.smelting import SmeltingInbound, SmeltingOrder
from app.models.steelmaking import SteelmakingRecordMaterial
from app.schemas.common import BatchDeleteRequest, PageResult
from app.schemas.item import AiCompositionRequest, AiCompositionResponse, ItemCreate, ItemRead, ItemType, ItemUpdate
from app.services.dify_composition import (
    DifyCompositionError,
    DifyCompositionNotConfiguredError,
    generate_steel_composition,
)
from app.services.master_data import require_master_option
from app.utils.deps import get_current_user, require_roles

router = APIRouter(prefix="/items", tags=["items"], dependencies=[Depends(get_current_user)])


def _composition_json(value) -> dict[str, str] | None:
    return (
        {code: format(Decimal(str(amount)).quantize(Decimal("0.000001")), "f") for code, amount in value.items()}
        if value is not None
        else None
    )


async def paginate(db: AsyncSession, stmt: Select[tuple[Item]], page: int, page_size: int) -> PageResult[ItemRead]:
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(items=[ItemRead.model_validate(row) for row in rows], total=total or 0, page=page, page_size=page_size)


# ---------- 业务约束：删除/停用前检查引用 ----------
ACTIVE_ORDER_STATUSES = ("draft", "pending_review", "approved", "in_progress")


async def item_deletion_block_reason(
    db: AsyncSession, item_id: int, *, include_history: bool = True
) -> str | None:
    """返回不可删除/停用的原因；None 表示允许。

    设计 §5.3：
    - 处于进行中/待审的订单引用该物品 → 禁止
    - 仍有库存 → 提示先出库清空
    """
    active_smelting = await db.scalar(
        select(func.count())
        .select_from(SmeltingInbound)
        .join(SmeltingOrder, SmeltingInbound.order_id == SmeltingOrder.id)
        .where(
            SmeltingInbound.item_id == item_id,
            SmeltingOrder.status.in_(ACTIVE_ORDER_STATUSES),
        )
    )
    if active_smelting:
        return "该物品正在加工订单中使用，无法操作"

    active_outsource = await db.scalar(
        select(func.count())
        .select_from(ProcessingOutbound)
        .join(OutsourceOrder, ProcessingOutbound.order_id == OutsourceOrder.id)
        .where(
            ProcessingOutbound.item_id == item_id,
            OutsourceOrder.status.in_(ACTIVE_ORDER_STATUSES),
        )
    )
    if active_outsource:
        return "该物品正在加工订单中使用，无法操作"

    active_sales = await db.scalar(
        select(func.count())
        .select_from(SalesOrderItem)
        .join(SalesOrder, SalesOrderItem.order_id == SalesOrder.id)
        .where(
            SalesOrderItem.item_id == item_id,
            SalesOrder.status.in_(ACTIVE_ORDER_STATUSES),
        )
    )
    if active_sales:
        return "该物品正在销售订单中使用，请先删除或修改相关订单"

    if include_history:
        sales_history = await db.scalar(
            select(func.count()).select_from(SalesOrderItem).where(SalesOrderItem.item_id == item_id)
        )
        if sales_history:
            return "该物品已被销售订单引用，为保护历史明细不能删除"

    steelmaking_history = await db.scalar(
        select(func.count()).select_from(SteelmakingRecordMaterial).where(SteelmakingRecordMaterial.item_id == item_id)
    )
    if steelmaking_history:
        return "该物品已被炼钢记录引用，为保护历史快照不能删除"

    inv_balance = await db.scalar(
        select(func.coalesce(func.sum(Inventory.current_quantity), 0)).where(Inventory.item_id == item_id)
    )
    if inv_balance and float(inv_balance) > 0:
        return "该物品仍有库存，请先出库清空后再操作"

    return None


@router.get("", response_model=PageResult[ItemRead])
async def list_items(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=500),
    q: str | None = None,
    item_type: ItemType | None = None,
    is_active: bool | None = None,
    chemical_enabled: bool | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Item).order_by(Item.id.desc())
    if q:
        condition = Item.name.like(f"%{q.strip()}%")
        if q.strip().isdigit():
            condition = condition | (Item.id == int(q.strip()))
        stmt = stmt.where(condition)
    if item_type:
        stmt = stmt.where(Item.item_type == item_type)
    if is_active is not None:
        stmt = stmt.where(Item.is_active == is_active)
    if chemical_enabled is not None:
        stmt = stmt.where(Item.chemical_enabled == chemical_enabled)
    return await paginate(db, stmt, page, page_size)


@router.post("/ai-composition", response_model=AiCompositionResponse)
async def create_ai_composition(
    payload: AiCompositionRequest,
    current_user: User = Depends(require_roles("admin", "accountant")),
):
    steel_grade = payload.steel_grade.strip()
    try:
        composition = await generate_steel_composition(steel_grade, f"hltg-accounting-{current_user.id}")
    except DifyCompositionNotConfiguredError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except DifyCompositionError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return AiCompositionResponse(steel_grade=steel_grade, chemical_composition=composition)


@router.post("", response_model=ItemRead, status_code=status.HTTP_201_CREATED)
async def create_item(
    payload: ItemCreate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    item_name_option = await require_master_option(
        db,
        category="item_name",
        code=payload.name,
        detail="请优先选择基础资料中已有的物品名称；没有时请先新增名称",
    )
    item_type_option = await require_master_option(
        db,
        category="item_type",
        code=payload.item_type,
        detail="请选择基础资料中已有的物品类型",
    )
    data = payload.model_dump()
    data["name"] = item_name_option.name
    data["item_type"] = item_type_option.code
    if data["chemical_enabled"]:
        data["chemical_composition"] = _composition_json(data["chemical_composition"])
    else:
        data["chemical_composition"] = None
        data["default_price"] = None
    item = Item(**data)
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
async def update_item(
    item_id: int,
    payload: ItemUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    item = await db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="物品不存在")
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_active") is False and item.is_active:
        reason = await item_deletion_block_reason(db, item_id, include_history=False)
        if reason:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=reason)
    if "name" in data and data["name"] != item.name:
        item_name_option = await require_master_option(
            db,
            category="item_name",
            code=data["name"],
            detail="请优先选择基础资料中已有的物品名称；没有时请先新增名称",
        )
        data["name"] = item_name_option.name
    if "item_type" in data and data["item_type"] != item.item_type:
        item_type_option = await require_master_option(
            db,
            category="item_type",
            code=data["item_type"],
            detail="请选择基础资料中已有的物品类型",
        )
        data["item_type"] = item_type_option.code
    chemical_enabled = data.get("chemical_enabled", item.chemical_enabled)
    if not chemical_enabled:
        data["chemical_composition"] = None
        data["default_price"] = None
    elif "chemical_composition" in data:
        data["chemical_composition"] = _composition_json(data["chemical_composition"])
    elif item.chemical_composition is None:
        data["chemical_composition"] = {code: "0" for code in ("C", "Mn", "Si", "Cr", "W", "Mo", "V", "Co", "Nb", "Ni", "P", "S")}
    for key, value in data.items():
        setattr(item, key, value)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="同名称+类型+规格的物品已存在")
    await db.refresh(item)
    return item


@router.post("/{item_id}/toggle-active", response_model=ItemRead)
async def toggle_item_active(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    """停用/启用切换；停用前进行业务约束检查。"""
    item = await db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="物品不存在")
    if item.is_active:
        # 停用前检查
        reason = await item_deletion_block_reason(db, item_id, include_history=False)
        if reason:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=reason)
        item.is_active = False
    else:
        item.is_active = True
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{item_id}")
async def delete_item(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    item = await db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="物品不存在")
    reason = await item_deletion_block_reason(db, item_id)
    if reason:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=reason)
    await db.delete(item)
    await db.commit()
    return {"message": "物品已删除"}


@router.post("/batch-delete")
async def batch_delete_items(
    payload: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    items = await db.scalars(select(Item).where(Item.id.in_(payload.ids)))
    deleted = 0
    skipped: list[dict] = []
    for item in items:
        reason = await item_deletion_block_reason(db, item.id)
        if reason:
            skipped.append({"id": item.id, "reason": reason})
            continue
        await db.delete(item)
        deleted += 1
    await db.commit()
    return {"deleted_count": deleted, "skipped": skipped}
