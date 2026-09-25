"""Minimal FastAPI entry point for the optional payslip AI service.

This process deliberately has no database dependency: uploaded documents remain
transient and the frontend continues to own all confirmed payslip data locally.
"""

from __future__ import annotations

import os

from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from lib.payslip_ai import router as payslip_ai_router, safe_metrics


def _cors_origins() -> list[str]:
    value = os.getenv("CORS_ORIGINS", "http://localhost:3000")
    return [origin.strip() for origin in value.split(",") if origin.strip()]


app = FastAPI(title="Cedolino Chiaro AI", docs_url=None, redoc_url=None)
api_router = APIRouter(prefix="/api")


@api_router.get("/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "ai": "configured" if os.getenv("OPENAI_API_KEY") else "not_configured",
        "model": os.getenv("OPENAI_PAYSLIP_MODEL", "gpt-4.1-mini"),
        "revision": os.getenv("RENDER_GIT_COMMIT", "local"),
    }


@api_router.get("/metrics")
async def metrics() -> dict[str, int]:
    return safe_metrics()


app.include_router(api_router)
app.include_router(payslip_ai_router, prefix="/api")
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=_cors_origins(),
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    expose_headers=["Server-Timing"],
)
