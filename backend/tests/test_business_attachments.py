from io import BytesIO
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from fastapi import UploadFile
from PIL import Image

from app.models.attachment import BusinessAttachment
from app.routers.media import BUSINESS_ENTITY_MODELS, MAX_VOUCHER_BYTES, attachment_read, save_voucher_as_webp
from app.services.attachments import StagedAttachmentDeletion, attachment_file_path, ensure_voucher_directory


class BusinessAttachmentTests(unittest.TestCase):
    def test_all_requested_business_modules_are_supported(self):
        self.assertEqual(
            set(BUSINESS_ENTITY_MODELS),
            {"steelmaking_record", "smelting_order", "outsource_order", "procurement_order", "sales_order"},
        )

    def test_voucher_directory_is_scoped_by_entity(self):
        with tempfile.TemporaryDirectory() as temporary:
            upload_root = Path(temporary) / "uploads"
            with patch("app.services.attachments.get_settings", return_value=SimpleNamespace(upload_dir=upload_root)):
                directory = ensure_voucher_directory("sales_order", 42)

            self.assertEqual(directory, upload_root / "vouchers" / "sales_order" / "42")
            self.assertTrue(directory.is_dir())

    def test_attachment_path_rejects_directory_traversal(self):
        with tempfile.TemporaryDirectory() as temporary:
            upload_root = Path(temporary) / "uploads"
            attachment = BusinessAttachment(storage_name="../outside.png")
            with patch("app.services.attachments.get_settings", return_value=SimpleNamespace(upload_dir=upload_root)):
                with self.assertRaises(HTTPException):
                    attachment_file_path(attachment)

    def test_voucher_size_limit_is_ten_megabytes(self):
        self.assertEqual(MAX_VOUCHER_BYTES, 10 * 1024 * 1024)

    def test_attachment_url_is_relative_to_the_frontend_api_base(self):
        attachment = BusinessAttachment(
            id=7,
            entity_type="sales_order",
            entity_id=42,
            original_name="凭证.jpg",
            storage_name="voucher.webp",
            content_type="image/webp",
            file_size=1024,
            uploaded_by=1,
            created_at=datetime(2026, 7, 27, 12, 0, 0),
        )

        result = attachment_read(attachment, "系统管理员")

        self.assertEqual(result.url, "/media/business-attachment-files/7")

    def test_staged_file_can_be_restored_after_transaction_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = root / "voucher.webp"
            staged = root / ".voucher.webp.deleting"
            original.write_bytes(b"webp")
            original.replace(staged)
            deletion = StagedAttachmentDeletion(root=root, files=[(original, staged)])

            deletion.restore()

            self.assertTrue(original.is_file())
            self.assertFalse(staged.exists())

    def test_staged_file_is_removed_after_transaction_commit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            entity_dir = root / "sales_order" / "7"
            entity_dir.mkdir(parents=True)
            staged = entity_dir / ".voucher.webp.deleting"
            staged.write_bytes(b"webp")
            deletion = StagedAttachmentDeletion(root=root, files=[(entity_dir / "voucher.webp", staged)])

            deletion.finalize()

            self.assertFalse(staged.exists())
            self.assertFalse(entity_dir.exists())


class VoucherWebpConversionTests(unittest.IsolatedAsyncioTestCase):
    async def test_png_upload_is_saved_as_webp(self):
        source = BytesIO()
        Image.new("RGB", (24, 16), (220, 20, 60)).save(source, format="PNG")
        source.seek(0)
        upload = UploadFile(file=source, filename="采购凭证.png")

        with tempfile.TemporaryDirectory() as temporary:
            target = await save_voucher_as_webp(upload, Path(temporary), "voucher")
            self.assertEqual(target.suffix, ".webp")
            with Image.open(target) as converted:
                self.assertEqual(converted.format, "WEBP")
                self.assertEqual(converted.size, (24, 16))


if __name__ == "__main__":
    unittest.main()
