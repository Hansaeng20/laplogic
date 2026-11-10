"""Laplogic API entry point (FastAPI). Vercel serves the ``app`` object."""

import logging
import os
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.errors import DataError
from routers.analysis import router as analysis_router
from routers.strategy import router as strategy_router

VERSION = "0.4.0"

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("laplogic")

app = FastAPI(
    title="Laplogic API",
    description="Simulator-agnostic race performance and strategy analysis",
    version=VERSION,
)

# Production traffic arrives through the frontend's same-origin /api rewrite,
# so CORS is only needed for local development or extra origins set here.
_origins = os.getenv(
    "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins.split(",") if o.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    request.state.request_id = request_id
    started = time.perf_counter()
    response = await call_next(request)
    elapsed = (time.perf_counter() - started) * 1000
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "%s %s -> %s (%.0f ms) [%s]",
        request.method, request.url.path, response.status_code, elapsed, request_id,
    )
    return response


@app.exception_handler(DataError)
async def data_error_handler(request: Request, exc: DataError):
    return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    messages = []
    for error in exc.errors():
        field = ".".join(str(p) for p in error.get("loc", [])[1:]) or "request"
        messages.append(f"{field}: {error.get('msg', 'invalid value')}")
    return JSONResponse(status_code=422, content={"detail": "; ".join(messages)})


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", "unknown")
    logger.exception("Unhandled error [%s]", request_id)
    return JSONResponse(
        status_code=500,
        content={
            "detail": (
                "Laplogic hit an unexpected error while processing this file. "
                f"Reference: {request_id}"
            )
        },
    )


app.include_router(analysis_router)
app.include_router(strategy_router)


@app.get("/")
def home():
    return {"message": "Welcome to Laplogic", "tagline": "Race Smarter. Lap Faster."}


@app.get("/api/health")
def health():
    return {"status": "running", "application": "Laplogic", "version": VERSION}
