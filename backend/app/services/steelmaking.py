from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.item import Item
from app.models.steelmaking import SteelmakingRecord, SteelmakingRecordComposition, SteelmakingRecordMaterial
from app.schemas.item import CHEMICAL_ELEMENTS
from app.schemas.steelmaking import SteelmakingMaterialInput

WEIGHT_QUANT = Decimal("0.000001")
PRICE_QUANT = Decimal("0.0001")
PERCENT_QUANT = Decimal("0.000001")
ELEMENT_NAMES = {
    "C": "碳", "Mn": "锰", "Si": "硅", "Cr": "铬", "W": "钨", "Mo": "钼",
    "V": "钒", "Co": "钴", "Nb": "铌", "Ni": "镍", "P": "磷", "S": "硫",
}


def resolve_furnace_no(furnace_no: str | None, batch_no: str) -> str:
    """炉号允许留空；空值统一使用不可变的炼钢批次号。"""
    normalized = (furnace_no or "").strip()
    return normalized or batch_no


def normalize_composition_snapshot(composition: dict | None) -> dict[str, str]:
    """Store JSON snapshot percentages at the same six-decimal precision as analysis rows.

    MySQL JSON numeric values may be returned as Python floats. Converting a float
    directly with Decimal(value) preserves its binary approximation and produces
    strings such as 0.0500000000000000027. Decimal(str(value)) avoids that expansion.
    """
    source = composition or {}
    return {
        code: format(Decimal(str(source.get(code, "0"))).quantize(PERCENT_QUANT), "f")
        for code in CHEMICAL_ELEMENTS
    }


def convert_weight_to_kg(weight: Decimal, unit: str) -> Decimal:
    value = Decimal(weight)
    if value <= 0:
        raise ValueError("重量必须大于 0")
    if unit not in {"kg", "ton"}:
        raise ValueError("重量单位只能是 kg 或 ton")
    return (value * (Decimal("1000") if unit == "ton" else Decimal("1"))).quantize(WEIGHT_QUANT)


def choose_final_price(default_price: Decimal | None, custom_price: Decimal | None) -> Decimal | None:
    return Decimal(custom_price) if custom_price is not None else (Decimal(default_price) if default_price is not None else None)


def ensure_steelmaking_material_allowed(item: Item) -> None:
    """Steelmaking materials only need chemical composition to be enabled."""
    if not item.chemical_enabled:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"物品“{item.name}”未启用化学成分，不能用作炼钢原料",
        )


def calculate_materials_and_composition(
    *,
    furnace_weight_kg: Decimal,
    material_rows: list[dict],
    actual_composition: dict[str, Decimal],
) -> tuple[list[dict], list[dict], Decimal, Decimal, bool]:
    furnace_kg = Decimal(furnace_weight_kg)
    if furnace_kg <= 0:
        raise ValueError("炉重必须大于 0，无法计算理论成分和单吨成本")

    element_weights = {code: Decimal("0") for code in CHEMICAL_ELEMENTS}
    total_cost_raw = Decimal("0")
    cost_complete = True
    calculated_materials: list[dict] = []

    for row in material_rows:
        weight_kg = Decimal(row["weight_kg"])
        composition = {code: Decimal(row["chemical_composition_snapshot"].get(code, "0")) for code in CHEMICAL_ELEMENTS}
        for code in CHEMICAL_ELEMENTS:
            element_weights[code] += weight_kg * composition[code] / Decimal("100")

        final_price = row["final_unit_price"]
        material_cost = None
        if final_price is None:
            cost_complete = False
        else:
            raw_cost = weight_kg / Decimal("1000") * Decimal(final_price)
            total_cost_raw += raw_cost
            material_cost = raw_cost.quantize(PRICE_QUANT)
        calculated_materials.append({**row, "material_cost": material_cost})

    compositions: list[dict] = []
    for code in CHEMICAL_ELEMENTS:
        element_weight = element_weights[code]
        theoretical = element_weight / furnace_kg * Decimal("100")
        actual = actual_composition.get(code)
        actual_decimal = Decimal(actual) if actual is not None else None
        deviation = actual_decimal - theoretical if actual_decimal is not None else None
        compositions.append(
            {
                "element_code": code,
                "element_name": ELEMENT_NAMES[code],
                "element_weight_kg": element_weight.quantize(WEIGHT_QUANT),
                "theoretical_percentage": theoretical.quantize(PERCENT_QUANT),
                "actual_percentage": actual_decimal.quantize(PERCENT_QUANT) if actual_decimal is not None else None,
                "deviation_percentage": deviation.quantize(PERCENT_QUANT) if deviation is not None else None,
            }
        )

    total_cost = total_cost_raw.quantize(PRICE_QUANT)
    cost_per_ton = (total_cost_raw / (furnace_kg / Decimal("1000"))).quantize(PRICE_QUANT)
    return calculated_materials, compositions, total_cost, cost_per_ton, cost_complete


async def replace_calculated_details(
    db: AsyncSession,
    record: SteelmakingRecord,
    materials: list[SteelmakingMaterialInput],
    actual_composition: dict[str, Decimal],
) -> None:
    item_ids = {line.item_id for line in materials}
    items = list(await db.scalars(select(Item).where(Item.id.in_(item_ids)))) if item_ids else []
    by_id = {item.id: item for item in items}
    missing = item_ids - set(by_id)
    if missing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"物品不存在：{sorted(missing)}")

    material_rows: list[dict] = []
    for index, line in enumerate(materials, start=1):
        item = by_id[line.item_id]
        ensure_steelmaking_material_allowed(item)
        snapshot = normalize_composition_snapshot(item.chemical_composition)
        default_price = Decimal(item.default_price) if item.default_price is not None else None
        custom_price = Decimal(line.custom_price) if line.custom_price is not None else None
        final_price = choose_final_price(default_price, custom_price)
        material_rows.append(
            {
                "item_id": item.id,
                "item_name_snapshot": item.name,
                "item_code_snapshot": str(item.id),
                "chemical_composition_snapshot": snapshot,
                "default_price_snapshot": default_price,
                "custom_price": custom_price,
                "final_unit_price": final_price,
                "input_weight": Decimal(line.input_weight),
                "input_weight_unit": line.input_weight_unit,
                "weight_kg": convert_weight_to_kg(line.input_weight, line.input_weight_unit),
                "sort_order": index,
            }
        )

    calculated, compositions, total_cost, cost_per_ton, cost_complete = calculate_materials_and_composition(
        furnace_weight_kg=record.furnace_weight_kg,
        material_rows=material_rows,
        actual_composition=actual_composition,
    )
    record.materials.clear()
    record.materials.extend(SteelmakingRecordMaterial(**row) for row in calculated)
    existing_compositions = {row.element_code: row for row in record.compositions}
    for values in compositions:
        row = existing_compositions.get(values["element_code"])
        if row is None:
            record.compositions.append(SteelmakingRecordComposition(**values))
        else:
            for key, value in values.items():
                setattr(row, key, value)
    record.total_cost = total_cost
    record.cost_per_ton = cost_per_ton
    record.cost_complete = cost_complete


async def load_record(db: AsyncSession, record_id: int, *, include_deleted: bool = False) -> SteelmakingRecord:
    stmt = (
        select(SteelmakingRecord)
        .where(SteelmakingRecord.id == record_id)
        .options(
            selectinload(SteelmakingRecord.materials),
            selectinload(SteelmakingRecord.compositions),
            selectinload(SteelmakingRecord.owner),
        )
    )
    if not include_deleted:
        stmt = stmt.where(SteelmakingRecord.deleted.is_(False))
    record = await db.scalar(stmt)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="炼钢记录不存在")
    return record
