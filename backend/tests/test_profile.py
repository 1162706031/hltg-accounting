import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.routers.auth import change_password, router, update_profile
from app.schemas.user import ChangePasswordRequest, ProfileUpdate
from app.utils.operation_log import mask_sensitive


class FakeSession:
    def __init__(self, user):
        self.user = user
        self.committed = False

    async def get(self, _model, user_id):
        return self.user if self.user.id == user_id else None

    async def commit(self):
        self.committed = True

    async def refresh(self, _user):
        return None


class ProfileTests(unittest.IsolatedAsyncioTestCase):
    async def test_user_can_update_own_real_name(self):
        user = SimpleNamespace(id=7, real_name="原姓名", is_active=True)
        session = FakeSession(user)

        updated = await update_profile(ProfileUpdate(real_name="  新姓名  "), session, user)  # type: ignore[arg-type]

        self.assertEqual(updated.real_name, "新姓名")
        self.assertTrue(session.committed)

    async def test_current_password_must_match(self):
        user = SimpleNamespace(id=7, password="stored-hash", is_active=True)
        session = FakeSession(user)

        with patch("app.routers.auth.verify_password", return_value=False):
            with self.assertRaises(HTTPException) as raised:
                await change_password(
                    ChangePasswordRequest(current_password="wrong", new_password="new-secret"),
                    session,  # type: ignore[arg-type]
                    user,  # type: ignore[arg-type]
                )

        self.assertEqual(raised.exception.status_code, 400)
        self.assertFalse(session.committed)

    async def test_user_can_change_own_password(self):
        user = SimpleNamespace(id=7, password="stored-hash", is_active=True)
        session = FakeSession(user)

        with (
            patch("app.routers.auth.verify_password", return_value=True),
            patch("app.routers.auth.hash_password", return_value="new-hash"),
        ):
            response = await change_password(
                ChangePasswordRequest(current_password="old-secret", new_password="new-secret"),
                session,  # type: ignore[arg-type]
                user,  # type: ignore[arg-type]
            )

        self.assertEqual(user.password, "new-hash")
        self.assertEqual(response.message, "密码已修改")
        self.assertTrue(session.committed)

    async def test_profile_routes_exist(self):
        methods_by_path = {route.path: route.methods for route in router.routes}
        self.assertIn("PUT", methods_by_path["/auth/me"])
        self.assertIn("POST", methods_by_path["/auth/change-password"])

    async def test_password_fields_are_masked_in_audit_detail(self):
        masked = mask_sensitive({"current_password": "old", "new_password": "new"})
        self.assertEqual(masked, {"current_password": "***", "new_password": "***"})


if __name__ == "__main__":
    unittest.main()
