from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Any
from uuid import uuid4


@dataclass(frozen=True, slots=True)
class AuditContext:
    request_id: str
    user_id: int
    action: str
    target_type: str
    target_id: int | None
    summary: str
    detail: dict[str, Any] | None
    ip_address: str | None


_current_audit_context: ContextVar[AuditContext | None] = ContextVar(
    "current_audit_context",
    default=None,
)


def new_audit_context(
    *,
    user_id: int,
    action: str,
    target_type: str,
    target_id: int | None,
    summary: str,
    detail: dict[str, Any] | None,
    ip_address: str | None,
) -> AuditContext:
    return AuditContext(
        request_id=uuid4().hex,
        user_id=user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        summary=summary,
        detail=detail,
        ip_address=ip_address,
    )


def get_audit_context() -> AuditContext | None:
    return _current_audit_context.get()


def set_audit_context(context: AuditContext) -> Token[AuditContext | None]:
    return _current_audit_context.set(context)


def reset_audit_context(token: Token[AuditContext | None]) -> None:
    _current_audit_context.reset(token)
