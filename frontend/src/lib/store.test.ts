import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DayEntry, DayTemplate, PayslipRecord } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const databaseName = "registro-ore-lavoro";

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Database still open between tests"));
  });
}

const day: DayEntry = {
  id: "giorno-reale", date: "2026-09-21", dayType: "lavoro", start: "08:00", end: "17:00",
  breakMinutes: 60, scheduledOrdinaryMinutes: 480, notturno: false, reperibilita: false,
  trasferta: false, festivo: null, note: "Turno reale", createdAt: "2026-09-21T08:00:00.000Z",
  updatedAt: "2026-09-21T08:00:00.000Z",
};
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

let store: typeof import("./store");
let repo: (typeof import("./repo"))["repo"];

beforeEach(async () => {
  await deleteDatabase();
  vi.resetModules();
  ({ repo } = await import("./repo"));
  store = await import("./store");
  await store.hydrateAndSeed();
});

afterEach(() => vi.restoreAllMocks());

async function snapshot() {
  return JSON.parse(await store.exportBackupPayload());
}

async function emptyApp() {
  await store.removeDemoData();
}

function validBackup() {
  return {
    app: "registro-ore-lavoro", version: 2, exportedAt: "2026-09-21T08:00:00.000Z",
    settings: { ...DEFAULT_SETTINGS }, days: [day], dayTemplates: [], payslips: [],
  };
}

describe("backup integrato", () => {
  it("include giornate tipo e cedolini mensili", async () => {
    await emptyApp();
    await store.saveDayTemplate(template);
    await store.savePayslip(payslip);
    const backup = await snapshot();
    expect(backup.version).toBe(2);
    expect(backup.dayTemplates).toEqual([template]);
    expect(backup.payslips).toMatchObject([payslip]);
  });

  it("continua a importare i backup versione 1 con dati", async () => {
    const {
      workerName, company, dailyOrdinaryHours, weeklyOrdinaryHours, basePay,
      overtimePct, holidayPct, nightPct, sundayPct, reperibilitaPct, trasfertaPct,
      reperibilitaEuroPerDay, netEnabled, netPct, patronalName, patronalMonth, patronalDay,
    } = DEFAULT_SETTINGS;
    await store.importBackup({
      app: "registro-ore-lavoro", version: 1, exportedAt: "2026-09-21T08:00:00.000Z",
      settings: {
        workerName, company, dailyOrdinaryHours, weeklyOrdinaryHours, basePay,
        overtimePct, holidayPct, nightPct, sundayPct, reperibilitaPct, trasfertaPct,
        reperibilitaEuroPerDay, netEnabled, netPct, patronalName, patronalMonth, patronalDay,
      },
      days: [day],
    });
    const backup = await snapshot();
    expect(backup.days).toEqual([day]);
    expect(backup.dayTemplates).toEqual([]);
    expect(backup.payslips).toEqual([]);
  });

  it("salva più cedolini senza cambiare automaticamente la paga configurata", async () => {
    await emptyApp();
    await store.saveSettings({ basePay: 8 });
    await store.savePayslip(payslip);
    await store.savePayslip({ ...payslip, id: "cedolino-2026-10", month: "2026-10", basePay: 12 });
    const backup = await snapshot();
    expect(backup.payslips).toHaveLength(2);
    expect(backup.settings.basePay).toBe(8);
    await store.deletePayslip(payslip.id);
  });

  it("salva manualmente un cedolino anche senza dati OCR", async () => {
    await emptyApp();
    await store.savePayslip({ ...payslip, id: "manuale", month: "2026-11", filename: "Inserimento manuale", basePay: null, ordinaryHours: null, overtimeRates: [], allowances: [], totals: [], ccnl: "", level: "" });
    const backup = await snapshot();
    expect(backup.payslips).toHaveLength(1);
    expect(backup.payslips[0]).toMatchObject({ month: "2026-11", filename: "Inserimento manuale", basePay: null });
  });

  it("azzera solo il registro preservando paga, CCNL, giornate tipo e cedolini", async () => {
    await emptyApp();
    await store.saveDayTemplate(template);
    await store.savePayslip(payslip);
    await store.saveSettings({ basePay: 12.5, ccnl: "CCNL fittizio", contractLevel: "Livello X" });
    await store.saveEntry(day);
    await store.clearRegister();
    const backup = await snapshot();
    expect(backup.days).toEqual([]);
    expect(backup.settings).toMatchObject({ basePay: 12.5, ccnl: "CCNL fittizio", contractLevel: "Livello X" });
    expect(backup.dayTemplates).toEqual([template]);
    expect(backup.payslips).toMatchObject([payslip]);
  });
});

describe("eliminazione cedolini e cambio lavoro", () => {
  async function seed() {
    await emptyApp();
    await store.savePayslip({ ...payslip, id: "A", month: "2026-07" });
    await store.savePayslip({ ...payslip, id: "B", month: "2026-08", items: [{ originalDescription: "Straordinario", category: "overtime", quantity: 4, unit: "hours", ratePct: 15, amount: 50, confidence: "alta", source: "ai" }] });
    await store.savePayslip({ ...payslip, id: "C", month: "2026-09" });
    await store.saveEntry({ ...day, id: "ora-storica", date: "2026-08-05", dayType: "ferie", start: "", end: "" });
    await store.saveSettings({ company: "Azienda sintetica", ccnl: "Contratto sintetico" });
  }

  it("elimina solo B e accetta lo stesso identico cedolino come nuovo", async () => {
    await seed();
    await store.deletePayslip("B");
    expect((await snapshot()).payslips.map((item: PayslipRecord) => item.id)).toEqual(["C", "A"]);
    await store.savePayslip({ ...payslip, id: "B-nuovo", month: "2026-08" });
    expect((await snapshot()).payslips).toHaveLength(3);
  });

  it("mantiene per default lo storico ore e cancella configurazione e cedolini", async () => {
    await seed();
    await store.resetJob();
    expect(await snapshot()).toMatchObject({ payslips: [], dayTemplates: [], settings: { company: "", ccnl: "" } });
    expect((await snapshot()).days).toHaveLength(1);
  });

  it("cancella anche le ore solo se richiesto esplicitamente", async () => {
    await seed();
    await store.resetJob(true);
    expect((await snapshot()).days).toEqual([]);
    expect((await snapshot()).payslips).toEqual([]);
  });
});

describe("sicurezza dei dati demo", () => {
  it("rimuove solo i giorni demo certi e conserva i giorni e altri dati reali", async () => {
    const seeded = await repo.readState();
    expect(seeded.demoProvenance).not.toBeNull();
    expect(seeded.days.length).toBeGreaterThan(0);
    await store.saveEntry(day);
    await store.saveDayTemplate(template);
    await store.savePayslip(payslip);

    await store.removeDemoData();

    const persisted = await repo.readState();
    expect(persisted.days).toEqual([day]);
    expect(persisted.dayTemplates).toEqual([template]);
    expect(persisted.payslips).toMatchObject([payslip]);
    expect((await snapshot()).days).toEqual([day]);
  });

  it("conserva una giornata demo modificata dall'utente", async () => {
    const original = (await repo.readState()).days[0];
    const changed = { ...original, note: "Turno corretto dall'utente", updatedAt: "2026-10-03T10:00:00.000Z" };
    await store.saveEntry(changed);

    await store.removeDemoData();

    expect((await repo.readState()).days).toEqual([changed]);
  });

  it("conserva le impostazioni demo modificate dall'utente", async () => {
    await store.saveSettings({ workerName: "Lavoratore reale", basePay: 20 });

    await store.removeDemoData();

    const settings = (await repo.readState()).settings;
    expect(settings).toMatchObject({ workerName: "Lavoratore reale", basePay: 20, company: "" });
  });

  it("conserva i vecchi dati demo senza provenienza certa", async () => {
    const legacy = await repo.readState();
    await repo.updateState((current) => ({ ...current, demoProvenance: null, demoFlag: true }));

    await store.removeDemoData();

    const persisted = await repo.readState();
    expect(persisted.days).toEqual(legacy.days);
    expect(persisted.settings).toEqual(legacy.settings);
    expect(persisted.demoFlag).toBe(false);
  });

  it("conserva modifiche di un'altra scheda fatte dopo la lettura locale", async () => {
    const original = (await repo.readState()).days[0];
    const changed = { ...original, note: "Modificato in altra scheda" };
    await repo.updateState((current) => ({
      ...current,
      days: [...current.days.map((entry) => entry.id === original.id ? changed : entry), day],
      settings: { ...current.settings!, company: "Azienda reale" },
    }));

    await store.removeDemoData();

    const persisted = await repo.readState();
    expect(persisted.days).toEqual(expect.arrayContaining([changed, day]));
    expect(persisted.days).toHaveLength(2);
    expect(persisted.settings?.company).toBe("Azienda reale");
  });
});

describe("conflitti tra schede nelle operazioni in blocco", () => {
  it("rifiuta l'annullamento se un'altra scheda cambia i giorni coinvolti", async () => {
    await emptyApp();
    await store.saveEntry(day);
    const bulkDay = { ...day, id: "giorno-blocco", note: "Compilazione in blocco" };
    await store.applyBulkEntries([bulkDay], [day.date]);

    const externallyChanged = { ...bulkDay, note: "Corretto in un'altra scheda" };
    const externallyAdded = { ...day, id: "giorno-altra-scheda", note: "Nuova registrazione" };
    await repo.updateState((current) => ({
      ...current,
      days: [...current.days.map((entry) => entry.id === bulkDay.id ? externallyChanged : entry), externallyAdded],
    }));
    const beforeUndo = await repo.readState();

    await expect(store.undoLastBulkOperation()).rejects.toThrow();

    expect(await repo.readState()).toEqual(beforeUndo);
    expect((await snapshot()).days).toEqual(expect.arrayContaining([externallyChanged, externallyAdded]));
    expect((await snapshot()).days).not.toContainEqual(day);
  });

  it("rifiuta la compilazione se un'altra scheda aggiunge un giorno dopo la lettura UI", async () => {
    await emptyApp(); // La scheda corrente vede la data ancora libera.
    await repo.updateState((current) => ({ ...current, days: [...current.days, day] }));
    const beforeApply = await repo.readState();
    const bulkDay = { ...day, id: "giorno-blocco", note: "Compilazione in blocco" };

    await expect(store.applyBulkEntries([bulkDay])).rejects.toThrow();

    expect(await repo.readState()).toEqual(beforeApply);
    expect((await snapshot()).days).toEqual([day]);
  });
});

describe("conflitti tra schede nei salvataggi singoli", () => {
  it("rifiuta la modifica di una giornata cambiata dopo la lettura locale", async () => {
    await emptyApp();
    await store.saveEntry(day);
    const externallyChanged = { ...day, note: "Corretto in un'altra scheda" };
    await repo.updateState((current) => ({
      ...current,
      days: current.days.map((entry) => entry.id === day.id ? externallyChanged : entry),
    }));
    const beforeSave = await repo.readState();

    await expect(store.saveEntry({ ...day, note: "Modifica locale superata" }, day))
      .rejects.toThrow(/un'altra scheda/);

    expect(await repo.readState()).toEqual(beforeSave);
    expect((await snapshot()).days).toEqual([externallyChanged]);
  });

  it("rifiuta un cedolino se un'altra scheda ha già salvato quel mese", async () => {
    await emptyApp();
    await repo.updateState((current) => ({ ...current, payslips: [...current.payslips, payslip] }));
    const beforeSave = await repo.readState();
    const local = { ...payslip, id: "cedolino-locale", basePay: 12 };

    await expect(store.savePayslip(local)).rejects.toThrow(/questo mese/);

    expect(await repo.readState()).toEqual(beforeSave);
    expect((await snapshot()).payslips).toMatchObject([payslip]);
  });

  it("rifiuta la modifica di un cedolino cambiato dopo la lettura locale", async () => {
    await emptyApp();
    await store.savePayslip(payslip);
    const expected = (await repo.readState()).payslips[0];
    const externallyChanged = { ...expected, basePay: 14 };
    await repo.updateState((current) => ({
      ...current,
      payslips: current.payslips.map((record) => record.id === expected.id ? externallyChanged : record),
    }));
    const beforeSave = await repo.readState();

    await expect(store.savePayslip({ ...expected, basePay: 16 }, expected))
      .rejects.toThrow(/un'altra scheda/);

    expect(await repo.readState()).toEqual(beforeSave);
    expect((await snapshot()).payslips[0].basePay).toBe(14);
  });
});

describe("validazione e persistenza backup", () => {
  async function expectUnchangedAfterRejectedBackup(backup: unknown) {
    await emptyApp();
    await store.saveEntry(day);
    const beforeDisk = await repo.readState();
    const beforeView = await snapshot();
    await expect(store.importBackup(backup)).rejects.toThrow();
    expect(await repo.readState()).toEqual(beforeDisk);
    expect(await snapshot()).toEqual({ ...beforeView, exportedAt: expect.any(String) });
  }

  it("rifiuta un backup vuoto senza alterare i dati", async () => {
    await expectUnchangedAfterRejectedBackup({ ...validBackup(), days: [] });
  });

  it("rifiuta un backup malformato senza importare solo i record validi", async () => {
    await expectUnchangedAfterRejectedBackup({ ...validBackup(), days: [day, { id: "rotto", date: "2026-09-22" }] });
  });

  it("rifiuta un backup incompleto senza alterare i dati", async () => {
    const { payslips: _missing, ...backup } = validBackup();
    void _missing;
    await expectUnchangedAfterRejectedBackup(backup);
  });

  it("rifiuta un backup incompatibile senza alterare i dati", async () => {
    await expectUnchangedAfterRejectedBackup({ ...validBackup(), version: 99 });
  });

  it("non cambia lo stato in memoria quando fallisce la persistenza", async () => {
    await emptyApp();
    await store.saveEntry(day);
    const before = await repo.readState();
    const modified = { ...day, note: "Modifica non salvata" };
    vi.spyOn(repo, "updateState").mockRejectedValueOnce(new Error("Quota IndexedDB esaurita"));

    await expect(store.saveEntry(modified)).rejects.toThrow();

    expect(await repo.readState()).toEqual(before);
    expect((await snapshot()).days).toEqual([day]);
  });

  it("attende le scritture in coda prima di esportare", async () => {
    await emptyApp();
    const update = repo.updateState.bind(repo);
    let release!: () => void;
    vi.spyOn(repo, "updateState").mockImplementationOnce(async (updater) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return update(updater);
    });

    const saving = store.saveEntry(day);
    const exporting = store.exportBackupPayload();
    let exported = false;
    void exporting.then(() => { exported = true; });
    await Promise.resolve();
    expect(exported).toBe(false);
    release();
    await saving;
    expect(JSON.parse(await exporting).days).toEqual([day]);
  });
});
