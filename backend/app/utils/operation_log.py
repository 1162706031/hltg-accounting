from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.operation_log import OperationLog
from app.utils.auth import get_subject

SENSITIVE_KEYS = {"password", "access_token", "refresh_token", "token", "authorization"}

TARGET_TYPE_MAP = {
    "items": "item",
    "parties": "party",
    "users": "user",
    "inventory": "inventory",
    "payments": "payment",
    "invoices": "invoice",
    "reconciliations": "reconciliation",
    "smelting-orders": "smelting_order",
    "outsource-orders": "outsource_order",
    "procurement-orders": "procurement_order",
    "sales-orders": "sales_order",
}

ACTION_MAP = {
    "submit": "SUBMIT",
    "approve": "APPROVE",
    "reject": "REJECT",
    "complete": "COMPLETE",
    "unaudit": "UNAUDIT",
}

ACTION_LABELS = {
    "CREATE": "创建",
    "UPDATE": "更新",
    "DELETE": "删除",
    "SUBMIT": "提交审核",
    "APPROVE": "审核通过",
    "REJECT": "驳回",
    "COMPLETE": "完成",
    "UNAUDIT": "反审核",
    "LOGIN": "登录",
}


def mask_sensitive(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "***" if key.lower() in SENSITIVE_KEYS else mask_sensitive(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [mask_sensitive(item) for item in value]
    return value


async def parse_json_body(request: Request) -> Any | None:
    body = await request.body()
    if not body:
        return None
    content_type = request.headers.get("content-type", "")
    if "application/json" not in content_type:
        return {"_body": f"<{content_type or 'unknown'} {len(body)} bytes>"}
    try:
        return mask_sensitive(json.loads(body.decode("utf-8")))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {"_body": f"<invalid json {len(body)} bytes>"}


def get_user_id_from_request(request: Request) -> int | None:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    subject = get_subject(auth.split(" ", 1)[1])
    return int(subject) if subject and subject.isdigit() else None


def operation_context(request: Request) -> tuple[str, str | None, int | None]:
    settings = get_settings()
    raw_path = request.url.path
    path = raw_path
    if path.startswith(settings.api_prefix):
        path = path[len(settings.api_prefix) :]
    parts = [part for part in path.strip("/").split("/") if part]
    resource = parts[0] if parts else "unknown"
    target_type = TARGET_TYPE_MAP.get(resource)
    if target_type is None:
        return "UPDATE", None, None

    target_id = next((int(part) for part in parts[1:] if part.isdigit()), None)
    tail = parts[-1] if parts else ""
    method = request.method.upper()

    if tail in ACTION_MAP:
        action = ACTION_MAP[tail]
    elif tail in {"start", "status", "toggle-active", "reset-password", "adjust", "out"}:
        action = "UPDATE"
    elif tail in {"batch-delete"} or method == "DELETE":
        action = "DELETE"
    elif method == "POST":
        action = "CREATE"
    elif method in {"PUT", "PATCH"}:
        action = "UPDATE"
    else:
        action = "UPDATE"

    return action, target_type, target_id


def should_log_request(request: Request, status_code: int) -> bool:
    if status_code >= 400:
        return False
    if request.method.upper() not in {"POST", "PUT", "PATCH", "DELETE"}:
        return False
    path = request.url.path
    if "/operation-logs" in path:
        return False
    if path.endswith("/auth/login") or path.endswith("/auth/refresh"):
        return False
    action, target_type, _target_id = operation_context(request)
    return action is not None and target_type is not None


async def write_operation_log(
    db: AsyncSession,
    *,
    user_id: int,
    action: str,
    target_type: str,
    target_id: int | None = None,
    summary: str,
    detail: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> None:
    db.add(
        OperationLog(
            user_id=user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            summary=summary[:500],
            detail=detail,
            ip_address=ip_address,
        )
    )
    await db.commit()


async def operation_log_middleware(request: Request, call_next: Callable[[Request], Awaitable[Any]]) -> Any:
    body = await parse_json_body(request) if request.method.upper() in {"POST", "PUT", "PATCH", "DELETE"} else None
    response = await call_next(request)
    if not should_log_request(request, response.status_code):
        return response

    user_id = get_user_id_from_request(request)
    if user_id is None:
        return response

    action, target_type, target_id = operation_context(request)
    if target_type is None:
        return response

    path = request.url.path
    query = str(request.url.query) or None
    summary = f"{ACTION_LABELS.get(action, action)} {target_type}"
    if target_id is not None:
        summary += f" #{target_id}"

    detail = {
        "method": request.method.upper(),
        "path": path,
        "query": query,
        "status_code": response.status_code,
        "request": body,
    }
    try:
        async with AsyncSessionLocal() as db:
            await write_operation_log(
                db,
                user_id=user_id,
                action=action,
                target_type=target_type,
                target_id=target_id,
                summary=summary,
                detail=detail,
                ip_address=request.client.host if request.client else None,
            )
    except Exception:
        # 操作日志不能影响主业务请求；失败时静默跳过，由服务端日志/健康检查另行处理。
        return response

    return response
