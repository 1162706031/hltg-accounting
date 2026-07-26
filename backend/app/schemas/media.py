from datetime import datetime

from pydantic import BaseModel


class ImageUploadResponse(BaseModel):
    url: str
    message: str


class BusinessAttachmentRead(BaseModel):
    id: int
    entity_type: str
    entity_id: int
    original_name: str
    content_type: str
    file_size: int
    uploaded_by: int | None
    uploader_name: str | None = None
    created_at: datetime
    url: str
