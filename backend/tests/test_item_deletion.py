import unittest

from app.routers.items import item_deletion_block_reason


class FakeScalarSession:
    def __init__(self, values):
        self.values = iter(values)

    async def scalar(self, _statement):
        return next(self.values)


class ItemDeletionReasonTests(unittest.IsolatedAsyncioTestCase):
    async def test_active_sales_order_blocks_item_operation_with_readable_reason(self):
        db = FakeScalarSession([0, 0, 1])
        reason = await item_deletion_block_reason(db, 7)  # type: ignore[arg-type]
        self.assertEqual(reason, "该物品正在销售订单中使用，请先删除或修改相关订单")

    async def test_completed_sales_history_blocks_physical_item_deletion(self):
        db = FakeScalarSession([0, 0, 0, 1])
        reason = await item_deletion_block_reason(db, 7)  # type: ignore[arg-type]
        self.assertEqual(reason, "该物品已被销售订单引用，为保护历史明细不能删除")

    async def test_completed_sales_history_does_not_prevent_deactivation(self):
        # include_history=False 时不会执行销售历史查询；后续依次是炼钢历史与库存余额。
        db = FakeScalarSession([0, 0, 0, 0, 0])
        reason = await item_deletion_block_reason(db, 7, include_history=False)  # type: ignore[arg-type]
        self.assertIsNone(reason)


if __name__ == "__main__":
    unittest.main()
