"""批次号自动生成。

设计 §6.5：前缀 + 自增序号，在事务内查询当前最大值 +1，避免并发重复。
- 冶炼: 3 开头 + 6 位 → 3000001
- 外协: 锻造=2 / 电渣=4 / 车光=5 / 退火=T，+ 6 位
- 采购: P + 4 位 → P0001
- 销售: S + 4 位 → S0001
- 炼钢记录: LG + 6 位 → LG000001
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def generate_batch_no(
    db: AsyncSession,
    *,
    column,
    prefix: str,
    width: int,
) -> str:
    """生成下一个批次号。

    取所有以 prefix 开头的批次号，截取前缀之后的数字串，在 Python 端求最大值 +1。
    （在 Python 端求最大可避免不同数据库方言 CAST 语法差异。）
    调用方须在同一事务内调用并尽快插入记录，以收窄并发窗口。
    """
    like_pattern = f"{prefix}%"
    numeric_part = func.substring(column, len(prefix) + 1)
    rows = await db.scalars(select(numeric_part).where(column.like(like_pattern)))

    max_seq = 0
    for value in rows:
        if value is None:
            continue
        try:
            max_seq = max(max_seq, int(value))
        except (TypeError, ValueError):
            continue

    return f"{prefix}{max_seq + 1:0{width}d}"
