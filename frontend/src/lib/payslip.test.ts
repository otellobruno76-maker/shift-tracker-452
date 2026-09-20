import { describe, expect, it } from "vitest";
import { analyzePayslipText, buildPayslipSettingsPatch, calculateIncreasePct } from "./payslip";

describe("calcolo maggiorazioni dal cedolino", () => {
  it("calcola +15% da 10,00 € a 11,50 €", () => {
    expect(calculateIncreasePct(10, 11.5)).toBe(15);
  });

  it("rileva percentuali esplicite e percentuali ricavate dalle tariffe", () => {
    const result = analyzePayslipText(`
      CCNL Multiservizi
      Livello 3
      Paga oraria 10,00
      Ore ordinarie 173,00
      Straordinario diurno 11,50
      Straordinario fascia 2 +20%
      Maggiorazione notturna +25%
      Maggiorazione festiva +30%
      Indennità mensa 80,00
      Totale netto 1.800,00
    `);

    expect(result.basePay.value).toBe(10);
    expect(result.ordinaryHours.value).toBe(173);
    expect(result.overtimeRates.map((rate) => rate.value)).toEqual([20, 15]);
    expect(result.overtimeRates.find((rate) => rate.value === 15)?.derived).toBe(true);
    expect(result.nightPct.value).toBe(25);
    expect(result.holidayPct.value).toBe(30);
    expect(result.ccnl.value).toBe("Multiservizi");
    expect(result.level.value).toBe("3");
    expect(result.allowances[0]).toMatchObject({ name: "Indennità mensa", amount: 80 });
    expect(result.totals[0]).toMatchObject({ label: "Totale netto", value: 1800 });
  });

  it("non inventa le voci assenti", () => {
    const result = analyzePayslipText("Cedolino mensile senza dettagli tariffari leggibili");

    expect(result.basePay.value).toBeNull();
    expect(result.overtimeRates).toEqual([]);
    expect(result.nightPct.value).toBeNull();
    expect(result.holidayPct.value).toBeNull();
  });
});

describe("applicazione dati confermati", () => {
  it("prepara soltanto i valori scelti dall'utente", () => {
    const patch = buildPayslipSettingsPatch({
      basePay: 10,
      overtimeRates: [15, 20, 25],
      ccnl: "Multiservizi",
      level: "3",
    });

    expect(patch).toMatchObject({
      basePay: 10,
      overtimePct: 15,
      overtimeRates: [15, 20, 25],
      ccnl: "Multiservizi",
      contractLevel: "3",
    });
    expect(patch.nightPct).toBeUndefined();
    expect(patch.holidayPct).toBeUndefined();
  });
});
