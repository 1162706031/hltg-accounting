from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel

ItemType = Literal["steel_grade", "raw_material", "alloy", "finished_product", "semi_finished", "scrap"]


class ItemBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    item_type: ItemType
    is_active: bool = True
    notes: str | None = None


class ItemCreate(ItemBase):
    pass


class ItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    item_type: ItemType | None = None
    is_active: bool | None = None
    notes: str | None = None


class ItemRead(ItemBase, ORMModel):
    id: int
    created_at: datetime
    updated_at: datetime
