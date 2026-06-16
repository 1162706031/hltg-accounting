from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.finance import Invoice, Payment
from app.models.inventory import Inventory
from app.models.party import Party
from app.models.reconciliation import PartyReconciliation
from app.models.user import User
from app.schemas.common import BatchDeleteRequest, PageResult
from app.schemas.party import (
    PartyBalanceDetail,
    PartyBalanceLine,
    PartyCreate,
    PartyRead,
    PartyUpdate,
)
from app.utils.deps import get_current_user, require_roles

router = APIRouter(prefix="/parties", tags=["parties"], dependencies=[Depends(get_current_user)])


async def party_reference_reason(db: AsyncSession, party_id: int) -> str | None:
    """返回该单位被引用的原因；无引用则返回 None（可安全删除）。"""
    checks = (
        (Inventory, Inventory.owner_id, "仍有库存归属于该单位"),
        (PartyReconciliation, PartyReconciliation.party_id, "仍有对账明细关联该单位"),
        (Payment, Payment.party_id, "仍有收付款记录关联该单位"),
        (Invoice, Invoice.party_id, "仍有开票记录关联该单位"),
    )
    for model, column, reason in checks:
        count = await db.scalar(select(func.count()).select_from(model).where(column == party_id))
        if count:
            return reason
    return None


async def paginate(db: AsyncSession, stmt: Select[tuple[Party]], page: int, page_size: int) -> PageResult[PartyRead]:
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(items=[PartyRead.model_validate(row) for row in rows], total=total or 0, page=page, page_size=page_size)


@router.get("", response_model=PageResult[PartyRead])
async def list_parties(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
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
async def create_party(
    payload: PartyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "accountant")),
):
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


@router.get("/{party_id}/balance", response_model=PartyBalanceDetail)
async def get_party_balance(party_id: int, db: AsyncSession = Depends(get_db)):
    """单个单位的往来明细：汇总四项净额 + 对账明细行（设计 §5.2 展开面板）。"""
    party = await db.get(Party, party_id)
    if party is None:
        raise HTTPException(status_code=404, detail="往来单位不存在")

    summary = (
        await db.execute(
            text(
                "SELECT net_receivable, net_payable, net_to_issue, net_to_receive "
                "FROM v_party_balance WHERE party_id = :pid"
            ),
            {"pid": party_id},
        )
    ).first()

    rows = await db.scalars(
        select(PartyReconciliation)
        .where(
            PartyReconciliation.party_id == party_id,
            PartyReconciliation.recon_status.in_(("unreconciled", "verified")),
        )
        .order_by(PartyReconciliation.biz_date.desc(), PartyReconciliation.id.desc())
    )

    return PartyBalanceDetail(
        party_id=party_id,
        party_name=party.name,
        net_receivable=summary.net_receivable if summary else 0,
        net_payable=summary.net_payable if summary else 0,
        net_to_issue=summary.net_to_issue if summary else 0,
        net_to_receive=summary.net_to_receive if summary else 0,
        lines=[PartyBalanceLine.model_validate(row, from_attributes=True) for row in rows],
    )


@router.put("/{party_id}", response_model=PartyRead)
async def update_party(
    party_id: int,
    payload: PartyUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    party = await db.get(Party, party_id)
    if party is None:
        raise HTTPException(status_code=404, detail="往来单位不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(party, key, value)
    await db.commit()
    await db.refresh(party)
    return party


@router.delete("/{party_id}")
async def delete_party(
    party_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    party = await db.get(Party, party_id)
    if party is None:
        raise HTTPException(status_code=404, detail="往来单位不存在")
    reason = await party_reference_reason(db, party_id)
    if reason:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"该单位{reason}，无法删除")
    await db.delete(party)
    await db.commit()
    return {"message": "往来单位已删除"}


@router.post("/batch-delete")
async def batch_delete_parties(
    payload: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    parties = list(await db.scalars(select(Party).where(Party.id.in_(payload.ids))))
    deleted = 0
    skipped: list[dict[str, object]] = []
    for party in parties:
        reason = await party_reference_reason(db, party.id)
        if reason:
            skipped.append({"id": party.id, "reason": f"该单位{reason}"})
            continue
        await db.delete(party)
        deleted += 1
    await db.commit()
    return {"deleted_count": deleted, "skipped": skipped}
