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
  qualification: DetectedValue<string>;
  contractCode: DetectedValue<string>;
  partTimePct: DetectedValue<number>;
  basePay: DetectedValue<number>;
  dailyPay: DetectedValue<number>;
  monthlyPay: DetectedValue<number>;
  ordinaryHours: DetectedValue<number>;
  workedHours: DetectedValue<number>;
  workedDays: DetectedValue<number>;
  overtimeHours: DetectedValue<number>;
  overtimeTariffs: DetectedValue<number>[];
  overtimeRates: DetectedRate[];
  nightPct: DetectedValue<number>;
  holidayPct: DetectedValue<number>;
  allowances: DetectedAllowance[];
  ccnl: DetectedValue<string>;
  level: DetectedValue<string>;
  totalElementsPay: DetectedValue<number>;
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

function cells(line: string): string[] {
  return line.split(/\s*\|\s*/).map(compact).filter(Boolean);
}

function textBelowHeader(lines: string[], header: RegExp): Record<string, DetectedValue<string>> {
  for (let index = 0; index < lines.length - 1; index++) {
    const headers = cells(lines[index]);
    if (headers.length < 2 || !headers.some((cell) => header.test(cell))) continue;
    const values = cells(lines[index + 1]);
    if (values.length < headers.length) continue;
    const result: Record<string, DetectedValue<string>> = {};
    headers.forEach((name, column) => {
      result[compact(name).toLocaleLowerCase("it-IT")] = {
        value: values[column] ?? null,
        source: `${compact(name)} → ${values[column] ?? "Non rilevato"}`,
        confidence: "alta",
      };
    });
    return result;
  }
  return {};
}

function tableValue(table: Record<string, DetectedValue<string>>, pattern: RegExp): DetectedValue<string> {
  const entry = Object.entries(table).find(([name]) => pattern.test(name))?.[1];
  return entry ?? missingText();
}

function firstNumberAfter(lines: string[], label: RegExp, min: number, max: number): DetectedValue<number> {
  for (const line of lines) {
    const matchLabel = line.match(label);
    if (!matchLabel || matchLabel.index === undefined) continue;
    const tail = line.slice(matchLabel.index + matchLabel[0].length).replace(/^\s*[:|=-]?\s*/, "");
    const candidates = [...tail.matchAll(/(?:€\s*)?(\d{1,6}(?:\.\d{3})*(?:,\d{1,4})?|\d{1,6}(?:[.,]\d{1,4})?)/g)];
    const value = candidates.length ? numberIt(candidates[0][1]) : null;
    if (value !== null && value >= min && value <= max) {
      const confused = line.length > 150 || candidates.length > 5;
      return { value, source: compact(line), confidence: confused ? "bassa" : candidates.length === 1 ? "alta" : "media" };
    }
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
  const employmentTable = textBelowHeader(lines, /qualifica|livello|contratto\s+di\s+lavoro|tipo\s+rapporto|part.?time/i);
  const qualification = tableValue(employmentTable, /^qualifica$/i);
  const contractCode = tableValue(employmentTable, /contratto\s+di\s+lavoro|^contratto$/i);
  const partTimeText = tableValue(employmentTable, /part.?time/i);
  const partTimeValue = partTimeText.value?.match(/\d+(?:[.,]\d+)?/)?.[0];
  const partTimePct: DetectedValue<number> = partTimeValue
    ? { value: numberIt(partTimeValue), source: partTimeText.source, confidence: partTimeText.confidence }
    : firstNumberAfter(lines, /%\s*part.?time|part.?time\s*%?/i, 0, 100);

  let basePay = firstNumberAfter(
    lines,
    /(?:paga|retribuzione|tariffa|valore)\s*(?:oraria|ora)|paga\s*base\s*oraria/i,
    1, 200,
  );
  const dailyPay = firstNumberAfter(lines, /(?:paga|retribuzione)\s*giornaliera/i, 1, 1000);
  const monthlyPay = firstNumberAfter(lines, /(?:paga|retribuzione)\s*(?:mensile|mese)/i, 100, 30000);
  const ordinaryHours = firstNumberAfter(lines, /ore\s*(?:ordinarie|normali)|ordinario\s*ore/i, 0, 300);
  const workedHours = firstNumberAfter(lines, /ore\s*lav(?:orate)?\.?/i, 0, 300);
  const workedDays = firstNumberAfter(lines, /gg\s*lav(?:orati)?\.?|giorni\s*lavorati/i, 0, 31);
  const overtimeHours = firstNumberAfter(lines, /ore\s*straordinarie|straordinario\s*ore/i, 0, 250);

  if (basePay.value === null) {
    const candidates: Array<{ value: number; source: string }> = [];
    for (let index = 0; index < lines.length; index++) {
      const headers = cells(lines[index]);
      const baseColumn = headers.findIndex((cell) => /dato\s*base/i.test(cell));
      if (baseColumn < 0) continue;
      for (let row = index + 1; row < Math.min(lines.length, index + 16); row++) {
        const values = cells(lines[row]);
        if (values.some((cell) => /dato\s*base/i.test(cell))) break;
        if (!/(ferie|festivit[aà]|permess).*(ore)|ore.*(ferie|festivit[aà]|permess)/i.test(values.join(" "))) continue;
        const value = numberIt(values[baseColumn] ?? "");
        if (value !== null && value >= 1 && value <= 200) candidates.push({ value, source: compact(lines[row]) });
      }
    }
    const groups = new Map<string, Array<{ value: number; source: string }>>();
    for (const candidate of candidates) {
      const key = candidate.value.toFixed(5);
      groups.set(key, [...(groups.get(key) ?? []), candidate]);
    }
    const repeated = [...groups.values()].sort((a, b) => b.length - a.length)[0];
    if (repeated?.length >= 2) basePay = {
      value: repeated[0].value,
      source: `Dato Base ripetuto in ${repeated.length} voci orarie: ${repeated.map((item) => item.source).join(" · ")}`,
      confidence: "media",
    };
  }

  const overtimeRates: DetectedRate[] = [];
  const overtimeTariffs: DetectedValue<number>[] = [];
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
      const tariff = values.find((candidate) => candidate >= basePay.value! && candidate <= basePay.value! * 3);
      if (tariff === undefined) continue;
      const confused = line.length > 150 || values.length > 5;
      overtimeTariffs.push({ value: tariff, source: compact(line), confidence: confused ? "bassa" : "media" });
      const value = calculateIncreasePct(basePay.value, tariff);
      if (value !== null && value <= 200) {
        overtimeRates.push({
          value,
          source: `${compact(line)} · calcolata da ${basePay.value.toFixed(2)} € → ${tariff.toFixed(2)} €`,
          confidence: confused ? "bassa" : "media",
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
  let level = tableValue(employmentTable, /^livello$/i);
  for (const line of lines) {
    if (ccnl.value === null) {
      const match = line.match(/CCNL\s*[:-]?\s*(.{3,70})/i);
      if (match) ccnl = { value: compact(match[1]), source: compact(line), confidence: "alta" };
    }
    if (level.value === null) {
      const match = line.match(/(?:livello|liv\.)\s*(?:[:=-]\s*|\s+)([0-9][A-Z0-9./-]{0,12})(?:\s|$)/i);
      if (match && !/^(contratto|tipo|rapporto)$/i.test(match[1])) level = { value: match[1], source: compact(line), confidence: "alta" };
    }
  }

  const totals: Array<{ label: string; value: number; source: string }> = [];
  for (const line of lines) {
    const match = line.match(/(totale\s+(?:competenze|ritenute|lordo|netto|ore)|netto\s+(?:(?:in\s+)?busta|a\s+pagare))[^\d]{0,20}(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i);
    const value = match ? numberIt(match[2]) : null;
    if (match && value !== null) totals.push({ label: compact(match[1]), value, source: compact(line) });
  }

  return {
    qualification,
    contractCode,
    partTimePct,
    basePay,
    dailyPay,
    monthlyPay,
    ordinaryHours,
    workedHours,
    workedDays,
    overtimeHours,
    overtimeTariffs,
    overtimeRates: uniqueRates(overtimeRates),
    nightPct: findPercent(/notturn/i),
    holidayPct: findPercent(/festiv/i),
    allowances: allowances.slice(0, 8),
    ccnl,
    level,
    totalElementsPay: firstNumberAfter(lines, /totale\s+elementi\s+retributivi/i, 100, 30000),
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
