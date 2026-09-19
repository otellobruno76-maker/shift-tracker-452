// Italian national holidays (computed for any year) + optional patronal festival.
import { toISODate } from "./dates";
import type { Settings } from "./types";

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

/** Anonymous Gregorian algorithm — Easter Sunday for a given year. */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// [mese, giorno, nome] — festività nazionali italiane a data fissa
const FIXED: Array<[number, number, string]> = [
  [1, 1, "Capodanno"],
  [1, 6, "Epifania"],
  [4, 25, "Festa della Liberazione"],
  [5, 1, "Festa del Lavoro"],
  [6, 2, "Festa della Repubblica"],
  [8, 15, "Ferragosto"],
  [11, 1, "Ognissanti"],
  [12, 8, "Immacolata Concezione"],
  [12, 25, "Natale"],
  [12, 26, "Santo Stefano"],
];

const cache = new Map<number, Holiday[]>();

export function nationalHolidays(year: number): Holiday[] {
  const hit = cache.get(year);
  if (hit) return hit;
  const list: Holiday[] = FIXED.map(([m, d, name]) => ({
    date: toISODate(new Date(year, m - 1, d)),
    name,
  }));
  const easter = easterSunday(year);
  const pasquetta = new Date(easter);
  pasquetta.setDate(easter.getDate() + 1);
  list.push({ date: toISODate(easter), name: "Pasqua" });
  list.push({ date: toISODate(pasquetta), name: "Lunedì dell'Angelo" });
  list.sort((x, y) => x.date.localeCompare(y.date));
  cache.set(year, list);
  return list;
}

export function patronalDate(year: number, settings: Settings): string | null {
  if (!settings.patronalMonth || !settings.patronalDay) return null;
  return toISODate(new Date(year, settings.patronalMonth - 1, settings.patronalDay));
}

/** Name of the holiday on a date, or null when it is not a holiday. */
export function holidayName(iso: string, settings: Settings): string | null {
  const year = Number(iso.slice(0, 4));
  const nat = nationalHolidays(year).find((h) => h.date === iso);
  if (nat) return nat.name;
  if (patronalDate(year, settings) === iso) {
    const name = settings.patronalName.trim();
    return name ? name : "Festività patronale";
  }
  return null;
}

export function isHoliday(iso: string, settings: Settings): boolean {
  return holidayName(iso, settings) !== null;
}
