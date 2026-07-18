from datetime import date, datetime, time

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.operation_log import OperationLog
from app.schemas.common import PageResult
from app.schemas.operation_log import OperationLogRead
from app.utils.deps import require_roles

router = APIRouter(prefix="/operation-logs", tags=["operation-logs"], dependencies=[Depends(require_roles("admin"))])


async def paginate(
    db: AsyncSession, stmt: Select[tuple[OperationLog]], page: int, page_size: int
) -> PageResult[OperationLogRead]:
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(
        items=[OperationLogRead.model_validate(row) for row in rows],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


@router.get("", response_model=PageResult[OperationLogRead])
async def list_operation_logs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=500),
    action: str | None = None,
    target_type: str | None = None,
    user_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(OperationLog).options(selectinload(OperationLog.user)).order_by(OperationLog.id.desc())
    if action:
        stmt = stmt.where(OperationLog.action == action)
    if target_type:
        stmt = stmt.where(OperationLog.target_type == target_type)
    if user_id:
        stmt = stmt.where(OperationLog.user_id == user_id)
    if date_from:
        stmt = stmt.where(OperationLog.created_at >= datetime.combine(date_from, time.min))
    if date_to:
        stmt = stmt.where(OperationLog.created_at <= datetime.combine(date_to, time.max))
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(or_(OperationLog.summary.like(pattern), OperationLog.target_type.like(pattern)))
    return await paginate(db, stmt, page, page_size)
