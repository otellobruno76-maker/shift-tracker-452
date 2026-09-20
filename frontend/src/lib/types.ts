// Shared domain types for Registro Ore Lavoro. Data lives on the device
// (IndexedDB); this module is the single source of truth for the shapes.

export type DayType = "lavoro" | "ferie" | "malattia" | "permesso" | "riposo";

export interface DayEntry {
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  dayType: DayType;
  /** "HH:MM" — empty for non-lavoro days */
  start: string;
  /** "HH:MM" — empty for non-lavoro days */
  end: string;
  breakMinutes: number;
  /** all the shift's hours count as night hours */
  notturno: boolean;
  reperibilita: boolean;
  trasferta: boolean;
  /** true/false = manual override, null = auto (Italian holiday list + patronal) */
  festivo: boolean | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** A reusable shift preset. Dates and calculated holiday state are deliberately excluded. */
export interface DayTemplate {
  id: string;
  name: string;
  dayType: DayType;
  start: string;
  end: string;
  breakMinutes: number;
  notturno: boolean;
  reperibilita: boolean;
  trasferta: boolean;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  workerName: string;
  company: string;
  /** ore ordinarie giornaliere, default 8 */
  dailyOrdinaryHours: number;
  /** ore ordinarie settimanali, default 40 */
  weeklyOrdinaryHours: number;
  /** paga oraria base in €/h */
  basePay: number;
  // maggiorazioni: tutte configurabili dall'utente, default 0 — nessun valore universale
  overtimePct: number;
  holidayPct: number;
  nightPct: number;
  sundayPct: number;
  /** maggiorazione % sulle ore dei giorni con reperibilità */
  reperibilitaPct: number;
  /** maggiorazione % sulle ore dei giorni con trasferta */
  trasfertaPct: number;
  /** indennità di reperibilità in € per giorno */
  reperibilitaEuroPerDay: number;
  /** stima netto mensile (facoltativa, mai un calcolo fiscale ufficiale) */
  netEnabled: boolean;
  /** percentuale indicativa di trattenute */
  netPct: number;
  /** festività patronale locale (ricorrente ogni anno) */
  patronalName: string;
  patronalMonth: number | null;
  patronalDay: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  workerName: "",
  company: "",
  dailyOrdinaryHours: 8,
  weeklyOrdinaryHours: 40,
  basePay: 0,
  overtimePct: 0,
  holidayPct: 0,
  nightPct: 0,
  sundayPct: 0,
  reperibilitaPct: 0,
  trasfertaPct: 0,
  reperibilitaEuroPerDay: 0,
  netEnabled: false,
  netPct: 0,
  patronalName: "",
  patronalMonth: null,
  patronalDay: null,
};

export const DAY_TYPE_LABELS: Record<DayType, string> = {
  lavoro: "Lavoro",
  ferie: "Ferie",
  malattia: "Malattia",
  permesso: "Permesso",
  riposo: "Riposo",
};

export const DAY_TYPES: DayType[] = ["lavoro", "ferie", "malattia", "permesso", "riposo"];

/** pause rapide selezionabili in minuti */
export const BREAK_PRESETS: number[] = [0, 15, 30, 45, 60];

export const MONTHS_IT: string[] = [
  "Gennaio",
  "Febbraio",
  "Marzo",
  "Aprile",
  "Maggio",
  "Giugno",
  "Luglio",
  "Agosto",
  "Settembre",
  "Ottobre",
  "Novembre",
  "Dicembre",
];

export function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
