// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { deletePayslip, exportBackupPayload, hydrateAndSeed, savePayslip } from "@/lib/store";
import type { PayslipRecord } from "@/lib/types";
import Cedolini from "./Cedolini";

const record: PayslipRecord = {
  id: "cedolini-editor-test", month: "2026-03", filename: "cedolino-di-prova.pdf",
  basePay: 10, ordinaryHours: 160, grossTotal: 2000, netTotal: 1500,
  overtimeRates: [15], nightPct: null, holidayPct: null, allowances: [], ccnl: "", level: "",
  totals: [{ label: "Lordo", value: 2000 }, { label: "Netto a pagare", value: 1500 }, { label: "Totale ritenute", value: 500 }],
  items: [
    { originalDescription: "Lordo", category: "gross", quantity: null, unit: "euro", ratePct: null, amount: 2000, confidence: "alta", source: "ai" },
    { originalDescription: "Netto", category: "net", quantity: null, unit: "euro", ratePct: null, amount: 1500, confidence: "alta", source: "ai" },
    { originalDescription: "Ritenute", category: "deductions", quantity: null, unit: "euro", ratePct: null, amount: 500, confidence: "alta", source: "ai" },
  ],
  fieldProvenance: { grossTotal: { source: "ai", confidence: "alta" }, netTotal: { source: "ai", confidence: "alta" } },
  uploadedAt: "2026-03-31T12:00:00.000Z", updatedAt: "2026-03-31T12:00:00.000Z",
};

async function savedRecord(): Promise<PayslipRecord> {
  const backup = JSON.parse(await exportBackupPayload()) as { payslips: PayslipRecord[] };
  return backup.payslips.find((item) => item.id === record.id)!;
}

beforeEach(async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  await hydrateAndSeed();
  await deletePayslip(record.id);
  await savePayslip(record);
});

afterEach(async () => {
  cleanup();
  await deletePayslip(record.id);
  vi.restoreAllMocks();
});

function openEditor() {
  render(<MemoryRouter><Cedolini /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Apri" }));
}

describe("correzione dei cedolini salvati", () => {
  it("mantiene il testo decimale durante la digitazione e salva il valore manuale", async () => {
    openEditor();
    const hourlyPay = screen.getByRole("textbox", { name: "Paga oraria" }) as HTMLInputElement;
    fireEvent.change(hourlyPay, { target: { value: "12." } });
    expect(hourlyPay.value).toBe("12.");
    fireEvent.change(hourlyPay, { target: { value: "12.5" } });
    fireEvent.click(screen.getByTestId("btn-save-payslip-edits"));

    await waitFor(async () => expect((await savedRecord()).basePay).toBe(12.5));
    expect((await savedRecord()).fieldProvenance?.basePay?.source).toBe("manuale");
  });

  it("blocca un importo ambiguo senza cancellare quello salvato", async () => {
    openEditor();
    const gross = screen.getByRole("textbox", { name: "Lordo / competenze" }) as HTMLInputElement;
    fireEvent.change(gross, { target: { value: "1.234" } });
    fireEvent.click(screen.getByTestId("btn-save-payslip-edits"));

    expect(screen.getByRole("alert").textContent).toContain("ambiguo");
    expect(gross.value).toBe("1.234");
    expect((await savedRecord()).grossTotal).toBe(2000);
  });

  it("non scarta silenziosamente una tariffa ambigua", async () => {
    openEditor();
    const tariffs = screen.getByRole("textbox", { name: "Tariffe straordinario" }) as HTMLInputElement;
    fireEvent.change(tariffs, { target: { value: "12.5; 1.234" } });
    fireEvent.click(screen.getByTestId("btn-save-payslip-edits"));

    expect(screen.getByRole("alert").textContent).toContain("tariffe");
    expect(tariffs.value).toBe("12.5; 1.234");
    expect((await savedRecord()).overtimeTariffs).toEqual([]);
  });

  it("esclude lordo e netto rimossi, anche dalle voci derivate", async () => {
    openEditor();
    fireEvent.change(screen.getByRole("textbox", { name: "Lordo / competenze" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Netto a pagare" }), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("btn-save-payslip-edits"));

    await waitFor(async () => expect((await savedRecord()).grossTotal).toBeNull());
    const saved = await savedRecord();
    expect(saved.netTotal).toBeNull();
    expect(saved.totals.map((item) => item.label)).toEqual(["Totale ritenute"]);
    expect(saved.items?.map((item) => item.category)).toEqual(["deductions"]);
    expect(saved.fieldProvenance?.grossTotal).toBeUndefined();
    expect(saved.fieldProvenance?.netTotal).toBeUndefined();
  });

  it("salva la correzione manuale senza lasciare una copia AI discordante", async () => {
    openEditor();
    fireEvent.change(screen.getByRole("textbox", { name: "Lordo / competenze" }), { target: { value: "2.100,00" } });
    fireEvent.click(screen.getByTestId("btn-save-payslip-edits"));

    await waitFor(async () => expect((await savedRecord()).grossTotal).toBe(2100));
    const saved = await savedRecord();
    expect(saved.fieldProvenance?.grossTotal?.source).toBe("manuale");
    expect(saved.totals.map((item) => item.label)).toEqual(["Totale ritenute"]);
    expect(saved.items?.map((item) => item.category)).toEqual(["deductions"]);
  });
});
