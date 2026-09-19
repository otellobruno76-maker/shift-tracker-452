// Time math and Italian formatting (24h, "11h30", euro).

/** "06:00" → 360, invalid → null */
export function timeToMinutes(t: string): number | null {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** 690 → "11h30", 480 → "8h", 45 → "0h45" */
export function fmtHours(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h}h` : `${h}h${String(mm).padStart(2, "0")}`;
}

/** +4h30 / -2h */
export function fmtSignedHours(minutes: number): string {
  return `${minutes >= 0 ? "+" : "-"}${fmtHours(Math.abs(minutes))}`;
}

export function fmtEUR(value: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value);
}

export function fmtNumberIt(value: number, decimals = 2): string {
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value);
}

export interface ShiftResult {
  gross: number;
  net: number;
  overnight: boolean;
}

/**
 * netto = fine - inizio - pausa. When the end time is earlier than (or equal to)
 * the start time the shift is assumed to cross midnight (e.g. 21:00–05:00).
 * Returns null when the times are invalid or inizio === fine.
 */
export function computeShift(start: string, end: string, breakMinutes: number): ShiftResult | null {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s === null || e === null) return null;
  let raw = e - s;
  if (raw === 0) return null;
  const overnight = raw < 0;
  if (overnight) raw += 1440;
  return { gross: raw, net: raw - breakMinutes, overnight };
}

/**
 * Minutes of the shift falling in the night window (22:00–06:00). Used only to
 * auto-suggest the "Lavoro notturno" checkbox in the entry form.
 */
export function nightWindowMinutes(start: string, end: string): number {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s === null || e === null) return 0;
  let raw = e - s;
  if (raw <= 0) raw += 1440;
  const from = s;
  const to = s + raw;
  const windows: Array<[number, number]> = [
    [0, 360], // 00:00–06:00 (stesso giorno)
    [1320, 1440], // 22:00–24:00
    [1440, 1800], // 00:00–06:00 (giorno successivo)
  ];
  let total = 0;
  for (const [a, b] of windows) {
    const overlap = Math.min(to, b) - Math.max(from, a);
    if (overlap > 0) total += overlap;
  }
  return Math.min(total, raw);
}
