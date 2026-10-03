"""Process-local admission controls for the optional payslip AI endpoint.

The ASGI middleware runs before FastAPI parses a multipart upload. The limits
are deliberately process-local: no authenticated user or shared store exists.
"""

from __future__ import annotations

import asyncio
import ipaddress
import math
import os
import threading
import time
from collections import OrderedDict, deque
from dataclasses import dataclass
from fastapi import FastAPI, HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


DEFAULT_MAX_UPLOAD_BYTES = 15 * 1024 * 1024
DEFAULT_MULTIPART_OVERHEAD_BYTES = 16 * 1024
AI_DAILY_LIMIT_CODE = "AI_DAILY_LIMIT"
AI_DAILY_LIMIT_MESSAGE = "Limite giornaliero del servizio AI raggiunto"


def _positive_int(name: str, default: int) -> int:
    value = int(os.getenv(name, str(default)))
    if value < 1:
        raise ValueError(f"{name} must be a positive integer")
    return value


def _positive_finite_float(name: str, default: float) -> float:
    value = float(os.getenv(name, str(default)))
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be a positive finite number")
    return value


@dataclass(frozen=True)
class AIProtectionConfig:
    max_upload_bytes: int
    multipart_overhead_bytes: int
    upload_timeout_seconds: float
    rate_limit_requests: int
    rate_limit_window_seconds: int
    rate_clients_max: int
    max_concurrent_analyses: int
    daily_analysis_limit: int
    trusted_proxy_cidrs: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]

    @classmethod
    def from_env(cls) -> AIProtectionConfig:
        cidrs = os.getenv("AI_TRUSTED_PROXY_CIDRS", "")
        trusted_proxy_cidrs = tuple(
            ipaddress.ip_network(part.strip(), strict=False)
            for part in cidrs.split(",") if part.strip()
        )
        if any(network.prefixlen == 0 for network in trusted_proxy_cidrs):
            raise ValueError("AI_TRUSTED_PROXY_CIDRS cannot trust the entire Internet")
        return cls(
            max_upload_bytes=_positive_int("AI_MAX_UPLOAD_BYTES", DEFAULT_MAX_UPLOAD_BYTES),
            multipart_overhead_bytes=_positive_int("AI_MULTIPART_OVERHEAD_BYTES", DEFAULT_MULTIPART_OVERHEAD_BYTES),
            upload_timeout_seconds=_positive_finite_float("AI_UPLOAD_TIMEOUT_SECONDS", 60.0),
            rate_limit_requests=_positive_int("AI_RATE_LIMIT_REQUESTS", 6),
            rate_limit_window_seconds=_positive_int("AI_RATE_LIMIT_WINDOW_SECONDS", 60),
            rate_clients_max=_positive_int("AI_RATE_CLIENTS_MAX", 10_000),
            max_concurrent_analyses=_positive_int("AI_MAX_CONCURRENT_ANALYSES", 2),
            daily_analysis_limit=_positive_int("AI_DAILY_ANALYSIS_LIMIT", 200),
            trusted_proxy_cidrs=trusted_proxy_cidrs,
        )

    @property
    def max_request_bytes(self) -> int:
        # Multipart boundaries and headers consume a little extra space.
        return self.max_upload_bytes + self.multipart_overhead_bytes


class AIProtection:
    """Short critical sections are shared safely across event loops and threads."""

    def __init__(self, config: AIProtectionConfig):
        self.config = config
        self._lock = threading.Lock()
        self._rate: OrderedDict[str, deque[float]] = OrderedDict()
        self._active = 0
        self._utc_day = int(time.time() // 86_400)
        self._daily_analyses = 0

    def _is_trusted_proxy(self, address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
        return any(address in network for network in self.config.trusted_proxy_cidrs)

    def client_key(self, scope: Scope) -> str:
        """Use the socket peer unless an explicitly trusted proxy supplied XFF.

        Uvicorn must run with --no-proxy-headers so scope.client is the real
        peer. Walking XFF from right to left ignores values supplied before
        the first untrusted hop.
        """
        peer = scope.get("client")
        peer_text = str(peer[0]) if peer else "unknown"
        try:
            address = ipaddress.ip_address(peer_text)
        except ValueError:
            return peer_text
        if not self._is_trusted_proxy(address):
            return address.compressed

        forwarded = [value for name, value in scope.get("headers", []) if name.lower() == b"x-forwarded-for"]
        if not forwarded:
            return address.compressed
        try:
            chain = b",".join(forwarded).decode("ascii").split(",")
            if len(chain) > 32:
                return address.compressed
            hops = [ipaddress.ip_address(part.strip()) for part in chain]
        except (UnicodeDecodeError, ValueError):
            return address.compressed
        for hop in reversed(hops):
            if not self._is_trusted_proxy(address):
                break
            address = hop
        return address.compressed

    def check_rate(self, key: str) -> int | None:
        """Return Retry-After seconds when the client exceeds its window."""
        now = time.monotonic()
        window = self.config.rate_limit_window_seconds
        with self._lock:
            # Buckets are ordered by their most recent attempt, so old peers
            # can be removed without scanning the whole map on every request.
            while self._rate and now - next(iter(self._rate.values()))[-1] >= window:
                self._rate.popitem(last=False)
            bucket = self._rate.get(key)
            if bucket is None:
                if len(self._rate) >= self.config.rate_clients_max:
                    return window
                bucket = deque()
                self._rate[key] = bucket
            while bucket and now - bucket[0] >= window:
                bucket.popleft()
            if len(bucket) >= self.config.rate_limit_requests:
                return max(1, math.ceil(window - (now - bucket[0])))
            bucket.append(now)
            self._rate.move_to_end(key)
        return None

    def acquire_slot(self) -> bool:
        with self._lock:
            if self._active >= self.config.max_concurrent_analyses:
                return False
            self._active += 1
            return True

    def release_slot(self) -> None:
        with self._lock:
            self._active -= 1

    def _daily_retry_after_locked(self, now: float) -> int | None:
        day = int(now // 86_400)
        if day != self._utc_day:
            self._utc_day = day
            self._daily_analyses = 0
        if self._daily_analyses >= self.config.daily_analysis_limit:
            return max(1, math.ceil((day + 1) * 86_400 - now))
        return None

    def check_daily_limit(self) -> int | None:
        """Check an exhausted quota before rate limiting, without claiming it."""
        with self._lock:
            return self._daily_retry_after_locked(time.time())

    def claim_daily_analysis(self) -> int | None:
        """Count validated documents admitted to an AI call, resetting at UTC midnight.

        A failed provider request still consumes an admission because it may
        incur cost. The claim remains atomic after document validation.
        """
        with self._lock:
            retry_after = self._daily_retry_after_locked(time.time())
            if retry_after is not None:
                return retry_after
            self._daily_analyses += 1
        return None


def _error(status: int, code: str, message: str, retry_after: int | None = None) -> JSONResponse:
    headers = {"Cache-Control": "no-store"}
    if retry_after is not None:
        headers["Retry-After"] = str(retry_after)
    return JSONResponse(
        status_code=status,
        content={"detail": {"code": code, "message": message}},
        headers=headers,
    )


class AIProtectionMiddleware:
    """Bound only POST /api/analyze-payslip-ai before multipart parsing."""

    def __init__(self, app: ASGIApp, guard: AIProtection):
        self.app = app
        self.guard = guard

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != "/api/analyze-payslip-ai":
            await self.app(scope, receive, send)
            return

        max_bytes = self.guard.config.max_request_bytes
        lengths = [value for name, value in scope.get("headers", []) if name.lower() == b"content-length"]
        if len(lengths) == 1 and lengths[0].isdigit() and (
            len(lengths[0]) > 20 or int(lengths[0]) > max_bytes
        ):
            await _error(413, "UPLOAD_TOO_LARGE", "Documento troppo grande")(scope, receive, send)
            return

        daily_retry_after = self.guard.check_daily_limit()
        if daily_retry_after is not None:
            await _error(429, AI_DAILY_LIMIT_CODE, AI_DAILY_LIMIT_MESSAGE, daily_retry_after)(scope, receive, send)
            return

        retry_after = self.guard.check_rate(self.guard.client_key(scope))
        if retry_after is not None:
            await _error(429, "AI_RATE_LIMIT", "Troppe richieste. Riprova tra poco.", retry_after)(scope, receive, send)
            return

        if not self.guard.acquire_slot():
            await _error(503, "AI_BUSY", "Servizio AI temporaneamente occupato", 5)(scope, receive, send)
            return

        received = 0
        upload_complete = False
        loop = asyncio.get_running_loop()
        upload_deadline = loop.time() + self.guard.config.upload_timeout_seconds
        timeout_detail = {"code": "UPLOAD_TIMEOUT", "message": "Caricamento del documento scaduto"}

        async def limited_receive() -> Message:
            nonlocal received, upload_complete
            if upload_complete:
                message = await receive()
            else:
                if loop.time() >= upload_deadline:
                    raise HTTPException(status_code=408, detail=timeout_detail)
                try:
                    async with asyncio.timeout_at(upload_deadline):
                        message = await receive()
                except TimeoutError as exc:
                    raise HTTPException(status_code=408, detail=timeout_detail) from exc
                if loop.time() >= upload_deadline:
                    raise HTTPException(status_code=408, detail=timeout_detail)
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > max_bytes:
                    # FastAPI preserves HTTPException while parsing the form,
                    # yielding a 413 before the route or OpenAI can run.
                    raise HTTPException(
                        status_code=413,
                        detail={"code": "UPLOAD_TOO_LARGE", "message": "Documento troppo grande"},
                    )
                if not message.get("more_body", False):
                    upload_complete = True
            return message

        try:
            await self.app(scope, limited_receive, send)
        finally:
            self.guard.release_slot()


def install_ai_protection(app: FastAPI) -> AIProtection:
    guard = AIProtection(AIProtectionConfig.from_env())
    app.state.ai_protection = guard
    app.add_middleware(AIProtectionMiddleware, guard=guard)
    return guard
