import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.routers.inventory import (
    batch_delete_inventory,
    delete_inventory,
    inventory_delete_reasons,
)
from app.schemas.common import BatchDeleteRequest


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _Transaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, _exc_type, _exc, _traceback):
        return False


class _BatchDb:
    def __init__(self, inventories):
        self.inventories = inventories

    def begin(self):
        return _Transaction()

    async def scalars(self, _stmt):
        return self.inventories


class InventoryDeleteReasonTests(unittest.IsolatedAsyncioTestCase):
    async def test_reference_reasons_are_grouped_by_inventory_and_order_type(self):
        db = SimpleNamespace(
            execute=AsyncMock(
                return_value=_Rows(
                    [
                        (11, "outsource_order"),
                        (11, "smelting_order"),
                        (11, "outsource_order"),
                        (12, "sales_order"),
                    ]
                )
            )
        )

        reasons = await inventory_delete_reasons(db, [11, 12, 13])

        self.assertEqual(
            reasons[11],
            "该库存项已被外协加工订单、冶炼订单引用，请先删除或修改相关订单",
        )
        self.assertEqual(
            reasons[12], "该库存项已被销售订单引用，请先删除或修改相关订单"
        )
        self.assertNotIn(13, reasons)

    async def test_nonzero_unreferenced_inventory_can_be_deleted(self):
        inventory = SimpleNamespace(id=11, current_quantity=Decimal("8.500"))
        db = SimpleNamespace(
            begin=lambda: _Transaction(),
            get=AsyncMock(return_value=inventory),
        )

        with patch(
            "app.routers.inventory.inventory_delete_reasons",
            new=AsyncMock(return_value={}),
        ), patch(
            "app.routers.inventory.delete_inventory_with_log", new_callable=AsyncMock
        ) as delete_with_log:
            result = await delete_inventory(
                11, db=db, current_user=SimpleNamespace(id=7)
            )

        self.assertEqual(result, {"message": "库存已删除"})
        delete_with_log.assert_awaited_once()
        self.assertTrue(db.get.await_args.kwargs["with_for_update"])

    async def test_referenced_inventory_is_rejected_even_when_quantity_is_zero(self):
        inventory = SimpleNamespace(id=11, current_quantity=Decimal("0"))
        db = SimpleNamespace(
            begin=lambda: _Transaction(),
            get=AsyncMock(return_value=inventory),
        )
        reason = "该库存项已被外协加工订单引用，请先删除或修改相关订单"

        with patch(
            "app.routers.inventory.inventory_delete_reasons",
            new=AsyncMock(return_value={11: reason}),
        ), patch(
            "app.routers.inventory.delete_inventory_with_log", new_callable=AsyncMock
        ) as delete_with_log:
            with self.assertRaises(HTTPException) as context:
                await delete_inventory(11, db=db, current_user=SimpleNamespace(id=7))

        self.assertEqual(context.exception.status_code, 409)
        self.assertEqual(context.exception.detail, reason)
        delete_with_log.assert_not_awaited()

    async def test_batch_delete_processes_each_inventory_and_skips_blocked_rows(self):
        inventories = [
            SimpleNamespace(id=11, current_quantity=Decimal("5")),
            SimpleNamespace(id=12, current_quantity=Decimal("0")),
        ]
        db = _BatchDb(inventories)
        reason = "该库存项已被销售订单引用，请先删除或修改相关订单"

        with patch(
            "app.routers.inventory.inventory_delete_reasons",
            new=AsyncMock(return_value={12: reason}),
        ), patch(
            "app.routers.inventory.delete_inventory_with_log", new_callable=AsyncMock
        ) as delete_with_log:
            result = await batch_delete_inventory(
                BatchDeleteRequest(ids=[11, 12, 13]),
                db=db,
                current_user=SimpleNamespace(id=7),
            )

        self.assertEqual(result["deleted_count"], 1)
        self.assertEqual(
            result["skipped"],
            [{"id": 12, "reason": reason}, {"id": 13, "reason": "库存项不存在"}],
        )
        self.assertEqual(delete_with_log.await_count, 1)
        self.assertEqual(delete_with_log.await_args.kwargs["inventory"].id, 11)


if __name__ == "__main__":
    unittest.main()
