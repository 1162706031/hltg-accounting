import unittest
from datetime import date

from pydantic import ValidationError

from app.schemas.outsource import OutsourceOrderCreate
from app.schemas.smelting import SmeltingOrderCreate


class ProcessingRequiredFieldsTests(unittest.TestCase):
    def test_smelting_output_requires_date_item_and_owner(self):
        common = {"party_id": 1, "order_type": "inhouse"}
        cases = [
            {"side": "out", "date": None, "item_id": 1, "owner_id": 1},
            {"side": "out", "date": date(2026, 7, 13), "item_id": None, "owner_id": 1},
            {"side": "out", "date": date(2026, 7, 13), "item_id": 1, "owner_id": None},
        ]
        for line in cases:
            with self.subTest(line=line), self.assertRaises(ValidationError):
                SmeltingOrderCreate(**common, inbound_lines=[line])

    def test_outsource_return_requires_date_item_and_owner(self):
        common = {"party_id": 1, "process_type": "forging"}
        cases = [
            {"in_date": None, "item_id": 1, "owner_id": 1},
            {"in_date": date(2026, 7, 13), "item_id": None, "owner_id": 1},
            {"in_date": date(2026, 7, 13), "item_id": 1, "owner_id": None},
        ]
        for line in cases:
            with self.subTest(line=line), self.assertRaises(ValidationError):
                OutsourceOrderCreate(**common, inbound_lines=[line])

    def test_valid_processing_lines_are_accepted(self):
        smelting = SmeltingOrderCreate(
            party_id=1,
            order_type="inhouse",
            inbound_lines=[{"side": "out", "date": date(2026, 7, 13), "item_id": 1, "owner_id": 1}],
        )
        outsource = OutsourceOrderCreate(
            party_id=1,
            process_type="forging",
            outbound_lines=[{"out_date": date(2026, 7, 13), "item_id": 1}],
            inbound_lines=[{"in_date": date(2026, 7, 14), "item_id": 2, "owner_id": 1}],
        )

        self.assertEqual(smelting.inbound_lines[0].owner_id, 1)
        self.assertEqual(outsource.inbound_lines[0].owner_id, 1)


if __name__ == "__main__":
    unittest.main()
