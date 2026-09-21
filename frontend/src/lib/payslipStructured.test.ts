import { describe, expect, it } from "vitest";
import { buildStructuredDocument, structuredDocumentFromText, type DocumentToken } from "./documentModel";
import { analyzeStructuredPayslip } from "./payslipStructured";

const token = (text: string, x: number, y: number, page = 1, source: "pdf" | "ocr" = "pdf"): DocumentToken => ({
  text, x, y, page, width: Math.max(18, text.length * 5), height: 10, source,
});

function inazFixture(source: "pdf" | "ocr" = "pdf") {
  return buildStructuredDocument([
    token("Qualifica", 20, 700, 1, source), token("Livello", 170, 700, 1, source), token("Contratto di Lavoro", 270, 700, 1, source), token("Tipo Rapporto", 430, 700, 1, source), token("%Part-Time", 560, 700, 1, source),
    token("Operaio a mese", 20, 680, 1, source), token("2", 170, 680, 1, source), token("607", 270, 680, 1, source), token("Tempo parziale", 430, 680, 1, source), token("65%", 560, 680, 1, source),
    token("Voce", 20, 620, 1, source), token("Descrizione", 100, 620, 1, source), token("Ore/Giorni/Num./%", 300, 620, 1, source), token("Dato Base", 440, 620, 1, source), token("Dato Figurativo", 530, 620, 1, source), token("Competenze/Ritenute", 650, 620, 1, source),
    token("100", 20, 600, 1, source), token("Festività goduta ore fig", 100, 600, 1, source), token("2,0000", 300, 600, 1, source), token("8,28260", 440, 600, 1, source), token("0", 530, 600, 1, source), token("16,57", 650, 600, 1, source),
    token("110", 20, 580, 1, source), token("Ferie godute ore (fig.)", 100, 580, 1, source), token("78,5000", 300, 580, 1, source), token("8,28260", 440, 580, 1, source), token("0", 530, 580, 1, source), token("650,18", 650, 580, 1, source),
    token("Totale elementi retributivi", 20, 520, 1, source), token("1.432,89", 440, 520, 1, source),
    token("Retribuzione mese", 20, 500, 1, source), token("931,38", 440, 500, 1, source),
  ]);
}

describe("parser strutturato cedolini", () => {
  it("riconosce un cedolino semplice con paga oraria esplicita", () => {
    const result = analyzeStructuredPayslip(structuredDocumentFromText("Paga oraria | 10,50\nOre ordinarie | 168"));
    expect(result.basePay.value).toBe(10.5);
    expect(result.basePay.confidence).toBe("alta");
  });

  it("mantiene distinta la retribuzione mensile", () => {
    const result = analyzeStructuredPayslip(structuredDocumentFromText("Qualifica | Operaio a mese\nRetribuzione mese | 931,38"));
    expect(result.monthlyPay.value).toBe(931.38);
    expect(result.basePay.value).toBeNull();
  });

  it("legge il layout INAZ per colonne senza confondere Livello e Contratto", () => {
    const result = analyzeStructuredPayslip(inazFixture());
    expect(result.adapter).toBe("inaz-family");
    expect(result.qualification.value).toBe("Operaio a mese");
    expect(result.level.value).toBe("2");
    expect(result.contractCode.value).toBe("607");
    expect(result.partTimePct.value).toBe(65);
    expect(result.monthlyPay.value).toBe(931.38);
    expect(result.basePay.value).toBe(8.2826);
    expect(result.basePay.confidence).toBe("media");
    expect(result.basePay.method).toBe("ricorrenza geometrica in tabella");
  });

  it("propone il Dato Base ripetuto nelle voci orarie", () => {
    const result = analyzeStructuredPayslip(inazFixture());
    expect(result.basePay.source).toContain("2 voci orarie");
  });

  it("riconosce straordinari espressi in percentuale", () => {
    const result = analyzeStructuredPayslip(structuredDocumentFromText("Straordinario diurno +25% | 4,00"));
    expect(result.overtimeRates.map((item) => item.value)).toContain(25);
  });

  it("ricava la maggiorazione da tariffa straordinaria e paga oraria", () => {
    const result = analyzeStructuredPayslip(structuredDocumentFromText("Paga oraria | 10,00\nStraordinario tariffa | 11,50"));
    expect(result.overtimeRates.map((item) => item.value)).toContain(15);
  });

  it("unisce intestazioni spezzate su più righe", () => {
    const document = buildStructuredDocument([
      token("Descrizione", 80, 500), token("Dato", 400, 500), token("Competenze", 600, 500),
      token("Voce", 80, 485), token("Base", 400, 485), token("Ritenute", 600, 485),
      token("Ferie godute ore", 80, 465), token("9,12500", 400, 465), token("72,00", 600, 465),
      token("Permessi goduti ore", 80, 445), token("9,12500", 400, 445), token("18,00", 600, 445),
    ]);
    expect(analyzeStructuredPayslip(document).basePay.value).toBe(9.125);
  });

  it("analizza documenti multipagina senza mescolare le coordinate", () => {
    const document = buildStructuredDocument([
      token("Retribuzione mensile", 20, 700, 1), token("1.800,00", 300, 700, 1),
      token("NETTO A PAGARE", 20, 700, 2), token("1.350,00", 300, 700, 2),
    ]);
    const result = analyzeStructuredPayslip(document);
    expect(result.monthlyPay.value).toBe(1800);
    expect(result.totals.some((item) => /netto/i.test(item.label))).toBe(true);
  });

  it("non inventa i campi mancanti e mantiene bassa l'ambiguità", () => {
    const result = analyzeStructuredPayslip(structuredDocumentFromText("Documento paga\nValori non chiaramente associati | 264,55 | 8,28"));
    expect(result.basePay.value).toBeNull();
    expect(result.level.value).toBeNull();
  });

  it("porta le coordinate OCR nello stesso parser geometrico", () => {
    const result = analyzeStructuredPayslip(inazFixture("ocr"));
    expect(result.level.value).toBe("2");
    expect(result.basePay.value).toBe(8.2826);
  });
});
