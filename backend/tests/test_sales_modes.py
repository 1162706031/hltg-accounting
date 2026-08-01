import unittest
from datetime import date
from decimal import Decimal

from fastapi import HTTPException

from app.models.inventory import Inventory
from app.models.item import Item
from app.models.sales import SalesOrder, SalesOrderItem
from app.routers.sales import _match_auto_mode_inventory, _validate_mode_lines
from app.schemas.sales import SalesOrderCreate


def sales_line(**overrides):
    values = {
        "line_no": 1,
        "ship_date": date(2026, 7, 22),
        "item_id": 7,
        "spec": "Φ150",
        "quantity": Decimal("1"),
        "unit": "吨",
        "unit_price": Decimal("10"),
    }
    values.update(overrides)
    return SalesOrderItem(**values)


class FakeScalarSession:
    def __init__(self, values):
        self.values = iter(values)
        self.statements = []

    async def scalar(self, statement):
        self.statements.append(statement)
        return next(self.values)


class SalesModeTests(unittest.IsolatedAsyncioTestCase):
    def test_historical_clients_default_to_inventory_mode(self):
        payload = SalesOrderCreate(
            party_id=1,
            items=[{"ship_date": date(2026, 7, 22), "inventory_id": 3}],
        )
        self.assertEqual(payload.sales_mode, "inventory")

    def test_inventory_mode_requires_inventory_id(self):
        order = SalesOrder(sales_mode="inventory")
        order.items = [sales_line(inventory_id=None)]
        with self.assertRaisesRegex(HTTPException, "未指定库存项"):
            _validate_mode_lines(order)

    def test_item_spec_mode_requires_item_and_spec(self):
        for line in (
            sales_line(item_id=None),
            sales_line(spec="  "),
            sales_line(quantity=Decimal("0")),
            sales_line(unit=""),
        ):
            order = SalesOrder(sales_mode="item_spec")
            order.items = [line]
            with self.subTest(line=line), self.assertRaises(HTTPException):
                _validate_mode_lines(order)

    async def test_auto_mode_aggregates_same_inventory_before_completing(self):
        item = Item(id=7, name="H13", item_type="steel_grade")
        order = SalesOrder(sales_mode="item_spec")
        order.items = [
            sales_line(line_no=1, quantity=Decimal("1.5"), item=item),
            sales_line(line_no=2, quantity=Decimal("2"), item=item),
        ]
        inventory = Inventory(
            id=11,
            item_id=7,
            owner_id=1,
            spec="Φ150",
            unit="吨",
            current_quantity=Decimal("3"),
        )
        db = FakeScalarSession([inventory])

        with self.assertRaisesRegex(HTTPException, "需要 3.5，当前仅有 3"):
            await _match_auto_mode_inventory(db, order)  # type: ignore[arg-type]
        self.assertIn("party.is_internal", str(db.statements[0]))
        self.assertNotIn("party.name", str(db.statements[0]))

    async def test_auto_mode_falls_back_to_selected_customer_inventory_when_internal_missing(self):
        item = Item(id=7, name="H13", item_type="steel_grade")
        order = SalesOrder(party_id=9, sales_mode="item_spec")
        order.items = [sales_line(item=item, quantity=Decimal("2"))]
        customer_inventory = Inventory(
            id=12,
            item_id=7,
            owner_id=9,
            spec="Φ150",
            unit="吨",
            current_quantity=Decimal("5"),
        )
        db = FakeScalarSession([None, customer_inventory])

        matched = await _match_auto_mode_inventory(db, order)  # type: ignore[arg-type]

        self.assertIs(matched[(7, "Φ150", "吨")], customer_inventory)
        self.assertEqual(len(db.statements), 2)
        self.assertIn("party.is_internal", str(db.statements[0]))
        self.assertIn("inventory.owner_id", str(db.statements[1]))
        self.assertNotIn("party.name", str(db.statements[1]))


if __name__ == "__main__":
    unittest.main()
