from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.finance import Payment
from app.models.user import User
from app.schemas.common import BatchDeleteRequest, PageResult
from app.schemas.finance import PaymentCreate, PaymentRead, PaymentUpdate
from app.utils.deps import get_current_user

router = APIRouter(prefix="/payments", tags=["payments"], dependencies=[Depends(get_current_user)])


async def paginate(db: AsyncSession, stmt: Select[tuple[Payment]], page: int, page_size: int) -> PageResult[PaymentRead]:
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(items=[PaymentRead.model_validate(row) for row in rows], total=total or 0, page=page, page_size=page_size)


@router.get("", response_model=PageResult[PaymentRead])
async def list_payments(
    page: int = 1,
    page_size: int = 20,
    party_id: int | None = None,
    direction: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Payment).order_by(Payment.pay_date.desc(), Payment.id.desc())
    if party_id:
        stmt = stmt.where(Payment.party_id == party_id)
    if direction:
        stmt = stmt.where(Payment.direction == direction)
    return await paginate(db, stmt, page, page_size)


@router.post("", response_model=PaymentRead, status_code=status.HTTP_201_CREATED)
async def create_payment(payload: PaymentCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    data = payload.model_dump()
    if data.get("linked_orders") is not None:
        data["linked_orders"] = [order.model_dump() for order in payload.linked_orders or []]
    payment = Payment(**data, created_by=current_user.id)
    db.add(payment)
    await db.commit()
    await db.refresh(payment)
    return payment


@router.put("/{payment_id}", response_model=PaymentRead)
async def update_payment(payment_id: int, payload: PaymentUpdate, db: AsyncSession = Depends(get_db)):
    payment = await db.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(status_code=404, detail="收付款记录不存在")
    data = payload.model_dump(exclude_unset=True)
    if "linked_orders" in data and payload.linked_orders is not None:
        data["linked_orders"] = [order.model_dump() for order in payload.linked_orders]
    for key, value in data.items():
        setattr(payment, key, value)
    await db.commit()
    await db.refresh(payment)
    return payment


@router.delete("/{payment_id}")
async def delete_payment(payment_id: int, db: AsyncSession = Depends(get_db)):
    payment = await db.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(status_code=404, detail="收付款记录不存在")
    await db.delete(payment)
    await db.commit()
    return {"message": "收付款记录已删除"}


@router.post("/batch-delete")
async def batch_delete_payments(payload: BatchDeleteRequest, db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(select(Payment).where(Payment.id.in_(payload.ids)))
    count = 0
    for row in rows:
        await db.delete(row)
        count += 1
    await db.commit()
    return {"message": f"已删除 {count} 条收付款记录"}
