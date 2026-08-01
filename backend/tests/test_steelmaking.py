import unittest
from decimal import Decimal

from fastapi import HTTPException

from app.models.item import Item
from app.schemas.item import ItemCreate
from app.schemas.steelmaking import SteelmakingMaterialInput
from app.services.steelmaking import (
    calculate_materials_and_composition,
    choose_final_price,
    convert_weight_to_kg,
    ensure_steelmaking_material_allowed,
    normalize_composition_snapshot,
    resolve_composition_snapshot,
    resolve_furnace_no,
)


class SteelmakingCalculationTests(unittest.TestCase):
    def test_inactive_item_with_chemical_composition_enabled_is_allowed(self):
        item = Item(
            name="停用但有化学成分的原料",
            item_type="alloy",
            is_active=False,
            chemical_enabled=True,
            chemical_composition={"Mo": "60"},
        )

        ensure_steelmaking_material_allowed(item)

    def test_item_without_chemical_composition_enabled_is_rejected(self):
        item = Item(
            name="未启用化学成分的原料",
            item_type="alloy",
            is_active=True,
            chemical_enabled=False,
        )

        with self.assertRaises(HTTPException) as context:
            ensure_steelmaking_material_allowed(item)

        self.assertEqual(context.exception.status_code, 409)

    def test_blank_furnace_number_uses_batch_number(self):
        self.assertEqual(resolve_furnace_no(None, "LG000001"), "LG000001")
        self.assertEqual(resolve_furnace_no("   ", "LG000001"), "LG000001")
        self.assertEqual(resolve_furnace_no("  A-12  ", "LG000001"), "A-12")

    def test_item_composition_normalizes_missing_elements(self):
        item = ItemCreate(
            name="钼铁",
            item_type="alloy",
            chemical_enabled=True,
            chemical_composition={"Mo": Decimal("60"), "C": Decimal("0.05")},
        )
        self.assertEqual(item.chemical_composition["Mn"], Decimal("0"))

    def test_composition_snapshot_avoids_float_expansion_and_keeps_six_decimals(self):
        snapshot = normalize_composition_snapshot({"C": 0.05, "Mo": "60.1234567"})
        self.assertEqual(snapshot["C"], "0.050000")
        self.assertEqual(snapshot["Mo"], "60.123457")
        self.assertEqual(snapshot["Mn"], "0.000000")

    def test_batch_composition_override_has_priority_over_item_default(self):
        snapshot = resolve_composition_snapshot(
            {"C": "0.05", "Mo": "60"},
            {"C": "0.08", "Mo": "58.5"},
        )
        self.assertEqual(snapshot["C"], "0.080000")
        self.assertEqual(snapshot["Mo"], "58.500000")

    def test_missing_batch_composition_falls_back_to_item_default(self):
        snapshot = resolve_composition_snapshot({"C": "0.05"}, None)
        self.assertEqual(snapshot["C"], "0.050000")

    def test_material_batch_composition_is_validated(self):
        line = SteelmakingMaterialInput(
            item_id=1,
            input_weight=Decimal("100"),
            chemical_composition={"C": Decimal("0.08"), "Mn": Decimal("1.2")},
        )
        self.assertEqual(line.chemical_composition["C"], Decimal("0.08"))

        with self.assertRaisesRegex(ValueError, "原料成分合计不能超过 100%"):
            SteelmakingMaterialInput(
                item_id=1,
                input_weight=Decimal("100"),
                chemical_composition={"C": Decimal("60"), "Mn": Decimal("50")},
            )

    def test_ton_to_kg_conversion(self):
        self.assertEqual(convert_weight_to_kg(Decimal("1.25"), "ton"), Decimal("1250.000000"))

    def test_custom_price_has_priority_and_missing_price_stays_null(self):
        self.assertEqual(choose_final_price(Decimal("15000"), Decimal("16000")), Decimal("16000"))
        self.assertEqual(
            choose_final_price(Decimal("15000"), Decimal("16"), "yuan_per_kg"),
            Decimal("16000"),
        )
        self.assertEqual(choose_final_price(Decimal("15000"), None), Decimal("15000"))
        self.assertIsNone(choose_final_price(None, None))

    def test_theoretical_actual_deviation_and_cost(self):
        materials, compositions, total, per_ton, complete = calculate_materials_and_composition(
            furnace_weight_kg=Decimal("1000"),
            material_rows=[
                {
                    "weight_kg": Decimal("100"),
                    "chemical_composition_snapshot": {"Mo": "60", "C": "0.05"},
                    "final_unit_price": Decimal("15000"),
                }
            ],
            actual_composition={"Mo": Decimal("5.5")},
        )
        mo = next(row for row in compositions if row["element_code"] == "Mo")
        c = next(row for row in compositions if row["element_code"] == "C")
        self.assertEqual(mo["theoretical_percentage"], Decimal("6.000000"))
        self.assertEqual(mo["deviation_percentage"], Decimal("-0.500000"))
        self.assertIsNone(c["actual_percentage"])
        self.assertIsNone(c["deviation_percentage"])
        self.assertEqual(materials[0]["material_cost"], Decimal("1500.0000"))
        self.assertEqual(total, Decimal("1500.0000"))
        self.assertEqual(per_ton, Decimal("1500.0000"))
        self.assertTrue(complete)

    def test_missing_price_marks_cost_incomplete(self):
        materials, _, total, _, complete = calculate_materials_and_composition(
            furnace_weight_kg=Decimal("1000"),
            material_rows=[
                {
                    "weight_kg": Decimal("10"),
                    "chemical_composition_snapshot": {},
                    "final_unit_price": None,
                }
            ],
            actual_composition={},
        )
        self.assertIsNone(materials[0]["material_cost"])
        self.assertEqual(total, Decimal("0.0000"))
        self.assertFalse(complete)

    def test_invalid_furnace_weight_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "炉重必须大于 0"):
            calculate_materials_and_composition(
                furnace_weight_kg=Decimal("0"),
                material_rows=[],
                actual_composition={},
            )


if __name__ == "__main__":
    unittest.main()
