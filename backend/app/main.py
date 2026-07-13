import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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

app = FastAPI(title=settings.app_name, debug=settings.debug)

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
