import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { repo, type StoredData } from "./repo";
import { DEFAULT_SETTINGS, type DayEntry } from "./types";

const day: DayEntry = {
  id: "persistito", date: "2026-09-21", dayType: "lavoro", start: "08:00", end: "17:00",
  breakMinutes: 60, notturno: false, reperibilita: false, trasferta: false,
  festivo: null, note: "Originale", createdAt: "2026-09-21T08:00:00.000Z",
  updatedAt: "2026-09-21T08:00:00.000Z",
};

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("registro-ore-lavoro");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Database still open between tests"));
  });
});

describe("transazione IndexedDB", () => {
  it("annulla tutte le modifiche se una scrittura nella sostituzione fallisce", async () => {
    const original: StoredData = {
      days: [day], settings: { ...DEFAULT_SETTINGS, workerName: "Persona reale" },
      dayTemplates: [], payslips: [], demoProvenance: null, demoFlag: false,
    };
    await repo.updateState(() => original);

    await expect(repo.updateState((current) => ({
      ...current,
      // clear() is queued before this invalid keyPath value raises DataError.
      days: [{ ...day, id: undefined } as unknown as DayEntry],
      settings: { ...DEFAULT_SETTINGS, workerName: "Valore incompleto" },
    }))).rejects.toThrow();

    expect(await repo.readState()).toEqual(original);
  });
});
