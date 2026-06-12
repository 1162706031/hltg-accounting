from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    pass


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

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
