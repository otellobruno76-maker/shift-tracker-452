import { describe, expect, it } from "vitest";
import { compareMonthWithPayslip, periodMatches } from "./payslipComparison";
import { emptyTotals } from "./stats";
import { DEFAULT_SETTINGS, type PayslipItem, type PayslipRecord } from "./types";

const record = (patch: Partial<PayslipRecord> = {}): PayslipRecord => ({
  id: "p", month: "2026-09", filename: "fittizio.pdf", basePay: null, ordinaryHours: 160,
  workedHours: 170, workedDays: 20, overtimeHours: 10, overtimeRates: [], nightPct: null,
  holidayPct: null, allowances: [], ccnl: "", level: "", totals: [], uploadedAt: "x", updatedAt: "x", ...patch,
});
const totals = (ordinary = 160, overtime = 10) => ({ ...emptyTotals(), ordinaryMinutes: ordinary * 60, overtimeMinutes: overtime * 60, netMinutes: (ordinary + overtime) * 60, workDays: 20 });

describe("confronto deterministico registro e cedolino", () => {
  it("classifica valori uguali come coerenti", () => expect(compareMonthWithPayslip(totals(), record(), DEFAULT_SETTINGS).slice(0, 4).every((row) => row.status === "coerente")).toBe(true));
  it("segnala ore registro maggiori", () => expect(compareMonthWithPayslip(totals(160, 12), record(), DEFAULT_SETTINGS).find((row) => row.key === "overtime")).toMatchObject({ difference: 2, status: "differenza" }));
  it("segnala ore registro minori", () => expect(compareMonthWithPayslip(totals(160, 8), record(), DEFAULT_SETTINGS).find((row) => row.key === "overtime")).toMatchObject({ difference: -2, status: "differenza" }));
  it("accetta arrotondamenti entro sei minuti", () => expect(compareMonthWithPayslip(totals(160, 10.05), record(), DEFAULT_SETTINGS).find((row) => row.key === "overtime")?.status).toBe("coerente"));
  it("non forza il confronto quando manca un valore", () => expect(compareMonthWithPayslip(totals(), record({ overtimeHours: null }), DEFAULT_SETTINGS).find((row) => row.key === "overtime")?.status).toBe("insufficiente"));
  it("converte giorni in ore soltanto con le ore giornaliere configurate", () => {
    const items: PayslipItem[] = [{ originalDescription: "Ferie godute", category: "vacation", quantity: 1, unit: "days", ratePct: null, amount: null, confidence: "alta", source: "ai" }];
    const result = compareMonthWithPayslip({ ...totals(), ferieDays: 1 }, record({ items }), DEFAULT_SETTINGS);
    expect(result.find((row) => row.key === "vacation")?.status).toBe("coerente");
  });
  it("mantiene separate le percentuali di straordinario", () => {
    const items: PayslipItem[] = [{ originalDescription: "Straord. 15%", category: "overtime", quantity: 4, unit: "hours", ratePct: 15, amount: 55, confidence: "alta", source: "ai" }];
    expect(compareMonthWithPayslip(totals(), record({ items }), DEFAULT_SETTINGS).some((row) => row.key === "overtime-15")).toBe(true);
  });
  it("confronta ferie, permessi e malattia senza confondere le categorie", () => {
    const items: PayslipItem[] = [
      ["Ferie", "vacation", 1], ["Permesso", "permission", 2], ["Malattia", "sickness", 3],
    ].map(([originalDescription, category, quantity]) => ({ originalDescription: String(originalDescription), category: category as PayslipItem["category"], quantity: Number(quantity), unit: "days", ratePct: null, amount: null, confidence: "alta", source: "ai" }));
    const result = compareMonthWithPayslip({ ...totals(), ferieDays: 1, permessiDays: 2, malattiaDays: 3 }, record({ items }), DEFAULT_SETTINGS);
    expect(["vacation", "permission", "sickness"].map((key) => result.find((row) => row.key === key)?.status)).toEqual(["coerente", "coerente", "coerente"]);
  });
  it("non confronta ore e giorni senza una conversione configurata", () => {
    const items: PayslipItem[] = [{ originalDescription: "Permesso", category: "permission", quantity: 8, unit: "hours", ratePct: null, amount: null, confidence: "alta", source: "ai" }];
    expect(compareMonthWithPayslip({ ...totals(), permessiDays: 1 }, record({ items }), { ...DEFAULT_SETTINGS, dailyOrdinaryHours: 0 }).find((row) => row.key === "permission")?.status).toBe("insufficiente");
  });
  it("rileva un cedolino di mese differente", () => expect(periodMatches("2026-09", record({ month: "2026-08" }))).toBe(false));
});
