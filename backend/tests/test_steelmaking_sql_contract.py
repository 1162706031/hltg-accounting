import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCHEMA = (ROOT / "database/schema.sql").read_text(encoding="utf-8")
MIGRATION = (ROOT / "database/migrations/V20260713_001__steelmaking_record.sql").read_text(encoding="utf-8")
SERVICE = (ROOT / "backend/app/services/steelmaking.py").read_text(encoding="utf-8")
ROUTER = (ROOT / "backend/app/routers/steelmaking.py").read_text(encoding="utf-8")


class SteelmakingSqlContractTests(unittest.TestCase):
    def test_schema_and_migration_contain_same_new_tables_and_columns(self):
        required_tokens = (
            "chemical_enabled",
            "chemical_composition",
            "default_price",
            "steelmaking_record",
            "steelmaking_record_material",
            "steelmaking_record_composition",
            "furnace_weight_kg",
            "chemical_composition_snapshot",
            "uk_steelmaking_record_element",
            "ON DELETE RESTRICT",
        )
        for token in required_tokens:
            self.assertIn(token, SCHEMA)
            self.assertIn(token, MIGRATION)

    def test_schema_is_complete_initialization_not_incremental_alter(self):
        item_start = SCHEMA.index("CREATE TABLE item")
        item_end = SCHEMA.index("ENGINE=InnoDB", item_start)
        item_ddl = SCHEMA[item_start:item_end]
        self.assertIn("chemical_enabled", item_ddl)
        self.assertNotIn("ALTER TABLE item", SCHEMA)

    def test_new_module_has_no_inventory_coupling(self):
        combined = f"{SERVICE}\n{ROUTER}"
        self.assertNotIn("services.inventory", combined)
        self.assertNotIn("InventoryLog", combined)
        self.assertNotIn("stock_in(", combined)
        self.assertNotIn("stock_out(", combined)


if __name__ == "__main__":
    unittest.main()
