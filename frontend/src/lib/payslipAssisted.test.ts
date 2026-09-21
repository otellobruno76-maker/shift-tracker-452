import { describe, expect, it } from "vitest";
import { analyzePayslipText, emptyPayslipAnalysis, estimatedDailyValue, reliablePayslipFieldCount } from "./payslip";
import { initialReview, updateReviewValue } from "./payslipReview";

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
});
