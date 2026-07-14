import unittest
from datetime import date
from decimal import Decimal

from app.models.procurement import ProcurementOrder, ProcurementOrderItem
from app.routers.procurement import _recompute


class ProcurementItemsTests(unittest.TestCase):
    def test_order_date_and_amount_use_all_items(self):
        order = ProcurementOrder(
            owner_id=1,
            tax_rate=Decimal("13"),
            need_invoice=True,
            items=[
                ProcurementOrderItem(
                    in_date=date(2026, 7, 10), item_id=1, owner_id=1,
                    quantity=Decimal("2"), unit="吨", unit_price=Decimal("1000"),
                ),
                ProcurementOrderItem(
                    in_date=date(2026, 7, 14), item_id=2, owner_id=2,
                    quantity=Decimal("3"), unit="吨", unit_price=Decimal("500"),
                ),
            ],
        )

        _recompute(order)

        self.assertEqual(order.purchase_date, date(2026, 7, 14))
        self.assertEqual(order.amount, Decimal("3500.00"))
        self.assertEqual(order.tax_amount, Decimal("455.00"))
        self.assertEqual(order.total_amount, Decimal("3955.00"))
        self.assertEqual(order.quantity, Decimal("5"))
        self.assertEqual(order.unit, "吨")
        self.assertEqual(order.items[0].amount, Decimal("2000.0000"))
        self.assertEqual(order.items[1].amount, Decimal("1500.0000"))

    def test_mixed_units_do_not_create_misleading_total_quantity(self):
        order = ProcurementOrder(
            owner_id=1,
            tax_rate=Decimal("13"),
            need_invoice=False,
            items=[
                ProcurementOrderItem(
                    in_date=date(2026, 7, 13), item_id=1, owner_id=1,
                    quantity=Decimal("1"), unit="吨", unit_price=Decimal("10"),
                ),
                ProcurementOrderItem(
                    in_date=date(2026, 7, 14), item_id=2, owner_id=1,
                    quantity=Decimal("100"), unit="千克", unit_price=Decimal("2"),
                ),
            ],
        )

        _recompute(order)

        self.assertEqual(order.quantity, Decimal("0"))
        self.assertEqual(order.unit, "多单位")
        self.assertEqual(order.total_amount, Decimal("210.00"))


if __name__ == "__main__":
    unittest.main()
