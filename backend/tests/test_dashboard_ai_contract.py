import json
import unittest
from unittest.mock import MagicMock, patch

from app.routers.dashboard import _open_agent_stream, _request_agent_json


class DashboardAgentScopeContractTests(unittest.TestCase):
    @patch("app.routers.dashboard.urlrequest.urlopen")
    def test_session_auth_matches_agentscope_contract(self, urlopen: MagicMock):
        response = MagicMock()
        response.read.return_value = json.dumps(
            {
                "session_id": "session-1",
                "user_id": "user_001",
                "expires_at": "2026-07-14T00:00:00",
                "agent_role": "internal-assistant",
                "available_agent_roles": ["internal-assistant"],
            }
        ).encode()
        urlopen.return_value.__enter__.return_value = response

        result = _request_agent_json(
            "/auth",
            {"api_key": "sk-frontend-001", "agent_role": "internal-assistant"},
        )

        request = urlopen.call_args.args[0]
        self.assertTrue(request.full_url.endswith("/auth"))
        self.assertEqual(request.method, "POST")
        self.assertEqual(
            json.loads(request.data),
            {"api_key": "sk-frontend-001", "agent_role": "internal-assistant"},
        )
        self.assertEqual(result["session_id"], "session-1")

    @patch("app.routers.dashboard.urlrequest.urlopen")
    def test_stream_request_is_forwarded_without_prompt_injection(self, urlopen: MagicMock):
        upstream = MagicMock()
        urlopen.return_value = upstream
        payload = {
            "session_id": "session-1",
            "message": "查询本月采购额",
            "agent_role": "internal-assistant",
        }

        result = _open_agent_stream(payload)

        request = urlopen.call_args.args[0]
        self.assertTrue(request.full_url.endswith("/chat/stream"))
        self.assertEqual(request.headers["Accept"], "text/event-stream")
        self.assertEqual(json.loads(request.data), payload)
        self.assertIs(result, upstream)


if __name__ == "__main__":
    unittest.main()
