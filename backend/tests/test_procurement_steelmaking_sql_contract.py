import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCHEMA = (ROOT / "database" / "schema.sql").read_text(encoding="utf-8")
MIGRATION = (
    ROOT / "database" / "migrations" / "V20260714_001__procurement_items_and_steelmaking_owner.sql"
).read_text(encoding="utf-8")
BATCH_MIGRATION = (
    ROOT / "database" / "migrations" / "V20260714_002__steelmaking_batch_no.sql"
).read_text(encoding="utf-8")


class ProcurementSteelmakingSqlContractTests(unittest.TestCase):
    def test_schema_and_migration_include_procurement_items(self):
        for sql in (SCHEMA, MIGRATION):
            self.assertIn("procurement_order_item", sql)
            self.assertIn("in_date", sql)
            self.assertIn("owner_id", sql)
            self.assertIn("fk_procurement_item_order", sql)

    def test_schema_and_migration_include_steelmaking_owner(self):
        for sql in (SCHEMA, MIGRATION):
            self.assertIn("idx_steelmaking_owner", sql)
            self.assertIn("fk_steelmaking_owner", sql)

    def test_migration_backfills_old_procurement_rows(self):
        self.assertIn("INSERT INTO procurement_order_item", MIGRATION)
        self.assertIn("FROM procurement_order AS po", MIGRATION)
        self.assertIn("NOT EXISTS", MIGRATION)

    def test_steelmaking_batch_number_schema_and_migration_match(self):
        for sql in (SCHEMA, BATCH_MIGRATION):
            self.assertIn("batch_no", sql)
            self.assertIn("idx_steelmaking_batch_no", sql)
        self.assertIn("CONCAT(", BATCH_MIGRATION)
        self.assertIn("SET furnace_no = batch_no", BATCH_MIGRATION)


if __name__ == "__main__":
    unittest.main()
