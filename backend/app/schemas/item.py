from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.common import ORMModel

ItemType = Literal["steel_grade", "raw_material", "alloy", "finished_product", "semi_finished", "scrap"]
CHEMICAL_ELEMENTS = ("C", "Mn", "Si", "Cr", "W", "Mo", "V", "Co", "Nb", "Ni", "P", "S")


def normalize_composition(value: dict[str, Decimal] | None) -> dict[str, Decimal] | None:
    if value is None:
        return None
    unknown = set(value) - set(CHEMICAL_ELEMENTS)
    if unknown:
        raise ValueError(f"不支持的元素：{', '.join(sorted(unknown))}")
    normalized = {code: Decimal(value.get(code, 0)) for code in CHEMICAL_ELEMENTS}
    if any(not amount.is_finite() or amount < 0 or amount > 100 for amount in normalized.values()):
        raise ValueError("化学成分必须在 0 到 100 之间")
    if sum(normalized.values(), Decimal("0")) > 100:
        raise ValueError("化学成分合计不能超过 100%")
    return normalized


class ItemBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    item_type: ItemType
    is_active: bool = True
    chemical_enabled: bool = False
    chemical_composition: dict[str, Decimal] | None = None
    default_price: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None

    @field_validator("chemical_composition")
    @classmethod
    def validate_composition(cls, value):
        return normalize_composition(value)

    @model_validator(mode="after")
    def require_composition_when_enabled(self):
        if self.chemical_enabled and self.chemical_composition is None:
            self.chemical_composition = normalize_composition({})
        return self


class ItemCreate(ItemBase):
    pass


class ItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    item_type: ItemType | None = None
    is_active: bool | None = None
    chemical_enabled: bool | None = None
    chemical_composition: dict[str, Decimal] | None = None
    default_price: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None

    @field_validator("chemical_composition")
    @classmethod
    def validate_composition(cls, value):
        return normalize_composition(value)


class ItemRead(ItemBase, ORMModel):
    id: int
    created_at: datetime
    updated_at: datetime
