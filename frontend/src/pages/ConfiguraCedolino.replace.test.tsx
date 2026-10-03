// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { deletePayslip, exportBackupPayload, hydrateAndSeed, savePayslip } from "@/lib/store";
import { emptyPayslipAnalysis, type PayslipAnalysis } from "@/lib/payslip";
import type { PayslipAIResult } from "@/lib/payslipAi";
import type { PayslipRecord } from "@/lib/types";
import ConfiguraCedolino from "./ConfiguraCedolino";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(), extract: vi.fn(), structured: vi.fn(), ai: vi.fn(),
}));
vi.mock("@/lib/documentPreparation", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/documentPreparation")>(),
  prepareDocument: mocks.prepare,
}));
vi.mock("@/lib/documentText", () => ({ extractDocumentStructure: mocks.extract }));
vi.mock("@/lib/payslipStructured", () => ({ analyzeStructuredPayslip: mocks.structured }));
vi.mock("@/lib/payslipAi", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/payslipAi")>(),
  requestPayslipAI: mocks.ai,
}));

const testFilenames = ["review-replacement-first.pdf", "review-replacement-second.pdf", "review-replacement-conflict.pdf"];

function analysis(basePay: number, net: number, overtimeAmount: number): PayslipAnalysis {
  const detected = emptyPayslipAnalysis();
  detected.basePay = { value: basePay, source: "Lettura locale", confidence: "alta" };
  detected.totals = [{ label: "Netto a pagare", value: net, source: "Lettura locale" }];
  detected.items = [
    { originalDescription: "Straordinario feriale", category: "overtime", unit: "hours", quantity: 2, ratePct: 20, amount: overtimeAmount, confidence: "alta", source: "locale" },
    { originalDescription: "Indennità mensa", category: "allowance", unit: "euro", quantity: null, ratePct: null, amount: 55, confidence: "alta", source: "locale" },
  ];
  return detected;
}

function aiResult(): PayslipAIResult {
  return {
    month: null, year: null, qualification: null, level: null, ccnl: null,
    contract_code: null, employment_type: null, part_time_pct: null, pay_type: "hourly",
    hourly_pay: 99, daily_pay: null, monthly_pay: null, ordinary_hours: null,
    worked_hours: null, worked_days: null, overtime_hours: null, overtime_rates: [],
    overtime_tariffs: [], night_rate: null, holiday_rate: null, minimum_contractual_pay: null,
    contingency: null, edr: null, seniority_increments: null, allowances: [],
    gross_pay: null, total_earnings: null, total_deductions: null, net_pay: 1999,
    fields: {
      hourly_pay: { confidence: "high", evidence: "paga oraria" },
      net_pay: { confidence: "high", evidence: "netto" },
    },
    line_items: [
      { original_description: "Straordinario feriale", category: "overtime", unit: "hours", quantity: 2, rate_pct: 20, amount: 100, confidence: "high", evidence: "riga straordinario" },
      { original_description: "Indennità mensa", category: "allowance", unit: "euro", quantity: null, rate_pct: null, amount: 65, confidence: "high", evidence: "riga mensa" },
    ],
  };
}

async function saved(filename: string): Promise<PayslipRecord | undefined> {
  const backup = JSON.parse(await exportBackupPayload()) as { payslips: PayslipRecord[] };
  return backup.payslips.find((item) => item.filename === filename);
}

async function clearTestPayslips() {
  for (const filename of testFilenames) {
    const record = await saved(filename);
    if (record) await deletePayslip(record.id);
  }
}

function mount(path: string) {
  render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/configura-cedolino" element={<ConfiguraCedolino />} />
    <Route path="/cedolini" element={<p>Cedolino salvato</p>} />
  </Routes></MemoryRouter>);
}

async function upload(name: string) {
  fireEvent.change(screen.getByTestId("payslip-file-input"), {
    target: { files: [new File(["cedolino"], name, { type: "application/pdf" })] },
  });
  await screen.findByTestId("payslip-review");
}

beforeEach(async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  mocks.prepare.mockImplementation(async (file: File) => file);
  mocks.extract.mockResolvedValue({});
  mocks.structured.mockReset();
  mocks.ai.mockReset();
  await hydrateAndSeed();
  await clearTestPayslips();
});

afterEach(async () => {
  cleanup();
  await clearTestPayslips();
  vi.restoreAllMocks();
});

describe("sostituzione di un cedolino già corretto", () => {
  it("ricarica correzioni ed esclusioni salvate, le mantiene dopo l'AI e salva la nuova revisione", async () => {
    mocks.structured.mockReturnValueOnce(analysis(10, 1500, 30)).mockReturnValueOnce(analysis(20, 1600, 80));
    mocks.ai.mockResolvedValue(aiResult());

    mount("/configura-cedolino");
    await upload(testFilenames[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "Paga oraria di riferimento" }), { target: { value: "12,50" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Usa Netto a pagare" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Importo voce Straordinario feriale" }), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Usa voce Indennità mensa" }));
    fireEvent.click(screen.getByTestId("btn-apply-payslip"));
    await waitFor(async () => expect((await saved(testFilenames[0]))?.basePay).toBe(12.5));
    const firstRecord = (await saved(testFilenames[0]))!;
    expect(firstRecord.netTotal).toBeNull();
    expect(firstRecord.items?.map((item) => item.originalDescription)).toEqual(["Straordinario feriale"]);
    cleanup();

    mount(`/configura-cedolino?replace=${firstRecord.id}`);
    await upload(testFilenames[1]);
    const pay = screen.getByRole("textbox", { name: "Paga oraria di riferimento" }) as HTMLInputElement;
    expect(pay.value).toBe("12,5");
    expect(screen.getByRole("checkbox", { name: "Usa Netto a pagare" }).getAttribute("aria-checked")).toBe("false");
    expect((screen.getByRole("textbox", { name: "Importo voce Straordinario feriale" }) as HTMLInputElement).value).toBe("45");
    expect(screen.getByRole("checkbox", { name: "Usa voce Indennità mensa" }).getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Avvia analisi avanzata con AI" }));
    fireEvent.click(screen.getByTestId("btn-confirm-ai"));
    await waitFor(() => expect(mocks.ai).toHaveBeenCalledTimes(1));
    await screen.findByText("Valori da verificare");
    expect((screen.getByRole("textbox", { name: "Paga oraria di riferimento" }) as HTMLInputElement).value).toBe("12,5");
    expect(screen.getByRole("checkbox", { name: "Usa Netto a pagare" }).getAttribute("aria-checked")).toBe("false");
    expect((screen.getByRole("textbox", { name: "Importo voce Straordinario feriale" }) as HTMLInputElement).value).toBe("45");
    expect(screen.getByRole("checkbox", { name: "Usa voce Indennità mensa" }).getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByTestId("btn-apply-payslip"));
    await waitFor(async () => expect((await saved(testFilenames[1]))?.filename).toBe(testFilenames[1]));
    const updated = (JSON.parse(await exportBackupPayload()) as { payslips: PayslipRecord[] }).payslips.find((item) => item.id === firstRecord.id)!;
    expect(updated.basePay).toBe(12.5);
    expect(updated.netTotal).toBeNull();
    expect(updated.items).toMatchObject([{ originalDescription: "Straordinario feriale", amount: 45 }]);
    expect(updated.fieldProvenance?.basePay?.source).toBe("manuale");
  });

  it("blocca una voce salvata senza corrispondenza finché l'utente decide", async () => {
    const original: PayslipRecord = {
      id: "review-replacement-conflict", month: "2026-09", filename: testFilenames[0],
      basePay: 12.5, ordinaryHours: null, overtimeRates: [], nightPct: null, holidayPct: null,
      allowances: [], ccnl: "", level: "", totals: [],
      items: [{ originalDescription: "Straordinario feriale", category: "overtime", unit: "hours", quantity: 2, ratePct: 20, amount: 45, confidence: "media", source: "manuale" }],
      fieldProvenance: { basePay: { source: "manuale", confidence: "alta" } },
      uploadedAt: "2026-09-30T12:00:00.000Z", updatedAt: "2026-09-30T12:00:00.000Z",
    };
    await savePayslip(original);
    mocks.structured.mockReturnValue(emptyPayslipAnalysis());

    mount(`/configura-cedolino?replace=${original.id}`);
    await upload(testFilenames[2]);
    expect(screen.getByTestId("payslip-decision-conflicts").textContent).toContain("Straordinario feriale");
    expect((screen.getByTestId("btn-apply-payslip") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Mantieni scelta salvata" }));
    expect((screen.getByTestId("btn-apply-payslip") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("textbox", { name: "Importo voce Straordinario feriale" }) as HTMLInputElement).value).toBe("45");
    fireEvent.click(screen.getByTestId("btn-apply-payslip"));
    await waitFor(async () => expect((await saved(testFilenames[2]))?.items?.[0].amount).toBe(45));
  });

  it("richiede una scelta se l'AI rileva un mese diverso", async () => {
    const original: PayslipRecord = {
      id: "review-replacement-month", month: "2026-09", filename: testFilenames[0],
      basePay: 12.5, ordinaryHours: null, overtimeRates: [], nightPct: null, holidayPct: null,
      allowances: [], ccnl: "", level: "", totals: [], items: [],
      uploadedAt: "2026-09-30T12:00:00.000Z", updatedAt: "2026-09-30T12:00:00.000Z",
    };
    await savePayslip(original);
    mocks.structured.mockReturnValue(emptyPayslipAnalysis());
    mocks.ai.mockResolvedValue({ ...aiResult(), month: 8, year: 2026, line_items: [] });

    mount(`/configura-cedolino?replace=${original.id}`);
    await upload(testFilenames[1]);
    fireEvent.click(screen.getByRole("button", { name: "Avvia analisi avanzata con AI" }));
    fireEvent.click(screen.getByTestId("btn-confirm-ai"));
    await screen.findByTestId("payslip-decision-conflicts");
    expect(screen.getByTestId("payslip-decision-conflicts").textContent).toContain("Mese e anno");
    expect((screen.getByTestId("btn-apply-payslip") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Usa nuova analisi" }));
    expect((screen.getByLabelText("Mese e anno") as HTMLInputElement).value).toBe("2026-08");
    fireEvent.click(screen.getByTestId("btn-apply-payslip"));
    await waitFor(async () => expect((await saved(testFilenames[1]))?.month).toBe("2026-08"));
  });
});

describe("errore dell’analisi AI nella revisione", () => {
  it("mostra il limite raggiunto, conserva la lettura locale e consente di riprovare", async () => {
    const message = "Troppe richieste di analisi AI. Riprova tra poco o continua con i dati locali.";
    mocks.structured.mockReturnValue(analysis(10, 1500, 30));
    mocks.ai.mockRejectedValueOnce(new Error(message)).mockResolvedValueOnce(aiResult());

    mount("/configura-cedolino");
    await upload("rate-limit.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Avvia analisi avanzata con AI" }));
    fireEvent.click(screen.getByTestId("btn-confirm-ai"));

    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect((screen.getByRole("textbox", { name: "Paga oraria di riferimento" }) as HTMLInputElement).value).toBe("10");
    expect((screen.getByTestId("btn-apply-payslip") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Riprova analisi con AI" }));
    fireEvent.click(screen.getByTestId("btn-confirm-ai"));
    await waitFor(() => expect(mocks.ai).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(message)).toBeNull());
  });

  it("mostra chiaramente il limite giornaliero mantenendo la lettura locale", async () => {
    const message = "Il limite giornaliero del servizio AI è stato raggiunto. Riprova tra circa 12 ore o continua con i dati locali.";
    mocks.structured.mockReturnValue(analysis(10, 1500, 30));
    mocks.ai.mockRejectedValue(new Error(message));

    mount("/configura-cedolino");
    await upload("daily-limit.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Avvia analisi avanzata con AI" }));
    fireEvent.click(screen.getByTestId("btn-confirm-ai"));

    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect((screen.getByRole("textbox", { name: "Paga oraria di riferimento" }) as HTMLInputElement).value).toBe("10");
    expect((screen.getByTestId("btn-apply-payslip") as HTMLButtonElement).disabled).toBe(false);
  });
});
