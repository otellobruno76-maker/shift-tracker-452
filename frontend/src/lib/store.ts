// In-memory app state mirrored to IndexedDB on every change (write-through).
// Single store layer: a future cloud sync can subscribe here without touching
// any page or component.
import { useSyncExternalStore } from "react";
import { buildDemoData } from "./demo";
import { repo } from "./repo";
import { DEFAULT_SETTINGS, type DayEntry, type DayTemplate, type Settings } from "./types";

let days: DayEntry[] = [];
let settings: Settings = DEFAULT_SETTINGS;
let dayTemplates: DayTemplate[] = [];
let demoActive = false;
let ready = false;
let hydrating = false;

const listeners = new Set<() => void>();
function emit(): void {
  listeners.forEach((fn) => fn());
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useDays(): DayEntry[] {
  return useSyncExternalStore(subscribe, () => days);
}
export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, () => settings);
}
export function useDayTemplates(): DayTemplate[] {
  return useSyncExternalStore(subscribe, () => dayTemplates);
}
export function useDemoActive(): boolean {
  return useSyncExternalStore(subscribe, () => demoActive);
}
export function useAppReady(): boolean {
  return useSyncExternalStore(subscribe, () => ready);
}

const byDate = (a: DayEntry, b: DayEntry) =>
  a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);

export function saveEntry(entry: DayEntry): void {
  const exists = days.some((d) => d.id === entry.id);
  days = (exists ? days.map((d) => (d.id === entry.id ? entry : d)) : [...days, entry]).sort(byDate);
  void repo.putDay(entry).catch(() => undefined);
  emit();
}

export function saveEntries(entries: DayEntry[]): void {
  if (entries.length === 0) return;
  const incoming = new Map(entries.map((entry) => [entry.id, entry]));
  days = [
    ...days.map((entry) => incoming.get(entry.id) ?? entry),
    ...entries.filter((entry) => !days.some((existing) => existing.id === entry.id)),
  ].sort(byDate);
  void repo.putDays(entries).catch(() => undefined);
  emit();
}

export function deleteEntry(id: string): void {
  days = days.filter((d) => d.id !== id);
  void repo.deleteDay(id).catch(() => undefined);
  emit();
}

export function saveSettings(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch };
  void repo.putSettings(settings).catch(() => undefined);
  emit();
}

export function saveDayTemplate(template: DayTemplate): void {
  const exists = dayTemplates.some((item) => item.id === template.id);
  dayTemplates = exists
    ? dayTemplates.map((item) => (item.id === template.id ? template : item))
    : [...dayTemplates, template];
  void repo.putDayTemplates(dayTemplates).catch(() => undefined);
  emit();
}

export function deleteDayTemplate(id: string): void {
  dayTemplates = dayTemplates.filter((item) => item.id !== id);
  void repo.putDayTemplates(dayTemplates).catch(() => undefined);
  emit();
}

function applyDemo(): void {
  const demo = buildDemoData();
  days = demo.days;
  settings = demo.settings;
  demoActive = true;
  void repo
    .clearDays()
    .then(() => repo.putDays(days))
    .catch(() => undefined);
  void repo.putSettings(settings).catch(() => undefined);
  void repo.putMeta("demo", true).catch(() => undefined);
  emit();
}

/** One-button removal of the demo data — leaves the app completely empty. */
export function removeDemoData(): void {
  days = [];
  settings = { ...DEFAULT_SETTINGS };
  demoActive = false;
  void repo.clearDays().catch(() => undefined);
  void repo.putSettings(settings).catch(() => undefined);
  void repo.putMeta("demo", false).catch(() => undefined);
  emit();
}

export function exportBackupPayload(): string {
  return JSON.stringify(
    {
      app: "registro-ore-lavoro",
      version: 2,
      exportedAt: new Date().toISOString(),
      settings,
      days,
      dayTemplates,
    },
    null,
    2,
  );
}

export function importBackup(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.days)) return false;
  const valid = d.days.filter(
    (e): e is DayEntry =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as DayEntry).id === "string" &&
      typeof (e as DayEntry).date === "string" &&
      typeof (e as DayEntry).dayType === "string",
  );
  const importedSettings =
    typeof d.settings === "object" && d.settings !== null
      ? ({ ...DEFAULT_SETTINGS, ...(d.settings as Partial<Settings>) } as Settings)
      : null;
  const importedTemplates = Array.isArray(d.dayTemplates)
    ? d.dayTemplates.filter(
        (item): item is DayTemplate =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as DayTemplate).id === "string" &&
          typeof (item as DayTemplate).name === "string" &&
          typeof (item as DayTemplate).dayType === "string",
      )
    : [];
  days = [...valid].sort(byDate);
  dayTemplates = importedTemplates;
  if (importedSettings) settings = importedSettings;
  demoActive = false;
  ready = true;
  void repo
    .clearDays()
    .then(() => repo.putDays(days))
    .catch(() => undefined);
  if (importedSettings) void repo.putSettings(settings).catch(() => undefined);
  void repo.putDayTemplates(dayTemplates).catch(() => undefined);
  void repo.putMeta("demo", false).catch(() => undefined);
  emit();
  return true;
}

/** Load local data once at startup; on the very first run seed the demo data. */
export async function hydrateAndSeed(): Promise<void> {
  if (ready || hydrating) return;
  hydrating = true;
  try {
    const [storedDays, storedSettings, storedTemplates, demoFlag] = await Promise.all([
      repo.getDays(),
      repo.getSettings(),
      repo.getDayTemplates(),
      repo.getMeta("demo"),
    ]);
    days = storedDays;
    dayTemplates = storedTemplates;
    if (storedSettings) settings = { ...DEFAULT_SETTINGS, ...storedSettings };
    demoActive = demoFlag === true;
    ready = true;
    const firstRun = storedDays.length === 0 && storedSettings === null && demoFlag === null;
    if (firstRun) {
      applyDemo();
    } else {
      emit();
    }
  } catch {
    ready = true;
    emit();
  } finally {
    hydrating = false;
  }
}
