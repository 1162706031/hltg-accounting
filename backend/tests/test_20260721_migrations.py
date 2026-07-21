import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
HARD_DELETE_MIGRATION = (
    ROOT / "database/migrations/V20260721_001__hard_delete_removed_steelmaking_records.sql"
).read_text(encoding="utf-8")
ITEM_TYPE_MIGRATION = (
    ROOT / "database/migrations/V20260721_002__retire_generic_item_types.sql"
).read_text(encoding="utf-8")
ITEM_NAME_MIGRATION = (
    ROOT / "database/migrations/V20260721_003__item_name_master_data.sql"
).read_text(encoding="utf-8")
SCHEMA = (ROOT / "database/schema.sql").read_text(encoding="utf-8")


class July21MigrationContractTests(unittest.TestCase):
    def test_historical_soft_deleted_steelmaking_rows_are_removed_child_first(self):
        composition = HARD_DELETE_MIGRATION.index("DELETE c")
        material = HARD_DELETE_MIGRATION.index("DELETE m")
        record = HARD_DELETE_MIGRATION.index("DELETE FROM steelmaking_record")
        self.assertLess(composition, record)
        self.assertLess(material, record)
        self.assertEqual(HARD_DELETE_MIGRATION.count("WHERE r.deleted = TRUE"), 2)

    def test_generic_item_types_are_removed_from_migration_and_fresh_schema(self):
        for code in ("raw_material", "finished_product", "semi_finished"):
            self.assertIn(code, ITEM_TYPE_MIGRATION)
            self.assertNotIn(f"('item_type', '{code}'", SCHEMA)

    def test_existing_item_names_are_imported_into_master_data(self):
        self.assertIn("MODIFY COLUMN code VARCHAR(100)", ITEM_NAME_MIGRATION)
        self.assertIn("SELECT DISTINCT 'item_name', item.name, item.name", ITEM_NAME_MIGRATION)
        self.assertIn("process/item_type/item_name/specification", SCHEMA)


if __name__ == "__main__":
    unittest.main()
