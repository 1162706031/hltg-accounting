from datetime import datetime
from typing import Any

from app.schemas.common import ORMModel
from app.schemas.user import UserRead


class OperationLogRead(ORMModel):
    id: int
    user_id: int
    action: str
    target_type: str
    target_id: int | None
    summary: str
    detail: dict[str, Any] | None
    ip_address: str | None
    created_at: datetime
    user: UserRead | None = None
