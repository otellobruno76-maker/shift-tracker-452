import { describe, expect, it } from "vitest";
import { computeSplits } from "./stats";
import { DEFAULT_SETTINGS } from "./types";
import type { DayEntry } from "./types";

function plannedDay(date: string, overtime = 0): DayEntry {
  return {
    id: date,
    date,
    dayType: "lavoro",
    start: "",
    end: "",
    breakMinutes: 0,
    notturno: false,
    reperibilita: false,
    trasferta: false,
    festivo: null,
    note: "",
    scheduledOrdinaryMinutes: 8 * 60,
    manualOvertimeMinutes: overtime,
    createdAt: date,
    updatedAt: date,
  };
}

describe("settimana lavorativa programmata", () => {
  it("calcola 40 ore ordinarie su cinque giorni da 8 ore", () => {
    const days = [22, 23, 24, 25, 26].map((day) => plannedDay(`2026-09-${day}`));
    const splits = computeSplits(days, DEFAULT_SETTINGS);

    expect(splits.reduce((sum, split) => sum + split.ordinary, 0)).toBe(40 * 60);
    expect(splits.reduce((sum, split) => sum + split.overtime, 0)).toBe(0);
  });

  it("aggiunge lo straordinario senza modificare le 40 ore ordinarie", () => {
    const days = [
      plannedDay("2026-09-21"),
      plannedDay("2026-09-22"),
      plannedDay("2026-09-23"),
      plannedDay("2026-09-24"),
      plannedDay("2026-09-25", 2 * 60),
    ];
    const splits = computeSplits(days, DEFAULT_SETTINGS);

    expect(splits.reduce((sum, split) => sum + split.ordinary, 0)).toBe(40 * 60);
    expect(splits.reduce((sum, split) => sum + split.overtime, 0)).toBe(2 * 60);
    expect(splits.reduce((sum, split) => sum + split.net, 0)).toBe(42 * 60);
  });
});
