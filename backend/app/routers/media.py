from io import BytesIO
from pathlib import Path
from time import time_ns
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.attachment import BusinessAttachment
from app.models.outsource import OutsourceOrder
from app.models.procurement import ProcurementOrder
from app.models.sales import SalesOrder
from app.models.smelting import SmeltingOrder
from app.models.steelmaking import SteelmakingRecord
from app.models.user import User
from app.schemas.media import BusinessAttachmentRead, ImageUploadResponse
from app.services.attachments import attachment_file_path, ensure_voucher_directory
from app.utils.deps import get_current_user, require_roles

router = APIRouter(prefix="/media", tags=["media"])

MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_VOUCHER_BYTES = 10 * 1024 * 1024
MAX_VOUCHERS_PER_ENTITY = 20
Image.MAX_IMAGE_PIXELS = 40_000_000
IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
BUSINESS_ENTITY_MODELS = {
    "steelmaking_record": SteelmakingRecord,
    "smelting_order": SmeltingOrder,
    "outsource_order": OutsourceOrder,
    "procurement_order": ProcurementOrder,
    "sales_order": SalesOrder,
}


def ensure_upload_directories() -> tuple[Path, Path]:
    root = get_settings().upload_dir
    company_dir = root / "company"
    avatar_dir = root / "avatars"
    company_dir.mkdir(parents=True, exist_ok=True)
    avatar_dir.mkdir(parents=True, exist_ok=True)
    return company_dir, avatar_dir


def detect_image_type(content: bytes) -> tuple[str, str] | None:
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", ".png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", ".jpg"
    if len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return "image/webp", ".webp"
    return None


def find_image(directory: Path, stem: str) -> Path | None:
    for suffix in IMAGE_TYPES.values():
        candidate = directory / f"{stem}{suffix}"
        if candidate.is_file():
            return candidate
    return None


async def save_image(file: UploadFile, directory: Path, stem: str, max_bytes: int = MAX_IMAGE_BYTES) -> Path:
    content = await file.read(max_bytes + 1)
    await file.close()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请选择要上传的图片")
    if len(content) > max_bytes:
        size_mb = max_bytes // (1024 * 1024)
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=f"图片大小不能超过 {size_mb}MB")

    detected = detect_image_type(content)
    if detected is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅支持 JPG、PNG 或 WebP 图片")
    _media_type, suffix = detected

    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"{stem}{suffix}"
    temporary = directory / f".{stem}-{time_ns()}.upload"
    temporary.write_bytes(content)
    try:
        for old_suffix in IMAGE_TYPES.values():
            old_path = directory / f"{stem}{old_suffix}"
            if old_path != target and old_path.exists():
                old_path.unlink()
        temporary.replace(target)
    finally:
        if temporary.exists():
            temporary.unlink()

    return target


async def save_voucher_as_webp(file: UploadFile, directory: Path, stem: str) -> Path:
    content = await file.read(MAX_VOUCHER_BYTES + 1)
    await file.close()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请选择要上传的图片")
    if len(content) > MAX_VOUCHER_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="图片大小不能超过 10MB")
    if detect_image_type(content) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅支持 JPG、PNG 或 WebP 图片")

    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"{stem}.webp"
    temporary = directory / f".{stem}-{time_ns()}.upload"
    try:
        with Image.open(BytesIO(content)) as source:
            source.seek(0)
            if source.width * source.height > Image.MAX_IMAGE_PIXELS:
                raise ValueError("image dimensions exceed voucher limit")
            source.load()
            converted = ImageOps.exif_transpose(source)
            has_alpha = converted.mode in {"RGBA", "LA"} or "transparency" in converted.info
            output = converted.convert("RGBA" if has_alpha else "RGB")
            output.save(temporary, format="WEBP", quality=82, method=6)
        temporary.replace(target)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        temporary.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="图片内容损坏或尺寸异常，无法转换为 WebP") from exc
    finally:
        temporary.unlink(missing_ok=True)
    return target


def attachment_read(
    attachment: BusinessAttachment,
    uploader_name: str | None = None,
) -> BusinessAttachmentRead:
    return BusinessAttachmentRead(
        id=attachment.id,
        entity_type=attachment.entity_type,
        entity_id=attachment.entity_id,
        original_name=attachment.original_name,
        content_type=attachment.content_type,
        file_size=attachment.file_size,
        uploaded_by=attachment.uploaded_by,
        uploader_name=uploader_name,
        created_at=attachment.created_at,
        # The frontend API client already prefixes requests with /api/v1 (or the
        # configured VITE_API_BASE). Returning an API-prefixed path here would
        # make Axios request /api/v1/api/v1/... when loading the protected file.
        url=f"/media/business-attachment-files/{attachment.id}",
    )


def require_business_entity_type(entity_type: str):
    model = BUSINESS_ENTITY_MODELS.get(entity_type)
    if model is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持该业务模块的凭证")
    return model


def image_response(path: Path) -> FileResponse:
    media_type = next((kind for kind, suffix in IMAGE_TYPES.items() if suffix == path.suffix), "application/octet-stream")
    return FileResponse(
        path,
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=0, must-revalidate",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/company-logo")
async def get_company_logo() -> FileResponse:
    company_dir, _avatar_dir = ensure_upload_directories()
    logo = find_image(company_dir, "logo")
    if logo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="企业 Logo 尚未上传")
    return image_response(logo)


@router.post("/company-logo", response_model=ImageUploadResponse)
async def upload_company_logo(
    file: UploadFile = File(...),
    _current_user: User = Depends(require_roles("admin")),
) -> ImageUploadResponse:
    company_dir, _avatar_dir = ensure_upload_directories()
    await save_image(file, company_dir, "logo")
    return ImageUploadResponse(
        url=f"{get_settings().api_prefix}/media/company-logo?v={time_ns()}",
        message="企业 Logo 已更新",
    )


@router.get("/avatars/{user_id}")
async def get_user_avatar(user_id: int) -> FileResponse:
    _company_dir, avatar_dir = ensure_upload_directories()
    avatar = find_image(avatar_dir, f"user-{user_id}")
    if avatar is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户头像尚未上传")
    return image_response(avatar)


@router.post("/me/avatar", response_model=ImageUploadResponse)
async def upload_my_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
) -> ImageUploadResponse:
    _company_dir, avatar_dir = ensure_upload_directories()
    await save_image(file, avatar_dir, f"user-{current_user.id}")
    return ImageUploadResponse(
        url=f"{get_settings().api_prefix}/media/avatars/{current_user.id}?v={time_ns()}",
        message="个人头像已更新",
    )


@router.get(
    "/business-attachments/{entity_type}/{entity_id}",
    response_model=list[BusinessAttachmentRead],
)
async def list_business_attachments(
    entity_type: str,
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> list[BusinessAttachmentRead]:
    require_business_entity_type(entity_type)
    rows = (
        await db.execute(
            select(BusinessAttachment, User.real_name, User.username)
            .outerjoin(User, User.id == BusinessAttachment.uploaded_by)
            .where(
                BusinessAttachment.entity_type == entity_type,
                BusinessAttachment.entity_id == entity_id,
            )
            .order_by(BusinessAttachment.id.asc())
        )
    ).all()
    return [attachment_read(row[0], row[1] or row[2]) for row in rows]


@router.post(
    "/business-attachments/{entity_type}/{entity_id}",
    response_model=BusinessAttachmentRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_business_attachment(
    entity_type: str,
    entity_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "accountant")),
) -> BusinessAttachmentRead:
    model = require_business_entity_type(entity_type)
    if await db.get(model, entity_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="关联的业务单据不存在")

    count = await db.scalar(
        select(func.count(BusinessAttachment.id)).where(
            BusinessAttachment.entity_type == entity_type,
            BusinessAttachment.entity_id == entity_id,
        )
    )
    if (count or 0) >= MAX_VOUCHERS_PER_ENTITY:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"每张单据最多上传 {MAX_VOUCHERS_PER_ENTITY} 张凭证")

    original_name = Path(file.filename or "凭证图片").name[:255]
    directory = ensure_voucher_directory(entity_type, entity_id)
    stem = uuid4().hex
    target = await save_voucher_as_webp(file, directory, stem)
    storage_name = target.relative_to(ensure_voucher_directory()).as_posix()
    attachment = BusinessAttachment(
        entity_type=entity_type,
        entity_id=entity_id,
        original_name=original_name,
        storage_name=storage_name,
        content_type="image/webp",
        file_size=target.stat().st_size,
        uploaded_by=current_user.id,
    )
    db.add(attachment)
    try:
        await db.commit()
        await db.refresh(attachment)
    except Exception:
        await db.rollback()
        target.unlink(missing_ok=True)
        raise
    return attachment_read(attachment, current_user.real_name or current_user.username)


@router.get("/business-attachment-files/{attachment_id}")
async def get_business_attachment_file(
    attachment_id: int,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> FileResponse:
    attachment = await db.get(BusinessAttachment, attachment_id)
    if attachment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="凭证不存在")
    path = attachment_file_path(attachment)
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="凭证文件不存在")
    response = image_response(path)
    response.headers["Content-Disposition"] = f'inline; filename="voucher-{attachment.id}{path.suffix}"'
    response.headers["Cache-Control"] = "private, max-age=0, must-revalidate"
    return response


@router.delete("/business-attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_business_attachment(
    attachment_id: int,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(require_roles("admin", "accountant")),
) -> None:
    attachment = await db.get(BusinessAttachment, attachment_id)
    if attachment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="凭证不存在")
    path = attachment_file_path(attachment)
    await db.delete(attachment)
    await db.commit()
    path.unlink(missing_ok=True)
