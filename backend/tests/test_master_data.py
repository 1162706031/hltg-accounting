import unittest
from types import SimpleNamespace

from pydantic import ValidationError

from app.schemas.inventory import InventoryInRequest
from app.schemas.item import ItemCreate
from app.schemas.master_data import MasterDataOptionCreate
from app.schemas.outsource import OutsourceOrderCreate
from app.services.master_data import master_option_reference_reason


class _ScalarDb:
    def __init__(self, values):
        self.values = iter(values)

    async def scalar(self, _stmt):
        return next(self.values)


class MasterDataSchemaTests(unittest.TestCase):
    def test_custom_item_type_and_process_codes_are_accepted_by_payload_schemas(self):
        item = ItemCreate(name="包装纸", item_type="custom_packaging")
        order = OutsourceOrderCreate(party_id=1, process_type="custom_normalizing")

        self.assertEqual(item.item_type, "custom_packaging")
        self.assertEqual(order.process_type, "custom_normalizing")

    def test_master_data_name_is_trimmed_and_blank_name_is_rejected(self):
        option = MasterDataOptionCreate(category="specification", name="  Φ150  ")
        self.assertEqual(option.name, "Φ150")
        with self.assertRaises(ValidationError):
            MasterDataOptionCreate(category="specification", name="   ")

    def test_multiple_names_cannot_be_combined_into_one_option(self):
        invalid_names = ("正火、淬火", "辅料/包装物", "Φ150;Φ180", "正火+淬火", "正火\n淬火")
        for name in invalid_names:
            with self.subTest(name=name), self.assertRaises(ValidationError):
                MasterDataOptionCreate(category="process", name=name)

    def test_manual_inventory_in_requires_a_non_blank_specification(self):
        common = {
            "item_id": 1,
            "owner_id": 1,
            "unit": "吨",
            "quantity": 1,
            "change_date": "2026-07-20",
        }
        with self.assertRaises(ValidationError):
            InventoryInRequest(**common, spec="")


class MasterDataReferenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_referenced_item_type_cannot_be_deleted(self):
        option = SimpleNamespace(category="item_type", code="custom_packaging", name="包装物")
        reason = await master_option_reference_reason(_ScalarDb([1]), option)
        self.assertEqual(reason, "已有物品使用该类型")

    async def test_unreferenced_specification_can_be_deleted(self):
        option = SimpleNamespace(category="specification", code="Φ150", name="Φ150")
        reason = await master_option_reference_reason(_ScalarDb([0, 0, 0, 0, 0, 0, 0, 0, 0]), option)
        self.assertIsNone(reason)


if __name__ == "__main__":
    unittest.main()
