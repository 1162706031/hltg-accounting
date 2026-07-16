import unittest
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException

from app.services.smelting import recompute_amounts


def _line(side: str, quantity: str, *, item_id: int = 1):
    return SimpleNamespace(
        side=side,
        date=date(2026, 7, 16),
        quantity=Decimal(quantity),
        unit_price=None,
        item_id=item_id,
    )


class SmeltingYieldRateTests(unittest.TestCase):
    def test_rejects_yield_above_one_hundred_with_readable_detail(self):
        order = SimpleNamespace(
            inbound_lines=[_line("in", "100"), _line("out", "100.13")],
            alloy_lines=[],
        )

        with self.assertRaises(HTTPException) as raised:
            recompute_amounts(order)

        self.assertEqual(raised.exception.status_code, 422)
        self.assertEqual(
            raised.exception.detail,
            "有效出钢量不能超过投料量，当前成锭率为 100.13%",
        )

    def test_accepts_yield_at_one_hundred(self):
        order = SimpleNamespace(
            inbound_lines=[_line("in", "100"), _line("out", "100")],
            alloy_lines=[],
            unit_price=None,
            need_invoice=False,
            tax_rate=Decimal("13"),
        )

        recompute_amounts(order)

        self.assertEqual(order.yield_pct, Decimal("100.00"))


if __name__ == "__main__":
    unittest.main()
