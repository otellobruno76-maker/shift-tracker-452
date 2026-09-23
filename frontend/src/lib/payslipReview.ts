import type { Confidence, DetectedAllowance, PayslipAnalysis } from "./payslip";
import type { PayslipItem } from "./types";

export interface ReviewState {
  month: string; payType: "oraria" | "giornaliera" | "mensile" | "";
  qualification: string; contractCode: string; partTimePct: string; basePay: string;
  dailyPay: string; monthlyPay: string; ordinaryHours: string; dailyOrdinaryHours: string;
  workedHours: string; workedDays: string; totalElementsPay: string; grossTotal: string;
  netTotal: string; overtimeHours: string; overtimeTariffs: string; overtimeRates: string;
  nightPct: string; holidayPct: string; ccnl: string; level: string;
  selected: Record<string, boolean>;
  edited: Record<string, boolean>;
  allowances: Array<DetectedAllowance & { selected: boolean; amountText: string }>;
  totals: Array<{ label: string; value: number }>;
  items: PayslipItem[];
}

const displayNumber = (value: number | null): string => value === null ? "" : String(value).replace(".", ",");

export function initialReview(analysis: PayslipAnalysis, month: string, configuredDailyHours = 0): ReviewState {
  const selected = (value: unknown, confidence: Confidence) => value !== null && confidence !== "bassa";
  return {
    month, payType: analysis.basePay.value !== null ? "oraria" : analysis.dailyPay.value !== null ? "giornaliera" : analysis.monthlyPay.value !== null ? "mensile" : "",
    qualification: analysis.qualification.value ?? "", contractCode: analysis.contractCode.value ?? "", partTimePct: displayNumber(analysis.partTimePct.value),
    basePay: displayNumber(analysis.basePay.value), dailyPay: displayNumber(analysis.dailyPay.value), monthlyPay: displayNumber(analysis.monthlyPay.value),
    ordinaryHours: displayNumber(analysis.ordinaryHours.value), dailyOrdinaryHours: configuredDailyHours > 0 ? displayNumber(configuredDailyHours) : "",
    workedHours: displayNumber(analysis.workedHours.value), workedDays: displayNumber(analysis.workedDays.value), totalElementsPay: displayNumber(analysis.totalElementsPay.value),
    grossTotal: displayNumber(analysis.totals.find((item) => /lordo|competenze/i.test(item.label))?.value ?? null), netTotal: displayNumber(analysis.totals.find((item) => /netto/i.test(item.label))?.value ?? null),
    overtimeHours: displayNumber(analysis.overtimeHours.value), overtimeTariffs: analysis.overtimeTariffs.map((item) => displayNumber(item.value)).join("; "),
    overtimeRates: analysis.overtimeRates.map((rate) => displayNumber(rate.value)).join(", "), nightPct: displayNumber(analysis.nightPct.value), holidayPct: displayNumber(analysis.holidayPct.value),
    ccnl: analysis.ccnl.value ?? "", level: analysis.level.value ?? "",
    edited: {}, selected: {
      qualification: selected(analysis.qualification.value, analysis.qualification.confidence), contractCode: selected(analysis.contractCode.value, analysis.contractCode.confidence),
      partTimePct: selected(analysis.partTimePct.value, analysis.partTimePct.confidence), basePay: selected(analysis.basePay.value, analysis.basePay.confidence),
      dailyPay: selected(analysis.dailyPay.value, analysis.dailyPay.confidence), monthlyPay: selected(analysis.monthlyPay.value, analysis.monthlyPay.confidence),
      ordinaryHours: selected(analysis.ordinaryHours.value, analysis.ordinaryHours.confidence), workedHours: selected(analysis.workedHours.value, analysis.workedHours.confidence),
      workedDays: selected(analysis.workedDays.value, analysis.workedDays.confidence), totalElementsPay: selected(analysis.totalElementsPay.value, analysis.totalElementsPay.confidence),
      grossTotal: analysis.totals.some((item) => /lordo|competenze/i.test(item.label)), netTotal: analysis.totals.some((item) => /netto/i.test(item.label)),
      overtimeHours: selected(analysis.overtimeHours.value, analysis.overtimeHours.confidence), overtimeTariffs: analysis.overtimeTariffs.length > 0 && analysis.overtimeTariffs.every((item) => item.confidence !== "bassa"),
      overtimeRates: analysis.overtimeRates.length > 0 && analysis.overtimeRates.every((rate) => rate.confidence !== "bassa"), nightPct: selected(analysis.nightPct.value, analysis.nightPct.confidence),
      holidayPct: selected(analysis.holidayPct.value, analysis.holidayPct.confidence), ccnl: selected(analysis.ccnl.value, analysis.ccnl.confidence), level: selected(analysis.level.value, analysis.level.confidence),
    },
    allowances: analysis.allowances.map((allowance) => ({ ...allowance, selected: allowance.confidence !== "bassa", amountText: displayNumber(allowance.amount) })),
    totals: analysis.totals.map(({ label, value }) => ({ label, value })), items: analysis.items,
  };
}

export function updateReviewValue<K extends keyof ReviewState>(state: ReviewState, key: K, value: ReviewState[K]): ReviewState {
  return { ...state, [key]: value, selected: { ...state.selected, [key]: String(value).trim() !== "" }, edited: { ...state.edited, [key]: true } };
}
