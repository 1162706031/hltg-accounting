from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.finance import Invoice
from app.models.user import User
from app.schemas.common import BatchDeleteRequest, PageResult
from app.schemas.finance import InvoiceCreate, InvoiceRead, InvoiceUpdate
from app.utils.deps import get_current_user

router = APIRouter(prefix="/invoices", tags=["invoices"], dependencies=[Depends(get_current_user)])


async def paginate(db: AsyncSession, stmt: Select[tuple[Invoice]], page: int, page_size: int) -> PageResult[InvoiceRead]:
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(items=[InvoiceRead.model_validate(row) for row in rows], total=total or 0, page=page, page_size=page_size)


@router.get("", response_model=PageResult[InvoiceRead])
async def list_invoices(
    page: int = 1,
    page_size: int = 20,
    party_id: int | None = None,
    direction: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Invoice).order_by(Invoice.invoice_date.desc(), Invoice.id.desc())
    if party_id:
        stmt = stmt.where(Invoice.party_id == party_id)
    if direction:
        stmt = stmt.where(Invoice.direction == direction)
    return await paginate(db, stmt, page, page_size)


@router.post("", response_model=InvoiceRead, status_code=status.HTTP_201_CREATED)
async def create_invoice(payload: InvoiceCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    data = payload.model_dump()
    if data.get("linked_orders") is not None:
        data["linked_orders"] = [order.model_dump() for order in payload.linked_orders or []]
    invoice = Invoice(**data, created_by=current_user.id)
    db.add(invoice)
    await db.commit()
    await db.refresh(invoice)
    return invoice


@router.put("/{invoice_id}", response_model=InvoiceRead)
async def update_invoice(invoice_id: int, payload: InvoiceUpdate, db: AsyncSession = Depends(get_db)):
    invoice = await db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="开票记录不存在")
    data = payload.model_dump(exclude_unset=True)
    if "linked_orders" in data and payload.linked_orders is not None:
        data["linked_orders"] = [order.model_dump() for order in payload.linked_orders]
    for key, value in data.items():
        setattr(invoice, key, value)
    await db.commit()
    await db.refresh(invoice)
    return invoice


@router.delete("/{invoice_id}")
async def delete_invoice(invoice_id: int, db: AsyncSession = Depends(get_db)):
    invoice = await db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="开票记录不存在")
    await db.delete(invoice)
    await db.commit()
    return {"message": "开票记录已删除"}


@router.post("/batch-delete")
async def batch_delete_invoices(payload: BatchDeleteRequest, db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(select(Invoice).where(Invoice.id.in_(payload.ids)))
    count = 0
    for row in rows:
        await db.delete(row)
        count += 1
    await db.commit()
    return {"message": f"已删除 {count} 条开票记录"}
