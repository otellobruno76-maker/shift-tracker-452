import { describe, expect, it } from "vitest";
import { analyzePayslipText } from "./payslip";

describe("compatibilità con layout diversi di cedolino italiano", () => {
  it("legge un layout compatto con valori espliciti", () => {
    const result = analyzePayslipText(`
      CCNL: Commercio
      Livello: 4
      Retribuzione oraria: 9,75000
      Ore ordinarie: 168,00
      Straordinario +20%
      Lordo 1.950,00
      Netto in busta 1.480,00
    `);
    expect(result.basePay).toMatchObject({ value: 9.75, confidence: "alta" });
    expect(result.ordinaryHours.value).toBe(168);
    expect(result.level.value).toBe("4");
    expect(result.totals).toHaveLength(2);
  });

  it("legge un layout tabellare con ordine colonne differente", () => {
    const result = analyzePayslipText(`
      Descrizione | UM | Quantità | Tariffa | Competenze
      Permesso retribuito | ore | 8,00 | 10,12500 | 81,00
      Festività goduta | h | 8,00 | 10,12500 | 81,00
      Totale competenze | 1.620,00
      Netto a pagare | 1.280,00
    `);
    expect(result.basePay).toMatchObject({ value: 10.125, confidence: "media" });
    expect(result.basePay.source).toContain("2 voci orarie coerenti");
  });

  it("propone ma non considera sicuro un solo Dato Base orario", () => {
    const result = analyzePayslipText(`
      Codice | Voce | Dato Base | Ore | Importo
      101 | Ferie ore | 8,75000 | 8 | 70,00
    `);
    expect(result.basePay).toMatchObject({ value: 8.75, confidence: "bassa" });
  });

  it("associa etichetta e valore disposti verticalmente con prudenza", () => {
    const result = analyzePayslipText(`
      Retribuzione mensile
      1.765,40
      Ore lavorate
      152,00
    `);
    expect(result.monthlyPay).toMatchObject({ value: 1765.4, confidence: "media" });
    expect(result.workedHours).toMatchObject({ value: 152, confidence: "media" });
    expect(result.basePay.value).toBeNull();
  });

  it("rifiuta valori semanticamente incompatibili e parole di intestazione", () => {
    const result = analyzePayslipText(`
      Qualifica | Livello | Contratto | Tipo rapporto
      Operaio | Contratto | Livello | 99.999,00
      Paga oraria 950,00
    `);
    expect(result.level.value).toBeNull();
    expect(result.basePay.value).toBeNull();
  });
});
