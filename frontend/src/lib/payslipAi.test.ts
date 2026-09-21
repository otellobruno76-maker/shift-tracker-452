import { describe, expect, it } from "vitest";
import { emptyPayslipAnalysis } from "./payslip";
import { mergePayslipAnalyses, type PayslipAIResult } from "./payslipAi";

const ai = (patch: Partial<PayslipAIResult> = {}): PayslipAIResult => ({
  month: 8, year: 2026, qualification: "Operaio a mese", level: "2", ccnl: null, contract_code: "607",
  employment_type: null, part_time_pct: 65, pay_type: "monthly", hourly_pay: 8.2826, daily_pay: null,
  monthly_pay: 931.38, ordinary_hours: null, worked_hours: null, worked_days: null, overtime_hours: null,
  overtime_rates: [], overtime_tariffs: [], night_rate: null, holiday_rate: null, minimum_contractual_pay: null,
  contingency: null, edr: null, seniority_increments: null, allowances: [], gross_pay: null,
  total_earnings: null, total_deductions: null, net_pay: null,
  fields: {
    qualification: { confidence: "high", evidence: "colonna Qualifica" }, level: { confidence: "high", evidence: "colonna Livello" },
    contract_code: { confidence: "high", evidence: "colonna Contratto" }, part_time_pct: { confidence: "high", evidence: "colonna %Part-Time" },
    monthly_pay: { confidence: "high", evidence: "Retribuzione mese" }, hourly_pay: { confidence: "medium", evidence: "Dato Base ripetuto in due voci orarie" },
  }, ...patch,
});

describe("merge lettura locale e analisi AI", () => {
  it("mantiene il caso sintetico INAZ senza inventare altri valori", () => {
    const merged = mergePayslipAnalyses(emptyPayslipAnalysis(), ai());
    expect(merged.analysis).toMatchObject({ qualification: { value: "Operaio a mese" }, level: { value: "2" }, contractCode: { value: "607" }, partTimePct: { value: 65 }, monthlyPay: { value: 931.38 }, basePay: { value: 8.2826, confidence: "media" } });
    expect(merged.analysis.dailyPay.value).toBeNull();
    expect(merged.analysis.ordinaryHours.value).toBeNull();
  });

  it("aumenta la fiducia quando locale e AI concordano", () => {
    const local = emptyPayslipAnalysis(); local.level = { value: "2", confidence: "media", source: "Lettura locale" };
    const merged = mergePayslipAnalyses(local, ai());
    expect(merged.analysis.level.confidence).toBe("alta");
    expect(merged.analysis.level.source).toContain("Concordanza");
  });

  it("espone un conflitto senza scegliere automaticamente", () => {
    const local = emptyPayslipAnalysis(); local.level = { value: "3", confidence: "alta", source: "colonna Livello" };
    const merged = mergePayslipAnalyses(local, ai());
    expect(merged.conflicts).toContain("Livello: locale “3”, AI “2”");
    expect(merged.analysis.level).toMatchObject({ value: "3", confidence: "bassa" });
  });

  it("non usa automaticamente un dato AI a bassa affidabilità contro un dato locale", () => {
    const local = emptyPayslipAnalysis(); local.basePay = { value: 10, confidence: "media", source: "lettura locale" };
    const result = ai({ hourly_pay: 99, fields: { ...ai().fields, hourly_pay: { confidence: "low", evidence: "numero ambiguo" } } });
    expect(mergePayslipAnalyses(local, result).analysis.basePay.value).toBe(10);
  });
});
