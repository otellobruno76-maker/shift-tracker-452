import { describe, expect, it } from "vitest";
import { reconstructPdfText } from "./documentText";
import { analyzePayslipText } from "./payslip";

describe("ricostruzione righe PDF", () => {
  it("mantiene etichette e valori sulla stessa riga e separa i totali", () => {
    const text = reconstructPdfText([
      { str: "Ore ordinarie", transform: [1, 0, 0, 10, 10, 700], width: 80 },
      { str: "160,00", transform: [1, 0, 0, 10, 180, 700], width: 35 },
      { str: "Totale lordo", transform: [1, 0, 0, 10, 10, 680], width: 70 },
      { str: "2.640,55", transform: [1, 0, 0, 10, 180, 680], width: 45 },
    ]);
    expect(text.split("\n")).toHaveLength(2);
    expect(analyzePayslipText(text).ordinaryHours.value).toBe(160);
  });
});
