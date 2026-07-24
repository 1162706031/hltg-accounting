from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.user import User
from app.schemas.auth import LoginRequest, LoginResponse, RefreshRequest, TokenPair
from app.schemas.common import MessageResponse
from app.schemas.user import ChangePasswordRequest, ProfileUpdate, UserRead
from app.utils.auth import create_token, get_subject
from app.utils.deps import get_current_user
from app.utils.operation_log import write_operation_log
from app.utils.security import hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


def build_token_pair(user: User) -> TokenPair:
    subject = str(user.id)
    return TokenPair(
        access_token=create_token(subject, settings.access_token_minutes, "access", {"role": user.role}),
        refresh_token=create_token(subject, settings.refresh_token_minutes, "refresh", {"role": user.role}),
    )


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> LoginResponse:
    result = await db.execute(select(User).where(User.username == payload.username))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="用户已停用")

    tokens = build_token_pair(user)
    await write_operation_log(
        db,
        user_id=user.id,
        action="LOGIN",
        target_type="user",
        target_id=user.id,
        summary=f"登录 user #{user.id}",
        detail={"username": user.username},
    )
    return LoginResponse(**tokens.model_dump(), user=UserRead.model_validate(user))


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenPair:
    subject = get_subject(payload.refresh_token, expected_type="refresh")
    if subject is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="刷新令牌无效")

    user = await db.get(User, int(subject))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在或已停用")
    return build_token_pair(user)


@router.get("/me", response_model=UserRead)
async def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.put("/me", response_model=UserRead)
async def update_profile(
    payload: ProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    user = await db.get(User, current_user.id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在或已停用")

    user.real_name = payload.real_name.strip() if payload.real_name and payload.real_name.strip() else None
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/change-password", response_model=MessageResponse)
async def change_password(
    payload: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MessageResponse:
    user = await db.get(User, current_user.id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在或已停用")
    if not verify_password(payload.current_password, user.password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前密码不正确")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="新密码不能与当前密码相同")

    user.password = hash_password(payload.new_password)
    await db.commit()
    return MessageResponse(message="密码已修改")
