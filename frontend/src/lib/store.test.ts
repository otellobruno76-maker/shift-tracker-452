import { describe, expect, it } from "vitest";
import { exportBackupPayload, importBackup, saveDayTemplate } from "./store";
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
});
