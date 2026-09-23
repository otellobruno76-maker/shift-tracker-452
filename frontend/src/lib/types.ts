// Shared domain types for Registro Ore Lavoro. Data lives on the device
// (IndexedDB); this module is the single source of truth for the shapes.

export type DayType = "lavoro" | "ferie" | "malattia" | "permesso" | "rol" | "ex_festivita" | "riposo";

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
  /** Ore ordinarie inserite in blocco dal calendario, senza obbligo di orario. */
  scheduledOrdinaryMinutes?: number;
  /** Straordinario aggiunto successivamente a una giornata programmata. */
  manualOvertimeMinutes?: number;
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

export interface PayslipRecord {
  id: string;
  /** Mese di competenza in formato YYYY-MM. */
  month: string;
  filename: string;
  payType?: "oraria" | "giornaliera" | "mensile" | "";
  qualification?: string;
  contractCode?: string;
  partTimePct?: number | null;
  basePay: number | null;
  dailyPay?: number | null;
  monthlyPay?: number | null;
  ordinaryHours: number | null;
  dailyOrdinaryHours?: number | null;
  workedHours?: number | null;
  workedDays?: number | null;
  totalElementsPay?: number | null;
  grossTotal?: number | null;
  netTotal?: number | null;
  overtimeHours?: number | null;
  overtimeTariffs?: number[];
  overtimeRates: number[];
  nightPct: number | null;
  holidayPct: number | null;
  allowances: Array<{ name: string; amount: number | null }>;
  ccnl: string;
  level: string;
  totals: Array<{ label: string; value: number }>;
  /** Voci originali del cedolino normalizzate per confronti deterministici. */
  items?: PayslipItem[];
  /** Provenienza dei campi confermati (locale, AI o modifica manuale). */
  fieldProvenance?: Record<string, PayslipFieldProvenance>;
  uploadedAt: string;
  updatedAt: string;
}

export type PayslipItemCategory =
  | "ordinary" | "overtime" | "holiday" | "night" | "vacation"
  | "permission" | "rol" | "former_holiday" | "sickness" | "absence"
  | "allowance" | "gross" | "earnings" | "deductions" | "net" | "other";
export type PayslipItemUnit = "hours" | "days" | "euro" | "percent" | "unknown";
export type PayslipDataSource = "registro" | "locale" | "ai" | "manuale";

export interface PayslipItem {
  originalDescription: string;
  category: PayslipItemCategory;
  quantity: number | null;
  unit: PayslipItemUnit;
  ratePct: number | null;
  amount: number | null;
  confidence: "alta" | "media" | "bassa";
  source: PayslipDataSource;
  note?: string;
}

export interface PayslipFieldProvenance {
  source: PayslipDataSource;
  confidence: "alta" | "media" | "bassa";
  evidence?: string;
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
  /** Retribuzione mensile di riferimento, distinta dalla paga oraria. */
  monthlyReferencePay: number;
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
  /** Dati facoltativi confermati dall'utente dopo la lettura locale del cedolino. */
  overtimeRates: number[];
  payslipReferenceHours: number | null;
  ccnl: string;
  contractLevel: string;
  payslipAllowances: Array<{ name: string; amount: number | null }>;
  payslipConfiguredAt: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  workerName: "",
  company: "",
  dailyOrdinaryHours: 8,
  weeklyOrdinaryHours: 40,
  basePay: 0,
  monthlyReferencePay: 0,
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
  overtimeRates: [],
  payslipReferenceHours: null,
  ccnl: "",
  contractLevel: "",
  payslipAllowances: [],
  payslipConfiguredAt: null,
};

export const DAY_TYPE_LABELS: Record<DayType, string> = {
  lavoro: "Lavoro",
  ferie: "Ferie",
  malattia: "Malattia",
  permesso: "Permesso",
  rol: "ROL",
  ex_festivita: "Ex festività",
  riposo: "Riposo",
};

export const DAY_TYPES: DayType[] = ["lavoro", "ferie", "malattia", "permesso", "rol", "ex_festivita", "riposo"];

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
