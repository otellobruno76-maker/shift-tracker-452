from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from pydantic import ValidationError

from lib import payslip_ai
from payslip_server import app as payslip_app


def app_client() -> TestClient:
    app = FastAPI()
    app.include_router(payslip_ai.router, prefix="/api")
    return TestClient(app)


def test_servizio_ai_health_senza_database(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    response = TestClient(payslip_app).get("/api/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "ai": "not_configured",
        "model": "gpt-4.1-mini",
        "revision": "local",
    }


def result(**patch):
    data = dict(
        month=8, year=2026, qualification="Operaio a mese", level="2", contract_code="607",
        part_time_pct=65, pay_type="monthly", monthly_pay=931.38, hourly_pay=8.2826,
        fields={"hourly_pay": {"confidence": "medium", "evidence": "Dato Base ripetuto in due voci orarie"}},
    )
    data.update(patch)
    return payslip_ai.PayslipAIResult(**data)


def install_success(monkeypatch, value=None):
    async def fake(*_args, **_kwargs):
        return value or result()
    monkeypatch.setattr(payslip_ai, "analyze_document_with_ai", fake)


def test_pdf_valido(monkeypatch):
    install_success(monkeypatch)
    response = app_client().post("/api/analyze-payslip-ai", files={"file": ("cedolino.pdf", b"%PDF-1.7\nfixture", "application/pdf")})
    assert response.status_code == 200
    assert response.json()["level"] == "2"


@pytest.mark.parametrize("filename,mime,data", [
    ("cedolino.png", "image/png", b"\x89PNG\r\n\x1a\nfixture"),
    ("cedolino.jpg", "image/jpeg", b"\xff\xd8\xfffixture"),
])
def test_immagine_valida(monkeypatch, filename, mime, data):
    install_success(monkeypatch)
    assert app_client().post("/api/analyze-payslip-ai", files={"file": (filename, data, mime)}).status_code == 200


def test_mime_non_valido():
    response = app_client().post("/api/analyze-payslip-ai", files={"file": ("cedolino.txt", b"test", "text/plain")})
    assert response.status_code == 415


def test_file_troppo_grande():
    response = app_client().post("/api/analyze-payslip-ai", files={"file": ("cedolino.pdf", b"%PDF-" + b"x" * payslip_ai.MAX_PAYSLIP_BYTES, "application/pdf")})
    assert response.status_code == 413


def test_risposta_ai_valida(monkeypatch):
    install_success(monkeypatch)
    body = app_client().post("/api/analyze-payslip-ai", files={"file": ("x.pdf", b"%PDF-ok", "application/pdf")}).json()
    assert body["monthly_pay"] == 931.38
    assert body["hourly_pay"] == 8.2826
    assert body["daily_pay"] is None


def test_voci_normalizzate_conservano_descrizione_originale(monkeypatch):
    install_success(monkeypatch, result(line_items=[{
        "original_description": "Straord. 15%", "category": "overtime", "quantity": 4,
        "unit": "hours", "rate_pct": 15, "amount": 55, "confidence": "high",
        "evidence": "riga Straord. 15%",
    }]))
    body = app_client().post("/api/analyze-payslip-ai", files={"file": ("x.pdf", b"%PDF-ok", "application/pdf")}).json()
    assert body["line_items"][0]["original_description"] == "Straord. 15%"
    assert body["line_items"][0]["category"] == "overtime"


def test_risposta_ai_incompleta_resta_null(monkeypatch):
    install_success(monkeypatch, payslip_ai.PayslipAIResult(pay_type="unknown"))
    body = app_client().post("/api/analyze-payslip-ai", files={"file": ("x.pdf", b"%PDF-ok", "application/pdf")}).json()
    assert body["hourly_pay"] is None
    assert body["level"] is None
    assert body["overtime_rates"] == []


def test_dato_ai_non_valido_viene_rifiutato():
    with pytest.raises(ValidationError):
        payslip_ai.PayslipAIResult(month=13, pay_type="unknown")


def test_errore_api_sicuro(monkeypatch):
    async def broken(*_args, **_kwargs):
        raise payslip_ai.PayslipAIError("OPENAI_BAD_REQUEST")
    monkeypatch.setattr(payslip_ai, "analyze_document_with_ai", broken)
    response = app_client().post("/api/analyze-payslip-ai", files={"file": ("x.pdf", b"%PDF-ok", "application/pdf")})
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "OPENAI_BAD_REQUEST"


def test_assenza_chiave_api(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    response = app_client().post("/api/analyze-payslip-ai", files={"file": ("x.pdf", b"%PDF-ok", "application/pdf")})
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "AI_NOT_CONFIGURED"


def test_metriche_non_contengono_segreti_o_dati_documento(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "secret-di-test-da-non-esporre")
    payload = TestClient(payslip_app).get("/api/metrics").json()
    serialized = str(payload)
    assert "secret-di-test" not in serialized
    assert set(payload) == {"analyses", "success", "failure", "latency_ms_total", "retries", "input_tokens", "output_tokens"}


@pytest.mark.parametrize("code,status", [
    ("INVALID_API_KEY", 502), ("NO_API_CREDIT", 402), ("MODEL_NOT_AVAILABLE", 502),
    ("OPENAI_BAD_REQUEST", 502), ("OPENAI_TIMEOUT", 504), ("INVALID_AI_RESPONSE", 502),
])
def test_codici_diagnostici_sicuri(monkeypatch, code, status):
    async def broken(*_args, **_kwargs):
        raise payslip_ai.PayslipAIError(code)
    monkeypatch.setattr(payslip_ai, "analyze_document_with_ai", broken)
    response = app_client().post("/api/analyze-payslip-ai", files={"file": ("x.pdf", b"%PDF-ok", "application/pdf")})
    assert response.status_code == status
    assert response.json()["detail"] == {"code": code, "message": payslip_ai.ERROR_STATUS[code][1]}
