"""Security checks for the pre-multipart AI admission controls."""

import asyncio

import httpx
import pytest
from fastapi import FastAPI
from starlette import formparsers
from starlette.middleware.cors import CORSMiddleware

from lib import payslip_ai
from lib.ai_protection import AIProtectionConfig, install_ai_protection
from payslip_server import app as payslip_app


def protected_app(monkeypatch, **settings):
    for key, value in settings.items():
        monkeypatch.setenv(key, str(value))
    app = FastAPI()
    app.include_router(payslip_ai.router, prefix="/api")
    install_ai_protection(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_methods=["POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    return app


def install_fake_ai(monkeypatch):
    calls = []

    async def fake(*args):
        calls.append(args)
        return payslip_ai.PayslipAIResult(pay_type="unknown")

    monkeypatch.setattr(payslip_ai, "analyze_document_with_ai", fake)
    return calls


def pdf(data=b"%PDF-fixture"):
    return {"file": ("cedolino.pdf", data, "application/pdf")}


def multipart(data, boundary=b"test-boundary"):
    return (
        b"--" + boundary + b"\r\n"
        b'Content-Disposition: form-data; name="file"; filename="x.pdf"\r\n'
        b"Content-Type: application/pdf\r\n\r\n"
        + data + b"\r\n--" + boundary + b"--\r\n"
    )


def upload_scope():
    return {
        "type": "http", "http_version": "1.1", "method": "POST", "path": "/api/analyze-payslip-ai",
        "raw_path": b"/api/analyze-payslip-ai", "root_path": "", "scheme": "http", "query_string": b"",
        "headers": [(b"content-type", b"multipart/form-data; boundary=test-boundary")],
        "client": ("198.51.100.4", 1234), "server": ("test", 80),
    }


async def chunks(data):
    for offset in range(0, len(data), 100):
        yield data[offset:offset + 100]


@pytest.mark.asyncio
async def test_file_within_configured_limit_is_accepted(monkeypatch):
    calls = install_fake_ai(monkeypatch)
    app = protected_app(monkeypatch, AI_MAX_UPLOAD_BYTES=256, AI_MULTIPART_OVERHEAD_BYTES=1024)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/analyze-payslip-ai", files=pdf(b"%PDF-" + b"x" * 251))
    assert response.status_code == 200
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_file_above_exact_limit_is_413_without_openai(monkeypatch):
    calls = install_fake_ai(monkeypatch)
    app = protected_app(monkeypatch, AI_MAX_UPLOAD_BYTES=256, AI_MULTIPART_OVERHEAD_BYTES=1024)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/analyze-payslip-ai", files=pdf(b"%PDF-" + b"x" * 252))
    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "UPLOAD_TOO_LARGE"
    assert calls == []


@pytest.mark.parametrize("declared_length", [b"1281", b"9" * 5000])
@pytest.mark.asyncio
async def test_large_content_length_rejected_before_reading_body(monkeypatch, declared_length):
    calls = install_fake_ai(monkeypatch)
    app = protected_app(monkeypatch, AI_MAX_UPLOAD_BYTES=256, AI_MULTIPART_OVERHEAD_BYTES=1024)
    body_read = False

    async def receive():
        nonlocal body_read
        body_read = True
        raise AssertionError("body must not be read")

    messages = []

    async def send(message):
        messages.append(message)

    await app(
        {
            "type": "http", "http_version": "1.1", "method": "POST", "path": "/api/analyze-payslip-ai",
            "raw_path": b"/api/analyze-payslip-ai", "root_path": "", "scheme": "http", "query_string": b"",
            "headers": [(b"content-length", declared_length)], "client": ("198.51.100.4", 1234),
            "server": ("test", 80),
        },
        receive,
        send,
    )
    assert messages[0]["status"] == 413
    assert not body_read
    assert calls == []


@pytest.mark.parametrize("headers", [
    {"Content-Type": "multipart/form-data; boundary=test-boundary"},
    {"Content-Type": "multipart/form-data; boundary=test-boundary", "Content-Length": "10"},
])
@pytest.mark.asyncio
async def test_streaming_over_cap_returns_413_and_releases_slot(monkeypatch, headers):
    calls = install_fake_ai(monkeypatch)
    app = protected_app(
        monkeypatch, AI_MAX_UPLOAD_BYTES=256, AI_MULTIPART_OVERHEAD_BYTES=1024,
        AI_MAX_CONCURRENT_ANALYSES=1,
    )
    body = multipart(b"%PDF-" + b"x" * 1300)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/analyze-payslip-ai", content=chunks(body), headers=headers)
        followup = await client.post("/api/analyze-payslip-ai", files=pdf())
    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "UPLOAD_TOO_LARGE"
    assert followup.status_code == 200
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_stalled_upload_times_out_closes_file_and_releases_slot(monkeypatch):
    calls = install_fake_ai(monkeypatch)
    app = protected_app(monkeypatch, AI_UPLOAD_TIMEOUT_SECONDS=1, AI_MAX_CONCURRENT_ANALYSES=1)
    opened_files = []
    original_spooled_file = formparsers.SpooledTemporaryFile

    def tracked_spooled_file(*args, **kwargs):
        file = original_spooled_file(*args, **kwargs)
        opened_files.append(file)
        return file

    monkeypatch.setattr(formparsers, "SpooledTemporaryFile", tracked_spooled_file)
    body = multipart(b"%PDF-partial")
    partial_body = body[:body.index(b"%PDF-partial") + len(b"%PDF-partial")]
    received = 0

    async def receive():
        nonlocal received
        received += 1
        if received == 1:
            return {"type": "http.request", "body": partial_body, "more_body": True}
        await asyncio.Event().wait()

    messages = []

    async def send(message):
        messages.append(message)

    await asyncio.wait_for(app(upload_scope(), receive, send), 5)
    assert messages[0]["status"] == 408
    assert b'"code":"UPLOAD_TIMEOUT"' in messages[1]["body"]
    assert received == 2
    assert opened_files and all(file.closed for file in opened_files)
    assert app.state.ai_protection._active == 0
    assert calls == []

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        followup = await client.post("/api/analyze-payslip-ai", files=pdf())
    assert followup.status_code == 200
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_trickle_upload_has_total_deadline_not_per_chunk_idle_timeout(monkeypatch):
    calls = install_fake_ai(monkeypatch)
    app = protected_app(monkeypatch, AI_UPLOAD_TIMEOUT_SECONDS=1, AI_MAX_CONCURRENT_ANALYSES=1)
    chunks_sent = 0
    body = multipart(b"%PDF-partial")
    partial_body = body[:body.index(b"%PDF-partial") + len(b"%PDF-partial")]

    async def receive():
        nonlocal chunks_sent
        if chunks_sent:
            await asyncio.sleep(0.1)
        chunks_sent += 1
        return {"type": "http.request", "body": partial_body if chunks_sent == 1 else b"x", "more_body": True}

    messages = []

    async def send(message):
        messages.append(message)

    await asyncio.wait_for(app(upload_scope(), receive, send), 5)
    assert messages[0]["status"] == 408
    assert b'"code":"UPLOAD_TIMEOUT"' in messages[1]["body"]
    assert 2 <= chunks_sent < 20
    assert app.state.ai_protection._active == 0
    assert calls == []


@pytest.mark.parametrize("value", ["0", "-1", "nan", "inf", "-inf"])
def test_upload_timeout_requires_positive_finite_value(monkeypatch, value):
    monkeypatch.setenv("AI_UPLOAD_TIMEOUT_SECONDS", value)
    with pytest.raises(ValueError, match="AI_UPLOAD_TIMEOUT_SECONDS"):
        AIProtectionConfig.from_env()


@pytest.mark.asyncio
async def test_rate_limit_is_429_and_skips_openai(monkeypatch):
    calls = install_fake_ai(monkeypatch)
    app = protected_app(monkeypatch, AI_RATE_LIMIT_REQUESTS=1, AI_RATE_LIMIT_WINDOW_SECONDS=47)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        first = await client.post("/api/analyze-payslip-ai", files=pdf())
        second = await client.post("/api/analyze-payslip-ai", files=pdf())
    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json()["detail"] == {
        "code": "AI_RATE_LIMIT", "message": "Troppe richieste. Riprova tra poco.",
    }
    assert 1 <= int(second.headers["Retry-After"]) <= 47
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_concurrency_limit_rejects_without_waiting_or_openai(monkeypatch):
    entered = asyncio.Event()
    release = asyncio.Event()
    calls = []

    async def slow(*args):
        calls.append(args)
        entered.set()
        await release.wait()
        return payslip_ai.PayslipAIResult(pay_type="unknown")

    monkeypatch.setattr(payslip_ai, "analyze_document_with_ai", slow)
    app = protected_app(monkeypatch, AI_MAX_CONCURRENT_ANALYSES=1)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        first_task = asyncio.create_task(client.post("/api/analyze-payslip-ai", files=pdf()))
        await asyncio.wait_for(entered.wait(), 2)
        busy = await asyncio.wait_for(client.post("/api/analyze-payslip-ai", files=pdf()), 2)
        release.set()
        first = await first_task
        after_release = await client.post("/api/analyze-payslip-ai", files=pdf())
    assert busy.status_code == 503
    assert busy.json()["detail"]["code"] == "AI_BUSY"
    assert first.status_code == after_release.status_code == 200
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_busy_request_is_rejected_before_reading_multipart(monkeypatch):
    entered = asyncio.Event()
    release = asyncio.Event()

    async def slow(*args):
        entered.set()
        await release.wait()
        return payslip_ai.PayslipAIResult(pay_type="unknown")

    monkeypatch.setattr(payslip_ai, "analyze_document_with_ai", slow)
    app = protected_app(monkeypatch, AI_MAX_CONCURRENT_ANALYSES=1)
    body_read = False

    async def receive():
        nonlocal body_read
        body_read = True
        raise AssertionError("busy request body must not be read")

    messages = []

    async def send(message):
        messages.append(message)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        first_task = asyncio.create_task(client.post("/api/analyze-payslip-ai", files=pdf()))
        await asyncio.wait_for(entered.wait(), 2)
        await app(
            {
                "type": "http", "http_version": "1.1", "method": "POST", "path": "/api/analyze-payslip-ai",
                "raw_path": b"/api/analyze-payslip-ai", "root_path": "", "scheme": "http", "query_string": b"",
                "headers": [(b"content-length", b"100")], "client": ("198.51.100.5", 1234),
                "server": ("test", 80),
            },
            receive,
            send,
        )
        release.set()
        assert (await first_task).status_code == 200
    assert messages[0]["status"] == 503
    assert not body_read


@pytest.mark.asyncio
async def test_daily_process_cap_prevents_additional_openai_call(monkeypatch):
    calls = install_fake_ai(monkeypatch)
    app = protected_app(monkeypatch, AI_DAILY_ANALYSIS_LIMIT=1, AI_RATE_LIMIT_REQUESTS=10)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        first = await client.post("/api/analyze-payslip-ai", files=pdf())
        second = await client.post("/api/analyze-payslip-ai", files=pdf())
    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json()["detail"] == {
        "code": "AI_DAILY_LIMIT", "message": "Limite giornaliero del servizio AI raggiunto",
    }
    assert 1 <= int(second.headers["Retry-After"]) <= 86_400
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_exhausted_daily_quota_takes_priority_over_rate_limit(monkeypatch):
    calls = install_fake_ai(monkeypatch)
    app = protected_app(monkeypatch, AI_DAILY_ANALYSIS_LIMIT=1, AI_RATE_LIMIT_REQUESTS=1)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        first = await client.post("/api/analyze-payslip-ai", files=pdf())
        second = await client.post("/api/analyze-payslip-ai", files=pdf())
    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json()["detail"]["code"] == "AI_DAILY_LIMIT"
    assert 1 <= int(second.headers["Retry-After"]) <= 86_400
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_untrusted_forwarded_headers_cannot_rotate_rate_identity(monkeypatch):
    calls = install_fake_ai(monkeypatch)
    app = protected_app(monkeypatch, AI_RATE_LIMIT_REQUESTS=1)
    transport = httpx.ASGITransport(app=app, client=("198.51.100.4", 4444))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.post(
            "/api/analyze-payslip-ai", files=pdf(),
            headers={"X-Forwarded-For": "192.0.2.1", "X-Real-IP": "192.0.2.2", "Forwarded": "for=192.0.2.3"},
        )
        second = await client.post(
            "/api/analyze-payslip-ai", files=pdf(),
            headers={"X-Forwarded-For": "192.0.2.99", "X-Real-IP": "192.0.2.98", "Forwarded": "for=192.0.2.97"},
        )
    assert first.status_code == 200
    assert second.status_code == 429
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_trusted_proxy_uses_first_untrusted_hop_from_right(monkeypatch):
    calls = install_fake_ai(monkeypatch)
    app = protected_app(monkeypatch, AI_RATE_LIMIT_REQUESTS=1, AI_TRUSTED_PROXY_CIDRS="10.0.0.0/8")
    transport = httpx.ASGITransport(app=app, client=("10.0.0.1", 4444))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.post("/api/analyze-payslip-ai", files=pdf(), headers={"X-Forwarded-For": "192.0.2.1, 203.0.113.8"})
        spoofed = await client.post("/api/analyze-payslip-ai", files=pdf(), headers={"X-Forwarded-For": "192.0.2.99, 203.0.113.8"})
        another = await client.post("/api/analyze-payslip-ai", files=pdf(), headers={"X-Forwarded-For": "192.0.2.1, 203.0.113.9"})
    assert first.status_code == another.status_code == 200
    assert spoofed.status_code == 429
    assert len(calls) == 2


@pytest.mark.parametrize("cidr", ["0.0.0.0/0", "::/0"])
def test_trusting_entire_internet_is_rejected(monkeypatch, cidr):
    monkeypatch.setenv("AI_TRUSTED_PROXY_CIDRS", cidr)
    with pytest.raises(ValueError, match="cannot trust"):
        AIProtectionConfig.from_env()


@pytest.mark.asyncio
async def test_cors_headers_on_preflight_and_rejections(monkeypatch):
    install_fake_ai(monkeypatch)
    app = protected_app(
        monkeypatch, AI_MAX_UPLOAD_BYTES=256, AI_MULTIPART_OVERHEAD_BYTES=1024,
        AI_RATE_LIMIT_REQUESTS=1,
    )
    origin = "http://localhost:3000"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        preflight = await client.options(
            "/api/analyze-payslip-ai",
            headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
        )
        too_large = await client.post(
            "/api/analyze-payslip-ai", files=pdf(b"%PDF-" + b"x" * 1300),
            headers={"Origin": origin},
        )
        accepted = await client.post("/api/analyze-payslip-ai", files=pdf(), headers={"Origin": origin})
        limited = await client.post("/api/analyze-payslip-ai", files=pdf(), headers={"Origin": origin})
    assert preflight.status_code == 200
    assert too_large.status_code == 413
    assert accepted.status_code == 200
    assert limited.status_code == 429
    for response in (preflight, too_large, limited):
        assert response.headers["Access-Control-Allow-Origin"] == origin


@pytest.mark.asyncio
async def test_actual_app_exposes_retry_after_to_browser(monkeypatch):
    monkeypatch.setattr(payslip_app.state.ai_protection, "check_rate", lambda _key: 11)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=payslip_app), base_url="http://test") as client:
        response = await client.post(
            "/api/analyze-payslip-ai", files=pdf(), headers={"Origin": "http://localhost:3000"},
        )
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "AI_RATE_LIMIT"
    assert response.headers["Retry-After"] == "11"
    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"
    assert "retry-after" in response.headers["Access-Control-Expose-Headers"].lower()
