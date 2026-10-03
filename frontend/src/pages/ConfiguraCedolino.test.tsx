// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ConfiguraCedolino from "./ConfiguraCedolino";

const mocks = vi.hoisted(() => ({ savePayslip: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/store", () => ({
  useSettings: () => ({ dailyOrdinaryHours: 8 }),
  usePayslips: () => [],
  savePayslip: mocks.savePayslip,
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => { cleanup(); mocks.savePayslip.mockClear(); });

describe("revisione cedolino prima del salvataggio", () => {
  it("non salva Lordo e Netto deselezionati anche se i campi contengono importi", async () => {
    render(<MemoryRouter initialEntries={["/configura-cedolino"]}><Routes>
      <Route path="/configura-cedolino" element={<ConfiguraCedolino />} />
      <Route path="/cedolini" element={<p>Cedolino salvato</p>} />
    </Routes></MemoryRouter>);

    fireEvent.click(screen.getByTestId("btn-manual-payslip"));
    fireEvent.change(screen.getByRole("textbox", { name: "Lordo / totale competenze" }), { target: { value: "1.800,00" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Netto a pagare" }), { target: { value: "1.400,00" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Usa Lordo / totale competenze" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Usa Netto a pagare" }));
    fireEvent.click(screen.getByTestId("btn-apply-payslip"));

    await waitFor(() => expect(mocks.savePayslip).toHaveBeenCalledTimes(1));
    const record = mocks.savePayslip.mock.calls[0][0];
    expect(record).toMatchObject({ grossTotal: null, netTotal: null, totals: [], items: [] });
  });
});
