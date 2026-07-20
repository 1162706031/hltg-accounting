from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inventory import Inventory, InventoryLog
from app.models.item import Item
from app.models.master_data import MasterDataOption
from app.models.outsource import OutsourceOrder, ProcessingInbound, ProcessingOutbound
from app.models.procurement import ProcurementOrder, ProcurementOrderItem
from app.models.sales import SalesOrderItem
from app.models.smelting import AlloyAddition, SmeltingInbound


async def require_master_option(
    db: AsyncSession,
    *,
    category: str,
    code: str | None,
    detail: str,
) -> MasterDataOption:
    normalized = (code or "").strip()
    option = await db.scalar(
        select(MasterDataOption)
        .where(
            MasterDataOption.category == category,
            MasterDataOption.code == normalized,
        )
        .with_for_update()
    )
    if option is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
    return option


async def require_specification(db: AsyncSession, spec: str | None) -> MasterDataOption:
    return await require_master_option(
        db,
        category="specification",
        code=spec,
        detail="请选择基础资料中已有的规格",
    )


async def master_option_reference_reason(
    db: AsyncSession,
    option: MasterDataOption,
) -> str | None:
    if option.category == "process":
        checks = ((OutsourceOrder, OutsourceOrder.process_type, "已有外协单使用该工艺"),)
        value = option.code
    elif option.category == "item_type":
        checks = (
            (Item, Item.item_type, "已有物品使用该类型"),
            (InventoryLog, InventoryLog.item_type, "已有库存变动历史使用该类型"),
        )
        value = option.code
    else:
        checks = (
            (Inventory, Inventory.spec, "已有库存使用该规格"),
            (SmeltingInbound, SmeltingInbound.spec, "已有冶炼明细使用该规格"),
            (AlloyAddition, AlloyAddition.spec, "已有冶炼合金明细使用该规格"),
            (ProcessingOutbound, ProcessingOutbound.spec, "已有外协发出明细使用该规格"),
            (ProcessingInbound, ProcessingInbound.spec, "已有外协回厂明细使用该规格"),
            (ProcurementOrder, ProcurementOrder.item_spec, "已有采购订单使用该规格"),
            (ProcurementOrderItem, ProcurementOrderItem.item_spec, "已有采购明细使用该规格"),
            (SalesOrderItem, SalesOrderItem.spec, "已有销售明细使用该规格"),
            (InventoryLog, InventoryLog.item_spec, "已有库存变动历史使用该规格"),
        )
        value = option.name

    for model, column, reason in checks:
        count = await db.scalar(select(func.count()).select_from(model).where(column == value))
        if count:
            return reason
    return None
