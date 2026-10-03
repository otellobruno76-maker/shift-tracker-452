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
  it("non sceglie arbitrariamente la prima aliquota se il cedolino ne mostra più di una", () => {
    const rows = compareMonthWithPayslip(totals(), record({ overtimeRates: [15, 25] }), { ...DEFAULT_SETTINGS, overtimePct: 25 });
    expect(rows.find((row) => row.key === "overtimeRate"))
      .toMatchObject({ payslipValue: null, difference: null, status: "insufficiente" });
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
  it("somma giorni e ore della stessa assenza soltanto con una conversione verificabile", () => {
    const items: PayslipItem[] = [
      { originalDescription: "Ferie giornata", category: "vacation", quantity: 1, unit: "days", ratePct: null, amount: null, confidence: "alta", source: "ai" },
      { originalDescription: "Ferie quattro ore", category: "vacation", quantity: 4, unit: "hours", ratePct: null, amount: null, confidence: "alta", source: "ai" },
    ];
    const month = { ...totals(), ferieDays: 2 };
    expect(compareMonthWithPayslip(month, record({ items }), { ...DEFAULT_SETTINGS, dailyOrdinaryHours: 4 }).find((row) => row.key === "vacation"))
      .toMatchObject({ payslipValue: 2, status: "coerente" });
    expect(compareMonthWithPayslip(month, record({ items }), { ...DEFAULT_SETTINGS, dailyOrdinaryHours: 0 }).find((row) => row.key === "vacation"))
      .toMatchObject({ payslipValue: null, difference: null, status: "insufficiente" });
  });
  it("non considera completa una categoria se una voce non ha quantità", () => {
    const items: PayslipItem[] = [
      { originalDescription: "Ferie godute", category: "vacation", quantity: 1, unit: "days", ratePct: null, amount: null, confidence: "alta", source: "ai" },
      { originalDescription: "Ferie senza quantità leggibile", category: "vacation", quantity: null, unit: "days", ratePct: null, amount: 50, confidence: "bassa", source: "ai" },
    ];
    expect(compareMonthWithPayslip({ ...totals(), ferieDays: 1 }, record({ items }), DEFAULT_SETTINGS).find((row) => row.key === "vacation"))
      .toMatchObject({ payslipValue: null, difference: null, status: "insufficiente" });
  });
  it("non trasforma giorni festivi in ore di lavoro usando la durata ordinaria", () => {
    const items: PayslipItem[] = [{ originalDescription: "Lavoro festivo 1 giorno", category: "holiday", quantity: 1, unit: "days", ratePct: null, amount: 80, confidence: "alta", source: "ai" }];
    expect(compareMonthWithPayslip({ ...totals(), holidayMinutes: 8 * 60 }, record({ items }), DEFAULT_SETTINGS).find((row) => row.key === "holiday"))
      .toMatchObject({ payslipValue: null, difference: null, status: "insufficiente" });
  });
  it("non considera euro o unità sconosciute come quantità orarie", () => {
    for (const unit of ["euro", "unknown"] as const) {
      const items: PayslipItem[] = [{ originalDescription: "Lavoro notturno", category: "night", quantity: 8, unit, ratePct: null, amount: 80, confidence: "alta", source: "ai" }];
      expect(compareMonthWithPayslip({ ...totals(), nightMinutes: 8 * 60 }, record({ items }), DEFAULT_SETTINGS).find((row) => row.key === "night"))
        .toMatchObject({ payslipValue: null, difference: null, status: "insufficiente" });
    }
  });
  it("tratta un importo o una quantità non finita come dato insufficiente", () => {
    const items: PayslipItem[] = [{ originalDescription: "Ore notturne", category: "night", quantity: Number.NaN, unit: "hours", ratePct: null, amount: null, confidence: "alta", source: "ai" }];
    const rows = compareMonthWithPayslip({ ...totals(), nightMinutes: 8 * 60, pay: { ...totals().pay, total: 2000 } }, record({ items, grossTotal: Number.NaN }),
      { ...DEFAULT_SETTINGS, basePay: 10 });
    expect(rows.find((row) => row.key === "night")).toMatchObject({ payslipValue: null, difference: null, status: "insufficiente" });
    expect(rows.find((row) => row.key === "gross")).toMatchObject({ payslipValue: null, difference: null, status: "insufficiente" });
  });
  it("non confronta una voce di straordinario in giorni o euro con le ore del registro", () => {
    for (const unit of ["days", "euro"] as const) {
      const items: PayslipItem[] = [{ originalDescription: "Straordinario 15%", category: "overtime", quantity: 2, unit, ratePct: 15, amount: 35, confidence: "alta", source: "ai" }];
      const row = compareMonthWithPayslip(totals(), record({ items }), { ...DEFAULT_SETTINGS, overtimePct: 15 }).find((item) => item.key === "overtime-15-0");
      expect(row).toMatchObject({ registerValue: null, payslipValue: 2, difference: null, status: "insufficiente", unit: unit === "days" ? "giorni" : "€" });
    }
  });
  it("non attribuisce a ciascuna riga le ore totali quando più righe hanno la stessa aliquota", () => {
    const items: PayslipItem[] = [2, 3].map((quantity) => ({ originalDescription: "Straordinario 15%", category: "overtime", quantity, unit: "hours", ratePct: 15, amount: 35, confidence: "alta", source: "ai" }));
    expect(compareMonthWithPayslip(totals(), record({ items }), { ...DEFAULT_SETTINGS, overtimePct: 15 }).filter((row) => row.key.startsWith("overtime-")))
      .toEqual(expect.arrayContaining([expect.objectContaining({ registerValue: null, status: "insufficiente" })]));
  });
  it("non riusa Lordo e Netto esclusi dalle voci o dai totali grezzi", () => {
    const items: PayslipItem[] = [
      { originalDescription: "Totale competenze", category: "gross", quantity: null, unit: "euro", ratePct: null, amount: 2000, confidence: "alta", source: "ai" },
      { originalDescription: "Netto a pagare", category: "net", quantity: null, unit: "euro", ratePct: null, amount: 1500, confidence: "alta", source: "ai" },
    ];
    const estimated = { ...totals(), pay: { ...totals().pay, total: 2000, net: 1500, netEnabled: true } };
    const rows = compareMonthWithPayslip(estimated, record({ grossTotal: null, netTotal: null, items, totals: [
      { label: "Totale competenze", value: 2000 }, { label: "Netto a pagare", value: 1500 },
    ] }), { ...DEFAULT_SETTINGS, basePay: 10, netEnabled: true });
    expect(rows.find((row) => row.key === "gross")).toMatchObject({ payslipValue: null, difference: null, status: "insufficiente" });
    expect(rows.find((row) => row.key === "net")).toMatchObject({ payslipValue: null, difference: null, status: "insufficiente" });
    expect(rows.some((row) => row.key === "netArithmetic")).toBe(false);
  });
  it("non prende una singola trattenuta per il totale trattenute", () => {
    const items: PayslipItem[] = [{ originalDescription: "Contributo INPS", category: "deductions", quantity: null, unit: "euro", ratePct: null, amount: 100, confidence: "alta", source: "ai" }];
    const estimated = { ...totals(), pay: { ...totals().pay, total: 2000, net: 1500, netEnabled: true } };
    expect(compareMonthWithPayslip(estimated, record({ items }), { ...DEFAULT_SETTINGS, basePay: 10 }).find((row) => row.key === "deductions"))
      .toMatchObject({ payslipValue: null, difference: null, status: "insufficiente" });
  });
  it("non somma due totali di trattenute discordanti", () => {
    const estimated = { ...totals(), pay: { ...totals().pay, total: 2000, net: 1500, netEnabled: true } };
    const rows = compareMonthWithPayslip(estimated, record({ totals: [
      { label: "Totale ritenute", value: 400 }, { label: "Totale trattenute", value: 500 },
    ] }), { ...DEFAULT_SETTINGS, basePay: 10 });
    expect(rows.find((row) => row.key === "deductions"))
      .toMatchObject({ payslipValue: null, difference: null, status: "insufficiente" });
  });
  it("non confronta una sola indennità con il totale di reperibilità senza tariffa o con più voci", () => {
    const item: PayslipItem = { originalDescription: "Indennità reperibilità", category: "allowance", quantity: 1, unit: "days", ratePct: null, amount: 30, confidence: "alta", source: "ai" };
    const month = { ...totals(), reperibilitaDays: 2, pay: { ...totals().pay, standbyAllowance: 60 } };
    const withoutRate = compareMonthWithPayslip(month, record({ items: [item] }), DEFAULT_SETTINGS).find((row) => row.key === "allowance-0");
    expect(withoutRate).toMatchObject({ registerValue: null, difference: null, status: "insufficiente" });
    const partialDays = compareMonthWithPayslip(month, record({ items: [item] }), { ...DEFAULT_SETTINGS, reperibilitaEuroPerDay: 30 }).find((row) => row.key === "allowance-0");
    expect(partialDays).toMatchObject({ registerValue: null, difference: null, status: "insufficiente" });
    const withTwoItems = compareMonthWithPayslip(month, record({ items: [item, item] }), { ...DEFAULT_SETTINGS, reperibilitaEuroPerDay: 30 });
    expect(withTwoItems.filter((row) => row.key.startsWith("allowance-")).every((row) => row.status === "insufficiente")).toBe(true);
  });
  it("indica l'unità della paga oraria e mensile senza confonderle", () => {
    const rows = compareMonthWithPayslip(totals(), record({ basePay: 12, monthlyPay: 2000 }),
      { ...DEFAULT_SETTINGS, basePay: 12, monthlyReferencePay: 2000 });
    expect(rows.find((row) => row.key === "basePay")).toMatchObject({ unit: "€/h", status: "coerente" });
    expect(rows.find((row) => row.key === "monthlyPay")).toMatchObject({ unit: "€/mese", status: "coerente" });
  });
  it("rileva un cedolino di mese differente", () => expect(periodMatches("2026-09", record({ month: "2026-08" }))).toBe(false));
  it("segnala quattro ore di straordinario con i due valori", () => {
    expect(compareMonthWithPayslip(totals(160, 14), record(), DEFAULT_SETTINGS).find((row) => row.key === "overtime"))
      .toMatchObject({ registerValue: 14, payslipValue: 10, difference: 4, status: "differenza" });
  });
  it("mostra lo scostamento di ferie indipendentemente dalle altre voci", () => {
    const items: PayslipItem[] = [{ originalDescription: "Ferie godute", category: "vacation", quantity: 1, unit: "days", ratePct: null, amount: null, confidence: "alta", source: "ai" }];
    const rows = compareMonthWithPayslip({ ...totals(), ferieDays: 2 }, record({ items }), DEFAULT_SETTINGS);
    expect(rows.find((row) => row.key === "vacation")).toMatchObject({ registerValue: 2, payslipValue: 1, difference: 1, status: "differenza" });
    expect(rows.find((row) => row.key === "ordinary")?.status).toBe("coerente");
  });
  it("calcola contributi soltanto con base e aliquota esplicite", () => {
    const items: PayslipItem[] = [
      { originalDescription: "Imponibile previdenziale", category: "other", quantity: null, unit: "euro", ratePct: null, amount: 2000, confidence: "alta", source: "ai" },
      { originalDescription: "Contributo INPS", category: "deductions", quantity: null, unit: "euro", ratePct: 9.19, amount: 183.8, confidence: "alta", source: "ai" },
    ];
    const result = compareMonthWithPayslip(totals(), record({ items }), DEFAULT_SETTINGS);
    expect(result.find((row) => row.key === "contributions")).toMatchObject({ registerValue: 183.8, payslipValue: 183.8, status: "coerente" });
    items[1] = { ...items[1], ratePct: null };
    const missing = compareMonthWithPayslip(totals(), record({ items }), DEFAULT_SETTINGS);
    expect(missing.find((row) => row.key === "contributions")?.status).toBe("insufficiente");
    expect(missing.find((row) => row.key === "contributions")?.explanation).toContain("aliquota contributiva");
    expect(missing.find((row) => row.key === "ordinary")?.status).toBe("coerente");
  });
  it("non somma una riga di contributi con il suo totale", () => {
    const items: PayslipItem[] = [
      { originalDescription: "Contributo INPS", category: "deductions", quantity: null, unit: "euro", ratePct: 10, amount: 100, confidence: "alta", source: "ai" },
      { originalDescription: "Totale contributi", category: "deductions", quantity: null, unit: "euro", ratePct: null, amount: 100, confidence: "alta", source: "ai" },
    ];
    const rows = compareMonthWithPayslip(totals(), record({ items }), DEFAULT_SETTINGS);
    expect(rows.find((row) => row.key === "contributions"))
      .toMatchObject({ payslipValue: 100, difference: null, status: "insufficiente" });
  });
  it("segnala totali dei contributi discordanti come insufficienti", () => {
    const items: PayslipItem[] = [100, 120].map((amount) => ({
      originalDescription: "Totale contributi", category: "deductions", quantity: null, unit: "euro", ratePct: null, amount, confidence: "alta", source: "ai",
    }));
    const rows = compareMonthWithPayslip(totals(), record({ items }), DEFAULT_SETTINGS);
    expect(rows.find((row) => row.key === "contributions"))
      .toMatchObject({ payslipValue: null, difference: null, status: "insufficiente" });
  });
  it("ricostruisce IRPEF netta e netto matematico dalle componenti esplicite", () => {
    const items: PayslipItem[] = [
      ["IRPEF lorda", 600], ["Detrazioni lavoro", 100], ["IRPEF trattenuta", 500], ["Totale trattenute", 700],
    ].map(([originalDescription, amount]) => ({ originalDescription: String(originalDescription), amount: Number(amount), category: "other", quantity: null, unit: "euro", ratePct: null, confidence: "alta", source: "ai" }));
    const rows = compareMonthWithPayslip(totals(), record({ items, grossTotal: 2200, netTotal: 1500 }), DEFAULT_SETTINGS);
    expect(rows.find((row) => row.key === "withheldTax")?.status).toBe("coerente");
    expect(rows.find((row) => row.key === "netArithmetic")?.status).toBe("coerente");
  });
});
