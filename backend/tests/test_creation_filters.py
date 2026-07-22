import inspect
import unittest
from datetime import date, datetime, time

from sqlalchemy import select

from app.models.sales import SalesOrder
from app.routers import dashboard, outsource, procurement, sales, smelting, steelmaking
from app.services.creator import apply_creation_filters


class CreationFilterTests(unittest.TestCase):
    def test_all_order_lists_and_audit_expose_creation_filters(self):
        endpoints = [
            sales.list_orders,
            procurement.list_orders,
            outsource.list_orders,
            smelting.list_orders,
            steelmaking.list_records,
            dashboard.pending_audits,
        ]
        for endpoint in endpoints:
            with self.subTest(endpoint=endpoint.__module__ + "." + endpoint.__name__):
                parameters = inspect.signature(endpoint).parameters
                self.assertIn("created_by", parameters)
                self.assertIn("created_by_name", parameters)
                self.assertIn("created_at_from", parameters)
                self.assertIn("created_at_to", parameters)

    def test_creation_filter_builds_creator_and_inclusive_date_conditions(self):
        stmt = apply_creation_filters(
            select(SalesOrder),
            SalesOrder,
            created_by=7,
            created_by_name=" 张三 ",
            created_at_from=date(2026, 7, 1),
            created_at_to=date(2026, 7, 22),
        )
        compiled = stmt.compile()
        sql = str(compiled)
        values = list(compiled.params.values())

        self.assertIn("sales_order.created_by =", sql)
        self.assertIn("sales_order.created_by IN", sql)
        self.assertIn("real_name LIKE", sql)
        self.assertIn("username LIKE", sql)
        self.assertIn("sales_order.created_at >=", sql)
        self.assertIn("sales_order.created_at <=", sql)
        self.assertIn("%张三%", values)
        self.assertIn(7, values)
        self.assertIn(datetime.combine(date(2026, 7, 1), time.min), values)
        self.assertIn(datetime.combine(date(2026, 7, 22), time.max), values)


if __name__ == "__main__":
    unittest.main()
