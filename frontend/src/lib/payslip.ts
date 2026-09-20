import type { Settings } from "./types";

export type Confidence = "alta" | "media" | "bassa";

export interface DetectedValue<T> {
  value: T | null;
  source: string;
  confidence: Confidence;
}

export interface DetectedRate extends DetectedValue<number> {
  derived: boolean;
}

export interface DetectedAllowance {
  name: string;
  amount: number | null;
  source: string;
  confidence: Confidence;
}

export interface PayslipAnalysis {
  basePay: DetectedValue<number>;
  ordinaryHours: DetectedValue<number>;
  overtimeRates: DetectedRate[];
  nightPct: DetectedValue<number>;
  holidayPct: DetectedValue<number>;
  allowances: DetectedAllowance[];
  ccnl: DetectedValue<string>;
  level: DetectedValue<string>;
  totals: Array<{ label: string; value: number; source: string }>;
}

export interface ConfirmedPayslipValues {
  basePay?: number;
  ordinaryHours?: number;
  overtimeRates?: number[];
  nightPct?: number;
  holidayPct?: number;
  allowances?: Array<{ name: string; amount: number | null }>;
  ccnl?: string;
  level?: string;
}

const missingNumber = (): DetectedValue<number> => ({ value: null, source: "Non rilevata", confidence: "bassa" });
const missingText = (): DetectedValue<string> => ({ value: null, source: "Non rilevata", confidence: "bassa" });

function numberIt(raw: string): number | null {
  const compacted = raw.replace(/\s/g, "");
  const cleaned = compacted.includes(",") && compacted.includes(".")
    ? compacted.replace(/\./g, "").replace(",", ".")
    : compacted.replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function compact(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function firstNumberAfter(lines: string[], label: RegExp): DetectedValue<number> {
  for (const line of lines) {
    if (!label.test(line)) continue;
    const matches = [...line.matchAll(/(?:€\s*)?(\d{1,4}(?:[.,]\d{1,4})?)/g)];
    const last = matches.at(-1)?.[1];
    const value = last ? numberIt(last) : null;
    if (value !== null) return { value, source: compact(line), confidence: "media" };
  }
  return missingNumber();
}

export function calculateIncreasePct(baseRate: number, increasedRate: number): number | null {
  if (!Number.isFinite(baseRate) || !Number.isFinite(increasedRate) || baseRate <= 0 || increasedRate < baseRate) {
    return null;
  }
  return Math.round(((increasedRate / baseRate - 1) * 100) * 100) / 100;
}

function uniqueRates(rates: DetectedRate[]): DetectedRate[] {
  const seen = new Set<string>();
  return rates.filter((rate) => {
    if (rate.value === null) return false;
    const key = rate.value.toFixed(2);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function analyzePayslipText(rawText: string): PayslipAnalysis {
  const lines = rawText.split(/\r?\n/).map(compact).filter(Boolean);
  const basePay = firstNumberAfter(
    lines,
    /(?:paga|retribuzione|tariffa|valore)\s*(?:oraria|ora)|paga\s*base\s*oraria/i,
  );
  const ordinaryHours = firstNumberAfter(lines, /ore\s*(?:ordinarie|normali)|ordinario\s*ore/i);

  const overtimeRates: DetectedRate[] = [];
  for (const line of lines) {
    if (!/straordinar/i.test(line)) continue;
    for (const match of line.matchAll(/(?:\+\s*)?(\d{1,3}(?:[.,]\d{1,2})?)\s*%/g)) {
      const value = numberIt(match[1]);
      if (value !== null) {
        overtimeRates.push({ value, source: compact(line), confidence: "alta", derived: false });
      }
    }
  }

  if (basePay.value !== null) {
    for (const line of lines) {
      if (!/straordinar/i.test(line) || /%/.test(line)) continue;
      const values = [...line.matchAll(/(?:€\s*)?(\d{1,3}[.,]\d{2,4})/g)]
        .map((match) => numberIt(match[1]))
        .filter((value): value is number => value !== null);
      const tariff = values.at(-1);
      if (tariff === undefined) continue;
      const value = calculateIncreasePct(basePay.value, tariff);
      if (value !== null && value <= 200) {
        overtimeRates.push({
          value,
          source: `${compact(line)} · calcolata da ${basePay.value.toFixed(2)} € → ${tariff.toFixed(2)} €`,
          confidence: "media",
          derived: true,
        });
      }
    }
  }

  const findPercent = (pattern: RegExp): DetectedValue<number> => {
    for (const line of lines) {
      if (!pattern.test(line)) continue;
      const match = line.match(/(?:\+\s*)?(\d{1,3}(?:[.,]\d{1,2})?)\s*%/);
      const value = match ? numberIt(match[1]) : null;
      if (value !== null) return { value, source: compact(line), confidence: "alta" };
    }
    return missingNumber();
  };

  const allowances: DetectedAllowance[] = [];
  for (const line of lines) {
    const match = line.match(/(indennit[aà][^\d€]{0,45})(?:€\s*)?(\d+(?:[.,]\d{1,2}))?/i);
    if (!match) continue;
    allowances.push({
      name: compact(match[1]).replace(/[:-]+$/, ""),
      amount: match[2] ? numberIt(match[2]) : null,
      source: compact(line),
      confidence: match[2] ? "media" : "bassa",
    });
  }

  let ccnl = missingText();
  let level = missingText();
  for (const line of lines) {
    if (ccnl.value === null) {
      const match = line.match(/CCNL\s*[:-]?\s*(.{3,70})/i);
      if (match) ccnl = { value: compact(match[1]), source: compact(line), confidence: "alta" };
    }
    if (level.value === null) {
      const match = line.match(/(?:livello|liv\.)\s*[:-]?\s*([A-Z0-9][A-Z0-9./-]{0,12})/i);
      if (match) level = { value: match[1], source: compact(line), confidence: "alta" };
    }
  }

  const totals: Array<{ label: string; value: number; source: string }> = [];
  for (const line of lines) {
    const match = line.match(/(totale\s+(?:competenze|lordo|netto|ore)|netto\s+(?:in\s+)?busta)[^\d]{0,20}(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i);
    const value = match ? numberIt(match[2]) : null;
    if (match && value !== null) totals.push({ label: compact(match[1]), value, source: compact(line) });
  }

  return {
    basePay,
    ordinaryHours,
    overtimeRates: uniqueRates(overtimeRates),
    nightPct: findPercent(/notturn/i),
    holidayPct: findPercent(/festiv/i),
    allowances: allowances.slice(0, 8),
    ccnl,
    level,
    totals: totals.slice(0, 6),
  };
}

export function buildPayslipSettingsPatch(values: ConfirmedPayslipValues): Partial<Settings> {
  const patch: Partial<Settings> = { payslipConfiguredAt: new Date().toISOString() };
  if (values.basePay !== undefined) patch.basePay = values.basePay;
  if (values.ordinaryHours !== undefined) patch.payslipReferenceHours = values.ordinaryHours;
  if (values.overtimeRates?.length) {
    patch.overtimeRates = values.overtimeRates;
    patch.overtimePct = values.overtimeRates[0];
  }
  if (values.nightPct !== undefined) patch.nightPct = values.nightPct;
  if (values.holidayPct !== undefined) patch.holidayPct = values.holidayPct;
  if (values.allowances !== undefined) patch.payslipAllowances = values.allowances;
  if (values.ccnl !== undefined) patch.ccnl = values.ccnl;
  if (values.level !== undefined) patch.contractLevel = values.level;
  return patch;
}
