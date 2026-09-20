import { describe, expect, it } from "vitest";
import {
  clearRegister,
  exportBackupPayload,
  importBackup,
  saveDayTemplate,
  saveEntry,
  saveSettings,
} from "./store";
import type { DayTemplate } from "./types";

const template: DayTemplate = {
  id: "template-1",
  name: "Turno lungo",
  dayType: "lavoro",
  start: "06:00",
  end: "18:00",
  breakMinutes: 30,
  notturno: false,
  reperibilita: true,
  trasferta: true,
  note: "Intervento abituale",
  createdAt: "2026-09-20T10:00:00.000Z",
  updatedAt: "2026-09-20T10:00:00.000Z",
};

describe("Giornate tipo", () => {
  it("include i turni tipo nei nuovi backup", () => {
    saveDayTemplate(template);

    const backup = JSON.parse(exportBackupPayload()) as {
      version: number;
      dayTemplates: DayTemplate[];
    };

    expect(backup.version).toBe(2);
    expect(backup.dayTemplates).toEqual([template]);
  });

  it("continua a importare i backup versione 1", () => {
    const imported = importBackup({
      app: "registro-ore-lavoro",
      version: 1,
      settings: null,
      days: [],
    });

    expect(imported).toBe(true);
    expect(JSON.parse(exportBackupPayload()).dayTemplates).toEqual([]);
  });

  it("azzera il registro preservando configurazione, paga, CCNL e giornate tipo", () => {
    saveDayTemplate(template);
    saveSettings({ basePay: 12.5, ccnl: "CCNL fittizio", contractLevel: "Livello X" });
    saveEntry({
      id: "giorno-1",
      date: "2026-09-21",
      dayType: "lavoro",
      start: "",
      end: "",
      breakMinutes: 0,
      scheduledOrdinaryMinutes: 480,
      notturno: false,
      reperibilita: false,
      trasferta: false,
      festivo: null,
      note: "",
      createdAt: "2026-09-21T08:00:00.000Z",
      updatedAt: "2026-09-21T08:00:00.000Z",
    });

    clearRegister();
    const backup = JSON.parse(exportBackupPayload());

    expect(backup.days).toEqual([]);
    expect(backup.settings.basePay).toBe(12.5);
    expect(backup.settings.ccnl).toBe("CCNL fittizio");
    expect(backup.settings.contractLevel).toBe("Livello X");
    expect(backup.dayTemplates).toEqual([template]);
  });
});
