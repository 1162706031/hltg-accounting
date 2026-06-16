from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.user import User
from app.schemas.auth import LoginRequest, LoginResponse, RefreshRequest, TokenPair
from app.schemas.user import UserRead
from app.utils.auth import create_token, get_subject
from app.utils.deps import get_current_user
from app.utils.operation_log import write_operation_log
from app.utils.security import verify_password

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
