import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.routers.media import detect_image_type, ensure_upload_directories, find_image


class MediaUploadTests(unittest.TestCase):
    def test_detects_supported_image_signatures(self):
        self.assertEqual(detect_image_type(b"\x89PNG\r\n\x1a\nrest"), ("image/png", ".png"))
        self.assertEqual(detect_image_type(b"\xff\xd8\xffrest"), ("image/jpeg", ".jpg"))
        self.assertEqual(detect_image_type(b"RIFF1234WEBPrest"), ("image/webp", ".webp"))
        self.assertIsNone(detect_image_type(b"not-an-image"))

    def test_upload_directories_are_created_when_missing(self):
        with tempfile.TemporaryDirectory() as temporary:
            upload_root = Path(temporary) / "missing" / "uploads"
            with patch("app.routers.media.get_settings", return_value=SimpleNamespace(upload_dir=upload_root)):
                company_dir, avatar_dir = ensure_upload_directories()

            self.assertTrue(company_dir.is_dir())
            self.assertTrue(avatar_dir.is_dir())

    def test_find_image_uses_generated_safe_filename(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            expected = directory / "user-7.png"
            expected.write_bytes(b"\x89PNG\r\n\x1a\n")
            self.assertEqual(find_image(directory, "user-7"), expected)


if __name__ == "__main__":
    unittest.main()
