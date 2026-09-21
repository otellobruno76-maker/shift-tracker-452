from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from lib import payslip_ai


def app_client() -> TestClient:
    app = FastAPI()
    app.include_router(payslip_ai.router, prefix="/api")
    return TestClient(app)


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


def test_risposta_ai_incompleta_resta_null(monkeypatch):
    install_success(monkeypatch, payslip_ai.PayslipAIResult(pay_type="unknown"))
    body = app_client().post("/api/analyze-payslip-ai", files={"file": ("x.pdf", b"%PDF-ok", "application/pdf")}).json()
    assert body["hourly_pay"] is None
    assert body["level"] is None
    assert body["overtime_rates"] == []


def test_errore_api_sicuro(monkeypatch):
    async def broken(*_args, **_kwargs):
        raise RuntimeError("provider detail that must not leak")
    monkeypatch.setattr(payslip_ai, "analyze_document_with_ai", broken)
    response = app_client().post("/api/analyze-payslip-ai", files={"file": ("x.pdf", b"%PDF-ok", "application/pdf")})
    assert response.status_code == 502
    assert "provider detail" not in response.text


def test_assenza_chiave_api(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    response = app_client().post("/api/analyze-payslip-ai", files={"file": ("x.pdf", b"%PDF-ok", "application/pdf")})
    assert response.status_code == 503
    assert response.json()["detail"] == "Analisi AI non configurata"
