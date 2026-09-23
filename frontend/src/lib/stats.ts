// Calculation engine: per-entry hour splits (ordinary vs overtime, holiday,
// night, sunday, standby, travel) with the weekly ordinary cap, plus month/year
// aggregations and the estimated pay breakdown.
import { isoWeekKey, parseISODate } from "./dates";
import { computeShift } from "./hours";
import { holidayName } from "./holidays";
import type { DayEntry, Settings } from "./types";

export interface EntrySplit {
  entry: DayEntry;
  /** minuti netti lavorati (0 per ferie/malattia/permesso/riposo) */
  net: number;
  ordinary: number;
  overtime: number;
  night: number;
  festivo: boolean;
  sunday: boolean;
  holidayName: string | null;
}

export interface PayBreakdown {
  base: number;
  overtime: number;
  holiday: number;
  night: number;
  sunday: number;
  standbyPct: number;
  travelPct: number;
  standbyAllowance: number;
  total: number;
  net: number;
  netEnabled: boolean;
}

export interface Totals {
  netMinutes: number;
  ordinaryMinutes: number;
  overtimeMinutes: number;
  holidayMinutes: number;
  nightMinutes: number;
  workDays: number;
  ferieDays: number;
  malattiaDays: number;
  permessiDays: number;
  rolDays: number;
  exFestivitaDays: number;
  riposiDays: number;
  trasferteDays: number;
  reperibilitaDays: number;
  pay: PayBreakdown;
}

/**
 * Stima progressiva della sola retribuzione mensile di riferimento.
 * È disponibile esclusivamente quando importo e ore mensili sono stati
 * confermati dall'utente; non viene trasformata in una paga oraria.
 */
export function monthlyReferenceEstimate(totals: Totals, settings: Settings): number | null {
  const referenceHours = settings.payslipReferenceHours ?? 0;
  if (settings.monthlyReferencePay <= 0 || referenceHours <= 0) return null;
  const progress = Math.min(1, Math.max(0, totals.ordinaryMinutes / 60 / referenceHours));
  return Math.round(settings.monthlyReferencePay * progress * 100) / 100;
}

export function isFestivoDay(entry: DayEntry, settings: Settings): boolean {
  if (entry.festivo === true) return true;
  if (entry.festivo === false) return false;
  return holidayName(entry.date, settings) !== null;
}

export function entryNetMinutes(entry: DayEntry): number {
  if (entry.dayType !== "lavoro") return 0;
  if (entry.scheduledOrdinaryMinutes !== undefined) {
    return Math.max(0, entry.scheduledOrdinaryMinutes) + Math.max(0, entry.manualOvertimeMinutes ?? 0);
  }
  const shift = computeShift(entry.start, entry.end, entry.breakMinutes);
  if (!shift) return 0;
  return Math.max(0, shift.net);
}

/**
 * Walks the entries in date order applying the weekly ordinary-hours cap:
 * each entry's ordinary hours are the minimum between the daily ordinary
 * limit and what is left of the weekly limit for its ISO week.
 */
export function computeSplits(days: DayEntry[], settings: Settings): EntrySplit[] {
  const sorted = [...days].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
  );
  const dailyLimit = Math.max(0, settings.dailyOrdinaryHours) * 60;
  const weeklyLimit = Math.max(0, settings.weeklyOrdinaryHours) * 60;
  let weekKey = "";
  let weeklyRemaining = weeklyLimit;

  return sorted.map((entry) => {
    const wk = isoWeekKey(entry.date);
    if (wk !== weekKey) {
      weekKey = wk;
      weeklyRemaining = weeklyLimit;
    }
    const festivo = isFestivoDay(entry, settings);
    const sunday = parseISODate(entry.date).getDay() === 0;
    const name = holidayName(entry.date, settings);
    if (entry.dayType !== "lavoro") {
      return {
        entry,
        net: 0,
        ordinary: 0,
        overtime: 0,
        night: 0,
        festivo,
        sunday,
        holidayName: name,
      };
    }
    const net = entryNetMinutes(entry);
    const plannedOrdinary = entry.scheduledOrdinaryMinutes ?? net;
    const ordinary = Math.max(0, Math.min(plannedOrdinary, dailyLimit, weeklyRemaining));
    weeklyRemaining -= ordinary;
    return {
      entry,
      net,
      ordinary,
      overtime: Math.max(0, net - ordinary),
      night: entry.notturno ? net : 0,
      festivo,
      sunday,
      holidayName: name,
    };
  });
}

function buildPay(
  minutes: {
    net: number;
    overtime: number;
    holiday: number;
    night: number;
    sunday: number;
    standby: number;
    travel: number;
  },
  reperibilitaDays: number,
  settings: Settings,
): PayBreakdown {
  const h = (m: number) => m / 60;
  const base = h(minutes.net) * settings.basePay;
  const overtime = h(minutes.overtime) * settings.basePay * (settings.overtimePct / 100);
  const holiday = h(minutes.holiday) * settings.basePay * (settings.holidayPct / 100);
  const night = h(minutes.night) * settings.basePay * (settings.nightPct / 100);
  const sunday = h(minutes.sunday) * settings.basePay * (settings.sundayPct / 100);
  const standbyPct = h(minutes.standby) * settings.basePay * (settings.reperibilitaPct / 100);
  const travelPct = h(minutes.travel) * settings.basePay * (settings.trasfertaPct / 100);
  const standbyAllowance = reperibilitaDays * settings.reperibilitaEuroPerDay;
  const total = base + overtime + holiday + night + sunday + standbyPct + travelPct + standbyAllowance;
  const net = settings.netEnabled ? total * (1 - settings.netPct / 100) : 0;
  return {
    base,
    overtime,
    holiday,
    night,
    sunday,
    standbyPct,
    travelPct,
    standbyAllowance,
    total,
    net,
    netEnabled: settings.netEnabled,
  };
}

export function summarize(splits: EntrySplit[], settings: Settings): Totals {
  const work = new Set<string>();
  const ferie = new Set<string>();
  const malattia = new Set<string>();
  const permessi = new Set<string>();
  const rol = new Set<string>();
  const exFestivita = new Set<string>();
  const riposi = new Set<string>();
  const reperibilita = new Set<string>();
  const trasferte = new Set<string>();
  const minutes = { net: 0, overtime: 0, holiday: 0, night: 0, sunday: 0, standby: 0, travel: 0 };
  let ordinaryMinutes = 0;

  for (const s of splits) {
    minutes.net += s.net;
    minutes.overtime += s.overtime;
    ordinaryMinutes += s.ordinary;
    if (s.festivo) minutes.holiday += s.net;
    else if (s.sunday) minutes.sunday += s.net;
    minutes.night += s.night;
    const d = s.entry.date;
    if (s.entry.dayType === "lavoro") {
      if (s.net > 0) work.add(d);
      if (s.entry.reperibilita) {
        reperibilita.add(d);
        minutes.standby += s.net;
      }
      if (s.entry.trasferta) {
        trasferte.add(d);
        minutes.travel += s.net;
      }
    } else if (s.entry.dayType === "ferie") ferie.add(d);
    else if (s.entry.dayType === "malattia") malattia.add(d);
    else if (s.entry.dayType === "permesso") permessi.add(d);
    else if (s.entry.dayType === "rol") rol.add(d);
    else if (s.entry.dayType === "ex_festivita") exFestivita.add(d);
    else riposi.add(d);
  }

  return {
    netMinutes: minutes.net,
    ordinaryMinutes,
    overtimeMinutes: minutes.overtime,
    holidayMinutes: minutes.holiday,
    nightMinutes: minutes.night,
    workDays: work.size,
    ferieDays: ferie.size,
    malattiaDays: malattia.size,
    permessiDays: permessi.size,
    rolDays: rol.size,
    exFestivitaDays: exFestivita.size,
    riposiDays: riposi.size,
    trasferteDays: trasferte.size,
    reperibilitaDays: reperibilita.size,
    pay: buildPay(minutes, reperibilita.size, settings),
  };
}

export function emptyTotals(): Totals {
  return {
    netMinutes: 0,
    ordinaryMinutes: 0,
    overtimeMinutes: 0,
    holidayMinutes: 0,
    nightMinutes: 0,
    workDays: 0,
    ferieDays: 0,
    malattiaDays: 0,
    permessiDays: 0,
    rolDays: 0,
    exFestivitaDays: 0,
    riposiDays: 0,
    trasferteDays: 0,
    reperibilitaDays: 0,
    pay: {
      base: 0,
      overtime: 0,
      holiday: 0,
      night: 0,
      sunday: 0,
      standbyPct: 0,
      travelPct: 0,
      standbyAllowance: 0,
      total: 0,
      net: 0,
      netEnabled: false,
    },
  };
}

export function statsForMonth(
  days: DayEntry[],
  settings: Settings,
  year: number,
  month: number,
): Totals {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const splits = computeSplits(days, settings).filter((s) => s.entry.date.startsWith(prefix));
  return summarize(splits, settings);
}

export interface YearStats {
  months: Totals[];
  year: Totals;
}

export function statsForYear(days: DayEntry[], settings: Settings, year: number): YearStats {
  const months = Array.from({ length: 12 }, (_, i) => statsForMonth(days, settings, year, i + 1));
  const splits = computeSplits(days, settings).filter((s) => s.entry.date.startsWith(String(year)));
  return { months, year: summarize(splits, settings) };
}
