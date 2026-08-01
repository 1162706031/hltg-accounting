import asyncio
import json
import re
from decimal import Decimal, InvalidOperation
from urllib import error as urlerror
from urllib import request as urlrequest

from app.config import Settings, get_settings
from app.schemas.item import CHEMICAL_ELEMENTS


class DifyCompositionError(Exception):
    """A safe, user-facing Dify composition error."""


class DifyCompositionNotConfiguredError(DifyCompositionError):
    pass


def build_workflow_payload(steel_grade: str, input_variable: str, user: str) -> dict:
    return {
        "inputs": {input_variable: steel_grade},
        "response_mode": "blocking",
        "user": user,
    }


def _decode_json_value(value):
    if not isinstance(value, str):
        return value
    text = value.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return value


def _find_composition_candidate(value, depth: int = 0):
    if depth > 6:
        return None
    value = _decode_json_value(value)
    if isinstance(value, dict):
        if "reasoning_content" in value:
            candidate = _find_composition_candidate(value["reasoning_content"], depth + 1)
            if candidate is not None:
                return candidate

        keys = set(value)
        if keys and keys <= set(CHEMICAL_ELEMENTS):
            return value

        for key in ("data", "outputs", "result", "text", "answer", "output"):
            if key in value:
                candidate = _find_composition_candidate(value[key], depth + 1)
                if candidate is not None:
                    return candidate

        for nested in value.values():
            candidate = _find_composition_candidate(nested, depth + 1)
            if candidate is not None:
                return candidate
    elif isinstance(value, list):
        for nested in value:
            candidate = _find_composition_candidate(nested, depth + 1)
            if candidate is not None:
                return candidate
    return None


def extract_dify_composition(payload: dict) -> dict[str, str]:
    candidate = _find_composition_candidate(payload)
    if not isinstance(candidate, dict):
        raise DifyCompositionError("Dify 没有返回可识别的化学成分数据")

    normalized: dict[str, str] = {}
    total = Decimal("0")
    has_non_zero = False
    for code in CHEMICAL_ELEMENTS:
        raw = candidate.get(code, 0)
        if isinstance(raw, bool):
            raise DifyCompositionError(f"Dify 返回的 {code} 成分格式不正确")
        try:
            amount = Decimal(str(raw))
        except (InvalidOperation, ValueError):
            raise DifyCompositionError(f"Dify 返回的 {code} 成分不是有效数字") from None
        if not amount.is_finite() or amount < 0 or amount > 100:
            raise DifyCompositionError(f"Dify 返回的 {code} 成分超出 0% 到 100% 范围")
        total += amount
        has_non_zero = has_non_zero or amount > 0
        normalized[code] = format(amount, "f")

    if total > 100:
        raise DifyCompositionError("Dify 返回的化学成分合计超过 100%")
    if not has_non_zero:
        raise DifyCompositionError("Dify 返回的化学成分全部为 0，请检查钢号或工作流")
    return normalized


def _read_http_error(exc: urlerror.HTTPError) -> str:
    try:
        payload = json.loads(exc.read().decode("utf-8"))
        return str(payload.get("message") or payload.get("detail") or exc.reason)
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return str(exc.reason)


def _run_workflow_request(settings: Settings, payload: dict) -> dict:
    url = f"{settings.dify_api_url.rstrip('/')}/workflows/run"
    request = urlrequest.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {settings.dify_api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            # Dify Cloud rejects urllib's default Python-urllib signature.
            # An explicit application identity keeps this a normal API request.
            "User-Agent": "HLTG-Accounting/1.0",
        },
        method="POST",
    )
    with urlrequest.urlopen(request, timeout=settings.dify_timeout_seconds) as response:
        return json.loads(response.read().decode("utf-8"))


async def generate_steel_composition(steel_grade: str, user: str) -> dict[str, str]:
    settings = get_settings()
    if not settings.dify_api_key:
        raise DifyCompositionNotConfiguredError("Dify 钢材成分 Workflow 尚未配置 API Key")
    input_variable = settings.dify_steel_input_variable.strip()
    if not input_variable:
        raise DifyCompositionNotConfiguredError("Dify Workflow 输入变量名尚未配置")

    payload = build_workflow_payload(steel_grade.strip(), input_variable, user)
    try:
        result = await asyncio.to_thread(_run_workflow_request, settings, payload)
    except urlerror.HTTPError as exc:
        raise DifyCompositionError(f"Dify Workflow 调用失败：{_read_http_error(exc)}") from exc
    except (urlerror.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise DifyCompositionError("Dify Workflow 暂时不可用，请稍后重试") from exc

    workflow_data = result.get("data") if isinstance(result, dict) else None
    if isinstance(workflow_data, dict) and workflow_data.get("status") == "failed":
        raise DifyCompositionError(f"Dify Workflow 执行失败：{workflow_data.get('error') or '未知错误'}")
    return extract_dify_composition(result)
