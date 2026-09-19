// Demo data ("DATI DI PROVA"), generated relative to the current month so the
// calendar and the summaries look alive on first run. Removable with one tap.
import { toISODate } from "./dates";
import { nationalHolidays } from "./holidays";
import { DEFAULT_SETTINGS, uid, type DayEntry, type Settings } from "./types";

export const DEMO_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  workerName: "Mario Rossi",
  company: "Edil Costruzioni S.r.l.",
  basePay: 12.5,
  overtimePct: 25,
  holidayPct: 30,
  nightPct: 20,
  sundayPct: 15,
  reperibilitaPct: 10,
  trasfertaPct: 10,
  reperibilitaEuroPerDay: 15,
  netEnabled: true,
  netPct: 25,
};

export function buildDemoData(): { days: DayEntry[]; settings: Settings } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  const today = now.getDate();
  const iso = (day: number) => toISODate(new Date(year, month, day));
  const stamp = new Date().toISOString();
  const days: DayEntry[] = [];
  const used = new Set<number>();

  const push = (day: number, p: Omit<DayEntry, "id" | "date" | "createdAt" | "updatedAt">) => {
    days.push({ id: uid(), date: iso(day), createdAt: stamp, updatedAt: stamp, ...p });
    used.add(day);
  };

  const vuoto = { start: "", end: "", breakMinutes: 0, notturno: false, reperibilita: false, trasferta: false, festivo: null, note: "" };
  const lavoro = { ...vuoto, dayType: "lavoro" as const, breakMinutes: 30 };

  // Dalla giornata più recente a ritroso: una varietà di esempi realistici
  const specs: Array<(day: number) => void> = [
    (d) => push(d, { ...lavoro, start: "06:00", end: "18:00", trasferta: true, note: "Intervento Alessandria" }),
    (d) => push(d, { ...lavoro, start: "08:00", end: "17:00", breakMinutes: 60, note: "Cantiere Torino" }),
    (d) => push(d, { ...lavoro, start: "06:00", end: "19:00", note: "Cantiere Torino" }),
    (d) => push(d, { ...lavoro, start: "21:00", end: "05:00", notturno: true, note: "Turno notturno magazzino" }),
    (d) => push(d, { ...vuoto, dayType: "riposo" }),
    (d) => push(d, { ...lavoro, start: "09:00", end: "18:00", breakMinutes: 60, reperibilita: true, note: "Reperibilità centrale" }),
    (d) => push(d, { ...vuoto, dayType: "ferie" }),
    (d) => push(d, { ...lavoro, start: "06:00", end: "13:00", breakMinutes: 0, note: "Sabato ridotto" }),
    (d) => push(d, { ...vuoto, dayType: "malattia" }),
    (d) => push(d, { ...lavoro, start: "07:00", end: "16:00", breakMinutes: 45, trasferta: true, note: "Manutenzione impianto" }),
    (d) => push(d, { ...vuoto, dayType: "permesso" }),
  ];

  let cursor = today;
  for (const spec of specs) {
    while (cursor >= 1 && used.has(cursor)) cursor -= 1;
    if (cursor < 1) break;
    spec(cursor);
    cursor -= 1;
  }

  // Una giornata festiva: usa una vera festività del mese se esiste,
  // altrimenti marca un giorno lavorato come festivo (esempio chiaramente demo).
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const holidayThisMonth = nationalHolidays(year).find((h) => {
    const day = Number(h.date.slice(8, 10));
    return h.date.startsWith(monthPrefix) && day <= today && !used.has(day);
  });
  if (holidayThisMonth) {
    const day = Number(holidayThisMonth.date.slice(8, 10));
    push(day, { ...lavoro, start: "07:00", end: "15:00", note: holidayThisMonth.name });
  } else {
    const lastWork = [...days].reverse().find((d) => d.dayType === "lavoro");
    if (lastWork) {
      lastWork.festivo = true;
      if (!lastWork.note) lastWork.note = "Festività locale (esempio)";
    }
  }

  return { days, settings: { ...DEMO_SETTINGS } };
}
