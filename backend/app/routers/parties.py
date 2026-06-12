from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.party import Party
from app.models.user import User
from app.schemas.common import BatchDeleteRequest, PageResult
from app.schemas.party import PartyCreate, PartyRead, PartyUpdate
from app.utils.deps import get_current_user

router = APIRouter(prefix="/parties", tags=["parties"], dependencies=[Depends(get_current_user)])


async def paginate(db: AsyncSession, stmt: Select[tuple[Party]], page: int, page_size: int) -> PageResult[PartyRead]:
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(items=[PartyRead.model_validate(row) for row in rows], total=total or 0, page=page, page_size=page_size)


@router.get("", response_model=PageResult[PartyRead])
async def list_parties(
    page: int = 1,
    page_size: int = 20,
    q: str | None = None,
    is_customer: bool | None = None,
    is_supplier: bool | None = None,
    is_processor: bool | None = None,
    is_internal: bool | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Party).order_by(Party.id.desc())
    if q:
        stmt = stmt.where(or_(Party.name.like(f"%{q}%"), Party.short_name.like(f"%{q}%")))
    for attr, value in {
        "is_customer": is_customer,
        "is_supplier": is_supplier,
        "is_processor": is_processor,
        "is_internal": is_internal,
    }.items():
        if value is not None:
            stmt = stmt.where(getattr(Party, attr) == value)
    return await paginate(db, stmt, page, page_size)


@router.post("", response_model=PartyRead, status_code=status.HTTP_201_CREATED)
async def create_party(payload: PartyCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    party = Party(**payload.model_dump())
    db.add(party)
    await db.commit()
    await db.refresh(party)
    return party


@router.get("/{party_id}", response_model=PartyRead)
async def get_party(party_id: int, db: AsyncSession = Depends(get_db)):
    party = await db.get(Party, party_id)
    if party is None:
        raise HTTPException(status_code=404, detail="往来单位不存在")
    return party


@router.put("/{party_id}", response_model=PartyRead)
async def update_party(party_id: int, payload: PartyUpdate, db: AsyncSession = Depends(get_db)):
    party = await db.get(Party, party_id)
    if party is None:
        raise HTTPException(status_code=404, detail="往来单位不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(party, key, value)
    await db.commit()
    await db.refresh(party)
    return party


@router.delete("/{party_id}")
async def delete_party(party_id: int, db: AsyncSession = Depends(get_db)):
    party = await db.get(Party, party_id)
    if party is None:
        raise HTTPException(status_code=404, detail="往来单位不存在")
    await db.delete(party)
    await db.commit()
    return {"message": "往来单位已删除"}


@router.post("/batch-delete")
async def batch_delete_parties(payload: BatchDeleteRequest, db: AsyncSession = Depends(get_db)):
    parties = await db.scalars(select(Party).where(Party.id.in_(payload.ids)))
    count = 0
    for party in parties:
        await db.delete(party)
        count += 1
    await db.commit()
    return {"message": f"已删除 {count} 个往来单位"}
