import logging
import sys
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import ResponseValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings
from app.routers import (
    auth,
    dashboard,
    inventory,
    invoices,
    items,
    operation_logs,
    outsource,
    parties,
    payments,
    procurement,
    reconciliations,
    sales,
    smelting,
    steelmaking,
    users,
)
from app.utils.operation_log import operation_log_middleware

settings = get_settings()
logger = logging.getLogger(__name__)

app = FastAPI(title=settings.app_name, debug=settings.debug)


@app.exception_handler(ResponseValidationError)
async def response_validation_error_handler(request: Request, exc: ResponseValidationError) -> JSONResponse:
    """响应契约异常统一返回结构化错误，避免前端只收到纯文本 500。"""
    safe_errors = [
        {key: error[key] for key in ("type", "loc", "msg") if key in error}
        for error in exc.errors()
    ]
    logger.error(
        "Response validation failed for %s %s: %s",
        request.method,
        request.url.path,
        safe_errors,
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "服务器返回的数据格式异常，请刷新后重试；如问题持续请联系管理员",
            "error_code": "RESPONSE_VALIDATION_ERROR",
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """未预期异常不暴露内部堆栈，但始终给前端可展示的 JSON。"""
    logger.error(
        "Unhandled error for %s %s",
        request.method,
        request.url.path,
        exc_info=(type(exc), exc, exc.__traceback__),
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "服务器处理请求失败，请稍后重试",
            "error_code": "INTERNAL_SERVER_ERROR",
        },
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.middleware("http")(operation_log_middleware)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(users.router, prefix=settings.api_prefix)
app.include_router(parties.router, prefix=settings.api_prefix)
app.include_router(items.router, prefix=settings.api_prefix)
app.include_router(inventory.router, prefix=settings.api_prefix)
app.include_router(operation_logs.router, prefix=settings.api_prefix)
app.include_router(payments.router, prefix=settings.api_prefix)
app.include_router(invoices.router, prefix=settings.api_prefix)
app.include_router(reconciliations.router, prefix=settings.api_prefix)
app.include_router(smelting.router, prefix=settings.api_prefix)
app.include_router(steelmaking.router, prefix=settings.api_prefix)
app.include_router(outsource.router, prefix=settings.api_prefix)
app.include_router(procurement.router, prefix=settings.api_prefix)
app.include_router(sales.router, prefix=settings.api_prefix)
app.include_router(dashboard.router, prefix=settings.api_prefix)


if __name__ == "__main__":
    import uvicorn

    backend_dir = Path(__file__).resolve().parents[1]
    uvicorn.run(
        "app.main:app",
        host=settings.backend_host,
        port=settings.backend_port,
        reload=True,
        reload_dirs=[str(backend_dir)],
    )
