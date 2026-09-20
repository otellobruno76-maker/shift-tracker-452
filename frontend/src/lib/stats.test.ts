import { describe, expect, it } from "vitest";
import { computeSplits, summarize } from "./stats";
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

  it("aggiunge 3 ore straordinarie a un solo giorno precompilato", () => {
    const [split] = computeSplits([plannedDay("2026-09-23", 3 * 60)], DEFAULT_SETTINGS);

    expect(split.ordinary).toBe(8 * 60);
    expect(split.overtime).toBe(3 * 60);
    expect(split.net).toBe(11 * 60);
  });

  it("sostituisce una giornata precompilata con ferie senza conteggiare ore", () => {
    const ferie = { ...plannedDay("2026-09-23"), dayType: "ferie" as const };
    const totals = summarize(computeSplits([ferie], DEFAULT_SETTINGS), DEFAULT_SETTINGS);

    expect(totals.ferieDays).toBe(1);
    expect(totals.netMinutes).toBe(0);
    expect(totals.ordinaryMinutes).toBe(0);
  });

  it("divide 06:00–18:00 con 30 minuti in 8h ordinarie e 3h30 straordinarie", () => {
    const manuale: DayEntry = {
      ...plannedDay("2026-09-23"),
      start: "06:00",
      end: "18:00",
      breakMinutes: 30,
      scheduledOrdinaryMinutes: undefined,
      manualOvertimeMinutes: undefined,
    };
    const [split] = computeSplits([manuale], DEFAULT_SETTINGS);

    expect(split.net).toBe(11 * 60 + 30);
    expect(split.ordinary).toBe(8 * 60);
    expect(split.overtime).toBe(3 * 60 + 30);
  });
});
