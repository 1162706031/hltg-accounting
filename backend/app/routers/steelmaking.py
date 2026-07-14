from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.steelmaking import SteelmakingRecord
from app.models.party import Party
from app.models.user import User
from app.schemas.common import BatchDeleteRequest, PageResult
from app.schemas.steelmaking import (
    RecordStatus,
    SteelmakingRecordCreate,
    SteelmakingRecordListItem,
    SteelmakingRecordRead,
    SteelmakingRecordUpdate,
)
from app.services.batch import generate_batch_no
from app.services.steelmaking import convert_weight_to_kg, load_record, replace_calculated_details, resolve_furnace_no
from app.utils.deps import get_current_user, require_roles

router = APIRouter(
    prefix="/steelmaking-records",
    tags=["steelmaking-records"],
    dependencies=[Depends(get_current_user)],
)


@router.get("", response_model=PageResult[SteelmakingRecordListItem])
async def list_records(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    date_from: date | None = None,
    date_to: date | None = None,
    batch_no: str | None = None,
    furnace_no: str | None = None,
    steel_grade: str | None = None,
    record_status: RecordStatus | None = Query(default=None, alias="status"),
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(SteelmakingRecord).options(selectinload(SteelmakingRecord.owner)).where(SteelmakingRecord.deleted.is_(False)).order_by(
        SteelmakingRecord.record_date.desc(), SteelmakingRecord.id.desc()
    )
    if date_from:
        stmt = stmt.where(SteelmakingRecord.record_date >= date_from)
    if date_to:
        stmt = stmt.where(SteelmakingRecord.record_date <= date_to)
    if batch_no:
        stmt = stmt.where(SteelmakingRecord.batch_no.like(f"%{batch_no.strip()}%"))
    if furnace_no:
        stmt = stmt.where(SteelmakingRecord.furnace_no.like(f"%{furnace_no.strip()}%"))
    if steel_grade:
        stmt = stmt.where(SteelmakingRecord.steel_grade.like(f"%{steel_grade.strip()}%"))
    if record_status:
        stmt = stmt.where(SteelmakingRecord.status == record_status)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(SteelmakingRecord.batch_no.like(like), SteelmakingRecord.furnace_no.like(like), SteelmakingRecord.steel_grade.like(like)))

    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(
        items=[SteelmakingRecordListItem.model_validate(row) for row in rows],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


@router.get("/{record_id}", response_model=SteelmakingRecordRead)
async def get_record(record_id: int, db: AsyncSession = Depends(get_db)):
    return await load_record(db, record_id)


@router.post("", response_model=SteelmakingRecordRead, status_code=status.HTTP_201_CREATED)
async def create_record(
    payload: SteelmakingRecordCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        if await db.get(Party, payload.owner_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="所属单位不存在")
        batch_no = await generate_batch_no(db, column=SteelmakingRecord.batch_no, prefix="LG", width=6)
        record = SteelmakingRecord(
            **payload.model_dump(exclude={"materials", "actual_composition", "furnace_weight", "furnace_no"}),
            batch_no=batch_no,
            furnace_no=resolve_furnace_no(payload.furnace_no, batch_no),
            furnace_weight=payload.furnace_weight,
            furnace_weight_kg=convert_weight_to_kg(payload.furnace_weight, payload.furnace_weight_unit),
            status="draft",
            created_by=current_user.id,
            updated_by=current_user.id,
            deleted=False,
        )
        await replace_calculated_details(db, record, payload.materials, payload.actual_composition)
        db.add(record)
    return await load_record(db, record.id)


@router.put("/{record_id}", response_model=SteelmakingRecordRead)
async def update_record(
    record_id: int,
    payload: SteelmakingRecordUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        record = await load_record(db, record_id)
        if record.status != "draft":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="仅草稿状态的炼钢记录可编辑")
        if await db.get(Party, payload.owner_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="所属单位不存在")
        data = payload.model_dump(exclude={"materials", "actual_composition", "furnace_weight", "furnace_no"})
        for key, value in data.items():
            setattr(record, key, value)
        record.furnace_weight = payload.furnace_weight
        record.furnace_no = resolve_furnace_no(payload.furnace_no, record.batch_no)
        record.furnace_weight_kg = convert_weight_to_kg(payload.furnace_weight, payload.furnace_weight_unit)
        record.updated_by = current_user.id
        await replace_calculated_details(db, record, payload.materials, payload.actual_composition)
    return await load_record(db, record_id)


@router.post("/{record_id}/confirm", response_model=SteelmakingRecordRead)
async def confirm_record(
    record_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        record = await load_record(db, record_id)
        if record.status != "draft":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="当前记录已确认")
        record.status = "confirmed"
        record.updated_by = current_user.id
    return await load_record(db, record_id)


@router.delete("/{record_id}")
async def delete_record(
    record_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "accountant")),
):
    async with db.begin():
        record = await load_record(db, record_id)
        record.deleted = True
        record.updated_by = current_user.id
    return {"message": "炼钢记录已删除"}


@router.post("/batch-delete")
async def batch_delete_records(
    payload: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "accountant")),
):
    rows = list(
        await db.scalars(
            select(SteelmakingRecord).where(
                SteelmakingRecord.id.in_(payload.ids),
                SteelmakingRecord.deleted.is_(False),
            )
        )
    )
    for record in rows:
        record.deleted = True
        record.updated_by = current_user.id
    await db.commit()
    return {"deleted_count": len(rows), "skipped": []}
