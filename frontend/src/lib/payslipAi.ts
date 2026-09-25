import { bounded } from "./documentPreparation";
import { emptyPayslipAnalysis, type Confidence, type DetectedValue, type PayslipAnalysis } from "./payslip";
import type { PayslipItem } from "./types";

export interface AIFieldEvidence { confidence: "high" | "medium" | "low"; evidence: string }
export interface PayslipAIResult {
  month: number | null; year: number | null; qualification: string | null; level: string | null;
  ccnl: string | null; contract_code: string | null; employment_type: string | null; part_time_pct: number | null;
  pay_type: "hourly" | "daily" | "monthly" | "unknown"; hourly_pay: number | null; daily_pay: number | null;
  monthly_pay: number | null; ordinary_hours: number | null; worked_hours: number | null; worked_days: number | null;
  overtime_hours: number | null; overtime_rates: number[]; overtime_tariffs: number[]; night_rate: number | null;
  holiday_rate: number | null; minimum_contractual_pay: number | null; contingency: number | null; edr: number | null;
  seniority_increments: number | null; allowances: Array<{ name: string; amount: number | null }>;
  gross_pay: number | null; total_earnings: number | null; total_deductions: number | null; net_pay: number | null;
  fields: Record<string, AIFieldEvidence>;
  line_items: Array<{
    original_description: string; category: PayslipItem["category"]; quantity: number | null;
    unit: PayslipItem["unit"]; rate_pct: number | null; amount: number | null;
    confidence: "high" | "medium" | "low"; evidence: string;
  }>;
}

export interface PayslipMergeResult { analysis: PayslipAnalysis; conflicts: string[]; month: string | null; payType: "oraria" | "giornaliera" | "mensile" | "" }

const configuredApiBase = (
  import.meta.env.VITE_AI_API_BASE_URL?.trim() || "https://shift-tracker-452.onrender.com"
).replace(/\/$/, "");
export const payslipAIEndpoint = `${configuredApiBase}/api/analyze-payslip-ai`;

const confidenceMap: Record<AIFieldEvidence["confidence"], Confidence> = { high: "alta", medium: "media", low: "bassa" };
const rank: Record<Confidence, number> = { alta: 3, media: 2, bassa: 1 };
const same = (left: unknown, right: unknown) => typeof left === "number" && typeof right === "number"
  ? Math.abs(left - right) <= Math.max(0.01, Math.abs(left) * .005)
  : String(left).trim().toLocaleLowerCase("it-IT") === String(right).trim().toLocaleLowerCase("it-IT");

function aiField<T>(value: T | null, key: string, ai: PayslipAIResult): DetectedValue<T> {
  const meta = ai.fields[key];
  return { value, confidence: meta ? confidenceMap[meta.confidence] : "bassa", source: value === null ? "Non rilevata" : `Analisi AI: ${meta?.evidence || "dato individuato nel documento"}`, method: "OpenAI multimodale" };
}

function mergeField<T>(label: string, local: DetectedValue<T>, remote: DetectedValue<T>, conflicts: string[]): DetectedValue<T> {
  if (remote.value === null) return local;
  if (local.value === null) return remote;
  if (same(local.value, remote.value)) return { ...local, confidence: rank[local.confidence] >= 2 || rank[remote.confidence] >= 2 ? "alta" : "media", source: `Concordanza lettura locale + analisi AI · Locale: ${local.source} · AI: ${remote.source.replace(/^Analisi AI:\s*/, "")}`, method: "confronto locale/AI" };
  if (remote.confidence === "bassa") return local;
  if (local.confidence === "bassa") return remote;
  conflicts.push(`${label}: locale “${local.value}”, AI “${remote.value}”`);
  return { ...local, confidence: "bassa", source: `Conflitto da verificare · Lettura locale: ${local.value} (${local.source}) · Analisi AI: ${remote.value} (${remote.source.replace(/^Analisi AI:\s*/, "")})`, method: "confronto locale/AI" };
}

export function mergePayslipAnalyses(local: PayslipAnalysis, ai: PayslipAIResult): PayslipMergeResult {
  const conflicts: string[] = [];
  const merged = { ...emptyPayslipAnalysis(), ...local };
  const field = <T,>(label: string, current: DetectedValue<T>, value: T | null, key: string) => mergeField(label, current, aiField(value, key, ai), conflicts);
  merged.qualification = field("Qualifica", local.qualification, ai.qualification, "qualification");
  merged.level = field("Livello", local.level, ai.level, "level");
  merged.ccnl = field("CCNL", local.ccnl, ai.ccnl, "ccnl");
  merged.contractCode = field("Contratto", local.contractCode, ai.contract_code, "contract_code");
  merged.partTimePct = field("Part-time", local.partTimePct, ai.part_time_pct, "part_time_pct");
  merged.basePay = field("Paga oraria", local.basePay, ai.hourly_pay, "hourly_pay");
  merged.dailyPay = field("Paga giornaliera", local.dailyPay, ai.daily_pay, "daily_pay");
  merged.monthlyPay = field("Retribuzione mensile", local.monthlyPay, ai.monthly_pay, "monthly_pay");
  merged.ordinaryHours = field("Ore ordinarie", local.ordinaryHours, ai.ordinary_hours, "ordinary_hours");
  merged.workedHours = field("Ore lavorate", local.workedHours, ai.worked_hours, "worked_hours");
  merged.workedDays = field("Giorni lavorati", local.workedDays, ai.worked_days, "worked_days");
  merged.overtimeHours = field("Ore straordinarie", local.overtimeHours, ai.overtime_hours, "overtime_hours");
  merged.nightPct = field("Notturno", local.nightPct, ai.night_rate, "night_rate");
  merged.holidayPct = field("Festivo", local.holidayPct, ai.holiday_rate, "holiday_rate");
  merged.overtimeRates = ai.overtime_rates.length ? ai.overtime_rates.map((value) => ({ ...aiField(value, "overtime_rates", ai), derived: false })) : local.overtimeRates;
  merged.overtimeTariffs = ai.overtime_tariffs.length ? ai.overtime_tariffs.map((value) => aiField(value, "overtime_tariffs", ai)) : local.overtimeTariffs;
  merged.allowances = ai.allowances.length ? ai.allowances.map((item) => ({ ...item, source: `Analisi AI: ${ai.fields.allowances?.evidence || "voce nel documento"}`, confidence: confidenceMap[ai.fields.allowances?.confidence ?? "low"] })) : local.allowances;
  const aiTotals = [
    ["Lordo", ai.gross_pay, "gross_pay"], ["Totale competenze", ai.total_earnings, "total_earnings"],
    ["Totale ritenute", ai.total_deductions, "total_deductions"], ["Netto a pagare", ai.net_pay, "net_pay"],
  ] as const;
  merged.totals = [...local.totals, ...aiTotals.filter(([, value]) => value !== null).map(([label, value, key]) => ({ label, value: value!, source: `Analisi AI: ${ai.fields[key]?.evidence || "totale nel documento"}` }))]
    .filter((item, index, items) => items.findIndex((candidate) => candidate.label.toLowerCase() === item.label.toLowerCase() && same(candidate.value, item.value)) === index);
  merged.extraFields = { ...(local.extraFields ?? {}), employmentType: aiField(ai.employment_type, "employment_type", ai), minimumContractualPay: aiField(ai.minimum_contractual_pay, "minimum_contractual_pay", ai), contingency: aiField(ai.contingency, "contingency", ai), edr: aiField(ai.edr, "edr", ai), seniorityIncrements: aiField(ai.seniority_increments, "seniority_increments", ai) };
  merged.items = (ai.line_items ?? []).map((item) => ({
    originalDescription: item.original_description,
    category: item.category,
    quantity: item.quantity,
    unit: item.unit,
    ratePct: item.rate_pct,
    amount: item.amount,
    confidence: confidenceMap[item.confidence],
    source: "ai",
    note: item.evidence,
  }));
  const month = ai.month && ai.year ? `${ai.year}-${String(ai.month).padStart(2, "0")}` : null;
  const payType = ai.pay_type === "hourly" ? "oraria" : ai.pay_type === "daily" ? "giornaliera" : ai.pay_type === "monthly" ? "mensile" : "";
  return { analysis: merged, conflicts, month, payType };
}

export interface AITimings { requestMs: number; parseMs: number; serverTiming: string | null }
const requests = new WeakMap<File, Promise<PayslipAIResult>>();
export function requestPayslipAI(file: File, options: { signal?: AbortSignal; onPhase?: (label: string) => void; onTimings?: (timings: AITimings) => void } = {}): Promise<PayslipAIResult> {
  const existing = requests.get(file);
  if (existing) return existing;
  const promise = performRequest(file, options).catch((error) => { requests.delete(file); throw error; });
  requests.set(file, promise);
  return promise;
}

async function performRequest(file: File, options: { signal?: AbortSignal; onPhase?: (label: string) => void; onTimings?: (timings: AITimings) => void }): Promise<PayslipAIResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) throw new Error("Analisi interrotta. Puoi riprovare.");
  options.signal?.addEventListener("abort", abort, { once: true });
  const started = performance.now();
  options.onPhase?.("Analisi del documento…");
  const slow = setTimeout(() => options.onPhase?.("Il servizio sta impiegando più tempo del previsto. Puoi annullare e riprovare."), 25_000);
  try {
    return await bounded(sendRequest(file, controller.signal, options, started), 75_000,
      "Tempo massimo raggiunto (75 secondi). Il servizio potrebbe essere in avvio. Riprova tra poco oppure continua con i dati locali.", abort);
  } finally { clearTimeout(slow); options.signal?.removeEventListener("abort", abort); }
}

async function sendRequest(file: File, signal: AbortSignal, options: { onPhase?: (label: string) => void; onTimings?: (timings: AITimings) => void }, started: number): Promise<PayslipAIResult> {
  const body = new FormData(); body.append("file", file, file.type === "application/pdf" ? "documento.pdf" : "documento.jpg");
  let response: Response;
  try {
    response = await fetch(payslipAIEndpoint, { method: "POST", body, signal });
  } catch {
    if (signal.aborted) throw new Error("Analisi interrotta. Puoi riprovare.");
    console.warn("payslip_ai_failure code=BACKEND_NOT_REACHABLE");
    throw new Error("Backend AI non raggiungibile");
  }
  if (!response.ok) {
    let code = "";
    try {
      const payload = await response.json() as { detail?: string | { code?: string } };
      code = typeof payload.detail === "object" ? payload.detail?.code ?? "" : "";
    } catch { /* risposta non JSON: tipica di proxy/static hosting */ }
    const messages: Record<string, string> = {
      AI_NOT_CONFIGURED: "Chiave API non configurata",
      INVALID_API_KEY: "Chiave API non valida",
      NO_API_CREDIT: "Credito API non disponibile",
      MODEL_NOT_AVAILABLE: "Modello AI non disponibile",
      OPENAI_BAD_REQUEST: "Richiesta AI non valida",
      OPENAI_TIMEOUT: "Il servizio AI non ha risposto in tempo",
      INVALID_AI_RESPONSE: "Risposta AI non valida",
    };
    if (messages[code]) throw new Error(messages[code]);
    if ([404, 405].includes(response.status)) {
      console.warn(`payslip_ai_failure code=BACKEND_NOT_REACHABLE status=${response.status}`);
      throw new Error("Backend AI non raggiungibile");
    }
    throw new Error(`Servizio AI non disponibile (HTTP ${response.status})`);
  }
  const received = performance.now();
  options.onPhase?.("Preparazione del risultato…");
  let result: PayslipAIResult;
  try {
    result = await response.json() as PayslipAIResult;
    if (!result || !result.fields || !Array.isArray(result.overtime_rates) || !Array.isArray(result.overtime_tariffs) || !Array.isArray(result.allowances)) throw new Error();
  } catch { throw new Error("Risposta AI non valida. Puoi riprovare o continuare in locale."); }
  options.onTimings?.({ requestMs: received - started, parseMs: performance.now() - received, serverTiming: response.headers.get("Server-Timing") });
  return result;
}
