import type { Confidence, DetectedAllowance, PayslipAnalysis } from "./payslip";
import { inspectPayslipNumber } from "./payslipNumber";
import type { PayslipItem } from "./types";

const grossLabel = /^\s*(?:totale\s+(?:competenze|lordo)|lordo(?:\s+totale)?)\s*:?\s*$/i;
const netLabel = /^\s*(?:totale\s+netto|netto(?:\s+(?:(?:in\s+)?busta|a\s+pagare))?)\s*:?\s*$/i;
const isGrossOrNetLabel = (label: string): boolean => grossLabel.test(label) || netLabel.test(label);

export interface ReviewItem extends PayslipItem {
  selected: boolean;
  quantityText: string;
  ratePctText: string;
  amountText: string;
  decisionTouched?: boolean;
  valueEdited?: boolean;
}

export interface ReviewTotal {
  label: string;
  valueText: string;
  source: string;
  selected: boolean;
  decisionTouched?: boolean;
  valueEdited?: boolean;
}

export interface ReviewState {
  month: string; payType: "oraria" | "giornaliera" | "mensile" | "";
  qualification: string; contractCode: string; partTimePct: string; basePay: string;
  dailyPay: string; monthlyPay: string; ordinaryHours: string; dailyOrdinaryHours: string;
  workedHours: string; workedDays: string; totalElementsPay: string; grossTotal: string;
  netTotal: string; overtimeHours: string; overtimeTariffs: string; overtimeRates: string;
  nightPct: string; holidayPct: string; ccnl: string; level: string;
  selected: Record<string, boolean>;
  edited: Record<string, boolean>;
  selectionTouched: Record<string, boolean>;
  allowancesEdited: boolean;
  totalsEdited: boolean;
  itemsEdited: boolean;
  allowances: Array<DetectedAllowance & { selected: boolean; amountText: string; decisionTouched?: boolean; valueEdited?: boolean }>;
  totals: ReviewTotal[];
  items: ReviewItem[];
}

const displayNumber = (value: number | null): string => value === null ? "" : String(value).replace(".", ",");

function uniqueTotal(analysis: PayslipAnalysis, pattern: RegExp, category: "gross" | "net"): number | null {
  if (Object.keys(analysis.extraFields ?? {}).some((key) => key.startsWith("total:") && pattern.test(key.slice(6)))) return null;
  const candidates = [
    ...analysis.totals.filter((item) => pattern.test(item.label)).map((item) => item.value),
    ...analysis.items.filter((item) => item.category === category && pattern.test(item.originalDescription) && item.amount !== null).map((item) => item.amount as number),
  ];
  if (!candidates.length || candidates.some((value) => Math.abs(value - candidates[0]) > 0.01)) return null;
  return candidates[0];
}

function otherReviewTotals(analysis: PayslipAnalysis): ReviewTotal[] {
  const totals = analysis.totals.filter((item) => !isGrossOrNetLabel(item.label) && !/totale\s+ore/i.test(item.label));
  const keyFor = (label: string) => /ritenut|trattenut/i.test(label) ? "trattenute" : label.trim().toLocaleLowerCase("it-IT");
  return totals.map((item, index) => {
    const duplicates = totals.filter((candidate) => keyFor(candidate.label) === keyFor(item.label));
    const conflicting = duplicates.some((candidate) => Math.abs(candidate.value - item.value) > 0.01);
    return {
      label: item.label, valueText: displayNumber(item.value), source: item.source,
      selected: !conflicting && totals.findIndex((candidate) => keyFor(candidate.label) === keyFor(item.label)) === index,
    };
  });
}

export function initialReview(analysis: PayslipAnalysis, month: string, configuredDailyHours = 0): ReviewState {
  const selected = (value: unknown, confidence: Confidence) => value !== null && confidence !== "bassa";
  const grossTotal = uniqueTotal(analysis, grossLabel, "gross");
  const netTotal = uniqueTotal(analysis, netLabel, "net");
  return {
    month, payType: analysis.basePay.value !== null ? "oraria" : analysis.dailyPay.value !== null ? "giornaliera" : analysis.monthlyPay.value !== null ? "mensile" : "",
    qualification: analysis.qualification.value ?? "", contractCode: analysis.contractCode.value ?? "", partTimePct: displayNumber(analysis.partTimePct.value),
    basePay: displayNumber(analysis.basePay.value), dailyPay: displayNumber(analysis.dailyPay.value), monthlyPay: displayNumber(analysis.monthlyPay.value),
    ordinaryHours: displayNumber(analysis.ordinaryHours.value), dailyOrdinaryHours: configuredDailyHours > 0 ? displayNumber(configuredDailyHours) : "",
    workedHours: displayNumber(analysis.workedHours.value), workedDays: displayNumber(analysis.workedDays.value), totalElementsPay: displayNumber(analysis.totalElementsPay.value),
    grossTotal: displayNumber(grossTotal), netTotal: displayNumber(netTotal),
    overtimeHours: displayNumber(analysis.overtimeHours.value), overtimeTariffs: analysis.overtimeTariffs.map((item) => displayNumber(item.value)).join("; "),
    overtimeRates: analysis.overtimeRates.map((rate) => displayNumber(rate.value)).join("; "), nightPct: displayNumber(analysis.nightPct.value), holidayPct: displayNumber(analysis.holidayPct.value),
    ccnl: analysis.ccnl.value ?? "", level: analysis.level.value ?? "",
    edited: {}, selectionTouched: {}, allowancesEdited: false, totalsEdited: false, itemsEdited: false,
    selected: {
      qualification: selected(analysis.qualification.value, analysis.qualification.confidence), contractCode: selected(analysis.contractCode.value, analysis.contractCode.confidence),
      partTimePct: selected(analysis.partTimePct.value, analysis.partTimePct.confidence), basePay: selected(analysis.basePay.value, analysis.basePay.confidence),
      dailyPay: selected(analysis.dailyPay.value, analysis.dailyPay.confidence), monthlyPay: selected(analysis.monthlyPay.value, analysis.monthlyPay.confidence),
      ordinaryHours: selected(analysis.ordinaryHours.value, analysis.ordinaryHours.confidence), dailyOrdinaryHours: configuredDailyHours > 0,
      workedHours: selected(analysis.workedHours.value, analysis.workedHours.confidence), workedDays: selected(analysis.workedDays.value, analysis.workedDays.confidence),
      totalElementsPay: selected(analysis.totalElementsPay.value, analysis.totalElementsPay.confidence),
      grossTotal: grossTotal !== null, netTotal: netTotal !== null,
      overtimeHours: selected(analysis.overtimeHours.value, analysis.overtimeHours.confidence), overtimeTariffs: analysis.overtimeTariffs.length > 0 && analysis.overtimeTariffs.every((item) => item.confidence !== "bassa"),
      overtimeRates: analysis.overtimeRates.length > 0 && analysis.overtimeRates.every((rate) => rate.confidence !== "bassa"), nightPct: selected(analysis.nightPct.value, analysis.nightPct.confidence),
      holidayPct: selected(analysis.holidayPct.value, analysis.holidayPct.confidence), ccnl: selected(analysis.ccnl.value, analysis.ccnl.confidence), level: selected(analysis.level.value, analysis.level.confidence),
    },
    allowances: analysis.allowances.map((allowance) => ({ ...allowance, selected: allowance.confidence !== "bassa", amountText: displayNumber(allowance.amount) })),
    totals: otherReviewTotals(analysis),
    items: analysis.items.filter((item) => item.category !== "net" && !isGrossOrNetLabel(item.originalDescription)).map((item) => ({
      ...item, category: item.category === "gross" ? "earnings" as const : item.category,
      selected: item.confidence !== "bassa", quantityText: displayNumber(item.quantity), ratePctText: displayNumber(item.ratePct), amountText: displayNumber(item.amount),
    })),
  };
}

export function updateReviewValue<K extends keyof ReviewState>(state: ReviewState, key: K, value: ReviewState[K]): ReviewState {
  const isSelectable = key in state.selected;
  return { ...state, [key]: value, selected: isSelectable ? { ...state.selected, [key]: String(value).trim() !== "" } : state.selected,
    edited: { ...state.edited, [key]: true } };
}

export function updateReviewSelection(state: ReviewState, key: string, value: boolean): ReviewState {
  return { ...state, selected: { ...state.selected, [key]: value }, selectionTouched: { ...state.selectionTouched, [key]: true } };
}

const editableFields = ["month", "payType", "qualification", "contractCode", "partTimePct", "basePay", "dailyPay", "monthlyPay", "ordinaryHours", "dailyOrdinaryHours", "workedHours", "workedDays", "totalElementsPay", "grossTotal", "netTotal", "overtimeHours", "overtimeTariffs", "overtimeRates", "nightPct", "holidayPct", "ccnl", "level"] as const;

/** Preserve every explicit correction or exclusion when a later AI result arrives. */
export function mergeReviewKeepingUserChoices(current: ReviewState, proposed: ReviewState): ReviewState {
  const merged = { ...proposed, edited: { ...current.edited }, selectionTouched: { ...current.selectionTouched } };
  for (const key of editableFields) {
    if (current.edited[key]) {
      if (key === "payType") merged.payType = current.payType;
      else merged[key] = current[key];
    }
    if (current.edited[key] || current.selectionTouched[key]) merged.selected[key] = current.selected[key];
  }
  merged.allowancesEdited = current.allowancesEdited;
  merged.totalsEdited = current.totalsEdited;
  merged.itemsEdited = current.itemsEdited;
  if (current.allowancesEdited) merged.allowances = current.allowances;
  if (current.totalsEdited) merged.totals = current.totals;
  if (current.itemsEdited) merged.items = current.items;
  return merged;
}

const numericFields = ["partTimePct", "basePay", "dailyPay", "monthlyPay", "ordinaryHours", "dailyOrdinaryHours", "workedHours", "workedDays", "totalElementsPay", "grossTotal", "netTotal", "overtimeHours", "nightPct", "holidayPct"] as const;
export type NumericReviewField = typeof numericFields[number];

function checkedNumber(value: string, label: string, allowNegative = false): number {
  const result = inspectPayslipNumber(value);
  if (result.status !== "valid" || (!allowNegative && result.value < 0)) {
    throw new Error(result.status === "uncertain" ? `Formato ambiguo per “${label}”: correggilo o escludilo.` : `Controlla il valore “${label}” oppure escludilo.`);
  }
  return result.value;
}

function optionalNumber(value: string, label: string, allowNegative = false): number | null {
  return value.trim() ? checkedNumber(value, label, allowNegative) : null;
}

function listNumbers(value: string, label: string): number[] {
  const parts = value.split(/[;\n]+/).map((item) => item.trim());
  if (parts.some((item) => !item)) throw new Error(`Controlla il valore “${label}” oppure escludilo.`);
  return parts.map((item) => checkedNumber(item, label));
}

export interface ConfirmedReviewValues {
  numbers: Record<NumericReviewField, number | null>;
  overtimeRates: number[];
  overtimeTariffs: number[];
  allowances: Array<{ name: string; amount: number | null }>;
  totals: Array<{ label: string; value: number }>;
  items: PayslipItem[];
}

/** Only selected, validated values leave the review screen. */
export function confirmReviewValues(review: ReviewState): ConfirmedReviewValues {
  const numbers = {} as Record<NumericReviewField, number | null>;
  for (const key of numericFields) numbers[key] = review.selected[key] ? checkedNumber(review[key], key, key === "grossTotal" || key === "netTotal") : null;
  const overtimeRates = review.selected.overtimeRates ? listNumbers(review.overtimeRates, "Maggiorazioni straordinario") : [];
  const overtimeTariffs = review.selected.overtimeTariffs ? listNumbers(review.overtimeTariffs, "Tariffe straordinarie") : [];
  const allowances = review.allowances.filter((item) => item.selected).map((item) => {
    if (!item.name.trim()) throw new Error("Dai un nome all’indennità oppure escludila.");
    return { name: item.name.trim(), amount: optionalNumber(item.amountText, item.name, true) };
  });
  const totals = review.totals.filter((item) => item.selected && !isGrossOrNetLabel(item.label)).map((item) => ({
    label: item.label.trim(), value: checkedNumber(item.valueText, item.label, true),
  }));
  const items = review.items.filter((item) => item.selected && item.category !== "gross" && item.category !== "net" && !isGrossOrNetLabel(item.originalDescription)).map((item) => ({
    originalDescription: item.originalDescription.trim(), category: item.category, unit: item.unit,
    quantity: optionalNumber(item.quantityText, `${item.originalDescription}: quantità`),
    ratePct: optionalNumber(item.ratePctText, `${item.originalDescription}: percentuale`),
    amount: optionalNumber(item.amountText, `${item.originalDescription}: importo`, true),
    source: item.source,
    confidence: item.confidence,
    note: item.note,
  }));
  return { numbers, overtimeRates, overtimeTariffs, allowances, totals, items };
}
