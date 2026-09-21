"""Optional AI payslip analysis. Documents are transient and never persisted."""

from __future__ import annotations

import base64
import json
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
        raise RuntimeError("AI_NOT_CONFIGURED")
    model = os.getenv("OPENAI_PAYSLIP_MODEL", "gpt-4.1-mini")
    encoded = base64.b64encode(data).decode("ascii")
    document = ({"type": "input_file", "filename": filename, "file_data": f"data:{mime};base64,{encoded}", "detail": "high"}
                if mime == "application/pdf" else
                {"type": "input_image", "image_url": f"data:{mime};base64,{encoded}", "detail": "high"})
    payload = {
        "model": model, "store": False,
        "input": [{"role": "user", "content": [{"type": "input_text", "text": SYSTEM_PROMPT}, document]}],
        "text": {"format": {"type": "json_schema", "name": "italian_payslip", "strict": True, "schema": _schema()}},
    }
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post("https://api.openai.com/v1/responses", headers={"Authorization": f"Bearer {api_key}"}, json=payload)
        response.raise_for_status()
    body = response.json()
    output_text = next((content.get("text") for item in body.get("output", []) if item.get("type") == "message" for content in item.get("content", []) if content.get("type") == "output_text"), None)
    if not output_text:
        raise RuntimeError("EMPTY_AI_RESPONSE")
    return PayslipAIResult.model_validate(json.loads(output_text))


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
    except RuntimeError as exc:
        if str(exc) == "AI_NOT_CONFIGURED":
            raise HTTPException(status_code=503, detail="Analisi AI non configurata") from exc
        raise HTTPException(status_code=502, detail="Analisi AI temporaneamente non disponibile") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Analisi AI temporaneamente non disponibile") from exc
    finally:
        if temporary_path:
            Path(temporary_path).unlink(missing_ok=True)
