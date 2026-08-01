import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    ROOT / "database/migrations/V20260801_001__smelting_steelmaking_links_and_price_units.sql"
).read_text(encoding="utf-8")
SCHEMA = (ROOT / "database/schema.sql").read_text(encoding="utf-8")


class AugustFirstMigrationContractTests(unittest.TestCase):
    def test_price_unit_is_persisted_and_final_price_remains_per_ton(self):
        for sql in (MIGRATION, SCHEMA):
            self.assertIn("custom_price_unit", sql)
            self.assertIn("yuan_per_kg", sql)
            self.assertIn("yuan_per_ton", sql)
            self.assertIn("final_unit_price", sql)

    def test_smelting_output_supports_multiple_steelmaking_records(self):
        for sql in (MIGRATION, SCHEMA):
            self.assertIn("smelting_inbound_steelmaking_record", sql)
            self.assertIn("PRIMARY KEY (smelting_inbound_id, steelmaking_record_id)", sql)
            self.assertIn("ON DELETE CASCADE", sql)

    def test_migration_backfills_exact_legacy_furnace_number_matches(self):
        self.assertIn("record.furnace_no = inbound.furnace_no", MIGRATION)
        self.assertIn("inbound.side = 'out'", MIGRATION)
        self.assertIn("SELECT COUNT(*)", MIGRATION)
        self.assertIn(") = 1", MIGRATION)


if __name__ == "__main__":
    unittest.main()
