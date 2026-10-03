// IndexedDB is authoritative. UI snapshots change only after a transaction commits.
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { validateBackup } from "./backup";
import { buildDemoData } from "./demo";
import { repo, type StoredData } from "./repo";
import { DEFAULT_SETTINGS, type DayEntry, type DayTemplate, type PayslipRecord, type Settings } from "./types";

let days: DayEntry[] = [];
let settings: Settings = DEFAULT_SETTINGS;
let dayTemplates: DayTemplate[] = [];
let payslips: PayslipRecord[] = [];
let demoActive = false;
let ready = false;
let hydration: Promise<void> | null = null;
let lastBulkSnapshot: DayEntry[] | null = null;
let lastBulkDates: string[] = [];
let lastBulkAppliedSnapshot: DayEntry[] | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let refreshQueue: Promise<void> = Promise.resolve();
let channel: BroadcastChannel | null = null;

const listeners = new Set<() => void>();
function emit(): void { listeners.forEach((fn) => fn()); }
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useDays(): DayEntry[] { return useSyncExternalStore(subscribe, () => days); }
export function useSettings(): Settings { return useSyncExternalStore(subscribe, () => settings); }
export function useDayTemplates(): DayTemplate[] { return useSyncExternalStore(subscribe, () => dayTemplates); }
export function usePayslips(): PayslipRecord[] { return useSyncExternalStore(subscribe, () => payslips); }
export function useDemoActive(): boolean { return useSyncExternalStore(subscribe, () => demoActive); }
export function useAppReady(): boolean { return useSyncExternalStore(subscribe, () => ready); }
export function useCanUndoBulk(): boolean { return useSyncExternalStore(subscribe, () => lastBulkSnapshot !== null); }

const byDate = (a: DayEntry, b: DayEntry) =>
  a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);

function sameEntries(left: DayEntry[], right: DayEntry[]): boolean {
  const byId = (a: DayEntry, b: DayEntry) => a.id.localeCompare(b.id);
  return JSON.stringify(left.slice().sort(byId)) === JSON.stringify(right.slice().sort(byId));
}

function hasProvenance(state: StoredData): boolean {
  const provenance = state.demoProvenance;
  return !!provenance &&
    (Object.keys(provenance.days).length > 0 || Object.keys(provenance.settings).length > 0);
}

function publish(state: StoredData): void {
  days = state.days.slice().sort(byDate);
  settings = state.settings ? { ...DEFAULT_SETTINGS, ...state.settings } : DEFAULT_SETTINGS;
  dayTemplates = state.dayTemplates;
  payslips = state.payslips.map((record) => ({
    ...record,
    overtimeRates: Array.isArray(record.overtimeRates) ? record.overtimeRates : [],
    overtimeTariffs: Array.isArray(record.overtimeTariffs) ? record.overtimeTariffs : [],
    allowances: Array.isArray(record.allowances) ? record.allowances : [],
    totals: Array.isArray(record.totals) ? record.totals : [],
    items: Array.isArray(record.items) ? record.items : [],
    fieldProvenance: record.fieldProvenance ?? {},
  })).sort((a, b) => b.month.localeCompare(a.month));
  demoActive = hasProvenance(state);
  emit();
}

function withoutDemoDays(state: StoredData, ids: Iterable<string>): StoredData["demoProvenance"] {
  if (!state.demoProvenance) return null;
  const demoDays = { ...state.demoProvenance.days };
  for (const id of ids) delete demoDays[id];
  return { days: demoDays, settings: { ...state.demoProvenance.settings } };
}

/** Queue local writes so an export and successive edits see every prior commit. */
function update(
  mutate: (current: StoredData) => StoredData,
  committed?: () => void,
): Promise<void> {
  const operation = writeQueue.then(async () => {
    const saved = await repo.updateState(mutate);
    publish(saved);
    committed?.();
    emit();
    try { channel?.postMessage("changed"); }
    catch (error) { console.error("Impossibile avvisare le altre schede", error); }
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function waitForPendingWrites(): Promise<void> { return writeQueue; }
export function waitForPayslipWrites(): Promise<void> { return waitForPendingWrites(); }

/** Refresh from durable state after another tab commits. Local writes run first. */
export function refreshFromStorage(): Promise<void> {
  const refresh = refreshQueue.then(async () => {
    await writeQueue;
    publish(await repo.readState());
  });
  refreshQueue = refresh.then(() => undefined, () => undefined);
  return refresh;
}

function listenForOtherTabs(): void {
  if (typeof window === "undefined") return;
  const reportReadFailure = () => toast.error("Impossibile aggiornare i dati locali. Ricarica la pagina e riprova.");
  if (!channel && "BroadcastChannel" in window) {
    try {
      channel = new BroadcastChannel("registro-ore-lavoro-updates");
      channel.onmessage = () => { void refreshFromStorage().catch(reportReadFailure); };
    } catch {
      // Visibility refresh below remains available when the channel cannot open.
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void refreshFromStorage().catch(reportReadFailure);
    }
  });
}

export function saveEntry(entry: DayEntry, expected?: DayEntry | null): Promise<void> {
  return update((current) => {
    if (expected !== undefined && !sameEntries(
      current.days.filter((day) => day.id === entry.id), expected ? [expected] : [],
    )) {
      throw new Error("La giornata è cambiata in un'altra scheda. Riaprila prima di salvare.");
    }
    return {
      ...current,
      days: [...current.days.filter((day) => day.id !== entry.id), entry],
      demoProvenance: withoutDemoDays(current, [entry.id]),
      demoFlag: false,
    };
  });
}

export function saveEntries(entries: DayEntry[]): Promise<void> {
  if (!entries.length) return Promise.resolve();
  const touched = new Set(entries.map((entry) => entry.date));
  const expected = days.filter((entry) => touched.has(entry.date));
  return update((current) => {
    if (!sameEntries(current.days.filter((entry) => touched.has(entry.date)), expected)) {
      throw new Error("Le giornate sono cambiate in un'altra scheda. Riapri la compilazione e riprova.");
    }
    const incoming = new Set(entries.map((entry) => entry.id));
    return {
      ...current,
      days: [...current.days.filter((day) => !incoming.has(day.id)), ...entries],
      demoProvenance: withoutDemoDays(current, incoming),
      demoFlag: false,
    };
  });
}

export function applyBulkEntries(entries: DayEntry[], replaceDates: string[] = []): Promise<void> {
  let snapshot: DayEntry[] = [];
  let appliedSnapshot: DayEntry[] = [];
  const touched = [...new Set([...entries.map((entry) => entry.date), ...replaceDates])];
  const touchedSet = new Set(touched);
  const expected = days.filter((entry) => touchedSet.has(entry.date));
  return update((current) => {
    snapshot = current.days.filter((entry) => touchedSet.has(entry.date));
    if (!sameEntries(snapshot, expected)) {
      throw new Error("Le giornate sono cambiate in un'altra scheda. Riapri l'anteprima e riprova.");
    }
    const replaced = new Set(replaceDates);
    const incoming = new Set(entries.map((entry) => entry.id));
    const removed = current.days.filter((entry) => replaced.has(entry.date)).map((entry) => entry.id);
    const next = {
      ...current,
      days: [...current.days.filter((entry) => !replaced.has(entry.date) && !incoming.has(entry.id)), ...entries],
      demoProvenance: withoutDemoDays(current, [...removed, ...incoming]),
      demoFlag: false,
    };
    appliedSnapshot = next.days.filter((entry) => touchedSet.has(entry.date));
    return next;
  }, () => {
    lastBulkSnapshot = snapshot;
    lastBulkDates = touched;
    lastBulkAppliedSnapshot = appliedSnapshot;
  });
}

export async function undoLastBulkOperation(): Promise<boolean> {
  if (lastBulkSnapshot === null || lastBulkAppliedSnapshot === null) return false;
  const snapshot = lastBulkSnapshot;
  const appliedSnapshot = lastBulkAppliedSnapshot;
  const affected = new Set(lastBulkDates);
  await update((current) => {
    if (!sameEntries(current.days.filter((entry) => affected.has(entry.date)), appliedSnapshot)) {
      throw new Error("Le giornate sono cambiate in un'altra scheda. L'annullamento è stato interrotto per conservarle.");
    }
    const currentIds = current.days.filter((entry) => affected.has(entry.date)).map((entry) => entry.id);
    const restoredIds = snapshot.map((entry) => entry.id);
    return {
      ...current,
      days: [...current.days.filter((entry) => !affected.has(entry.date)), ...snapshot],
      demoProvenance: withoutDemoDays(current, [...currentIds, ...restoredIds]),
      demoFlag: false,
    };
  }, () => {
    lastBulkSnapshot = null;
    lastBulkDates = [];
    lastBulkAppliedSnapshot = null;
  });
  return true;
}

/** Cancella solo il registro ore; impostazioni e giornate tipo restano invariati. */
export function clearRegister(): Promise<void> {
  return update((current) => ({
    ...current,
    days: [],
    demoProvenance: withoutDemoDays(current, current.days.map((entry) => entry.id)),
    demoFlag: false,
  }), () => {
    lastBulkSnapshot = null;
    lastBulkDates = [];
    lastBulkAppliedSnapshot = null;
  });
}

export function deleteEntry(id: string, expected?: DayEntry): Promise<void> {
  return update((current) => {
    if (expected && !sameEntries(current.days.filter((day) => day.id === id), [expected])) {
      throw new Error("La giornata è cambiata in un'altra scheda. Riaprila prima di eliminarla.");
    }
    return {
      ...current,
      days: current.days.filter((day) => day.id !== id),
      demoProvenance: withoutDemoDays(current, [id]),
      demoFlag: false,
    };
  });
}

export function saveSettings(patch: Partial<Settings>): Promise<void> {
  return update((current) => {
    const provenance = current.demoProvenance && {
      days: { ...current.demoProvenance.days },
      settings: { ...current.demoProvenance.settings },
    };
    if (provenance) {
      for (const key of Object.keys(patch) as (keyof Settings)[]) delete provenance.settings[key];
    }
    return {
      ...current,
      settings: { ...DEFAULT_SETTINGS, ...current.settings, ...patch },
      demoProvenance: provenance,
      demoFlag: false,
    };
  });
}

export function saveDayTemplate(template: DayTemplate): Promise<void> {
  return update((current) => ({
    ...current,
    dayTemplates: [...current.dayTemplates.filter((item) => item.id !== template.id), template],
    demoFlag: false,
  }));
}

export function deleteDayTemplate(id: string): Promise<void> {
  return update((current) => ({
    ...current,
    dayTemplates: current.dayTemplates.filter((item) => item.id !== id),
    demoFlag: false,
  }));
}

export function savePayslip(record: PayslipRecord, expected?: PayslipRecord | null): Promise<void> {
  return update((current) => {
    const existing = current.payslips.find((item) => item.id === record.id);
    if (expected !== undefined && JSON.stringify(existing ?? null) !== JSON.stringify(expected)) {
      throw new Error("Il cedolino è cambiato in un'altra scheda. Riaprilo prima di salvare.");
    }
    if (current.payslips.some((item) => item.month === record.month && item.id !== record.id)) {
      throw new Error("Esiste già un cedolino per questo mese. Riapri lo storico prima di salvare.");
    }
    return {
      ...current,
      payslips: [...current.payslips.filter((item) => item.id !== record.id), record],
      demoFlag: false,
    };
  });
}

export function deletePayslip(id: string, expected?: PayslipRecord): Promise<void> {
  return update((current) => {
    if (expected && JSON.stringify(current.payslips.find((item) => item.id === id) ?? null) !== JSON.stringify(expected)) {
      throw new Error("Il cedolino è cambiato in un'altra scheda. Riaprilo prima di eliminarlo.");
    }
    return {
      ...current,
      payslips: current.payslips.filter((item) => item.id !== id),
      demoFlag: false,
    };
  });
}

/** Cancella il rapporto precedente; lo storico personale resta salvo per impostazione predefinita. */
export function resetJob(deleteHours = false): Promise<void> {
  return update((current) => ({
    ...current,
    settings: { ...DEFAULT_SETTINGS, workerName: current.settings?.workerName ?? "" },
    dayTemplates: [],
    payslips: [],
    days: deleteHours ? [] : current.days,
    demoProvenance: current.demoProvenance
      ? { days: deleteHours ? {} : { ...current.demoProvenance.days }, settings: {} }
      : null,
    demoFlag: false,
  }), () => {
    if (deleteHours) {
      lastBulkSnapshot = null;
      lastBulkDates = [];
      lastBulkAppliedSnapshot = null;
    }
  });
}

/** Remove only generated values whose original provenance still exists. */
export function removeDemoData(): Promise<void> {
  return update((current) => {
    const provenance = current.demoProvenance;
    if (!provenance) return { ...current, demoFlag: false };
    const remaining = current.days.filter((entry) => {
      const original = provenance.days[entry.id];
      return !original || JSON.stringify(entry) !== JSON.stringify(original);
    });
    const retainedSettings = { ...DEFAULT_SETTINGS, ...current.settings };
    for (const key of Object.keys(provenance.settings) as (keyof Settings)[]) {
      if (JSON.stringify(retainedSettings[key]) === JSON.stringify(provenance.settings[key])) {
        Object.assign(retainedSettings, { [key]: DEFAULT_SETTINGS[key] });
      }
    }
    return {
      ...current,
      days: remaining,
      settings: retainedSettings,
      demoProvenance: null,
      demoFlag: false,
    };
  }, () => {
    lastBulkSnapshot = null;
    lastBulkDates = [];
    lastBulkAppliedSnapshot = null;
  });
}

export async function exportBackupPayload(): Promise<string> {
  await writeQueue;
  const current = await repo.readState();
  return JSON.stringify({
    app: "registro-ore-lavoro",
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: { ...DEFAULT_SETTINGS, ...current.settings },
    days: current.days.slice().sort(byDate),
    dayTemplates: current.dayTemplates,
    payslips: current.payslips,
  }, null, 2);
}

/** Validation runs before entering the write queue; the replacement is one transaction. */
export async function importBackup(data: unknown): Promise<void> {
  const backup = validateBackup(data);
  await update(() => ({
    days: backup.days,
    settings: backup.settings,
    dayTemplates: backup.dayTemplates,
    payslips: backup.payslips,
    demoProvenance: null,
    demoFlag: false,
  }), () => {
    lastBulkSnapshot = null;
    lastBulkDates = [];
    lastBulkAppliedSnapshot = null;
    ready = true;
  });
}

/** Seed only when the latest durable state is truly empty. */
export function hydrateAndSeed(): Promise<void> {
  if (ready) return Promise.resolve();
  if (hydration) return hydration;
  hydration = (async () => {
    const stored = await repo.readState();
    const firstRun = stored.days.length === 0 && stored.settings === null &&
      stored.dayTemplates.length === 0 && stored.payslips.length === 0 &&
      stored.demoFlag === null && stored.demoProvenance === null;
    if (firstRun) {
      const demo = buildDemoData();
      await update((current) => {
        const stillFirstRun = current.days.length === 0 && current.settings === null &&
          current.dayTemplates.length === 0 && current.payslips.length === 0 &&
          current.demoFlag === null && current.demoProvenance === null;
        if (!stillFirstRun) return current;
        return {
          ...current,
          days: demo.days,
          settings: demo.settings,
          demoProvenance: {
            days: Object.fromEntries(demo.days.map((entry) => [entry.id, entry])),
            settings: { ...demo.settings },
          },
          demoFlag: true,
        };
      });
    } else {
      await writeQueue;
      publish(await repo.readState());
    }
    ready = true;
    emit();
    listenForOtherTabs();
  })().finally(() => { hydration = null; });
  return hydration;
}
