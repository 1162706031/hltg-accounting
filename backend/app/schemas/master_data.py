import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel

MasterDataCategory = Literal["process", "item_type", "item_name", "specification"]


class MasterDataOptionCreate(BaseModel):
    category: MasterDataCategory
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("名称不能为空")
        if re.search(r"[、，,；;/／+＋\r\n]", normalized):
            raise ValueError("每次只能创建一个名称，请勿使用逗号、顿号、分号、斜杠、加号或换行合并多项")
        return normalized


class MasterDataOptionRead(ORMModel):
    id: int
    category: MasterDataCategory
    code: str
    name: str
    is_system: bool
    created_by: int | None
    created_at: datetime
    updated_at: datetime
