from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.common import BatchDeleteRequest, PageResult
from app.schemas.user import ResetPasswordRequest, UserCreate, UserRead, UserUpdate
from app.utils.deps import require_roles
from app.utils.security import hash_password

router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(require_roles("admin"))])


async def paginate(db: AsyncSession, stmt: Select[tuple[User]], page: int, page_size: int) -> PageResult[UserRead]:
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(items=[UserRead.model_validate(row) for row in rows], total=total or 0, page=page, page_size=page_size)


@router.get("", response_model=PageResult[UserRead])
async def list_users(page: int = 1, page_size: int = 20, q: str | None = None, db: AsyncSession = Depends(get_db)):
    stmt = select(User).order_by(User.id.desc())
    if q:
        stmt = stmt.where(User.username.like(f"%{q}%") | User.real_name.like(f"%{q}%"))
    return await paginate(db, stmt, page, page_size)


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    user = User(**payload.model_dump(exclude={"password"}), password=hash_password(payload.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserRead)
async def update_user(user_id: int, payload: UserUpdate, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, key, value)
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/{user_id}/reset-password")
async def reset_password(user_id: int, payload: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    user.password = hash_password(payload.password)
    await db.commit()
    return {"message": "密码已重置"}


@router.delete("/{user_id}")
async def delete_user(user_id: int, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    await db.delete(user)
    await db.commit()
    return {"message": "用户已删除"}


@router.post("/batch-delete")
async def batch_delete_users(payload: BatchDeleteRequest, db: AsyncSession = Depends(get_db)):
    users = await db.scalars(select(User).where(User.id.in_(payload.ids)))
    count = 0
    for user in users:
        await db.delete(user)
        count += 1
    await db.commit()
    return {"message": f"已删除 {count} 个用户"}
