import unittest
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.routers.inventory import create_batch_stock_in
from app.schemas.inventory import InventoryBatchInRequest
from app.services.inventory import find_or_create_inventory


def _line(item_id: int):
    return {
        "item_id": item_id,
        "owner_id": 2,
        "spec": "A",
        "unit": "吨",
        "quantity": "1.5",
        "change_date": date(2026, 7, 20),
    }


def _inventory(inventory_id: int, item_id: int):
    now = datetime(2026, 7, 20, 8, 0, 0)
    return SimpleNamespace(
        id=inventory_id,
        item_id=item_id,
        spec="A",
        unit="吨",
        owner_id=2,
        current_quantity="1.5",
        notes=None,
        created_at=now,
        updated_at=now,
        item=None,
        owner=None,
    )


class _Transaction:
    def __init__(self):
        self.entered = False
        self.exit_error = None

    async def __aenter__(self):
        self.entered = True
        return self

    async def __aexit__(self, exc_type, _exc, _traceback):
        self.exit_error = exc_type
        return False


class _FakeDb:
    def __init__(self, rows):
        self.transaction = _Transaction()
        self.rows = rows
        self.scalars_called = False

    def begin(self):
        return self.transaction

    async def scalars(self, _stmt):
        self.scalars_called = True
        return self.rows


class InventoryBatchInTests(unittest.IsolatedAsyncioTestCase):
    async def test_multiple_lines_are_processed_in_one_transaction(self):
        payload = InventoryBatchInRequest(lines=[_line(11), _line(12)])
        db = _FakeDb([_inventory(101, 11), _inventory(102, 12)])

        with patch("app.routers.inventory.require_specification", new_callable=AsyncMock), patch(
            "app.routers.inventory.stock_in", new_callable=AsyncMock
        ) as stock_in:
            stock_in.side_effect = [SimpleNamespace(id=101), SimpleNamespace(id=102)]
            result = await create_batch_stock_in(payload, db=db, current_user=SimpleNamespace(id=7))

        self.assertTrue(db.transaction.entered)
        self.assertIsNone(db.transaction.exit_error)
        self.assertEqual(stock_in.await_count, 2)
        self.assertEqual(result.processed_count, 2)
        self.assertEqual([row.id for row in result.items], [101, 102])
        self.assertEqual(stock_in.await_args_list[0].kwargs["created_by"], 7)

    async def test_line_failure_exits_the_shared_transaction_with_error(self):
        payload = InventoryBatchInRequest(lines=[_line(11), _line(12)])
        db = _FakeDb([])

        with patch("app.routers.inventory.require_specification", new_callable=AsyncMock), patch(
            "app.routers.inventory.stock_in", new_callable=AsyncMock
        ) as stock_in:
            stock_in.side_effect = [SimpleNamespace(id=101), HTTPException(status_code=400, detail="入库数量不能为 0")]
            with self.assertRaises(HTTPException):
                await create_batch_stock_in(payload, db=db, current_user=SimpleNamespace(id=7))

        self.assertIs(db.transaction.exit_error, HTTPException)
        self.assertFalse(db.scalars_called)

    async def test_existing_inventory_rejects_a_different_unit(self):
        existing = SimpleNamespace(unit="吨")
        db = SimpleNamespace(scalar=AsyncMock(return_value=existing))

        with self.assertRaises(HTTPException) as context:
            await find_or_create_inventory(
                db,
                item_id=11,
                owner_id=2,
                spec="Φ150",
                unit="千克",
                created_by=7,
            )

        self.assertEqual(context.exception.status_code, 409)
        self.assertIn("统一计量单位", context.exception.detail)


if __name__ == "__main__":
    unittest.main()
