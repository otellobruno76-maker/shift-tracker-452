"""Optional AI payslip analysis. Documents are transient and never persisted."""

from __future__ import annotations

import base64
import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Literal

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

router = APIRouter()
MAX_PAYSLIP_BYTES = 15 * 1024 * 1024
ALLOWED_MIME = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
logger = logging.getLogger(__name__)


class PayslipAIError(RuntimeError):
    """Stable, non-sensitive diagnostic code for the API boundary."""


ERROR_STATUS = {
    "AI_NOT_CONFIGURED": (503, "Chiave API non configurata"),
    "INVALID_API_KEY": (502, "Chiave API non valida"),
    "NO_API_CREDIT": (402, "Credito API non disponibile"),
    "MODEL_NOT_AVAILABLE": (502, "Modello AI non disponibile"),
    "OPENAI_BAD_REQUEST": (502, "Richiesta al servizio AI non valida"),
    "OPENAI_TIMEOUT": (504, "Il servizio AI non ha risposto in tempo"),
    "INVALID_AI_RESPONSE": (502, "Risposta AI non valida"),
}


class FieldEvidence(BaseModel):
    confidence: Literal["high", "medium", "low"]
    evidence: str


class Allowance(BaseModel):
    name: str
    amount: float | None = None


class PayslipAIResult(BaseModel):
    month: int | None = Field(default=None, ge=1, le=12)
    year: int | None = Field(default=None, ge=2000, le=2100)
    qualification: str | None = None
    level: str | None = None
    ccnl: str | None = None
    contract_code: str | None = None
    employment_type: str | None = None
    part_time_pct: float | None = Field(default=None, ge=0, le=100)
    pay_type: Literal["hourly", "daily", "monthly", "unknown"] = "unknown"
    hourly_pay: float | None = Field(default=None, ge=0)
    daily_pay: float | None = Field(default=None, ge=0)
    monthly_pay: float | None = Field(default=None, ge=0)
    ordinary_hours: float | None = Field(default=None, ge=0)
    worked_hours: float | None = Field(default=None, ge=0)
    worked_days: float | None = Field(default=None, ge=0, le=31)
    overtime_hours: float | None = Field(default=None, ge=0)
    overtime_rates: list[float] = Field(default_factory=list)
    overtime_tariffs: list[float] = Field(default_factory=list)
    night_rate: float | None = Field(default=None, ge=0)
    holiday_rate: float | None = Field(default=None, ge=0)
    minimum_contractual_pay: float | None = Field(default=None, ge=0)
    contingency: float | None = Field(default=None, ge=0)
    edr: float | None = Field(default=None, ge=0)
    seniority_increments: float | None = Field(default=None, ge=0)
    allowances: list[Allowance] = Field(default_factory=list)
    gross_pay: float | None = Field(default=None, ge=0)
    total_earnings: float | None = Field(default=None, ge=0)
    total_deductions: float | None = Field(default=None, ge=0)
    net_pay: float | None = Field(default=None, ge=0)
    fields: dict[str, FieldEvidence] = Field(default_factory=dict)


SYSTEM_PROMPT = """Sei un analizzatore prudente di cedolini paga italiani.
Leggi l'intero documento, comprese tabelle, colonne, intestazioni spezzate e note.
Non presumere un layout specifico e non confondere mai un'intestazione con il suo valore.
Non inventare dati mancanti: usa null quando non sei sicuro.
Distingui dati espliciti da dati calcolati o inferiti nell'evidence.
Una tariffa ipotizzata da Dato Base deve avere confidence medium o low.
Non convertire una retribuzione mensile in paga oraria.
Riconosci sinonimi e abbreviazioni italiane e controlla la coerenza matematica quando possibile.
Non estrarre né restituire codice fiscale, IBAN, indirizzo, conto corrente o dati personali non richiesti.
Restituisci esclusivamente lo schema JSON richiesto."""


def _schema() -> dict:
    nullable_number = {"type": ["number", "null"]}
    nullable_string = {"type": ["string", "null"]}
    field_names = (
        "month", "year", "qualification", "level", "ccnl", "contract_code", "employment_type", "part_time_pct",
        "pay_type", "hourly_pay", "daily_pay", "monthly_pay", "ordinary_hours", "worked_hours", "worked_days",
        "overtime_hours", "overtime_rates", "overtime_tariffs", "night_rate", "holiday_rate", "minimum_contractual_pay",
        "contingency", "edr", "seniority_increments", "allowances", "gross_pay", "total_earnings", "total_deductions", "net_pay",
    )
    evidence_schema = {"type": "object", "additionalProperties": False, "properties": {"confidence": {"type": "string", "enum": ["high", "medium", "low"]}, "evidence": {"type": "string"}}, "required": ["confidence", "evidence"]}
    properties: dict[str, dict] = {
        "month": {"type": ["integer", "null"], "minimum": 1, "maximum": 12},
        "year": {"type": ["integer", "null"], "minimum": 2000, "maximum": 2100},
        **{key: nullable_string for key in ("qualification", "level", "ccnl", "contract_code", "employment_type")},
        "part_time_pct": {"type": ["number", "null"], "minimum": 0, "maximum": 100},
        "pay_type": {"type": "string", "enum": ["hourly", "daily", "monthly", "unknown"]},
        **{key: nullable_number for key in (
            "hourly_pay", "daily_pay", "monthly_pay", "ordinary_hours", "worked_hours", "worked_days",
            "overtime_hours", "night_rate", "holiday_rate", "minimum_contractual_pay", "contingency", "edr",
            "seniority_increments", "gross_pay", "total_earnings", "total_deductions", "net_pay",
        )},
        "overtime_rates": {"type": "array", "items": {"type": "number"}},
        "overtime_tariffs": {"type": "array", "items": {"type": "number"}},
        "allowances": {"type": "array", "items": {"type": "object", "additionalProperties": False, "properties": {"name": {"type": "string"}, "amount": nullable_number}, "required": ["name", "amount"]}},
        "fields": {"type": "object", "additionalProperties": False, "properties": {key: evidence_schema for key in field_names}, "required": list(field_names)},
    }
    return {"type": "object", "additionalProperties": False, "properties": properties, "required": list(properties)}


def _valid_signature(data: bytes, mime: str) -> bool:
    if mime == "application/pdf": return data.startswith(b"%PDF-")
    if mime == "image/jpeg": return data.startswith(b"\xff\xd8\xff")
    if mime == "image/png": return data.startswith(b"\x89PNG\r\n\x1a\n")
    if mime == "image/webp": return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return False


async def analyze_document_with_ai(data: bytes, mime: str, filename: str) -> PayslipAIResult:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise PayslipAIError("AI_NOT_CONFIGURED")
    model = os.getenv("OPENAI_PAYSLIP_MODEL", "gpt-4.1-mini")
    encoded = base64.b64encode(data).decode("ascii")
    document = ({"type": "input_file", "filename": filename, "file_data": f"data:{mime};base64,{encoded}"}
                if mime == "application/pdf" else
                {"type": "input_image", "image_url": f"data:{mime};base64,{encoded}", "detail": "high"})
    payload = {
        "model": model, "store": False,
        "input": [{"role": "user", "content": [{"type": "input_text", "text": SYSTEM_PROMPT}, document]}],
        "text": {"format": {"type": "json_schema", "name": "italian_payslip", "strict": True, "schema": _schema()}},
    }
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post("https://api.openai.com/v1/responses", headers={"Authorization": f"Bearer {api_key}"}, json=payload)
    except httpx.TimeoutException as exc:
        raise PayslipAIError("OPENAI_TIMEOUT") from exc
    except httpx.RequestError as exc:
        raise PayslipAIError("OPENAI_BAD_REQUEST") from exc

    if response.is_error:
        try:
            error = response.json().get("error", {})
        except (ValueError, AttributeError):
            error = {}
        error_code = str(error.get("code") or "").lower()
        error_type = str(error.get("type") or "").lower()
        if response.status_code == 401:
            code = "INVALID_API_KEY"
        elif response.status_code == 429 and ("quota" in error_code or "quota" in error_type):
            code = "NO_API_CREDIT"
        elif response.status_code == 404 or "model" in error_code:
            code = "MODEL_NOT_AVAILABLE"
        else:
            code = "OPENAI_BAD_REQUEST"
        raise PayslipAIError(code)

    try:
        body = response.json()
        output_text = next((content.get("text") for item in body.get("output", []) if item.get("type") == "message" for content in item.get("content", []) if content.get("type") == "output_text"), None)
        if not output_text:
            raise ValueError("missing output_text")
        return PayslipAIResult.model_validate(json.loads(output_text))
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise PayslipAIError("INVALID_AI_RESPONSE") from exc


@router.post("/analyze-payslip-ai", response_model=PayslipAIResult)
async def analyze_payslip_ai(file: UploadFile = File(...)) -> PayslipAIResult:
    mime = (file.content_type or "").lower()
    if mime not in ALLOWED_MIME:
        raise HTTPException(status_code=415, detail="Formato documento non supportato")
    data = await file.read(MAX_PAYSLIP_BYTES + 1)
    await file.close()
    if len(data) > MAX_PAYSLIP_BYTES:
        raise HTTPException(status_code=413, detail="Documento troppo grande")
    if not _valid_signature(data, mime):
        raise HTTPException(status_code=415, detail="Il contenuto non corrisponde al formato dichiarato")

    suffix = Path(file.filename or "documento").suffix[:10]
    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(prefix="payslip-", suffix=suffix, delete=False) as temporary:
            temporary.write(data)
            temporary_path = temporary.name
        return await analyze_document_with_ai(data, mime, Path(file.filename or "documento").name)
    except PayslipAIError as exc:
        code = str(exc)
        status, message = ERROR_STATUS.get(code, (502, "Analisi AI temporaneamente non disponibile"))
        logger.warning("payslip_ai_failure code=%s mime=%s size=%d", code, mime, len(data))
        raise HTTPException(status_code=status, detail={"code": code, "message": message}) from exc
    except Exception as exc:
        logger.exception("payslip_ai_failure code=INVALID_AI_RESPONSE mime=%s size=%d", mime, len(data))
        raise HTTPException(status_code=502, detail={"code": "INVALID_AI_RESPONSE", "message": "Risposta AI non valida"}) from exc
    finally:
        if temporary_path:
            Path(temporary_path).unlink(missing_ok=True)
