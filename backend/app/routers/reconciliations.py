from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import Select, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.reconciliation import PartyReconciliation
from app.models.user import User
from app.schemas.common import BatchDeleteRequest, PageResult
from app.schemas.reconciliation import (
    PartyBalanceRead,
    ReconciliationCreate,
    ReconciliationRead,
    ReconciliationStatusUpdate,
    ReconciliationUpdate,
)
from app.utils.deps import get_current_user

router = APIRouter(prefix="/reconciliations", tags=["reconciliations"], dependencies=[Depends(get_current_user)])


async def paginate(
    db: AsyncSession, stmt: Select[tuple[PartyReconciliation]], page: int, page_size: int
) -> PageResult[ReconciliationRead]:
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(items=[ReconciliationRead.model_validate(row) for row in rows], total=total or 0, page=page, page_size=page_size)


@router.get("", response_model=PageResult[ReconciliationRead])
async def list_reconciliations(
    page: int = 1,
    page_size: int = 20,
    party_id: int | None = None,
    recon_status: str | None = None,
    period: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(PartyReconciliation).order_by(PartyReconciliation.biz_date.desc(), PartyReconciliation.id.desc())
    if party_id:
        stmt = stmt.where(PartyReconciliation.party_id == party_id)
    if recon_status:
        stmt = stmt.where(PartyReconciliation.recon_status == recon_status)
    if period:
        stmt = stmt.where(PartyReconciliation.period == period)
    return await paginate(db, stmt, page, page_size)


@router.post("", response_model=ReconciliationRead, status_code=status.HTTP_201_CREATED)
async def create_reconciliation(
    payload: ReconciliationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = PartyReconciliation(**payload.model_dump(), created_by=current_user.id)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.put("/{reconciliation_id}", response_model=ReconciliationRead)
async def update_reconciliation(reconciliation_id: int, payload: ReconciliationUpdate, db: AsyncSession = Depends(get_db)):
    row = await db.get(PartyReconciliation, reconciliation_id)
    if row is None:
        raise HTTPException(status_code=404, detail="对账行不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    await db.commit()
    await db.refresh(row)
    return row


@router.put("/{reconciliation_id}/status", response_model=ReconciliationRead)
async def update_reconciliation_status(
    reconciliation_id: int,
    payload: ReconciliationStatusUpdate,
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(PartyReconciliation, reconciliation_id)
    if row is None:
        raise HTTPException(status_code=404, detail="对账行不存在")
    row.recon_status = payload.recon_status
    await db.commit()
    await db.refresh(row)
    return row


@router.delete("/{reconciliation_id}")
async def delete_reconciliation(reconciliation_id: int, db: AsyncSession = Depends(get_db)):
    row = await db.get(PartyReconciliation, reconciliation_id)
    if row is None:
        raise HTTPException(status_code=404, detail="对账行不存在")
    await db.delete(row)
    await db.commit()
    return {"message": "对账行已删除"}


@router.post("/batch-delete")
async def batch_delete_reconciliations(payload: BatchDeleteRequest, db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(select(PartyReconciliation).where(PartyReconciliation.id.in_(payload.ids)))
    count = 0
    for row in rows:
        await db.delete(row)
        count += 1
    await db.commit()
    return {"message": f"已删除 {count} 条对账行"}


@router.get("/balances", response_model=list[PartyBalanceRead])
async def list_party_balances(db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("SELECT * FROM v_party_balance ORDER BY party_id DESC"))
    return [PartyBalanceRead(**dict(row._mapping)) for row in result]
