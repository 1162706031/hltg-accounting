import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    ROOT / "database/migrations/V20260722_001__sales_order_modes.sql"
).read_text(encoding="utf-8")
SCHEMA = (ROOT / "database/schema.sql").read_text(encoding="utf-8")


class SalesModeMigrationContractTests(unittest.TestCase):
    def test_migration_preserves_existing_orders_as_inventory_mode(self):
        self.assertIn("DEFAULT 'inventory'", MIGRATION)
        self.assertIn("UPDATE sales_order SET sales_mode = 'inventory'", MIGRATION)

    def test_fresh_schema_contains_both_sales_modes(self):
        expected = "sales_mode      ENUM('inventory','item_spec')"
        self.assertIn(expected, SCHEMA)


if __name__ == "__main__":
    unittest.main()
