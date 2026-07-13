import unittest
from datetime import date
from decimal import Decimal

from fastapi import HTTPException

from app.models.sales import SalesOrder, SalesOrderItem
from app.routers.sales import _recompute


class SalesOrderDateTests(unittest.TestCase):
    def test_order_ship_date_uses_latest_line_date(self):
        order = SalesOrder(tax_rate=Decimal("0"), need_invoice=False)
        order.items = [
            SalesOrderItem(ship_date=date(2026, 7, 10), quantity=1, unit_price=10),
            SalesOrderItem(ship_date=date(2026, 7, 15), quantity=2, unit_price=10),
        ]

        _recompute(order)

        self.assertEqual(order.ship_date, date(2026, 7, 15))

    def test_every_sales_line_requires_ship_date(self):
        order = SalesOrder(tax_rate=Decimal("0"), need_invoice=False)
        order.items = [SalesOrderItem(ship_date=None, quantity=1, unit_price=10)]

        with self.assertRaisesRegex(HTTPException, "每条销售明细都必须填写发货日期"):
            _recompute(order)


if __name__ == "__main__":
    unittest.main()
