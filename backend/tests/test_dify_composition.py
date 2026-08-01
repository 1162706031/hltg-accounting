import unittest

from app.services.dify_composition import (
    DifyCompositionError,
    build_workflow_payload,
    extract_dify_composition,
)


class DifyCompositionTests(unittest.TestCase):
    def test_builds_blocking_workflow_payload_with_configured_input_name(self):
        self.assertEqual(
            build_workflow_payload("H12", "input", "hltg-accounting-1"),
            {
                "inputs": {"input": "H12"},
                "response_mode": "blocking",
                "user": "hltg-accounting-1",
            },
        )

    def test_extracts_reasoning_content_from_blocking_response(self):
        result = extract_dify_composition(
            {
                "data": {
                    "status": "succeeded",
                    "outputs": {
                        "reasoning_content": {
                            "C": 0.32,
                            "Cr": 4.75,
                            "Mo": 1.25,
                            "Si": 0.8,
                        }
                    },
                }
            }
        )

        self.assertEqual(result["C"], "0.32")
        self.assertEqual(result["Cr"], "4.75")
        self.assertEqual(result["Mo"], "1.25")
        self.assertEqual(result["Mn"], "0")

    def test_extracts_json_string_wrapped_in_markdown(self):
        result = extract_dify_composition(
            {
                "data": {
                    "outputs": {
                        "text": "```json\n{\"reasoning_content\": {\"C\": 1.5, \"Cr\": 12}}\n```"
                    }
                }
            }
        )

        self.assertEqual(result["C"], "1.5")
        self.assertEqual(result["Cr"], "12")

    def test_rejects_invalid_composition_total(self):
        with self.assertRaisesRegex(DifyCompositionError, "合计超过"):
            extract_dify_composition({"reasoning_content": {"C": 60, "Cr": 60}})


if __name__ == "__main__":
    unittest.main()
