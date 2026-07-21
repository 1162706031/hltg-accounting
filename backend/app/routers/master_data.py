from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.master_data import MasterDataOption
from app.models.user import User
from app.schemas.master_data import (
    MasterDataCategory,
    MasterDataOptionCreate,
    MasterDataOptionRead,
)
from app.schemas.common import BatchDeleteRequest
from app.services.master_data import RETIRED_ITEM_TYPE_CODES, master_option_reference_reason
from app.utils.deps import get_current_user, require_roles

router = APIRouter(
    prefix="/master-data",
    tags=["master-data"],
    dependencies=[Depends(get_current_user)],
)


@router.get("/options", response_model=list[MasterDataOptionRead])
async def list_master_data_options(
    category: MasterDataCategory | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(MasterDataOption).order_by(
        MasterDataOption.category,
        MasterDataOption.is_system.desc(),
        MasterDataOption.id,
    )
    if category:
        stmt = stmt.where(MasterDataOption.category == category)
    stmt = stmt.where(
        ~(
            (MasterDataOption.category == "item_type")
            & MasterDataOption.code.in_(RETIRED_ITEM_TYPE_CODES)
        )
    )
    return list(await db.scalars(stmt))


@router.post("/options", response_model=MasterDataOptionRead, status_code=status.HTTP_201_CREATED)
async def create_master_data_option(
    payload: MasterDataOptionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "accountant")),
):
    if payload.category == "item_type" and payload.name in {"原料", "成品", "半成品"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该名称过于笼统，请创建能准确区分物品用途或材质的具体类型",
        )
    code = payload.name if payload.category in {"specification", "item_name"} else f"custom_{uuid4().hex[:16]}"
    option = MasterDataOption(
        category=payload.category,
        code=code,
        name=payload.name,
        is_system=False,
        created_by=current_user.id,
    )
    db.add(option)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该分类下已存在同名配置")
    await db.refresh(option)
    return option


@router.delete("/options/{option_id}")
async def delete_master_data_option(
    option_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        option = await db.scalar(
            select(MasterDataOption)
            .where(MasterDataOption.id == option_id)
            .with_for_update()
        )
        if option is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="基础资料配置不存在")
        if option.is_system:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="系统内置配置不能删除")
        reason = await master_option_reference_reason(db, option)
        if reason:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{reason}，无法删除")
        await db.delete(option)
    return {"message": "配置已删除"}


@router.post("/options/batch-delete")
async def batch_delete_master_data_options(
    payload: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    deleted_count = 0
    skipped: list[dict[str, int | str]] = []
    async with db.begin():
        rows = list(
            await db.scalars(
                select(MasterDataOption)
                .where(MasterDataOption.id.in_(payload.ids))
                .with_for_update()
            )
        )
        by_id = {row.id: row for row in rows}
        for option_id in dict.fromkeys(payload.ids):
            option = by_id.get(option_id)
            if option is None:
                skipped.append({"id": option_id, "reason": "配置不存在"})
                continue
            if option.is_system:
                skipped.append({"id": option_id, "reason": "系统内置配置不能删除"})
                continue
            reason = await master_option_reference_reason(db, option)
            if reason:
                skipped.append({"id": option_id, "reason": f"{reason}，无法删除"})
                continue
            await db.delete(option)
            deleted_count += 1
    return {"deleted_count": deleted_count, "skipped": skipped}
