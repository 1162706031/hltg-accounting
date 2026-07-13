import asyncio
import json
from datetime import date, timedelta
from decimal import Decimal
from urllib import error as urlerror
from urllib import request as urlrequest

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.outsource import OutsourceOrder
from app.models.finance import Invoice, Payment
from app.models.inventory import Inventory
from app.models.item import Item
from app.models.party import Party
from app.models.procurement import ProcurementOrder
from app.models.reconciliation import PartyReconciliation
from app.models.sales import SalesOrder
from app.models.smelting import SmeltingOrder
from app.models.steelmaking import SteelmakingRecord
from app.models.user import User
from app.config import get_settings
from app.services.party_balance import list_party_balances
from app.utils.deps import get_current_user, require_roles

router = APIRouter(prefix="/dashboard", tags=["dashboard"], dependencies=[Depends(get_current_user)])


class PendingAuditItem(BaseModel):
    order_kind: str  # smelting / outsource / procurement / sales
    order_id: int
    batch_no: str
    party_name: str | None
    amount: float | None
    created_by: int | None
    created_by_name: str | None
    created_at: str | None
    status: str


class DashboardStats(BaseModel):
    smelting_this_month: int
    outsource_this_month: int
    procurement_this_month: int
    sales_this_month: int
    pending_audit_count: int


class DashboardTrendPoint(BaseModel):
    date: date
    procurement: Decimal
    sales: Decimal
    production: int
    smelting: int
    outsource: int
    steelmaking: int


class DashboardInventoryItem(BaseModel):
    item_name: str
    unit: str
    quantity: Decimal


class DashboardRecentItem(BaseModel):
    kind: str
    kind_label: str
    record_id: int
    reference: str
    biz_date: date
    party_name: str | None = None
    amount: Decimal | None = None
    status: str
    path: str


class DashboardTodoItem(BaseModel):
    key: str
    label: str
    count: int
    level: str
    path: str


class DashboardOverview(BaseModel):
    date_from: date
    date_to: date
    procurement_count: int
    procurement_amount: Decimal
    sales_count: int
    sales_amount: Decimal
    smelting_count: int
    outsource_count: int
    steelmaking_count: int
    steelmaking_cost: Decimal
    cash_received: Decimal
    cash_paid: Decimal
    invoice_issued: Decimal
    invoice_received: Decimal
    receivable: Decimal
    payable: Decimal
    inventory_sku_count: int
    inventory_positive_count: int
    pending_audit_count: int
    trends: list[DashboardTrendPoint]
    inventory_distribution: list[DashboardInventoryItem]
    todos: list[DashboardTodoItem]
    recent: list[DashboardRecentItem]


class AiStatus(BaseModel):
    configured: bool
    reachable: bool
    provider: str
    message: str
    default_agent_role: str | None = None
    enabled_agent_roles: list[str] = Field(default_factory=list)


class AiSession(BaseModel):
    session_id: str
    expires_at: str
    agent_role: str
    available_agent_roles: list[str]


class AiStreamQuestion(BaseModel):
    session_id: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=4000)
    agent_role: str | None = Field(default=None, max_length=100)


# 业务类别 → (模型, 中文名)
_ORDER_KINDS = {
    "smelting": (SmeltingOrder, "冶炼"),
    "outsource": (OutsourceOrder, "外协"),
    "procurement": (ProcurementOrder, "采购"),
    "sales": (SalesOrder, "销售"),
}


async def _count_sum(
    db: AsyncSession,
    model,
    date_column,
    amount_column,
    date_from: date,
    date_to: date,
    *extra_conditions,
):
    row = await db.execute(
        select(func.count(model.id), func.coalesce(func.sum(amount_column), 0)).where(
            date_column >= date_from, date_column <= date_to, *extra_conditions
        )
    )
    count, amount = row.one()
    return int(count or 0), Decimal(amount or 0)


async def _group_amount(db: AsyncSession, model, date_column, amount_column, date_from: date, date_to: date):
    rows = await db.execute(
        select(date_column, func.coalesce(func.sum(amount_column), 0))
        .where(date_column >= date_from, date_column <= date_to)
        .group_by(date_column)
    )
    return {row[0]: Decimal(row[1] or 0) for row in rows if row[0] is not None}


async def _group_count(db: AsyncSession, model, date_column, date_from: date, date_to: date, *extra_conditions):
    rows = await db.execute(
        select(date_column, func.count(model.id))
        .where(date_column >= date_from, date_column <= date_to, *extra_conditions)
        .group_by(date_column)
    )
    return {row[0]: int(row[1] or 0) for row in rows if row[0] is not None}


@router.get("/stats", response_model=DashboardStats)
async def get_stats(db: AsyncSession = Depends(get_db)):
    today = date.today()
    month_start = today.replace(day=1)

    async def count_month(model) -> int:
        return await db.scalar(
            select(func.count()).select_from(model).where(model.created_at >= month_start)
        ) or 0

    async def count_pending(model) -> int:
        return await db.scalar(
            select(func.count()).select_from(model).where(model.status == "pending_review")
        ) or 0

    pending = 0
    for model, _ in _ORDER_KINDS.values():
        pending += await count_pending(model)

    return DashboardStats(
        smelting_this_month=await count_month(SmeltingOrder),
        outsource_this_month=await count_month(OutsourceOrder),
        procurement_this_month=await count_month(ProcurementOrder),
        sales_this_month=await count_month(SalesOrder),
        pending_audit_count=pending,
    )


@router.get("/overview", response_model=DashboardOverview)
async def dashboard_overview(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    date_to = date_to or date.today()
    date_from = date_from or (date_to - timedelta(days=29))
    if date_from > date_to:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="开始日期不能晚于结束日期")
    if (date_to - date_from).days > 366:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="工作台时间范围最长为 366 天")

    procurement_count, procurement_amount = await _count_sum(
        db, ProcurementOrder, ProcurementOrder.purchase_date, ProcurementOrder.total_amount, date_from, date_to
    )
    sales_count, sales_amount = await _count_sum(
        db, SalesOrder, SalesOrder.ship_date, SalesOrder.total_amount, date_from, date_to
    )
    smelting_count = await db.scalar(
        select(func.count(SmeltingOrder.id)).where(SmeltingOrder.feed_date >= date_from, SmeltingOrder.feed_date <= date_to)
    ) or 0
    outsource_count = await db.scalar(
        select(func.count(OutsourceOrder.id)).where(OutsourceOrder.out_date >= date_from, OutsourceOrder.out_date <= date_to)
    ) or 0
    steelmaking_count, steelmaking_cost = await _count_sum(
        db,
        SteelmakingRecord,
        SteelmakingRecord.record_date,
        SteelmakingRecord.total_cost,
        date_from,
        date_to,
        SteelmakingRecord.deleted.is_(False),
    )

    cash_received = await db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.direction == "pay", Payment.pay_date >= date_from, Payment.pay_date <= date_to
        )
    ) or Decimal("0")
    cash_paid = await db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.direction == "receive", Payment.pay_date >= date_from, Payment.pay_date <= date_to
        )
    ) or Decimal("0")
    invoice_issued = await db.scalar(
        select(func.coalesce(func.sum(Invoice.amount), 0)).where(
            Invoice.direction == "issue", Invoice.invoice_date >= date_from, Invoice.invoice_date <= date_to
        )
    ) or Decimal("0")
    invoice_received = await db.scalar(
        select(func.coalesce(func.sum(Invoice.amount), 0)).where(
            Invoice.direction == "receive", Invoice.invoice_date >= date_from, Invoice.invoice_date <= date_to
        )
    ) or Decimal("0")
    recon = await db.execute(
        select(
            func.coalesce(func.sum(PartyReconciliation.debit), 0),
            func.coalesce(func.sum(PartyReconciliation.credit), 0),
        ).where(
            PartyReconciliation.biz_date >= date_from,
            PartyReconciliation.biz_date <= date_to,
            PartyReconciliation.recon_status.in_(("unreconciled", "verified")),
        )
    )
    receivable, payable = recon.one()

    inventory_sku_count = await db.scalar(select(func.count(Inventory.id))) or 0
    inventory_positive_count = await db.scalar(
        select(func.count(Inventory.id)).where(Inventory.current_quantity > 0)
    ) or 0
    pending_audit_count = 0
    for model, _label in _ORDER_KINDS.values():
        pending_audit_count += int(
            await db.scalar(select(func.count(model.id)).where(model.status == "pending_review")) or 0
        )
    unreconciled_count = await db.scalar(
        select(func.count(PartyReconciliation.id)).where(PartyReconciliation.recon_status == "unreconciled")
    ) or 0
    incomplete_cost_count = await db.scalar(
        select(func.count(SteelmakingRecord.id)).where(
            SteelmakingRecord.deleted.is_(False),
            SteelmakingRecord.cost_complete.is_(False),
            SteelmakingRecord.record_date >= date_from,
            SteelmakingRecord.record_date <= date_to,
        )
    ) or 0
    zero_inventory_count = int(inventory_sku_count) - int(inventory_positive_count)
    inventory_quantity = func.coalesce(func.sum(Inventory.current_quantity), 0).label("quantity")
    inventory_name = func.coalesce(Item.name, "未关联物品").label("item_name")
    inventory_rows = await db.execute(
        select(inventory_name, Inventory.unit, inventory_quantity)
        .join(Item, Item.id == Inventory.item_id, isouter=True)
        .where(Inventory.current_quantity > 0)
        .group_by(inventory_name, Inventory.unit)
        .order_by(inventory_quantity.desc())
        .limit(10)
    )
    inventory_distribution = [
        DashboardInventoryItem(item_name=row.item_name, unit=row.unit, quantity=Decimal(row.quantity or 0))
        for row in inventory_rows
    ]

    procurement_trend = await _group_amount(
        db, ProcurementOrder, ProcurementOrder.purchase_date, ProcurementOrder.total_amount, date_from, date_to
    )
    sales_trend = await _group_amount(
        db, SalesOrder, SalesOrder.ship_date, SalesOrder.total_amount, date_from, date_to
    )
    smelting_trend = await _group_count(db, SmeltingOrder, SmeltingOrder.feed_date, date_from, date_to)
    outsource_trend = await _group_count(db, OutsourceOrder, OutsourceOrder.out_date, date_from, date_to)
    steelmaking_trend = await _group_count(
        db,
        SteelmakingRecord,
        SteelmakingRecord.record_date,
        date_from,
        date_to,
        SteelmakingRecord.deleted.is_(False),
    )
    trends = []
    cursor = date_from
    while cursor <= date_to:
        trends.append(
            DashboardTrendPoint(
                date=cursor,
                procurement=procurement_trend.get(cursor, Decimal("0")),
                sales=sales_trend.get(cursor, Decimal("0")),
                production=(
                    smelting_trend.get(cursor, 0)
                    + outsource_trend.get(cursor, 0)
                    + steelmaking_trend.get(cursor, 0)
                ),
                smelting=smelting_trend.get(cursor, 0),
                outsource=outsource_trend.get(cursor, 0),
                steelmaking=steelmaking_trend.get(cursor, 0),
            )
        )
        cursor += timedelta(days=1)

    recent: list[DashboardRecentItem] = []
    recent_specs = (
        ("procurement", "采购", ProcurementOrder, ProcurementOrder.purchase_date, "/procurement"),
        ("sales", "销售", SalesOrder, SalesOrder.ship_date, "/sales"),
        ("smelting", "冶炼", SmeltingOrder, SmeltingOrder.feed_date, "/smelting"),
        ("outsource", "外协", OutsourceOrder, OutsourceOrder.out_date, "/outsource"),
    )
    for kind, label, model, biz_date_column, path in recent_specs:
        rows = await db.execute(
            select(
                model.id,
                model.batch_no,
                biz_date_column.label("biz_date"),
                model.total_amount,
                model.status,
                Party.name.label("party_name"),
            )
            .join(Party, Party.id == model.party_id, isouter=True)
            .where(biz_date_column >= date_from, biz_date_column <= date_to)
            .order_by(biz_date_column.desc(), model.id.desc())
            .limit(6)
        )
        for row in rows:
            recent.append(
                DashboardRecentItem(
                    kind=kind,
                    kind_label=label,
                    record_id=row.id,
                    reference=row.batch_no,
                    biz_date=row.biz_date,
                    party_name=row.party_name,
                    amount=row.total_amount,
                    status=row.status,
                    path=path,
                )
            )
    steel_rows = await db.execute(
        select(
            SteelmakingRecord.id,
            SteelmakingRecord.furnace_no,
            SteelmakingRecord.record_date,
            SteelmakingRecord.total_cost,
            SteelmakingRecord.status,
        )
        .where(
            SteelmakingRecord.deleted.is_(False),
            SteelmakingRecord.record_date >= date_from,
            SteelmakingRecord.record_date <= date_to,
        )
        .order_by(SteelmakingRecord.record_date.desc(), SteelmakingRecord.id.desc())
        .limit(6)
    )
    for row in steel_rows:
        recent.append(
            DashboardRecentItem(
                kind="steelmaking",
                kind_label="炼钢记录",
                record_id=row.id,
                reference=row.furnace_no,
                biz_date=row.record_date,
                amount=row.total_cost,
                status=row.status,
                path="/steelmaking-records",
            )
        )
    recent.sort(key=lambda item: (item.biz_date, item.record_id), reverse=True)

    return DashboardOverview(
        date_from=date_from,
        date_to=date_to,
        procurement_count=procurement_count,
        procurement_amount=procurement_amount,
        sales_count=sales_count,
        sales_amount=sales_amount,
        smelting_count=int(smelting_count),
        outsource_count=int(outsource_count),
        steelmaking_count=steelmaking_count,
        steelmaking_cost=steelmaking_cost,
        cash_received=Decimal(cash_received),
        cash_paid=Decimal(cash_paid),
        invoice_issued=Decimal(invoice_issued),
        invoice_received=Decimal(invoice_received),
        receivable=Decimal(receivable or 0),
        payable=Decimal(payable or 0),
        inventory_sku_count=int(inventory_sku_count),
        inventory_positive_count=int(inventory_positive_count),
        pending_audit_count=pending_audit_count,
        trends=trends,
        inventory_distribution=inventory_distribution,
        todos=[
            DashboardTodoItem(key="audit", label="待审核订单", count=pending_audit_count, level="warning", path="/audit"),
            DashboardTodoItem(key="reconciliation", label="未对账明细", count=int(unreconciled_count), level="info", path="/reconciliation"),
            DashboardTodoItem(key="steel-cost", label="成本不完整炼钢记录", count=int(incomplete_cost_count), level="error", path="/steelmaking-records"),
            DashboardTodoItem(key="inventory", label="零结余库存项", count=zero_inventory_count, level="default", path="/inventory"),
        ],
        recent=recent[:10],
    )


@router.get("/ai/status", response_model=AiStatus)
async def ai_status():
    settings = get_settings()
    configured = bool(settings.ai_agent_url and settings.ai_agent_api_key)
    if not configured:
        return AiStatus(
            configured=False,
            reachable=False,
            provider=settings.ai_agent_provider,
            message="尚未配置 AgentScope 服务地址和 API Key",
        )
    try:
        health = await asyncio.to_thread(_request_agent_json, "/health", None, min(settings.ai_agent_timeout_seconds, 3))
    except (urlerror.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return AiStatus(
            configured=True,
            reachable=False,
            provider=settings.ai_agent_provider,
            message="AgentScope 配置已保存，但当前服务不可达",
        )
    return AiStatus(
        configured=True,
        reachable=health.get("status") == "healthy",
        provider=settings.ai_agent_provider,
        message="AgentScope 流式服务已连接",
        default_agent_role=health.get("default_agent_role"),
        enabled_agent_roles=health.get("enabled_agent_roles") or [],
    )


def _agent_url(path: str) -> str:
    settings = get_settings()
    if not settings.ai_agent_url:
        raise RuntimeError("AgentScope is not configured")
    return f"{settings.ai_agent_url.rstrip('/')}{path}"


def _request_agent_json(path: str, payload: dict | None = None, timeout: int | None = None) -> dict:
    settings = get_settings()
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    req = urlrequest.Request(
        _agent_url(path),
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None,
        headers=headers,
        method="POST" if payload is not None else "GET",
    )
    with urlrequest.urlopen(req, timeout=timeout or settings.ai_agent_timeout_seconds) as response:
        body = response.read().decode("utf-8")
    return json.loads(body)


@router.post("/ai/session", response_model=AiSession)
async def create_ai_session():
    settings = get_settings()
    if not settings.ai_agent_url or not settings.ai_agent_api_key:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="AgentScope 智能体尚未配置")
    try:
        result = await asyncio.to_thread(
            _request_agent_json,
            "/auth",
            {"api_key": settings.ai_agent_api_key, "agent_role": settings.ai_agent_role},
        )
    except urlerror.HTTPError as exc:
        detail = _read_agent_error(exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"AgentScope 认证失败：{detail}") from exc
    except (urlerror.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="AgentScope 服务暂时不可用") from exc
    return AiSession.model_validate(result)


def _read_agent_error(exc: urlerror.HTTPError) -> str:
    try:
        payload = json.loads(exc.read().decode("utf-8"))
        detail = payload.get("detail", "")
        if isinstance(detail, dict):
            return str(detail.get("message") or detail)
        return str(detail or exc.reason)
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return str(exc.reason)


def _open_agent_stream(payload: dict):
    settings = get_settings()
    req = urlrequest.Request(
        _agent_url("/chat/stream"),
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
        method="POST",
    )
    return urlrequest.urlopen(req, timeout=settings.ai_agent_timeout_seconds)


@router.post("/ai/stream", response_class=StreamingResponse)
async def stream_ai_chat(question: AiStreamQuestion):
    settings = get_settings()
    if not settings.ai_agent_url or not settings.ai_agent_api_key:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="AgentScope 智能体尚未配置")
    payload = {
        "session_id": question.session_id,
        "message": question.message.strip(),
        "agent_role": question.agent_role or settings.ai_agent_role,
    }
    try:
        upstream = await asyncio.to_thread(_open_agent_stream, payload)
    except urlerror.HTTPError as exc:
        detail = _read_agent_error(exc)
        code = status.HTTP_409_CONFLICT if exc.code == 404 else status.HTTP_502_BAD_GATEWAY
        raise HTTPException(status_code=code, detail=detail) from exc
    except (urlerror.URLError, TimeoutError, OSError) as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="AgentScope 流式服务暂时不可用") from exc

    async def forward_events():
        try:
            while True:
                line = await asyncio.to_thread(upstream.readline)
                if not line:
                    break
                yield line
        finally:
            upstream.close()

    return StreamingResponse(
        forward_events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/party-balances")
async def party_balances(db: AsyncSession = Depends(get_db)):
    """各往来单位余额。"""
    return await list_party_balances(db)


@router.get("/pending-audits", response_model=list[PendingAuditItem])
async def pending_audits(
    kind: str | None = Query(default=None, description="smelting/outsource/procurement/sales，空=全部"),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("reviewer", "admin")),
):
    """审核中心：聚合 4 类订单的待审核(pending_review)记录。"""
    from app.models.party import Party

    kinds = {kind: _ORDER_KINDS[kind]} if kind in _ORDER_KINDS else _ORDER_KINDS

    items: list[PendingAuditItem] = []
    for order_kind, (model, _name) in kinds.items():
        stmt = (
            select(
                model.id,
                model.batch_no,
                model.created_by,
                func.coalesce(User.real_name, User.username).label("created_by_name"),
                model.created_at,
                model.status,
                model.total_amount.label("amount"),
                Party.name.label("party_name"),
            )
            .join(Party, Party.id == model.party_id, isouter=True)
            .join(User, User.id == model.created_by, isouter=True)
            .where(model.status == "pending_review")
            .order_by(model.created_at.asc())
        )
        rows = await db.execute(stmt)
        for row in rows:
            m = row._mapping
            items.append(
                PendingAuditItem(
                    order_kind=order_kind,
                    order_id=m["id"],
                    batch_no=m["batch_no"],
                    party_name=m["party_name"],
                    amount=float(m["amount"]) if m["amount"] is not None else None,
                    created_by=m["created_by"],
                    created_by_name=m["created_by_name"],
                    created_at=m["created_at"].isoformat() if m["created_at"] else None,
                    status=m["status"],
                )
            )

    items.sort(key=lambda x: x.created_at or "")
    return items
