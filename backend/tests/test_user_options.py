import unittest
from types import SimpleNamespace

from app.routers.users import list_user_options, options_router


class FakeSession:
    async def scalars(self, _statement):
        return [
            SimpleNamespace(id=1, username="active", real_name="在职用户", is_active=True),
            SimpleNamespace(id=2, username="inactive", real_name="历史用户", is_active=False),
        ]


class UserOptionTests(unittest.IsolatedAsyncioTestCase):
    async def test_options_keep_inactive_users_for_historical_orders(self):
        rows = await list_user_options(FakeSession())  # type: ignore[arg-type]
        self.assertEqual([row.id for row in rows], [1, 2])
        self.assertFalse(rows[1].is_active)

    async def test_static_options_route_exists(self):
        self.assertIn("/users/options", [route.path for route in options_router.routes])


if __name__ == "__main__":
    unittest.main()
