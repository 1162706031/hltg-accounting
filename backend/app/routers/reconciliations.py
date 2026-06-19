import calendar
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.outsource import OutsourceOrder, ProcessingInbound, ProcessingOutbound
from app.models.party import Party
from app.models.procurement import ProcurementOrder
from app.models.reconciliation import PartyReconciliation
from app.models.sales import SalesOrder, SalesOrderItem
from app.models.smelting import SmeltingInbound, SmeltingOrder
from app.models.user import User
from app.schemas.common import BatchDeleteRequest, PageResult
from app.schemas.reconciliation import (
    PartyBalanceRead,
    ReconciliationImportCandidate,
    ReconciliationImportRequest,
    ReconciliationImportResult,
    ReconciliationCreate,
    ReconciliationRead,
    ReconciliationStatusUpdate,
    ReconciliationUpdate,
)
from app.services.party_balance import list_party_balances as load_party_balances
from app.utils.deps import get_current_user, require_roles

router = APIRouter(prefix="/reconciliations", tags=["reconciliations"], dependencies=[Depends(get_current_user)])

IMPORTABLE_STATUSES = ("approved", "completed")
PROCESS_LABELS = {"forging": "锻造", "esr": "电渣", "turning": "车加工", "annealing": "退火"}


async def paginate(
    db: AsyncSession, stmt: Select[tuple[PartyReconciliation]], page: int, page_size: int
) -> PageResult[ReconciliationRead]:
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    return PageResult(items=[ReconciliationRead.model_validate(row) for row in rows], total=total or 0, page=page, page_size=page_size)


async def load_reconciliation(db: AsyncSession, reconciliation_id: int) -> PartyReconciliation:
    row = await db.scalar(
        select(PartyReconciliation)
        .where(PartyReconciliation.id == reconciliation_id)
        .options(selectinload(PartyReconciliation.party))
    )
    if row is None:
        raise HTTPException(status_code=404, detail="对账行不存在")
    return row


@router.get("", response_model=PageResult[ReconciliationRead])
async def list_reconciliations(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    party_id: int | None = None,
    recon_status: str | None = None,
    period: str | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(PartyReconciliation)
        .options(selectinload(PartyReconciliation.party))
        .order_by(PartyReconciliation.biz_date.desc(), PartyReconciliation.id.desc())
    )
    if party_id:
        stmt = stmt.where(PartyReconciliation.party_id == party_id)
    if recon_status:
        stmt = stmt.where(PartyReconciliation.recon_status == recon_status)
    if period:
        stmt = stmt.where(PartyReconciliation.period == period)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                PartyReconciliation.biz_desc.like(like),
                PartyReconciliation.steel_grade.like(like),
                PartyReconciliation.notes.like(like),
            )
        )
    return await paginate(db, stmt, page, page_size)


@router.post("", response_model=ReconciliationRead, status_code=status.HTTP_201_CREATED)
async def create_reconciliation(
    payload: ReconciliationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "accountant")),
):
    if await db.get(Party, payload.party_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="往来单位不存在")
    row = PartyReconciliation(**payload.model_dump(), created_by=current_user.id)
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该订单已导入过对账，请勿重复导入")
    return await load_reconciliation(db, row.id)


def _money(value: Decimal | int | float | None) -> Decimal:
    return Decimal(value or 0).quantize(Decimal("0.01"))


def _quantity(value: Decimal | int | float | None) -> Decimal:
    return Decimal(value or 0).quantize(Decimal("0.001"))


def _period_from_date(value: date | None) -> tuple[str, date | None, date | None]:
    if value is None:
        return "未定账期", None, None
    last_day = calendar.monthrange(value.year, value.month)[1]
    return f"{value.year}年{value.month}月", date(value.year, value.month, 1), date(value.year, value.month, last_day)


def _invoice_fields(need_invoice: bool, direction: str, amount: Decimal) -> tuple[str | None, Decimal | None]:
    if not need_invoice or amount <= 0:
        return None, None
    return direction, amount


async def _imported_ids(db: AsyncSession, ref_type: str) -> set[int]:
    rows = await db.scalars(
        select(PartyReconciliation.ref_id).where(
            PartyReconciliation.ref_type == ref_type, PartyReconciliation.ref_id.is_not(None)
        )
    )
    return {int(row) for row in rows if row is not None}


async def _smelting_candidates(
    db: AsyncSession, party_id: int | None = None, q: str | None = None, order_ids: list[int] | None = None
) -> list[ReconciliationImportCandidate]:
    total_out_qty = (
        select(func.coalesce(func.sum(SmeltingInbound.quantity), 0))
        .where(SmeltingInbound.order_id == SmeltingOrder.id, SmeltingInbound.side == "out")
        .correlate(SmeltingOrder)
        .scalar_subquery()
    )
    stmt = (
        select(SmeltingOrder, total_out_qty.label("quantity"))
        .options(selectinload(SmeltingOrder.party))
        .where(
            SmeltingOrder.order_type == "ext_smelting",
            SmeltingOrder.status.in_(IMPORTABLE_STATUSES),
            ~exists().where(
                PartyReconciliation.ref_type == "smelting_order",
                PartyReconciliation.ref_id == SmeltingOrder.id,
            ),
        )
        .order_by(SmeltingOrder.id.desc())
    )
    if party_id:
        stmt = stmt.where(SmeltingOrder.party_id == party_id)
    if q:
        stmt = stmt.where(SmeltingOrder.batch_no.like(f"%{q}%"))
    if order_ids is not None:
        stmt = stmt.where(SmeltingOrder.id.in_(order_ids))

    result = await db.execute(stmt)
    candidates: list[ReconciliationImportCandidate] = []
    for order, quantity in result:
        amount = _money(order.total_amount)
        invoice_direction, invoice_amount = _invoice_fields(order.need_invoice, "issue", amount)
        candidates.append(
            ReconciliationImportCandidate(
                order_type="smelting_order",
                order_id=order.id,
                type_label="冶炼",
                batch_no=order.batch_no,
                party_id=order.party_id,
                party_name=order.party.name if order.party else f"#{order.party_id}",
                biz_date=order.tap_date or order.feed_date,
                amount=amount,
                biz_desc="冶炼加工费+合金",
                quantity=_quantity(quantity),
                unit="吨",
                unit_price=order.unit_price,
                debit=amount,
                credit=Decimal("0.00"),
                invoice_direction=invoice_direction,
                invoice_amount=invoice_amount,
                need_invoice=order.need_invoice,
            )
        )
    return candidates


async def _outsource_candidates(
    db: AsyncSession, party_id: int | None = None, q: str | None = None, order_ids: list[int] | None = None
) -> list[ReconciliationImportCandidate]:
    total_in_qty = (
        select(func.coalesce(func.sum(ProcessingInbound.quantity), 0))
        .where(ProcessingInbound.order_id == OutsourceOrder.id)
        .correlate(OutsourceOrder)
        .scalar_subquery()
    )
    total_out_qty = (
        select(func.coalesce(func.sum(ProcessingOutbound.quantity), 0))
        .where(ProcessingOutbound.order_id == OutsourceOrder.id)
        .correlate(OutsourceOrder)
        .scalar_subquery()
    )
    quantity_expr = func.greatest(total_in_qty, total_out_qty)
    stmt = (
        select(OutsourceOrder, quantity_expr.label("quantity"))
        .options(selectinload(OutsourceOrder.party))
        .where(
            OutsourceOrder.status.in_(IMPORTABLE_STATUSES),
            ~exists().where(
                PartyReconciliation.ref_type == "outsource_order",
                PartyReconciliation.ref_id == OutsourceOrder.id,
            ),
        )
        .order_by(OutsourceOrder.id.desc())
    )
    if party_id:
        stmt = stmt.where(OutsourceOrder.party_id == party_id)
    if q:
        stmt = stmt.where(OutsourceOrder.batch_no.like(f"%{q}%"))
    if order_ids is not None:
        stmt = stmt.where(OutsourceOrder.id.in_(order_ids))

    result = await db.execute(stmt)
    candidates: list[ReconciliationImportCandidate] = []
    for order, quantity in result:
        amount = _money(order.total_amount)
        invoice_direction, invoice_amount = _invoice_fields(order.need_invoice, "receive", amount)
        process_label = PROCESS_LABELS.get(order.process_type, order.process_type)
        candidates.append(
            ReconciliationImportCandidate(
                order_type="outsource_order",
                order_id=order.id,
                type_label="外协",
                batch_no=order.batch_no,
                party_id=order.party_id,
                party_name=order.party.name if order.party else f"#{order.party_id}",
                biz_date=order.in_date or order.out_date,
                amount=amount,
                biz_desc=f"{process_label}加工费",
                quantity=_quantity(quantity),
                unit="吨",
                unit_price=order.unit_price,
                debit=Decimal("0.00"),
                credit=amount,
                invoice_direction=invoice_direction,
                invoice_amount=invoice_amount,
                need_invoice=order.need_invoice,
            )
        )
    return candidates


async def _procurement_candidates(
    db: AsyncSession, party_id: int | None = None, q: str | None = None, order_ids: list[int] | None = None
) -> list[ReconciliationImportCandidate]:
    stmt = (
        select(ProcurementOrder)
        .options(selectinload(ProcurementOrder.party), selectinload(ProcurementOrder.item))
        .where(
            ProcurementOrder.status.in_(IMPORTABLE_STATUSES),
            ~exists().where(
                PartyReconciliation.ref_type == "procurement_order",
                PartyReconciliation.ref_id == ProcurementOrder.id,
            ),
        )
        .order_by(ProcurementOrder.id.desc())
    )
    if party_id:
        stmt = stmt.where(ProcurementOrder.party_id == party_id)
    if q:
        stmt = stmt.where(ProcurementOrder.batch_no.like(f"%{q}%"))
    if order_ids is not None:
        stmt = stmt.where(ProcurementOrder.id.in_(order_ids))

    rows = await db.scalars(stmt)
    candidates: list[ReconciliationImportCandidate] = []
    for order in rows:
        amount = _money(order.total_amount)
        invoice_direction, invoice_amount = _invoice_fields(order.need_invoice, "receive", amount)
        item_name = order.item.name if order.item else order.item_spec
        candidates.append(
            ReconciliationImportCandidate(
                order_type="procurement_order",
                order_id=order.id,
                type_label="采购",
                batch_no=order.batch_no,
                party_id=order.party_id,
                party_name=order.party.name if order.party else f"#{order.party_id}",
                biz_date=order.purchase_date,
                amount=amount,
                biz_desc=f"采购{item_name or ''}",
                steel_grade=item_name,
                quantity=_quantity(order.quantity),
                unit=order.unit,
                unit_price=order.unit_price,
                debit=Decimal("0.00"),
                credit=amount,
                invoice_direction=invoice_direction,
                invoice_amount=invoice_amount,
                need_invoice=order.need_invoice,
            )
        )
    return candidates


async def _sales_candidates(
    db: AsyncSession, party_id: int | None = None, q: str | None = None, order_ids: list[int] | None = None
) -> list[ReconciliationImportCandidate]:
    stmt = (
        select(SalesOrder)
        .options(
            selectinload(SalesOrder.party),
            selectinload(SalesOrder.items).selectinload(SalesOrderItem.item),
        )
        .where(
            SalesOrder.status.in_(IMPORTABLE_STATUSES),
            ~exists().where(
                PartyReconciliation.ref_type == "sales_order",
                PartyReconciliation.ref_id == SalesOrder.id,
            ),
        )
        .order_by(SalesOrder.id.desc())
    )
    if party_id:
        stmt = stmt.where(SalesOrder.party_id == party_id)
    if q:
        stmt = stmt.where(SalesOrder.batch_no.like(f"%{q}%"))
    if order_ids is not None:
        stmt = stmt.where(SalesOrder.id.in_(order_ids))

    rows = await db.scalars(stmt)
    candidates: list[ReconciliationImportCandidate] = []
    for order in rows:
        amount = _money(order.total_amount)
        invoice_direction, invoice_amount = _invoice_fields(order.need_invoice, "issue", amount)
        first_item = next((line.item.name for line in order.items if line.item), None)
        total_quantity = sum((Decimal(line.quantity or 0) for line in order.items), Decimal("0"))
        unit = order.items[0].unit if len(order.items) == 1 else "吨"
        candidates.append(
            ReconciliationImportCandidate(
                order_type="sales_order",
                order_id=order.id,
                type_label="销售",
                batch_no=order.batch_no,
                party_id=order.party_id,
                party_name=order.party.name if order.party else f"#{order.party_id}",
                biz_date=order.ship_date,
                amount=amount,
                biz_desc=f"销售{first_item or '货品'}",
                steel_grade=first_item,
                quantity=_quantity(total_quantity),
                unit=unit,
                unit_price=order.items[0].unit_price if len(order.items) == 1 else None,
                debit=amount,
                credit=Decimal("0.00"),
                invoice_direction=invoice_direction,
                invoice_amount=invoice_amount,
                need_invoice=order.need_invoice,
            )
        )
    return candidates


async def _load_import_candidates(
    db: AsyncSession,
    order_type: str = "all",
    party_id: int | None = None,
    q: str | None = None,
    order_ids: list[int] | None = None,
) -> list[ReconciliationImportCandidate]:
    loaders = {
        "smelting_order": _smelting_candidates,
        "outsource_order": _outsource_candidates,
        "procurement_order": _procurement_candidates,
        "sales_order": _sales_candidates,
    }
    if order_type != "all":
        if order_type not in loaders:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的订单类型")
        return await loaders[order_type](db, party_id=party_id, q=q, order_ids=order_ids)

    all_candidates: list[ReconciliationImportCandidate] = []
    for loader in loaders.values():
        all_candidates.extend(await loader(db, party_id=party_id, q=q, order_ids=None))
    return sorted(all_candidates, key=lambda item: (item.biz_date or date.min, item.order_id), reverse=True)


def _candidate_to_row(candidate: ReconciliationImportCandidate, current_user: User) -> PartyReconciliation:
    period, period_start, period_end = _period_from_date(candidate.biz_date)
    return PartyReconciliation(
        party_id=candidate.party_id,
        period=period,
        period_start=period_start,
        period_end=period_end,
        ref_type=candidate.order_type,
        ref_id=candidate.order_id,
        line_no=1,
        biz_date=candidate.biz_date,
        biz_desc=candidate.biz_desc,
        steel_grade=candidate.steel_grade,
        quantity=candidate.quantity,
        unit=candidate.unit,
        unit_price=candidate.unit_price,
        debit=candidate.debit,
        credit=candidate.credit,
        invoice_amount=candidate.invoice_amount,
        invoice_direction=candidate.invoice_direction,
        recon_status="unreconciled",
        notes=f"从{candidate.type_label}订单 {candidate.batch_no} 导入",
        created_by=current_user.id,
    )


@router.get("/import-candidates", response_model=list[ReconciliationImportCandidate])
async def list_import_candidates(
    order_type: str = Query(default="all"),
    party_id: int | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    return await _load_import_candidates(db, order_type=order_type, party_id=party_id, q=q)


@router.post("/import", response_model=ReconciliationImportResult)
async def import_reconciliations(
    payload: ReconciliationImportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "accountant")),
):
    if payload.order_type == "all":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="导入时请指定单一订单类型")

    candidates = await _load_import_candidates(
        db, order_type=payload.order_type, order_ids=payload.order_ids
    )
    selected_ids = set(payload.order_ids)
    candidates = [candidate for candidate in candidates if candidate.order_id in selected_ids]

    imported: list[PartyReconciliation] = []
    skipped: list[dict[str, object]] = []
    existing = await _imported_ids(db, payload.order_type)

    for candidate in candidates:
        if candidate.order_id in existing:
            skipped.append({"order_type": candidate.order_type, "order_id": candidate.order_id, "reason": "已导入"})
            continue
        row = _candidate_to_row(candidate, current_user)
        db.add(row)
        imported.append(row)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        candidates = await _load_import_candidates(
            db, order_type=payload.order_type, order_ids=payload.order_ids
        )
        existing = await _imported_ids(db, payload.order_type)
        skipped = [
            {"order_type": payload.order_type, "order_id": order_id, "reason": "已导入"}
            for order_id in payload.order_ids
            if order_id in existing
        ]
        imported = []
        for candidate in candidates:
            row = _candidate_to_row(candidate, current_user)
            db.add(row)
            imported.append(row)
        await db.commit()

    imported_ids = [row.id for row in imported]
    loaded_imported = []
    if imported_ids:
        loaded_imported = list(
            await db.scalars(
                select(PartyReconciliation)
                .where(PartyReconciliation.id.in_(imported_ids))
                .options(selectinload(PartyReconciliation.party))
                .order_by(PartyReconciliation.id.desc())
            )
        )

    skipped_ids = {int(item["order_id"]) for item in skipped}
    missing_ids = selected_ids - {row.ref_id for row in loaded_imported if row.ref_id is not None} - skipped_ids
    for order_id in sorted(missing_ids):
        skipped.append({"order_type": payload.order_type, "order_id": order_id, "reason": "订单不可导入或不存在"})

    return ReconciliationImportResult(
        imported_count=len(loaded_imported),
        skipped_count=len(skipped),
        imported=[ReconciliationRead.model_validate(row) for row in loaded_imported],
        skipped=skipped,
    )


@router.put("/{reconciliation_id}", response_model=ReconciliationRead)
async def update_reconciliation(
    reconciliation_id: int,
    payload: ReconciliationUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    row = await db.get(PartyReconciliation, reconciliation_id)
    if row is None:
        raise HTTPException(status_code=404, detail="对账行不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    await db.commit()
    return await load_reconciliation(db, row.id)


@router.put("/{reconciliation_id}/status", response_model=ReconciliationRead)
async def update_reconciliation_status(
    reconciliation_id: int,
    payload: ReconciliationStatusUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    row = await db.get(PartyReconciliation, reconciliation_id)
    if row is None:
        raise HTTPException(status_code=404, detail="对账行不存在")
    row.recon_status = payload.recon_status
    await db.commit()
    return await load_reconciliation(db, row.id)


@router.delete("/{reconciliation_id}")
async def delete_reconciliation(
    reconciliation_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    row = await db.get(PartyReconciliation, reconciliation_id)
    if row is None:
        raise HTTPException(status_code=404, detail="对账行不存在")
    await db.delete(row)
    await db.commit()
    return {"message": "对账行已删除"}


@router.post("/batch-delete")
async def batch_delete_reconciliations(
    payload: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "accountant")),
):
    rows = await db.scalars(select(PartyReconciliation).where(PartyReconciliation.id.in_(payload.ids)))
    count = 0
    for row in rows:
        await db.delete(row)
        count += 1
    await db.commit()
    return {"message": f"已删除 {count} 条对账行"}


@router.get("/balances", response_model=list[PartyBalanceRead])
async def list_party_balances(db: AsyncSession = Depends(get_db)):
    return [PartyBalanceRead(**row) for row in await load_party_balances(db)]
