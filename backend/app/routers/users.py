from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.exc import IntegrityError
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


async def count_other_active_admins(db: AsyncSession, exclude_id: int) -> int:
    return await db.scalar(
        select(func.count())
        .select_from(User)
        .where(User.role == "admin", User.is_active.is_(True), User.id != exclude_id)
    ) or 0


@router.get("", response_model=PageResult[UserRead])
async def list_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(User).order_by(User.id.desc())
    if q:
        stmt = stmt.where(or_(User.username.like(f"%{q}%"), User.real_name.like(f"%{q}%")))
    return await paginate(db, stmt, page, page_size)


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    user = User(**payload.model_dump(exclude={"password"}), password=hash_password(payload.password))
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在")
    await db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: int,
    payload: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")

    data = payload.model_dump(exclude_unset=True)
    # 防止管理员把自己降级或停用，导致无人可管理系统
    if user.id == current_user.id:
        if data.get("role") not in (None, "admin"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能修改自己的管理员角色")
        if data.get("is_active") is False:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能停用自己的账号")
    # 防止把最后一个启用的管理员降级或停用
    if user.role == "admin":
        downgrading = data.get("role") not in (None, "admin")
        deactivating = data.get("is_active") is False
        if (downgrading or deactivating) and await count_other_active_admins(db, user.id) == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="必须保留至少一个启用的管理员")

    for key, value in data.items():
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
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能删除自己的账号")
    if user.role == "admin" and await count_other_active_admins(db, user.id) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="必须保留至少一个启用的管理员")
    await db.delete(user)
    await db.commit()
    return {"message": "用户已删除"}


@router.post("/batch-delete")
async def batch_delete_users(
    payload: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    users = list(await db.scalars(select(User).where(User.id.in_(payload.ids))))
    deleted = 0
    skipped: list[dict[str, object]] = []
    for user in users:
        if user.id == current_user.id:
            skipped.append({"id": user.id, "reason": "不能删除自己的账号"})
            continue
        if user.role == "admin" and await count_other_active_admins(db, user.id) == 0:
            skipped.append({"id": user.id, "reason": "必须保留至少一个启用的管理员"})
            continue
        await db.delete(user)
        deleted += 1
    await db.commit()
    return {"deleted_count": deleted, "skipped": skipped}
