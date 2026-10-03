// Promise wrapper over IndexedDB — the ONLY persistence layer of the app
// (local-first: no backend, no cloud). A future cloud-sync feature can hook
// the same interface without touching any UI code.
import type { DayEntry, DayTemplate, PayslipRecord, Settings } from "./types";

const DB_NAME = "registro-ore-lavoro";
const DB_VERSION = 1;
const STORE_DAYS = "days";
const STORE_KV = "kv";

export interface StoredData {
  days: DayEntry[];
  settings: Settings | null;
  dayTemplates: DayTemplate[];
  payslips: PayslipRecord[];
  demoProvenance: { days: Record<string, DayEntry>; settings: Partial<Settings> } | null;
  demoFlag: boolean | null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DAYS)) {
        db.createObjectStore(STORE_DAYS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest | void,
): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result: T | undefined;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB tx failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB tx aborted"));
      try {
        const request = run(store);
        if (request) {
          request.onsuccess = () => {
            result = request.result as T;
          };
        }
      } catch (error) {
        try { tx.abort(); } catch { /* The transaction may have already aborted. */ }
        reject(error);
      }
    });
  } finally {
    db.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertStoredData(value: unknown): asserts value is StoredData {
  if (!isRecord(value) || !Array.isArray(value.days) ||
      (value.settings !== null && !isRecord(value.settings)) ||
      !Array.isArray(value.dayTemplates) || !Array.isArray(value.payslips) ||
      (value.demoFlag !== null && typeof value.demoFlag !== "boolean") ||
      (value.demoProvenance !== null && (!isRecord(value.demoProvenance) ||
        !isRecord(value.demoProvenance.days) || !isRecord(value.demoProvenance.settings)))) {
    throw new Error("Dati locali non validi");
  }
}

function readStoredData(values: unknown[]): StoredData {
  const [days, settings, dayTemplates, payslips, demoProvenance, demoFlag] = values;
  const state = {
    days: (days as DayEntry[]).slice().sort(byDate),
    settings: (settings as Settings | null) ?? null,
    dayTemplates: (dayTemplates as DayTemplate[] | undefined) ?? [],
    payslips: (payslips as PayslipRecord[] | undefined) ?? [],
    demoProvenance: (demoProvenance as StoredData["demoProvenance"]) ?? null,
    demoFlag: (demoFlag as boolean | null) ?? null,
  };
  assertStoredData(state);
  return { ...state, payslips: normalizePayslips(state.payslips) };
}

function normalizePayslips(records: PayslipRecord[]): PayslipRecord[] {
  return records.map((record) => ({
    ...record,
    overtimeRates: Array.isArray(record.overtimeRates) ? record.overtimeRates : [],
    overtimeTariffs: Array.isArray(record.overtimeTariffs) ? record.overtimeTariffs : [],
    allowances: Array.isArray(record.allowances) ? record.allowances : [],
    totals: Array.isArray(record.totals) ? record.totals : [],
    items: Array.isArray(record.items) ? record.items : [],
    fieldProvenance: record.fieldProvenance ?? {},
  })).sort((a, b) => b.month.localeCompare(a.month));
}

/** Reads and writes both stores in one transaction, so tabs see the same committed state. */
async function transactState(
  mode: IDBTransactionMode,
  updater?: (current: StoredData) => StoredData,
): Promise<StoredData> {
  const db = await openDb();
  try {
    return await new Promise<StoredData>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction([STORE_DAYS, STORE_KV], mode);
      } catch (error) {
        reject(error);
        return;
      }

      let result: StoredData | undefined;
      let failure: unknown;
      tx.oncomplete = () => result ? resolve(result) : reject(new Error("IndexedDB tx completed without state"));
      tx.onerror = (event) => {
        failure ??= (event.target as IDBRequest).error ?? tx.error ?? new Error("IndexedDB tx failed");
      };
      tx.onabort = () => reject(failure ?? tx.error ?? new Error("IndexedDB tx aborted"));

      const abort = (error: unknown) => {
        failure = error;
        try { tx.abort(); } catch { reject(error); }
      };

      try {
        const dayStore = tx.objectStore(STORE_DAYS);
        const kvStore = tx.objectStore(STORE_KV);
        const requests: IDBRequest[] = [
          dayStore.getAll(),
          kvStore.get("settings"),
          kvStore.get("dayTemplates"),
          kvStore.get("payslips"),
          kvStore.get("demoProvenance"),
          kvStore.get("demo"),
        ];
        const values: unknown[] = new Array(requests.length);
        let remaining = requests.length;
        requests.forEach((request, index) => {
          request.onsuccess = () => {
            values[index] = request.result;
            if (--remaining !== 0) return;
            try {
              const current = readStoredData(values);
              if (!updater) {
                result = current;
                return;
              }

              // The updater runs synchronously inside this active readwrite transaction.
              // Any exception aborts all writes, including ones already queued here.
              const next = updater(current);
              assertStoredData(next);
              dayStore.clear();
              for (const day of next.days) dayStore.put(day);
              if (next.settings === null) kvStore.delete("settings");
              else kvStore.put(next.settings, "settings");
              kvStore.put(next.dayTemplates, "dayTemplates");
              kvStore.put(next.payslips, "payslips");
              if (next.demoProvenance === null) kvStore.delete("demoProvenance");
              else kvStore.put(next.demoProvenance, "demoProvenance");
              if (next.demoFlag === null) kvStore.delete("demo");
              else kvStore.put(next.demoFlag, "demo");
              result = next;
            } catch (error) {
              abort(error);
            }
          };
          request.onerror = () => {
            failure ??= request.error ?? new Error("IndexedDB read failed");
          };
        });
      } catch (error) {
        abort(error);
      }
    });
  } finally {
    db.close();
  }
}

const byDate = (a: DayEntry, b: DayEntry) =>
  a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);

export const repo = {
  readState(): Promise<StoredData> {
    return transactState("readonly");
  },
  updateState(updater: (current: StoredData) => StoredData): Promise<StoredData> {
    return transactState("readwrite", updater);
  },
  async getDays(): Promise<DayEntry[]> {
    const all = await withStore<DayEntry[]>(STORE_DAYS, "readonly", (s) => s.getAll());
    return (all ?? []).slice().sort(byDate);
  },
  async putDay(entry: DayEntry): Promise<void> {
    await withStore(STORE_DAYS, "readwrite", (s) => s.put(entry));
  },
  async putDays(entries: DayEntry[]): Promise<void> {
    await withStore(STORE_DAYS, "readwrite", (s) => {
      for (const e of entries) s.put(e);
    });
  },
  async deleteDay(id: string): Promise<void> {
    await withStore(STORE_DAYS, "readwrite", (s) => s.delete(id));
  },
  async clearDays(): Promise<void> {
    await withStore(STORE_DAYS, "readwrite", (s) => s.clear());
  },
  async getSettings(): Promise<Settings | null> {
    const value = await withStore<Settings>(STORE_KV, "readonly", (s) => s.get("settings"));
    return value ?? null;
  },
  async putSettings(settings: Settings): Promise<void> {
    await withStore(STORE_KV, "readwrite", (s) => s.put(settings, "settings"));
  },
  async getDayTemplates(): Promise<DayTemplate[]> {
    const value = await withStore<DayTemplate[]>(STORE_KV, "readonly", (s) =>
      s.get("dayTemplates"),
    );
    return Array.isArray(value) ? value : [];
  },
  async putDayTemplates(templates: DayTemplate[]): Promise<void> {
    await withStore(STORE_KV, "readwrite", (s) => s.put(templates, "dayTemplates"));
  },
  async getPayslips(): Promise<PayslipRecord[]> {
    const value = await withStore<PayslipRecord[]>(STORE_KV, "readonly", (s) => s.get("payslips"));
    return normalizePayslips(value ?? []);
  },
  async putPayslips(payslips: PayslipRecord[]): Promise<void> {
    await withStore(STORE_KV, "readwrite", (s) => s.put(payslips, "payslips"));
  },
  async getMeta(key: string): Promise<unknown> {
    const value = await withStore<unknown>(STORE_KV, "readonly", (s) => s.get(key));
    return value ?? null;
  },
  async putMeta(key: string, value: unknown): Promise<void> {
    await withStore(STORE_KV, "readwrite", (s) => s.put(value, key));
  },
};
