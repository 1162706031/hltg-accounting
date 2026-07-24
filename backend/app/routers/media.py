from pathlib import Path
from time import time_ns

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from app.config import get_settings
from app.models.user import User
from app.schemas.media import ImageUploadResponse
from app.utils.deps import get_current_user, require_roles

router = APIRouter(prefix="/media", tags=["media"])

MAX_IMAGE_BYTES = 2 * 1024 * 1024
IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
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


async def save_image(file: UploadFile, directory: Path, stem: str) -> Path:
    content = await file.read(MAX_IMAGE_BYTES + 1)
    await file.close()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请选择要上传的图片")
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="图片大小不能超过 2MB")

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
