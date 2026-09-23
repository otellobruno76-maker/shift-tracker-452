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
  it("non inventa un confronto economico quando manca la paga oraria", () => {
    const rows = compareMonthWithPayslip(totals(), record({ grossTotal: 1800, basePay: null }), DEFAULT_SETTINGS);
    expect(rows.find((row) => row.key === "gross")).toMatchObject({ registerValue: null, payslipValue: 1800, status: "insufficiente" });
  });
  it("converte giorni in ore soltanto con le ore giornaliere configurate", () => {
    const items: PayslipItem[] = [{ originalDescription: "Ferie godute", category: "vacation", quantity: 1, unit: "days", ratePct: null, amount: null, confidence: "alta", source: "ai" }];
    const result = compareMonthWithPayslip({ ...totals(), ferieDays: 1 }, record({ items }), DEFAULT_SETTINGS);
    expect(result.find((row) => row.key === "vacation")?.status).toBe("coerente");
  });
  it("mantiene separate le percentuali di straordinario", () => {
    const items: PayslipItem[] = [{ originalDescription: "Straord. 15%", category: "overtime", quantity: 4, unit: "hours", ratePct: 15, amount: 55, confidence: "alta", source: "ai" }];
    expect(compareMonthWithPayslip(totals(), record({ items }), DEFAULT_SETTINGS).some((row) => row.key.startsWith("overtime-15-"))).toBe(true);
  });
  it("confronta ferie, permessi e malattia senza confondere le categorie", () => {
    const items: PayslipItem[] = [
      ["Ferie", "vacation", 1], ["Permesso", "permission", 2], ["Malattia", "sickness", 3],
    ].map(([originalDescription, category, quantity]) => ({ originalDescription: String(originalDescription), category: category as PayslipItem["category"], quantity: Number(quantity), unit: "days", ratePct: null, amount: null, confidence: "alta", source: "ai" }));
    const result = compareMonthWithPayslip({ ...totals(), ferieDays: 1, permessiDays: 2, malattiaDays: 3 }, record({ items }), DEFAULT_SETTINGS);
    expect(["vacation", "permission", "sickness"].map((key) => result.find((row) => row.key === key)?.status)).toEqual(["coerente", "coerente", "coerente"]);
  });
  it("scenario C: confronta ferie, malattia, ROL ed ex festività nello stesso mese", () => {
    const items: PayslipItem[] = [
      ["Ferie godute", "vacation", 1], ["Malattia", "sickness", 2], ["ROL goduti", "rol", 1], ["Ex festività", "former_holiday", 1],
    ].map(([originalDescription, category, quantity]) => ({ originalDescription: String(originalDescription), category: category as PayslipItem["category"], quantity: Number(quantity), unit: "days", ratePct: null, amount: null, confidence: "alta", source: "ai" }));
    const result = compareMonthWithPayslip({ ...totals(), ferieDays: 1, malattiaDays: 2, rolDays: 1, exFestivitaDays: 1 }, record({ items }), DEFAULT_SETTINGS);
    expect(["vacation", "sickness", "rol", "formerHoliday"].map((key) => result.find((row) => row.key === key)?.status)).toEqual(["coerente", "coerente", "coerente", "coerente"]);
  });
  it("non attribuisce tutte le ore a una percentuale quando ci sono più maggiorazioni", () => {
    const items: PayslipItem[] = [15, 25].map((ratePct) => ({ originalDescription: `Straord. ${ratePct}%`, category: "overtime", quantity: 2, unit: "hours", ratePct, amount: 25, confidence: "alta", source: "ai" }));
    const rows = compareMonthWithPayslip(totals(), record({ items }), { ...DEFAULT_SETTINGS, overtimePct: 15 }).filter((row) => row.key.startsWith("overtime-"));
    expect(rows.every((row) => row.status === "insufficiente" && row.registerValue === null)).toBe(true);
  });
  it("ignora percentuali non esplicite con affidabilità bassa", () => {
    const items: PayslipItem[] = [{ originalDescription: "Numero ambiguo", category: "overtime", quantity: 4, unit: "hours", ratePct: 25, amount: null, confidence: "bassa", source: "ai" }];
    expect(compareMonthWithPayslip(totals(), record({ items }), DEFAULT_SETTINGS).some((row) => row.key.startsWith("overtime-25-"))).toBe(false);
  });
  it("separa stima economica e importi letti nel cedolino", () => {
    const result = compareMonthWithPayslip(totals(), record({ grossTotal: 2000, netTotal: 1500, totals: [{ label: "Totale ritenute", value: 500 }] }), { ...DEFAULT_SETTINGS, basePay: 10, netEnabled: true, netPct: 25 });
    expect(result.find((row) => row.key === "gross")?.registerLabel).toBe("Stima dell’app");
    expect(result.find((row) => row.key === "deductions")?.payslipValue).toBe(500);
    expect(result.find((row) => row.key === "net")?.payslipLabel).toBe("Importo letto nel cedolino");
  });
  it("non confronta ore e giorni senza una conversione configurata", () => {
    const items: PayslipItem[] = [{ originalDescription: "Permesso", category: "permission", quantity: 8, unit: "hours", ratePct: null, amount: null, confidence: "alta", source: "ai" }];
    expect(compareMonthWithPayslip({ ...totals(), permessiDays: 1 }, record({ items }), { ...DEFAULT_SETTINGS, dailyOrdinaryHours: 0 }).find((row) => row.key === "permission")?.status).toBe("insufficiente");
  });
  it("rileva un cedolino di mese differente", () => expect(periodMatches("2026-09", record({ month: "2026-08" }))).toBe(false));
});
