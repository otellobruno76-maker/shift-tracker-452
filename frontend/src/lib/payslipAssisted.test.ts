import { describe, expect, it } from "vitest";
import { analyzePayslipText, emptyPayslipAnalysis, estimatedDailyValue, reliablePayslipFieldCount } from "./payslip";
import { confirmReviewValues, initialReview, mergeReviewKeepingUserChoices, updateReviewSelection, updateReviewValue } from "./payslipReview";

describe("compilazione assistita del cedolino", () => {
  it("mantiene i dati di un cedolino riconosciuto bene", () => {
    const analysis = analyzePayslipText("Paga oraria 10,00\nOre ordinarie 168\nCCNL Metalmeccanici\nLivello 3\nNetto a pagare 1.450,00");
    const review = initialReview(analysis, "2026-09", 8);
    expect(reliablePayslipFieldCount(analysis)).toBeGreaterThanOrEqual(4);
    expect(review).toMatchObject({ basePay: "10", ordinaryHours: "168", level: "3", dailyOrdinaryHours: "8" });
  });

  it("precompila soltanto ciò che riconosce in un cedolino parziale", () => {
    const analysis = analyzePayslipText("Retribuzione mensile 1.620,00\nDocumento parzialmente leggibile");
    const review = initialReview(analysis, "2026-08", 8);
    expect(review.monthlyPay).toBe("1620");
    expect(review.basePay).toBe("");
    expect(review.dailyPay).toBe("");
  });

  it("non inventa dati quando il documento è sconosciuto", () => {
    const analysis = emptyPayslipAnalysis();
    const review = initialReview(analysis, "2026-07", 0);
    expect(reliablePayslipFieldCount(analysis)).toBe(0);
    expect(review.basePay).toBe("");
    expect(review.dailyPay).toBe("");
    expect(review.monthlyPay).toBe("");
    expect(estimatedDailyValue(null, 8)).toBeNull();
  });

  it("rende modificabili e selezionati i dati compilati manualmente", () => {
    const review = initialReview(emptyPayslipAnalysis(), "2026-07", 0);
    const edited = updateReviewValue(review, "basePay", "12,50");
    expect(edited.basePay).toBe("12,50");
    expect(edited.selected.basePay).toBe(true);
    expect(estimatedDailyValue(12.5, 8)).toBe(100);
  });

  it("rispetta l'esclusione di lordo e netto e non conserva copie nei totali o nelle voci", () => {
    const analysis = emptyPayslipAnalysis();
    analysis.totals = [
      { label: "Lordo", value: 1800, source: "Analisi AI" },
      { label: "Netto a pagare", value: 1400, source: "Analisi AI" },
      { label: "Totale ritenute", value: 400, source: "Analisi AI" },
    ];
    analysis.items = [
      { originalDescription: "Lordo", category: "gross", quantity: null, unit: "euro", ratePct: null, amount: 1800, confidence: "alta", source: "ai" },
      { originalDescription: "Netto a pagare", category: "net", quantity: null, unit: "euro", ratePct: null, amount: 1400, confidence: "alta", source: "ai" },
    ];
    let review = initialReview(analysis, "2026-09");
    review = updateReviewSelection(updateReviewSelection(review, "grossTotal", false), "netTotal", false);
    const confirmed = confirmReviewValues(review);
    expect(confirmed.numbers.grossTotal).toBeNull();
    expect(confirmed.numbers.netTotal).toBeNull();
    expect(confirmed.totals).toEqual([{ label: "Totale ritenute", value: 400 }]);
    expect(confirmed.items).toEqual([]);
  });

  it("segnala come incerti totali lordo discordanti", () => {
    const analysis = emptyPayslipAnalysis();
    analysis.totals = [
      { label: "Lordo", value: 1800, source: "Lettura locale" },
      { label: "Totale competenze", value: 1900, source: "Analisi AI" },
    ];
    const review = initialReview(analysis, "2026-09");
    expect(review.grossTotal).toBe("");
    expect(review.selected.grossTotal).toBe(false);
  });

  it("non preseleziona totali di trattenute discordanti", () => {
    const analysis = emptyPayslipAnalysis();
    analysis.totals = [
      { label: "Totale ritenute", value: 400, source: "Lettura locale" },
      { label: "Totale trattenute", value: 500, source: "Analisi AI" },
    ];
    const review = initialReview(analysis, "2026-09");
    expect(review.totals.map((item) => item.selected)).toEqual([false, false]);
    expect(confirmReviewValues(review).totals).toEqual([]);
  });

  it("propone Lordo e Netto anche quando l'AI li trova solo nelle voci", () => {
    const analysis = emptyPayslipAnalysis();
    analysis.items = [
      { originalDescription: "Totale competenze", category: "gross", quantity: null, unit: "euro", ratePct: null, amount: 1900, confidence: "alta", source: "ai" },
      { originalDescription: "Netto a pagare", category: "net", quantity: null, unit: "euro", ratePct: null, amount: 1400, confidence: "alta", source: "ai" },
    ];
    const review = initialReview(analysis, "2026-09");
    expect(review).toMatchObject({ grossTotal: "1900", netTotal: "1400" });
    expect(confirmReviewValues(review)).toMatchObject({ numbers: { grossTotal: 1900, netTotal: 1400 }, items: [] });
  });

  it("mantiene correzioni, mese, esclusioni e voci già riviste dopo una nuova analisi AI", () => {
    const before = initialReview(emptyPayslipAnalysis(), "2026-08");
    let current = updateReviewValue(before, "basePay", "12.5");
    current = updateReviewValue(current, "month", "2026-07");
    current = updateReviewSelection(current, "netTotal", false);
    current = { ...current, itemsEdited: true, items: [{
      originalDescription: "Straordinario", category: "overtime", quantity: 2, quantityText: "3,5",
      unit: "hours", ratePct: 20, ratePctText: "20", amount: 30, amountText: "30",
      confidence: "media", source: "manuale", selected: true,
    }] };
    const aiAnalysis = emptyPayslipAnalysis();
    aiAnalysis.basePay = { value: 99, confidence: "alta", source: "Analisi AI" };
    aiAnalysis.totals = [{ label: "Netto a pagare", value: 1000, source: "Analisi AI" }];
    const merged = mergeReviewKeepingUserChoices(current, initialReview(aiAnalysis, "2026-09"));
    expect(merged.basePay).toBe("12.5");
    expect(merged.month).toBe("2026-07");
    expect(merged.selected.netTotal).toBe(false);
    expect(merged.items).toEqual(current.items);
    expect(confirmReviewValues(merged).numbers.basePay).toBe(12.5);
  });

  it("blocca numeri ambigui senza modificarli silenziosamente", () => {
    const review = updateReviewValue(initialReview(emptyPayslipAnalysis(), "2026-08"), "basePay", "1.234");
    expect(() => confirmReviewValues(review)).toThrow(/Formato ambiguo/);
  });

  it("permette di correggere o escludere le voci che alimentano i confronti", () => {
    const analysis = emptyPayslipAnalysis();
    analysis.items = [{ originalDescription: "Straordinario 20%", category: "overtime", quantity: 2, unit: "hours", ratePct: 20, amount: -123.45, confidence: "alta", source: "ai" }];
    const review = initialReview(analysis, "2026-08");
    const revised = { ...review, itemsEdited: true, items: [{ ...review.items[0], quantityText: "3,5", amountText: "-123,45" }] };
    expect(confirmReviewValues(revised).items[0]).toMatchObject({ quantity: 3.5, amount: -123.45 });
    const excluded = { ...revised, items: [{ ...revised.items[0], selected: false }] };
    expect(confirmReviewValues(excluded).items).toEqual([]);
  });
});
