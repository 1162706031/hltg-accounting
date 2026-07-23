from datetime import date, datetime, time
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel
from app.schemas.item import CHEMICAL_ELEMENTS
from app.schemas.party import PartyRead

WeightUnit = Literal["kg", "ton"]
RecordStatus = Literal["draft", "confirmed"]


class SteelmakingMaterialInput(BaseModel):
    item_id: int
    input_weight: Decimal = Field(gt=0)
    input_weight_unit: WeightUnit = "kg"
    custom_price: Decimal | None = Field(default=None, ge=0)
    chemical_composition: dict[str, Decimal] | None = None
    sort_order: int = Field(default=1, ge=1)

    @field_validator("chemical_composition")
    @classmethod
    def validate_chemical_composition(cls, value):
        if value is None:
            return value
        unknown = set(value) - set(CHEMICAL_ELEMENTS)
        if unknown:
            raise ValueError(f"不支持的元素：{', '.join(sorted(unknown))}")
        amounts = [Decimal(amount) for amount in value.values()]
        if any(not amount.is_finite() or amount < 0 or amount > 100 for amount in amounts):
            raise ValueError("原料成分必须在 0 到 100 之间")
        if sum(amounts, Decimal("0")) > 100:
            raise ValueError("原料成分合计不能超过 100%")
        return value


class SteelmakingRecordCreate(BaseModel):
    record_date: date
    furnace_no: str | None = Field(default=None, max_length=50)
    steel_grade: str = Field(min_length=1, max_length=100)
    owner_id: int
    ingot_type: str | None = Field(default=None, max_length=100)
    furnace_weight: Decimal = Field(gt=0)
    furnace_weight_unit: WeightUnit = "kg"
    power_on_time: time | None = None
    tap_time: time | None = None
    tap_temperature: Decimal | None = Field(default=None, ge=0)
    pouring_time: time | None = None
    remark: str | None = None
    materials: list[SteelmakingMaterialInput] = Field(default_factory=list)
    actual_composition: dict[str, Decimal] = Field(default_factory=dict)

    @field_validator("actual_composition")
    @classmethod
    def validate_actual_composition(cls, value):
        unknown = set(value) - set(CHEMICAL_ELEMENTS)
        if unknown:
            raise ValueError(f"不支持的元素：{', '.join(sorted(unknown))}")
        if any(not Decimal(amount).is_finite() or Decimal(amount) < 0 or Decimal(amount) > 100 for amount in value.values()):
            raise ValueError("实际成分必须在 0 到 100 之间")
        if sum((Decimal(amount) for amount in value.values()), Decimal("0")) > 100:
            raise ValueError("实际成分合计不能超过 100%")
        return value


class SteelmakingRecordUpdate(SteelmakingRecordCreate):
    pass


class SteelmakingMaterialRead(ORMModel):
    id: int
    record_id: int
    item_id: int
    item_name_snapshot: str
    item_code_snapshot: str | None
    chemical_composition_snapshot: dict[str, Decimal]
    default_price_snapshot: Decimal | None
    custom_price: Decimal | None
    final_unit_price: Decimal | None
    input_weight: Decimal
    input_weight_unit: WeightUnit
    weight_kg: Decimal
    material_cost: Decimal | None
    sort_order: int
    created_at: datetime
    updated_at: datetime


class SteelmakingCompositionRead(ORMModel):
    id: int
    record_id: int
    element_code: str
    element_name: str
    element_weight_kg: Decimal
    theoretical_percentage: Decimal
    actual_percentage: Decimal | None
    deviation_percentage: Decimal | None
    created_at: datetime
    updated_at: datetime


class SteelmakingRecordListItem(ORMModel):
    id: int
    batch_no: str
    record_date: date
    furnace_no: str
    steel_grade: str
    owner_id: int
    ingot_type: str | None
    furnace_weight: Decimal
    furnace_weight_unit: WeightUnit
    furnace_weight_kg: Decimal
    total_cost: Decimal | None
    cost_per_ton: Decimal | None
    cost_complete: bool
    status: RecordStatus
    remark: str | None
    created_by_name: str | None = None
    created_at: datetime
    updated_at: datetime
    owner: PartyRead | None = None


class SteelmakingRecordRead(SteelmakingRecordListItem):
    power_on_time: time | None
    tap_time: time | None
    tap_temperature: Decimal | None
    pouring_time: time | None
    created_by: int | None
    updated_by: int | None
    materials: list[SteelmakingMaterialRead] = Field(default_factory=list)
    compositions: list[SteelmakingCompositionRead] = Field(default_factory=list)
