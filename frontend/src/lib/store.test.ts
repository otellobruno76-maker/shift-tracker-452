import { describe, expect, it } from "vitest";
import { clearRegister, deletePayslip, exportBackupPayload, importBackup, saveDayTemplate, saveEntry, savePayslip, saveSettings } from "./store";
import type { DayTemplate, PayslipRecord } from "./types";

const template: DayTemplate = {
  id: "template-1", name: "Turno lungo", dayType: "lavoro", start: "06:00", end: "18:00",
  breakMinutes: 30, notturno: false, reperibilita: true, trasferta: true, note: "Intervento abituale",
  createdAt: "2026-09-20T10:00:00.000Z", updatedAt: "2026-09-20T10:00:00.000Z",
};
const payslip: PayslipRecord = {
  id: "cedolino-2026-09", month: "2026-09", filename: "cedolino-fittizio.pdf",
  basePay: 10, ordinaryHours: 173, overtimeRates: [15, 20], nightPct: 25,
  holidayPct: 30, allowances: [{ name: "Indennità mensa", amount: 80 }],
  ccnl: "CCNL di prova", level: "L2", totals: [{ label: "Totale netto", value: 1800 }],
  uploadedAt: "2026-09-20T10:00:00.000Z", updatedAt: "2026-09-20T10:00:00.000Z",
};

describe("backup integrato", () => {
  it("include giornate tipo e cedolini mensili", () => {
    importBackup({ app: "registro-ore-lavoro", version: 1, settings: null, days: [] });
    saveDayTemplate(template);
    savePayslip(payslip);
    const backup = JSON.parse(exportBackupPayload());
    expect(backup.version).toBe(2);
    expect(backup.dayTemplates).toEqual([template]);
    expect(backup.payslips).toEqual([payslip]);
  });

  it("continua a importare i backup versione 1", () => {
    expect(importBackup({ app: "registro-ore-lavoro", version: 1, settings: null, days: [] })).toBe(true);
    const backup = JSON.parse(exportBackupPayload());
    expect(backup.dayTemplates).toEqual([]);
    expect(backup.payslips).toEqual([]);
  });

  it("salva più cedolini senza cambiare automaticamente la paga configurata", () => {
    importBackup({ app: "registro-ore-lavoro", version: 1, settings: null, days: [] });
    saveSettings({ basePay: 8 });
    savePayslip(payslip);
    savePayslip({ ...payslip, id: "cedolino-2026-10", month: "2026-10", basePay: 12 });
    const backup = JSON.parse(exportBackupPayload());
    expect(backup.payslips).toHaveLength(2);
    expect(backup.settings.basePay).toBe(8);
    deletePayslip(payslip.id);
  });

  it("salva manualmente un cedolino anche senza dati OCR", () => {
    importBackup({ app: "registro-ore-lavoro", version: 1, settings: null, days: [] });
    savePayslip({ ...payslip, id: "manuale", month: "2026-11", filename: "Inserimento manuale", basePay: null, ordinaryHours: null, overtimeRates: [], allowances: [], totals: [], ccnl: "", level: "" });
    const backup = JSON.parse(exportBackupPayload());
    expect(backup.payslips).toHaveLength(1);
    expect(backup.payslips[0]).toMatchObject({ month: "2026-11", filename: "Inserimento manuale", basePay: null });
  });

  it("azzera solo il registro preservando paga, CCNL, giornate tipo e cedolini", () => {
    importBackup({ app: "registro-ore-lavoro", version: 1, settings: null, days: [] });
    saveDayTemplate(template);
    savePayslip(payslip);
    saveSettings({ basePay: 12.5, ccnl: "CCNL fittizio", contractLevel: "Livello X" });
    saveEntry({
      id: "giorno-1", date: "2026-09-21", dayType: "lavoro", start: "", end: "",
      breakMinutes: 0, scheduledOrdinaryMinutes: 480, notturno: false, reperibilita: false,
      trasferta: false, festivo: null, note: "", createdAt: "2026-09-21T08:00:00.000Z",
      updatedAt: "2026-09-21T08:00:00.000Z",
    });
    clearRegister();
    const backup = JSON.parse(exportBackupPayload());
    expect(backup.days).toEqual([]);
    expect(backup.settings).toMatchObject({ basePay: 12.5, ccnl: "CCNL fittizio", contractLevel: "Livello X" });
    expect(backup.dayTemplates).toEqual([template]);
    expect(backup.payslips).toEqual([payslip]);
  });
});
