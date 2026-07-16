import json
import unittest
from types import SimpleNamespace

from fastapi.exceptions import ResponseValidationError

from app.main import response_validation_error_handler, unhandled_exception_handler


def _request():
    return SimpleNamespace(method="PUT", url=SimpleNamespace(path="/api/v1/example/1"))


class StructuredErrorResponseTests(unittest.IsolatedAsyncioTestCase):
    async def test_response_validation_error_returns_safe_json_detail(self):
        error = ResponseValidationError(
            [{"type": "less_than_equal", "loc": ("response", "rate"), "msg": "too large", "input": 2}]
        )

        with self.assertLogs("app.main", level="ERROR"):
            response = await response_validation_error_handler(_request(), error)

        self.assertEqual(response.status_code, 500)
        body = json.loads(response.body)
        self.assertEqual(body["error_code"], "RESPONSE_VALIDATION_ERROR")
        self.assertIn("服务器返回的数据格式异常", body["detail"])
        self.assertNotIn("too large", body["detail"])

    async def test_unhandled_error_returns_safe_json_detail(self):
        error = RuntimeError("database password must not leak")

        with self.assertLogs("app.main", level="ERROR"):
            response = await unhandled_exception_handler(_request(), error)

        self.assertEqual(response.status_code, 500)
        body = json.loads(response.body)
        self.assertEqual(body["error_code"], "INTERNAL_SERVER_ERROR")
        self.assertEqual(body["detail"], "服务器处理请求失败，请稍后重试")
        self.assertNotIn("password", response.body.decode())


if __name__ == "__main__":
    unittest.main()
