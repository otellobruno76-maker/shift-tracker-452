// Date helpers. Dates are stored as "YYYY-MM-DD" strings and parsed as LOCAL
// dates (never `new Date(iso)`, which parses UTC and shifts the day).

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

/** GG/MM/AAAA */
export function fmtDateIt(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function weekdayShort(iso: string): string {
  return new Intl.DateTimeFormat("it-IT", { weekday: "short" }).format(parseISODate(iso));
}

export function weekdayLong(iso: string): string {
  return new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" }).format(
    parseISODate(iso),
  );
}

/** 0 = lunedì … 6 = domenica */
export function weekdayIndex(iso: string): number {
  return (parseISODate(iso).getDay() + 6) % 7;
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parseMonthKey(key: string): { year: number; month: number } {
  const [y, m] = key.split("-").map(Number);
  return { year: y, month: m };
}

export function currentMonthKey(): string {
  const now = new Date();
  return monthKey(now.getFullYear(), now.getMonth() + 1);
}

export function addMonthsKey(key: string, delta: number): string {
  const { year, month } = parseMonthKey(key);
  const d = new Date(year, month - 1 + delta, 1);
  return monthKey(d.getFullYear(), d.getMonth() + 1);
}

/** "Settembre 2026" */
export function monthLabel(year: number, month: number): string {
  const s = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1),
  );
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** ISO day list of the month: "YYYY-MM-DD" for each day */
export function isoDayList(year: number, month: number): string[] {
  const out: string[] = [];
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    out.push(toISODate(new Date(year, month - 1, d)));
  }
  return out;
}

/** ISO year-week key, used to apply the weekly ordinary-hours cap */
export function isoWeekKey(iso: string): string {
  const d = parseISODate(iso);
  const target = new Date(d);
  target.setDate(target.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(target.getFullYear(), 0, 4);
  const week =
    1 +
    Math.round(
      ((target.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7,
    );
  return `${target.getFullYear()}-W${String(week).padStart(2, "0")}`;
}
