// Promise wrapper over IndexedDB — the ONLY persistence layer of the app
// (local-first: no backend, no cloud). A future cloud-sync feature can hook
// the same interface without touching any UI code.
import type { DayEntry, DayTemplate, PayslipRecord, Settings } from "./types";

const DB_NAME = "registro-ore-lavoro";
const DB_VERSION = 1;
const STORE_DAYS = "days";
const STORE_KV = "kv";

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
      const request = run(store);
      let result: T | undefined;
      if (request) {
        request.onsuccess = () => {
          result = request.result as T;
        };
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB tx failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB tx aborted"));
    });
  } finally {
    db.close();
  }
}

const byDate = (a: DayEntry, b: DayEntry) =>
  a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);

export const repo = {
  async getDays(): Promise<DayEntry[]> {
    try {
      const all = await withStore<DayEntry[]>(STORE_DAYS, "readonly", (s) => s.getAll());
      return (all ?? []).slice().sort(byDate);
    } catch {
      return [];
    }
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
    try {
      const value = await withStore<Settings>(STORE_KV, "readonly", (s) => s.get("settings"));
      return value ?? null;
    } catch {
      return null;
    }
  },
  async putSettings(settings: Settings): Promise<void> {
    await withStore(STORE_KV, "readwrite", (s) => s.put(settings, "settings"));
  },
  async getDayTemplates(): Promise<DayTemplate[]> {
    try {
      const value = await withStore<DayTemplate[]>(STORE_KV, "readonly", (s) =>
        s.get("dayTemplates"),
      );
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  },
  async putDayTemplates(templates: DayTemplate[]): Promise<void> {
    await withStore(STORE_KV, "readwrite", (s) => s.put(templates, "dayTemplates"));
  },
  async getPayslips(): Promise<PayslipRecord[]> {
    try {
      const value = await withStore<PayslipRecord[]>(STORE_KV, "readonly", (s) => s.get("payslips"));
      return (value ?? []).map((record) => ({
        ...record,
        overtimeRates: Array.isArray(record.overtimeRates) ? record.overtimeRates : [],
        overtimeTariffs: Array.isArray(record.overtimeTariffs) ? record.overtimeTariffs : [],
        allowances: Array.isArray(record.allowances) ? record.allowances : [],
        totals: Array.isArray(record.totals) ? record.totals : [],
        items: Array.isArray(record.items) ? record.items : [],
        fieldProvenance: record.fieldProvenance ?? {},
      })).sort((a, b) => b.month.localeCompare(a.month));
    } catch {
      return [];
    }
  },
  async putPayslips(payslips: PayslipRecord[]): Promise<void> {
    await withStore(STORE_KV, "readwrite", (s) => s.put(payslips, "payslips"));
  },
  async getMeta(key: string): Promise<unknown> {
    try {
      const value = await withStore<unknown>(STORE_KV, "readonly", (s) => s.get(key));
      return value ?? null;
    } catch {
      return null;
    }
  },
  async putMeta(key: string, value: unknown): Promise<void> {
    await withStore(STORE_KV, "readwrite", (s) => s.put(value, key));
  },
};
