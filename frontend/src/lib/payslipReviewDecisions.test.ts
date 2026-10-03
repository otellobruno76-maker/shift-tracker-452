import { describe, expect, it } from "vitest";
import { emptyPayslipAnalysis, type PayslipAnalysis } from "./payslip";
import { initialReview, updateReviewSelection, updateReviewValue, type ReviewState } from "./payslipReview";
import {
  captureReviewDecisions, resolveReviewDecisionConflict, restoreReviewDecisions,
} from "./payslipReviewDecisions";
import type { PayslipRecord } from "./types";

const item = (description: string, amount: number, category: "earnings" | "allowance" = "earnings") => ({
  originalDescription: description, category, unit: "euro" as const,
  quantity: null, ratePct: null, amount, confidence: "alta" as const, source: "ai" as const,
});

function record(review: ReviewState, patch: Partial<PayslipRecord> = {}): PayslipRecord {
  return {
    id: "cedolino-1", month: "2026-09", filename: "cedolino.pdf", basePay: null,
    ordinaryHours: null, overtimeRates: [], nightPct: null, holidayPct: null,
    allowances: [], ccnl: "", level: "", totals: [], items: [],
    uploadedAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    reviewDecisions: captureReviewDecisions(review), ...patch,
  };
}

describe("decisioni salvate nella revisione del cedolino", () => {
  it("preserva correzioni, esclusioni e valori confermati senza chiamarli tutti manuali", () => {
    const original = emptyPayslipAnalysis();
    original.basePay = { value: 10, confidence: "alta", source: "Lettura locale" };
    original.level = { value: "3", confidence: "alta", source: "Lettura locale" };
    original.totals = [{ label: "Netto a pagare", value: 1400, source: "Lettura locale" }];
    let review = initialReview(original, "2026-09");
    review = updateReviewValue(review, "basePay", "12,50");
    review = updateReviewSelection(review, "netTotal", false);
    review = updateReviewSelection(review, "level", true);
    const saved = record(review, {
      basePay: 12.5, level: "3", netTotal: null,
      fieldProvenance: {
        basePay: { source: "manuale", confidence: "alta" },
        level: { source: "locale", confidence: "alta" },
      },
    });
    const next = emptyPayslipAnalysis();
    next.basePay = { value: 99, confidence: "alta", source: "Analisi AI" };
    next.level = { value: "4", confidence: "alta", source: "Analisi AI" };
    next.totals = [{ label: "Netto a pagare", value: 1500, source: "Analisi AI" }];
    const restored = restoreReviewDecisions(saved, initialReview(next, "2026-09"));
    expect(restored.review).toMatchObject({ basePay: "12,5", level: "3", month: "2026-09", edited: { basePay: true } });
    expect(restored.review.edited.level).toBeUndefined();
    expect(restored.review.selected.netTotal).toBe(false);
    expect(restored.review.selectionTouched.level).toBe(true);
    expect(restored.preservedFields).toContain("level");
    expect(restored.conflicts).toEqual([]);
  });

  it("riconcilia le righe per descrizione univoca, anche se l'AI cambia categoria, e aggiunge le nuove", () => {
    const original = emptyPayslipAnalysis();
    original.allowances = [{ name: "Indennità turno", amount: 20, source: "Lettura locale", confidence: "alta" }];
    original.totals = [{ label: "Totale ritenute", value: 300, source: "Lettura locale" }];
    original.items = [item("Competenze accessorie", 60), item("Premio", 40)];
    let review = initialReview(original, "2026-09");
    review = {
      ...review,
      allowances: review.allowances.map((row) => ({ ...row, amountText: "25", valueEdited: true })),
      totals: review.totals.map((row) => ({ ...row, valueText: "310", valueEdited: true })),
      items: review.items.map((row) => row.originalDescription === "Premio"
        ? { ...row, selected: false, decisionTouched: true }
        : { ...row, amountText: "65", valueEdited: true }),
    };
    const saved = record(review, {
      allowances: [{ name: "Indennità turno", amount: 25 }],
      totals: [{ label: "Totale ritenute", value: 310 }],
      items: [{ ...item("Competenze accessorie", 65), source: "manuale" }],
    });
    const next = emptyPayslipAnalysis();
    next.allowances = [
      { name: "Indennità turno", amount: 99, source: "Analisi AI", confidence: "alta" },
      { name: "Indennità nuova", amount: 10, source: "Analisi AI", confidence: "alta" },
    ];
    next.totals = [{ label: "Totale ritenute", value: 500, source: "Analisi AI" }];
    next.items = [item("Competenze accessorie", 999, "allowance"), item("Premio", 80), item("Nuova voce", 10)];
    const restored = restoreReviewDecisions(saved, initialReview(next, "2026-09"));
    expect(restored.conflicts).toEqual([]);
    expect(restored.review.allowances.map((row) => [row.name, row.amountText])).toEqual([
      ["Indennità turno", "25"], ["Indennità nuova", "10"],
    ]);
    expect(restored.review.totals[0].valueText).toBe("310");
    expect(restored.review.items.map((row) => [row.originalDescription, row.amountText, row.selected, row.category])).toEqual([
      ["Competenze accessorie", "65", true, "earnings"],
      ["Premio", "80", false, "earnings"],
      ["Nuova voce", "10", true, "earnings"],
    ]);
  });

  it("richiede scelta per riga assente o descrizione duplicata; conserva la scelta precedente su richiesta", () => {
    const original = emptyPayslipAnalysis();
    original.items = [item("Premio", 40), item("Straordinario", 30)];
    const reviewed = initialReview(original, "2026-09");
    const edited = {
      ...reviewed,
      items: reviewed.items.map((row) => row.originalDescription === "Premio"
        ? { ...row, selected: false, decisionTouched: true }
        : { ...row, amountText: "35", valueEdited: true }),
    };
    const saved = record(edited, { items: [item("Straordinario", 35)] });
    const next = emptyPayslipAnalysis();
    next.items = [item("Straordinario", 50), item("Straordinario", 55)];
    const { review, conflicts } = restoreReviewDecisions(saved, initialReview(next, "2026-09"));
    expect(conflicts.map((entry) => [entry.label, entry.reason])).toEqual([
      ["Premio", "missing"], ["Straordinario", "ambiguous"],
    ]);
    const kept = resolveReviewDecisionConflict(review, conflicts[0], "keep");
    expect(kept.items.find((row) => row.originalDescription === "Premio")?.selected).toBe(false);
    expect(captureReviewDecisions(kept).items.some((row) => row.originalDescription === "Premio" && !row.selected)).toBe(true);
    expect(resolveReviewDecisionConflict(review, conflicts[0], "new")).toBe(review);
  });

  it("mantiene le correzioni fatte nella sostituzione quando arriva l'AI", () => {
    const original = emptyPayslipAnalysis();
    original.items = [item("Straordinario", 30)];
    const saved = record(initialReview(original, "2026-09"), {
      basePay: 12, items: [item("Straordinario", 30)],
    });
    const local = emptyPayslipAnalysis();
    local.basePay = { value: 12, confidence: "alta", source: "Lettura locale" };
    local.items = [item("Straordinario", 30)];
    const first = restoreReviewDecisions(saved, initialReview(local, "2026-09")).review;
    const current = {
      ...updateReviewValue(first, "basePay", "14"),
      items: first.items.map((row) => ({ ...row, amountText: "40", valueEdited: true })),
    };
    const ai: PayslipAnalysis = emptyPayslipAnalysis();
    ai.basePay = { value: 99, confidence: "alta", source: "Analisi AI" };
    ai.items = [item("Straordinario", 50), item("Premio", 10)];
    const restored = restoreReviewDecisions(saved, initialReview(ai, "2026-09"), current);
    expect(restored.review.basePay).toBe("14");
    expect(restored.review.items.map((row) => [row.originalDescription, row.amountText])).toEqual([
      ["Straordinario", "40"], ["Premio", "10"],
    ]);
    expect(restored.conflicts).toEqual([]);
  });

  it("ricostruisce i valori e le righe confermati anche per record precedenti senza metadati", () => {
    const proposed = emptyPayslipAnalysis();
    proposed.basePay = { value: 99, confidence: "alta", source: "Analisi AI" };
    proposed.totals = [{ label: "Netto a pagare", value: 1500, source: "Analisi AI" }];
    proposed.items = [item("Premio", 80), item("Nuova voce", 20)];
    const legacy = record(initialReview(emptyPayslipAnalysis(), "2026-09"), {
      basePay: 12, netTotal: null, items: [item("Premio", 40)], reviewDecisions: undefined,
    });
    const restored = restoreReviewDecisions(legacy, initialReview(proposed, "2026-09"));
    expect(restored.review.basePay).toBe("12");
    expect(restored.review.edited.basePay).toBeUndefined();
    expect(restored.review.items[0].amountText).toBe("40");
    expect(restored.review.netTotal).toBe("1500");
    expect(restored.review.selected.netTotal).toBe(false);
    expect(restored.review.items[1].selected).toBe(false);
    expect(captureReviewDecisions(restored.review).fields.netTotal.selected).toBe(false);
    expect(captureReviewDecisions(restored.review).items[1]).toMatchObject({ originalDescription: "Nuova voce", selected: false });
  });

  it("chiede una decisione per un mese AI diverso e conserva la risoluzione nella sessione", () => {
    const saved = record(initialReview(emptyPayslipAnalysis(), "2026-09"));
    const proposed = initialReview(emptyPayslipAnalysis(), "2026-10");
    const first = restoreReviewDecisions(saved, proposed);
    expect(first.review.month).toBe("2026-09");
    expect(first.conflicts).toMatchObject([{
      kind: "month", reason: "different", label: "Mese e anno", previousValue: "2026-09", proposedValues: ["2026-10"],
    }]);
    const kept = resolveReviewDecisionConflict(first.review, first.conflicts[0], "keep");
    const afterKeep = restoreReviewDecisions(saved, proposed, kept);
    expect(afterKeep.conflicts).toEqual([]);
    expect(restoreReviewDecisions(saved, proposed, afterKeep.review).conflicts).toEqual([]);
    const chosenNew = resolveReviewDecisionConflict(first.review, first.conflicts[0], "new");
    expect(chosenNew.month).toBe("2026-10");
    const afterNew = restoreReviewDecisions(saved, proposed, chosenNew);
    expect(afterNew.review.month).toBe("2026-10");
    expect(afterNew.conflicts).toEqual([]);
    expect(restoreReviewDecisions(saved, proposed, afterNew.review).conflicts).toEqual([]);
  });

  it("non elimina la prima scelta quando due conflitti hanno la stessa descrizione", () => {
    const saved = record(initialReview(emptyPayslipAnalysis(), "2026-09"), {
      items: [item("Premio", 30), item("Premio", 40)],
    });
    const next = emptyPayslipAnalysis();
    next.items = [item("Premio", 50), item("Premio", 60)];
    const restored = restoreReviewDecisions(saved, initialReview(next, "2026-09"));
    expect(restored.conflicts).toHaveLength(2);
    expect(restored.conflicts.every((entry) => entry.reason === "ambiguous")).toBe(true);
    const first = resolveReviewDecisionConflict(restored.review, restored.conflicts[0], "keep");
    const second = resolveReviewDecisionConflict(first, restored.conflicts[1], "keep");
    expect(second.items.map((row) => row.amountText)).toEqual(["30", "40"]);
  });

  it("non confonde una voce omonima approvata con una esclusa", () => {
    const original = emptyPayslipAnalysis();
    original.items = [item("Premio", 40), item("Premio", 50)];
    const review = initialReview(original, "2026-09");
    const saved = record({ ...review, items: review.items.map((row, index) => index === 1
      ? { ...row, selected: false, decisionTouched: true } : row) }, {
      items: [item("Premio", 40)],
    });
    const next = emptyPayslipAnalysis();
    next.items = [item("Premio", 80)];
    const restored = restoreReviewDecisions(saved, initialReview(next, "2026-09"));
    expect(restored.conflicts).toHaveLength(2);
    expect(restored.conflicts.every((entry) => entry.reason === "ambiguous")).toBe(true);
    expect(restored.conflicts.map((entry) => entry.previousValue).sort()).toEqual(["40", "50"]);
  });
});
