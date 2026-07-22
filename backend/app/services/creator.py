from collections.abc import Iterable
from datetime import date, datetime, time
from typing import TypeVar

from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


SchemaT = TypeVar("SchemaT", bound=BaseModel)


def apply_creation_filters(
    stmt,
    model,
    *,
    created_by: int | None = None,
    created_by_name: str | None = None,
    created_at_from: date | None = None,
    created_at_to: date | None = None,
):
    """给带 created_by/created_at 的业务查询统一增加创建信息筛选。"""
    if created_by is not None:
        stmt = stmt.where(model.created_by == created_by)
    creator_query = (created_by_name or "").strip()
    if creator_query:
        like = f"%{creator_query}%"
        stmt = stmt.where(
            model.created_by.in_(
                select(User.id).where(
                    or_(User.real_name.like(like), User.username.like(like))
                )
            )
        )
    if created_at_from:
        stmt = stmt.where(model.created_at >= datetime.combine(created_at_from, time.min))
    if created_at_to:
        stmt = stmt.where(model.created_at <= datetime.combine(created_at_to, time.max))
    return stmt


async def serialize_with_creator_names(
    db: AsyncSession,
    records: Iterable[object],
    schema_type: type[SchemaT],
) -> list[SchemaT]:
    """批量补充创建人显示名，避免每条订单单独查询用户。"""
    rows = list(records)
    creator_ids = {
        created_by
        for row in rows
        if (created_by := getattr(row, "created_by", None)) is not None
    }
    names: dict[int, str] = {}
    if creator_ids:
        user_rows = (
            await db.execute(
                select(User.id, User.real_name, User.username).where(User.id.in_(creator_ids))
            )
        ).all()
        names = {
            user_id: real_name or username
            for user_id, real_name, username in user_rows
        }
    return [
        schema_type.model_validate(row).model_copy(
            update={"created_by_name": names.get(getattr(row, "created_by", None))}
        )
        for row in rows
    ]
