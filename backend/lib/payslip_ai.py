"""Optional AI payslip analysis. Documents are transient and never persisted."""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import tempfile
import time
from collections import Counter
from pathlib import Path
from typing import Literal

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

router = APIRouter()
MAX_PAYSLIP_BYTES = 15 * 1024 * 1024
ALLOWED_MIME = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
logger = logging.getLogger(__name__)
_metrics = Counter()


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
    "OPENAI_SCHEMA_TOO_COMPLEX": (502, "Schema AI troppo complesso"),
    "OPENAI_SCHEMA_REQUIRED": (502, "Schema AI con campi obbligatori non valido"),
    "OPENAI_SCHEMA_UNSUPPORTED": (502, "Schema AI non supportato"),
}


def _safe_bad_request_code(error: dict) -> str:
    """Classifica la risposta 400 senza restituire il testo, che potrebbe contenere input."""
    message = str(error.get("message") or "").lower()
    param = str(error.get("param") or "").lower()
    if "too many" in message or "exceeds" in message and ("propert" in message or "schema" in message):
        return "OPENAI_SCHEMA_TOO_COMPLEX"
    if "required" in message and ("schema" in message or "propert" in message):
        return "OPENAI_SCHEMA_REQUIRED"
    if "schema" in message or "schema" in param:
        return "OPENAI_SCHEMA_UNSUPPORTED"
    return "OPENAI_BAD_REQUEST"


class FieldEvidence(BaseModel):
    confidence: Literal["high", "medium", "low"]
    evidence: str


class Allowance(BaseModel):
    name: str
    amount: float | None = None


class PayslipLineItem(BaseModel):
    original_description: str
    category: Literal[
        "ordinary", "overtime", "holiday", "night", "vacation", "permission", "rol",
        "former_holiday", "sickness", "absence", "allowance", "gross", "earnings",
        "deductions", "net", "other",
    ]
    quantity: float | None = Field(default=None, ge=0)
    unit: Literal["hours", "days", "euro", "percent", "unknown"] = "unknown"
    rate_pct: float | None = Field(default=None, ge=0)
    amount: float | None = Field(default=None)
    confidence: Literal["high", "medium", "low"]
    evidence: str


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
    line_items: list[PayslipLineItem] = Field(default_factory=list)


def normalize_result(result: PayslipAIResult) -> PayslipAIResult:
    """Completa solo aggregati matematici già espliciti nelle voci strutturate."""
    updates: dict = {}
    hourly_evidence = result.fields.get("hourly_pay")
    inferred_hourly_source = re.compile(
        r"dato\s+base|ripetut|(?:riga|voce).*(?:ferie|festivit|permess)|(?:ferie|festivit|permess).*(?:riga|voce)",
        re.I,
    )
    # Un valore ricavato dal Dato Base di ferie/festività/permessi è un utile
    # candidato orario, ma non equivale a una paga oraria esplicitamente
    # dichiarata. La classificazione resta prudente anche se il modello usa
    # impropriamente la parola "tariffa" nella propria parafrasi.
    if (
        result.hourly_pay is not None
        and hourly_evidence
        and hourly_evidence.confidence == "high"
        and inferred_hourly_source.search(hourly_evidence.evidence)
    ):
        fields = dict(result.fields)
        fields["hourly_pay"] = hourly_evidence.model_copy(update={"confidence": "medium"})
        updates["fields"] = fields
    overtime_items = [item for item in result.line_items if item.category == "overtime" and item.confidence != "low"]
    rates = sorted({item.rate_pct for item in overtime_items if item.rate_pct is not None})
    # Le percentuali esplicite delle righe strutturate prevalgono sul campo
    # aggregato del modello, che può confondere il Dato Base con una %.
    if rates and rates != result.overtime_rates:
        updates["overtime_rates"] = rates
    if result.overtime_hours is None:
        hours = [item.quantity for item in overtime_items if item.unit == "hours" and item.quantity is not None]
        if hours:
            updates["overtime_hours"] = round(sum(hours), 4)
    tariff_evidence = result.fields.get("overtime_tariffs")
    tariff_label = re.compile(r"(?:€|eur)\s*/\s*h|euro\s*(?:all.?ora|ora)|tariffa\s+(?:oraria|straordinar)|paga\s+oraria|retribuzione\s+oraria", re.I)
    # Se l'AI ha restituito le righe strutturate, la descrizione originale è
    # più affidabile della sua parafrasi nell'evidence. Un semplice "Dato Base"
    # sotto una voce Straordinario non diventa quindi una tariffa esplicita.
    explicit_tariff = (
        any(tariff_label.search(item.original_description) for item in overtime_items)
        if overtime_items
        else bool(tariff_evidence and tariff_label.search(tariff_evidence.evidence))
    )
    if result.overtime_tariffs and not explicit_tariff:
        updates["overtime_tariffs"] = []
    aggregate_items = {
        "total_earnings": "earnings", "total_deductions": "deductions", "net_pay": "net",
    }
    for field, category in aggregate_items.items():
        if getattr(result, field) is not None:
            continue
        values = [item.amount for item in result.line_items if item.category == category and item.amount is not None and item.confidence != "low"]
        if len(values) == 1:
            updates[field] = values[0]
    return result.model_copy(update=updates) if updates else result


SYSTEM_PROMPT = """Sei un analizzatore prudente di cedolini paga italiani.
Leggi l'intero documento, comprese tabelle, colonne, intestazioni spezzate e note.
Non presumere un layout specifico e non confondere mai un'intestazione con il suo valore.
Non inventare dati mancanti: usa null quando non sei sicuro.
Distingui dati espliciti da dati calcolati o inferiti nell'evidence.
Una tariffa ipotizzata da Dato Base deve avere confidence medium o low.
Non convertire una retribuzione mensile in paga oraria.
Riconosci sinonimi e abbreviazioni italiane e controlla la coerenza matematica quando possibile.
Non estrarre né restituire codice fiscale, IBAN, indirizzo, conto corrente o dati personali non richiesti.
Per ogni voce utile conserva la descrizione originale in line_items e normalizzala nella categoria prevista.
Non sommare concetti semanticamente diversi e indica sempre unità, confidence ed evidence.
Inserisci in overtime_tariffs soltanto tariffe unitarie espresse in €/h: l'importo totale
della voce straordinario appartiene a line_items.amount e non è una tariffa oraria.
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
    evidence_schema = {"type": "object", "additionalProperties": False, "properties": {
        "field": {"type": "string", "enum": list(field_names)},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "evidence": {"type": "string"},
    }, "required": ["field", "confidence", "evidence"]}
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
        "line_items": {"type": "array", "items": {"type": "object", "additionalProperties": False, "properties": {
            "original_description": {"type": "string"},
            "category": {"type": "string", "enum": ["ordinary", "overtime", "holiday", "night", "vacation", "permission", "rol", "former_holiday", "sickness", "absence", "allowance", "gross", "earnings", "deductions", "net", "other"]},
            "quantity": nullable_number,
            "unit": {"type": "string", "enum": ["hours", "days", "euro", "percent", "unknown"]},
            "rate_pct": nullable_number,
            "amount": nullable_number,
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
            "evidence": {"type": "string"},
        }, "required": ["original_description", "category", "quantity", "unit", "rate_pct", "amount", "confidence", "evidence"]}},
        # Un array evita di duplicare decine di sotto-schemi identici e resta
        # entro i limiti di complessità degli Structured Outputs.
        "fields": {"type": "array", "items": evidence_schema},
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
            code = _safe_bad_request_code(error)
        raise PayslipAIError(code)

    try:
        body = response.json()
        usage = body.get("usage") or {}
        _metrics["input_tokens"] += int(usage.get("input_tokens") or 0)
        _metrics["output_tokens"] += int(usage.get("output_tokens") or 0)
        output_text = next((content.get("text") for item in body.get("output", []) if item.get("type") == "message" for content in item.get("content", []) if content.get("type") == "output_text"), None)
        if not output_text:
            raise ValueError("missing output_text")
        parsed = json.loads(output_text)
        evidence = parsed.get("fields") or []
        if isinstance(evidence, list):
            parsed["fields"] = {
                item["field"]: {"confidence": item["confidence"], "evidence": item["evidence"]}
                for item in evidence if isinstance(item, dict) and item.get("field")
            }
        return normalize_result(PayslipAIResult.model_validate(parsed))
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise PayslipAIError("INVALID_AI_RESPONSE") from exc


@router.post("/analyze-payslip-ai", response_model=PayslipAIResult)
async def analyze_payslip_ai(file: UploadFile = File(...)) -> PayslipAIResult:
    started = time.monotonic()
    _metrics["analyses"] += 1
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
        result = await analyze_document_with_ai(data, mime, Path(file.filename or "documento").name)
        _metrics["success"] += 1
        return result
    except PayslipAIError as exc:
        code = str(exc)
        status, message = ERROR_STATUS.get(code, (502, "Analisi AI temporaneamente non disponibile"))
        logger.warning("payslip_ai_failure code=%s mime=%s size=%d", code, mime, len(data))
        _metrics["failure"] += 1
        raise HTTPException(status_code=status, detail={"code": code, "message": message}) from exc
    except Exception as exc:
        logger.exception("payslip_ai_failure code=INVALID_AI_RESPONSE mime=%s size=%d", mime, len(data))
        _metrics["failure"] += 1
        raise HTTPException(status_code=502, detail={"code": "INVALID_AI_RESPONSE", "message": "Risposta AI non valida"}) from exc
    finally:
        _metrics["latency_ms_total"] += round((time.monotonic() - started) * 1000)
        if temporary_path:
            Path(temporary_path).unlink(missing_ok=True)


def safe_metrics() -> dict[str, int]:
    """Aggregati tecnici: nessun nome file, contenuto o identificativo personale."""
    return {key: int(_metrics[key]) for key in ("analyses", "success", "failure", "latency_ms_total", "retries", "input_tokens", "output_tokens")}
