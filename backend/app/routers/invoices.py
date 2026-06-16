from fastapi import APIRouter, Depends, HTTPException, Query, status
from datetime import date

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.finance import Invoice
from app.models.party import Party
from app.models.user import User
from app.schemas.common import BatchDeleteRequest, PageResult
from app.schemas.finance import InvoiceCreate, InvoiceRead, InvoiceUpdate
from app.utils.deps import get_current_user, require_roles

router = APIRouter(prefix="/invoices", tags=["invoices"], dependencies=[Depends(get_current_user)])


async def ensure_party_exists(db: AsyncSession, party_id: int) -> None:
    if await db.get(Party, party_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="往来单位不存在")


async def get_invoice_with_party(db: AsyncSession, invoice_id: int) -> Invoice:
    invoice = await db.scalar(
        select(Invoice).options(selectinload(Invoice.party)).where(Invoice.id == invoice_id)
    )
    if invoice is None:
        raise HTTPException(status_code=404, detail="开票记录不存在")
    return invoice


async def paginate(db: AsyncSession, stmt: Select[tuple[Invoice]], page: int, page_size: int) -> PageResult[InvoiceRead]:
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(items=[InvoiceRead.model_validate(row) for row in rows], total=total or 0, page=page, page_size=page_size)


@router.get("", response_model=PageResult[InvoiceRead])
async def list_invoices(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    party_id: int | None = None,
    direction: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Invoice).join(Invoice.party).options(selectinload(Invoice.party)).order_by(Invoice.invoice_date.desc(), Invoice.id.desc())
    if party_id:
        stmt = stmt.where(Invoice.party_id == party_id)
    if direction:
        stmt = stmt.where(Invoice.direction == direction)
    if date_from:
        stmt = stmt.where(Invoice.invoice_date >= date_from)
    if date_to:
        stmt = stmt.where(Invoice.invoice_date <= date_to)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(Party.name.like(pattern) | Party.short_name.like(pattern) | Invoice.invoice_no.like(pattern) | Invoice.notes.like(pattern))
    return await paginate(db, stmt, page, page_size)


@router.post("", response_model=InvoiceRead, status_code=status.HTTP_201_CREATED)
async def create_invoice(
    payload: InvoiceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "accountant")),
):
    await ensure_party_exists(db, payload.party_id)
    data = payload.model_dump()
    if data.get("linked_orders") is not None:
        data["linked_orders"] = [order.model_dump() for order in payload.linked_orders or []]
    invoice = Invoice(**data, created_by=current_user.id)
    db.add(invoice)
    await db.commit()
    return await get_invoice_with_party(db, invoice.id)


@router.put("/{invoice_id}", response_model=InvoiceRead)
async def update_invoice(
    invoice_id: int,
    payload: InvoiceUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    invoice = await db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="开票记录不存在")
    if payload.party_id is not None:
        await ensure_party_exists(db, payload.party_id)
    data = payload.model_dump(exclude_unset=True)
    if "linked_orders" in data and payload.linked_orders is not None:
        data["linked_orders"] = [order.model_dump() for order in payload.linked_orders]
    for key, value in data.items():
        setattr(invoice, key, value)
    await db.commit()
    return await get_invoice_with_party(db, invoice.id)


@router.delete("/{invoice_id}")
async def delete_invoice(
    invoice_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    invoice = await db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="开票记录不存在")
    await db.delete(invoice)
    await db.commit()
    return {"message": "开票记录已删除"}


@router.post("/batch-delete")
async def batch_delete_invoices(
    payload: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    rows = await db.scalars(select(Invoice).where(Invoice.id.in_(payload.ids)))
    count = 0
    for row in rows:
        await db.delete(row)
        count += 1
    await db.commit()
    return {"message": f"已删除 {count} 条开票记录"}
