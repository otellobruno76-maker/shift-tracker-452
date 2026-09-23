import { describe, expect, it } from "vitest";
import { buildBulkEntries, inclusiveDateRange, valuesFromTemplate } from "./bulkDays";
import type { DayTemplate } from "./types";

describe("inserimento multiplo dal calendario", () => {
  it("seleziona tutte le date comprese tra inizio e fine", () => {
    expect(inclusiveDateRange("2026-09-21", "2026-09-25")).toEqual([
      "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25",
    ]);
    expect(inclusiveDateRange("2026-09-25", "2026-09-21")).toHaveLength(5);
  });

  it("crea lo stesso turno su ogni giorno selezionato", () => {
    const entries = buildBulkEntries(["2026-09-21", "2026-09-22"], {
      dayType: "lavoro", start: "08:00", end: "17:00", breakMinutes: 60,
    }, "2026-09-20T12:00:00.000Z");
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.date)).toEqual(["2026-09-21", "2026-09-22"]);
    expect(entries.every((entry) => entry.start === "08:00" && entry.breakMinutes === 60)).toBe(true);
  });

  it("mantiene i dati di una giornata tipo", () => {
    const template: DayTemplate = {
      id: "tipo-1", name: "Turno mattina", dayType: "lavoro", start: "06:00", end: "14:30",
      breakMinutes: 30, notturno: false, reperibilita: true, trasferta: false, note: "abituale",
      createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
    };
    expect(valuesFromTemplate(template)).toMatchObject({ start: "06:00", end: "14:30", breakMinutes: 30, reperibilita: true });
  });

  it("azzera gli orari per ferie, malattia, permesso, ROL, ex festività e riposo", () => {
    const [entry] = buildBulkEntries(["2026-09-21"], {
      dayType: "ferie", start: "08:00", end: "17:00", breakMinutes: 60,
    });
    expect(entry).toMatchObject({ dayType: "ferie", start: "", end: "", breakMinutes: 0 });
    for (const dayType of ["rol", "ex_festivita"] as const) {
      expect(buildBulkEntries(["2026-09-22"], { dayType, start: "08:00", end: "17:00", breakMinutes: 60 })[0]).toMatchObject({ dayType, start: "", end: "", breakMinutes: 0 });
    }
  });
});
