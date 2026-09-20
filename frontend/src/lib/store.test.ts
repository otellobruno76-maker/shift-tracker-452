import { describe, expect, it } from "vitest";
import { deletePayslip, exportBackupPayload, importBackup, savePayslip, saveSettings } from "./store";
import type { PayslipRecord } from "./types";

const record: PayslipRecord = {
  id: "cedolino-2026-09", month: "2026-09", filename: "cedolino-fittizio.pdf",
  basePay: 10, ordinaryHours: 173, overtimeRates: [15, 20], nightPct: 25,
  holidayPct: 30, allowances: [{ name: "Indennità mensa", amount: 80 }],
  ccnl: "CCNL di prova", level: "L2", totals: [{ label: "Totale netto", value: 1800 }],
  uploadedAt: "2026-09-20T10:00:00.000Z", updatedAt: "2026-09-20T10:00:00.000Z",
};

describe("salvataggio impostazioni da cedolino", () => {
  it("salva i valori confermati e li include nel backup compatibile", () => {
    saveSettings({
      basePay: 10,
      overtimePct: 15,
      overtimeRates: [15, 20],
      ccnl: "CCNL di prova",
      contractLevel: "L2",
      payslipReferenceHours: 173,
    });

    const backup = JSON.parse(exportBackupPayload());
    expect(backup.version).toBe(2);
    expect(backup.settings).toMatchObject({
      basePay: 10,
      overtimePct: 15,
      overtimeRates: [15, 20],
      ccnl: "CCNL di prova",
      contractLevel: "L2",
      payslipReferenceHours: 173,
    });
  });

  it("salva più cedolini nel backup senza modificare automaticamente le impostazioni", () => {
    saveSettings({ basePay: 8 });
    savePayslip(record);
    savePayslip({ ...record, id: "cedolino-2026-10", month: "2026-10", basePay: 12 });
    const backup = JSON.parse(exportBackupPayload());

    expect(backup.payslips).toHaveLength(2);
    expect(backup.settings.basePay).toBe(8);
    deletePayslip(record.id);
  });

  it("continua a importare backup precedenti senza storico cedolini", () => {
    expect(importBackup({ app: "registro-ore-lavoro", version: 1, settings: null, days: [] })).toBe(true);
    expect(JSON.parse(exportBackupPayload()).payslips).toEqual([]);
  });
});
