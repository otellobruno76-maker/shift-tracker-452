import type { DayEntry, DayTemplate, DayType } from "./types";
import { uid } from "./types";

export function inclusiveDateRange(first: string, last: string): string[] {
  const [start, end] = first <= last ? [first, last] : [last, first];
  const dates: string[] = [];
  const cursor = new Date(`${start}T12:00:00`);
  const finish = new Date(`${end}T12:00:00`);
  while (cursor <= finish) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export interface BulkDayValues {
  dayType: DayType;
  start: string;
  end: string;
  breakMinutes: number;
  notturno?: boolean;
  reperibilita?: boolean;
  trasferta?: boolean;
  note?: string;
}

export function valuesFromTemplate(template: DayTemplate): BulkDayValues {
  return {
    dayType: template.dayType,
    start: template.start,
    end: template.end,
    breakMinutes: template.breakMinutes,
    notturno: template.notturno,
    reperibilita: template.reperibilita,
    trasferta: template.trasferta,
    note: template.note,
  };
}

export function buildBulkEntries(dates: string[], values: BulkDayValues, now = new Date().toISOString()): DayEntry[] {
  const isWork = values.dayType === "lavoro";
  return dates.map((date) => ({
    id: uid(),
    date,
    dayType: values.dayType,
    start: isWork ? values.start : "",
    end: isWork ? values.end : "",
    breakMinutes: isWork ? values.breakMinutes : 0,
    notturno: isWork ? Boolean(values.notturno) : false,
    reperibilita: isWork ? Boolean(values.reperibilita) : false,
    trasferta: isWork ? Boolean(values.trasferta) : false,
    festivo: null,
    note: values.note?.trim() ?? "",
    createdAt: now,
    updatedAt: now,
  }));
}
