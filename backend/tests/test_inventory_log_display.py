import unittest

from app.routers.inventory import inventory_log_display_fields


class InventoryLogDisplayTests(unittest.TestCase):
    def test_order_type_batch_and_remaining_note_are_split_into_columns(self):
        fields = inventory_log_display_fields("sales_order", "批次号：S0008；销售出库")

        self.assertEqual(fields["order_type_label"], "销售")
        self.assertEqual(fields["batch_no"], "S0008")
        self.assertEqual(fields["business_remark"], "销售出库")

    def test_manual_inventory_note_remains_visible(self):
        fields = inventory_log_display_fields(None, "月末盘点调整")

        self.assertIsNone(fields["order_type_label"])
        self.assertIsNone(fields["batch_no"])
        self.assertEqual(fields["business_remark"], "月末盘点调整")

    def test_ascii_separators_are_supported_for_history(self):
        fields = inventory_log_display_fields("procurement_order", "批次号:P001;采购入库")

        self.assertEqual(fields["batch_no"], "P001")
        self.assertEqual(fields["business_remark"], "采购入库")


if __name__ == "__main__":
    unittest.main()
