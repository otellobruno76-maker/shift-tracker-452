import type { DocumentCell, DocumentRow, StructuredDocument } from "./documentModel";
import { analyzePayslipText, type DetectedValue, type PayslipAnalysis } from "./payslip";

export interface PayslipAdapter {
  id: string;
  matches(document: StructuredDocument): boolean;
  apply(document: StructuredDocument, analysis: PayslipAnalysis): PayslipAnalysis;
}

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
const numeric = (raw: string): number | null => {
  const value = Number(raw.replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(value) ? value : null;
};
const center = (cell: DocumentCell) => (cell.x + cell.right) / 2;
const cellUnder = (row: DocumentRow, header: DocumentCell): DocumentCell | undefined => {
  const candidate = row.cells.slice().sort((a, b) => Math.abs(center(a) - center(header)) - Math.abs(center(b) - center(header)))[0];
  return candidate && Math.abs(center(candidate) - center(header)) <= Math.max(80, header.right - header.x) ? candidate : undefined;
};

function joinedHeader(rows: DocumentRow[], rowIndex: number, matcher: RegExp): { header: DocumentCell; dataIndex: number; label: string } | null {
  const row = rows[rowIndex];
  const headerSignals = row.cells.filter((cell) => /voce|descrizione|dato|base|ore|giorni|competenze|ritenute|tariffa|valore/.test(normalize(cell.text))).length;
  for (const header of row.cells) {
    if (matcher.test(normalize(header.text))) return { header, dataIndex: rowIndex + 1, label: header.text };
    const continuation = rows[rowIndex + 1] && cellUnder(rows[rowIndex + 1], header);
    if (continuation && headerSignals >= 2) {
      const label = `${header.text} ${continuation.text}`;
      if (matcher.test(normalize(label))) return { header: { ...header, text: label }, dataIndex: rowIndex + 2, label };
    }
  }
  return null;
}

function headerValue(document: StructuredDocument, aliases: RegExp, validate?: (value: string) => boolean): DetectedValue<string> | null {
  for (let index = 0; index < document.rows.length - 1; index++) {
    const row = document.rows[index]; const next = document.rows[index + 1];
    if (row.page !== next.page) continue;
    const header = row.cells.find((cell) => aliases.test(normalize(cell.text)));
    if (!header) continue;
    const valueCell = cellUnder(next, header);
    if (!valueCell || (validate && !validate(valueCell.text))) continue;
    return { value: valueCell.text.trim(), source: `${header.text} → ${valueCell.text}`, confidence: "alta", method: "colonna geometrica" };
  }
  return null;
}

function numericHeaderValue(document: StructuredDocument, aliases: RegExp, min: number, max: number): DetectedValue<number> | null {
  const found = headerValue(document, aliases, (raw) => { const value = numeric(raw); return value !== null && value >= min && value <= max; });
  return found ? { ...found, value: numeric(found.value!) } : null;
}

function hourlyCandidate(document: StructuredDocument): DetectedValue<number> | null {
  const candidates: Array<{ value: number; source: string }> = [];
  for (const table of document.tables) {
    for (let headerIndex = 0; headerIndex < Math.min(3, table.rows.length); headerIndex++) {
      const found = joinedHeader(table.rows, headerIndex, /dato base|tariffa oraria|valore unitario/);
      if (!found) continue;
      for (const row of table.rows.slice(found.dataIndex)) {
        if (!/ore|\bh\b|ferie|festiv|permess|straord|notturn|malatt/.test(normalize(row.text))) continue;
        const cell = cellUnder(row, found.header); const value = cell ? numeric(cell.text) : null;
        if (value !== null && value >= 1 && value <= 200) candidates.push({ value, source: row.text });
      }
    }
  }
  const groups = new Map<string, typeof candidates>();
  candidates.forEach((item) => { const key = item.value.toFixed(5); groups.set(key, [...(groups.get(key) ?? []), item]); });
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  if (!best) return null;
  return { value: best[0].value, source: `Dato Base nella stessa colonna di ${best.length} voci orarie: ${best.map((item) => item.source).join(" · ")}`, confidence: best.length >= 2 ? "media" : "bassa", method: "ricorrenza geometrica in tabella" };
}

type Concept = { key: string; aliases: RegExp; min?: number; max?: number; numeric?: boolean };
const concepts: Concept[] = [
  { key: "competenza", aliases: /mese competenza|periodo di paga|competenza/ },
  { key: "tipoRapporto", aliases: /^tipo rapporto$|rapporto di lavoro/ },
  { key: "minimoTabellare", aliases: /minimo tabellare|minimo contrattuale/, min: 0, max: 20000, numeric: true },
  { key: "contingenza", aliases: /^contingenza$/, min: 0, max: 10000, numeric: true },
  { key: "edr", aliases: /^edr$|elemento distinto/, min: 0, max: 10000, numeric: true },
  { key: "scattiAnzianita", aliases: /scatti.*anzianita|anzianita.*scatti/, min: 0, max: 10000, numeric: true },
  { key: "totaleRitenute", aliases: /totale ritenute/, min: 0, max: 100000, numeric: true },
  { key: "ferie", aliases: /^ferie$|ferie godute/, min: 0, max: 1000, numeric: true },
  { key: "permessi", aliases: /^permessi$|permessi goduti/, min: 0, max: 1000, numeric: true },
  { key: "malattia", aliases: /^malattia$/, min: 0, max: 1000, numeric: true },
];

function conceptFields(document: StructuredDocument): Record<string, DetectedValue<string | number>> {
  const result: Record<string, DetectedValue<string | number>> = {};
  for (const concept of concepts) {
    const textValue = headerValue(document, concept.aliases);
    if (!textValue) continue;
    if (!concept.numeric) { result[concept.key] = textValue; continue; }
    const value = numeric(textValue.value ?? "");
    if (value !== null && value >= (concept.min ?? -Infinity) && value <= (concept.max ?? Infinity)) {
      result[concept.key] = { ...textValue, value };
    }
  }
  return result;
}

function applyGeometry(document: StructuredDocument, analysis: PayslipAnalysis): PayslipAnalysis {
  const level = headerValue(document, /^livello$/, (value) => /^\s*[0-9][a-z0-9./-]*\s*$/i.test(value));
  const qualification = headerValue(document, /^qualifica$/);
  const contractCode = headerValue(document, /^(contratto|codice contratto|contratto di lavoro)$/, (value) => !/livello|contratto/i.test(value));
  const partTime = numericHeaderValue(document, /part time|% part time/, 0, 100);
  const geometricBase = hourlyCandidate(document);
  return {
    ...analysis,
    extraFields: { ...(analysis.extraFields ?? {}), ...conceptFields(document) },
    level: level ?? analysis.level,
    qualification: qualification ?? analysis.qualification,
    contractCode: contractCode ?? analysis.contractCode,
    partTimePct: partTime ?? analysis.partTimePct,
    basePay: analysis.basePay.value !== null && analysis.basePay.confidence === "alta" ? analysis.basePay : geometricBase ?? analysis.basePay,
  };
}

export const inazAdapter: PayslipAdapter = {
  id: "inaz-family",
  matches: (document) => {
    const text = normalize(document.text);
    return /dato base/.test(text) && /dato figurativo|competenze ritenute/.test(text) && /qualifica/.test(text) && /livello/.test(text);
  },
  apply: (document, analysis) => ({ ...applyGeometry(document, analysis), adapter: "inaz-family" }),
};

export const payslipAdapters: PayslipAdapter[] = [inazAdapter];

function exposeMethod<T extends DetectedValue<unknown>>(field: T): T {
  if (field.value === null || /Metodo:/i.test(field.source)) return field;
  const method = field.method ?? "analisi semantica su righe strutturate";
  return { ...field, method, source: `${field.source} · Metodo: ${method}` } as T;
}

export function analyzeStructuredPayslip(document: StructuredDocument): PayslipAnalysis {
  let analysis = analyzePayslipText(document.text);
  const adapter = payslipAdapters.find((candidate) => candidate.matches(document));
  analysis = adapter ? adapter.apply(document, analysis) : applyGeometry(document, analysis);
  return {
    ...analysis,
    qualification: exposeMethod(analysis.qualification), contractCode: exposeMethod(analysis.contractCode),
    partTimePct: exposeMethod(analysis.partTimePct), basePay: exposeMethod(analysis.basePay),
    dailyPay: exposeMethod(analysis.dailyPay), monthlyPay: exposeMethod(analysis.monthlyPay),
    ordinaryHours: exposeMethod(analysis.ordinaryHours), workedHours: exposeMethod(analysis.workedHours),
    workedDays: exposeMethod(analysis.workedDays), overtimeHours: exposeMethod(analysis.overtimeHours),
    overtimeTariffs: analysis.overtimeTariffs.map(exposeMethod), overtimeRates: analysis.overtimeRates.map(exposeMethod),
    nightPct: exposeMethod(analysis.nightPct), holidayPct: exposeMethod(analysis.holidayPct),
    ccnl: exposeMethod(analysis.ccnl), level: exposeMethod(analysis.level), totalElementsPay: exposeMethod(analysis.totalElementsPay),
  };
}
