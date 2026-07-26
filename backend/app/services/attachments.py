from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.attachment import BusinessAttachment


def ensure_voucher_directory(entity_type: str | None = None, entity_id: int | None = None) -> Path:
    directory = get_settings().upload_dir / "vouchers"
    if entity_type is not None:
        directory /= entity_type
    if entity_id is not None:
        directory /= str(entity_id)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def attachment_file_path(attachment: BusinessAttachment) -> Path:
    root = ensure_voucher_directory().resolve()
    candidate = (root / attachment.storage_name).resolve()
    if root not in candidate.parents:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="凭证文件不存在")
    return candidate


@dataclass
class StagedAttachmentDeletion:
    root: Path
    files: list[tuple[Path, Path]] = field(default_factory=list)

    def finalize(self) -> None:
        parents: set[Path] = set()
        for _original, staged in self.files:
            staged.unlink(missing_ok=True)
            parents.add(staged.parent)
        for directory in sorted(parents, key=lambda item: len(item.parts), reverse=True):
            current = directory
            while current != self.root:
                try:
                    current.rmdir()
                except OSError:
                    break
                current = current.parent

    def restore(self) -> None:
        for original, staged in reversed(self.files):
            if staged.exists() and not original.exists():
                staged.replace(original)


async def stage_business_attachment_deletion(
    db: AsyncSession,
    entity_type: str,
    entity_ids: list[int] | tuple[int, ...] | set[int],
) -> StagedAttachmentDeletion:
    root = ensure_voucher_directory().resolve()
    staged_deletion = StagedAttachmentDeletion(root=root)
    unique_ids = list(set(entity_ids))
    if not unique_ids:
        return staged_deletion

    attachments = list(
        await db.scalars(
            select(BusinessAttachment).where(
                BusinessAttachment.entity_type == entity_type,
                BusinessAttachment.entity_id.in_(unique_ids),
            )
        )
    )
    try:
        for attachment in attachments:
            original = attachment_file_path(attachment)
            if original.is_file():
                staged = original.with_name(f".{original.name}.{uuid4().hex}.deleting")
                original.replace(staged)
                staged_deletion.files.append((original, staged))
            await db.delete(attachment)
    except Exception:
        staged_deletion.restore()
        raise
    return staged_deletion
