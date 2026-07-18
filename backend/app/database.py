from collections.abc import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Session

from app.config import get_settings
from app.utils.audit_context import get_audit_context


class Base(DeclarativeBase):
    pass


class AuditedSession(Session):
    """Sync session used internally by AsyncSession so audit rows share its transaction."""


@event.listens_for(AuditedSession, "before_commit")
def add_request_audit_log(session: AuditedSession) -> None:
    context = get_audit_context()
    if context is None or session.info.get("audit_request_id") == context.request_id:
        return

    # Imported lazily because OperationLog itself imports Base from this module.
    from app.models.operation_log import OperationLog

    session.add(
        OperationLog(
            user_id=context.user_id,
            action=context.action,
            target_type=context.target_type,
            target_id=context.target_id,
            summary=context.summary[:500],
            detail=context.detail,
            ip_address=context.ip_address,
        )
    )
    session.info["audit_request_id"] = context.request_id


@event.listens_for(AuditedSession, "after_rollback")
def clear_rolled_back_audit_marker(session: AuditedSession) -> None:
    # A few endpoints retry after an IntegrityError. The first audit row rolls
    # back with that transaction, so the retry must be allowed to add it again.
    session.info.pop("audit_request_id", None)


settings = get_settings()

engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    # 注意: 未启用 pool_pre_ping —— PyMySQL 1.2.0 + aiomysql 0.2.0 的
    # 异步 ping() 适配器签名与 SQLAlchemy 的 pre_ping 调用不兼容
    # (TypeError: ping() missing 'reconnect')。改用较短的连接回收周期主动
    # 淘汰可能失效的连接，避免命中服务端 wait_timeout 或中间网络的静默断连。
    pool_recycle=280,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    expire_on_commit=False,
    class_=AsyncSession,
    sync_session_class=AuditedSession,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
