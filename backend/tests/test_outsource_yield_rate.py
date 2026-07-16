import unittest
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException

from app.schemas.outsource import OutsourceOrderRead
from app.services.outsource import recompute_amounts


def _line(quantity: str, *, item_id: int = 1):
    return SimpleNamespace(
        out_date=date(2026, 7, 16),
        in_date=date(2026, 7, 16),
        quantity=Decimal(quantity),
        unit_price=None,
        item_id=item_id,
    )


class OutsourceYieldRateTests(unittest.TestCase):
    def test_rejects_yield_rate_above_one_with_readable_detail(self):
        order = SimpleNamespace(
            outbound_lines=[_line("100")],
            inbound_lines=[_line("100.13")],
        )

        with self.assertRaises(HTTPException) as raised:
            recompute_amounts(order)

        self.assertEqual(raised.exception.status_code, 422)
        self.assertEqual(
            raised.exception.detail,
            "回厂有效数量不能超过发出数量，当前成材率为 100.13%",
        )

    def test_accepts_yield_rate_at_one(self):
        order = SimpleNamespace(
            outbound_lines=[_line("100")],
            inbound_lines=[_line("100")],
            unit_price=None,
            need_invoice=False,
            tax_rate=Decimal("13"),
        )

        recompute_amounts(order)

        self.assertEqual(order.yield_rate, Decimal("1.0000"))

    def test_read_schema_allows_historical_invalid_rate_to_be_corrected(self):
        now = datetime(2026, 7, 16)

        order = OutsourceOrderRead(
            id=35,
            batch_no="WXC000035",
            party_id=1,
            process_type="forging",
            yield_rate=Decimal("1.0013"),
            amount=None,
            tax_amount=None,
            subtotal=None,
            total_amount=None,
            status="draft",
            created_by=1,
            audited_by=None,
            audited_at=None,
            created_at=now,
            updated_at=now,
        )

        self.assertEqual(order.yield_rate, Decimal("1.0013"))


if __name__ == "__main__":
    unittest.main()
