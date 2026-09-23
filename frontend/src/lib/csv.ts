// CSV export with the Italian Excel convention: ";" separator, CRLF rows,
// UTF-8 BOM so Excel opens accents correctly.
import { fmtDateIt, monthLabel, weekdayShort } from "./dates";
import { fmtEUR, fmtHours } from "./hours";
import { computeSplits, summarize } from "./stats";
import { DAY_TYPE_LABELS, type DayEntry, type Settings } from "./types";

function esc(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildMonthCSV(
  days: DayEntry[],
  settings: Settings,
  year: number,
  month: number,
): string {
  const rows: string[][] = [];
  const sep = ";";
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const splits = computeSplits(days, settings).filter((s) => s.entry.date.startsWith(prefix));
  const t = summarize(splits, settings);
  const pay = t.pay;

  rows.push(["Registro Ore Lavoro"]);
  rows.push(["Riepilogo presenze e stima retribuzione"]);
  rows.push([`Lavoratore: ${settings.workerName || "-"}`]);
  rows.push([`Azienda: ${settings.company || "-"}`]);
  rows.push([`Mese: ${monthLabel(year, month)}`]);
  rows.push([]);
  rows.push([
    "Data",
    "Giorno",
    "Tipo",
    "Inizio",
    "Fine",
    "Pausa (min)",
    "Ore lavorate",
    "Ordinarie",
    "Straordinario",
    "Notturne",
    "Festivo",
    "Reperibilità",
    "Trasferta",
    "Note",
  ]);

  for (const s of splits) {
    const e = s.entry;
    const isLavoro = e.dayType === "lavoro";
    rows.push([
      fmtDateIt(e.date),
      weekdayShort(e.date).trim(),
      DAY_TYPE_LABELS[e.dayType],
      isLavoro ? e.start : "",
      isLavoro ? e.end : "",
      isLavoro ? String(e.breakMinutes) : "",
      fmtHours(s.net),
      fmtHours(s.ordinary),
      s.overtime > 0 ? fmtHours(s.overtime) : "",
      s.night > 0 ? fmtHours(s.night) : "",
      s.festivo ? "Sì" : "",
      isLavoro && e.reperibilita ? "Sì" : "",
      isLavoro && e.trasferta ? "Sì" : "",
      e.note || "",
    ]);
  }

  rows.push([]);
  rows.push(["TOTALI DEL MESE"]);
  rows.push(["Giorni lavorati", String(t.workDays)]);
  rows.push(["Ore totali", fmtHours(t.netMinutes)]);
  rows.push(["Ore ordinarie", fmtHours(t.ordinaryMinutes)]);
  rows.push(["Ore straordinarie", fmtHours(t.overtimeMinutes)]);
  rows.push(["Ore festive", fmtHours(t.holidayMinutes)]);
  rows.push(["Ore notturne", fmtHours(t.nightMinutes)]);
  rows.push(["Ferie (giorni)", String(t.ferieDays)]);
  rows.push(["Malattia (giorni)", String(t.malattiaDays)]);
  rows.push(["Permessi (giorni)", String(t.permessiDays)]);
  rows.push(["ROL (giorni)", String(t.rolDays)]);
  rows.push(["Ex festività (giorni)", String(t.exFestivitaDays)]);
  rows.push(["Riposo (giorni)", String(t.riposiDays)]);
  rows.push(["Reperibilità (giorni)", String(t.reperibilitaDays)]);
  rows.push(["Trasferte (giorni)", String(t.trasferteDays)]);

  rows.push([]);
  rows.push(["STIMA RETRIBUZIONE"]);
  rows.push(["Compenso base", fmtEUR(pay.base)]);
  rows.push([`Maggiorazione straordinario (${settings.overtimePct}%)`, fmtEUR(pay.overtime)]);
  rows.push([`Maggiorazione festivo (${settings.holidayPct}%)`, fmtEUR(pay.holiday)]);
  rows.push([`Maggiorazione notturna (${settings.nightPct}%)`, fmtEUR(pay.night)]);
  rows.push([`Maggiorazione domenicale (${settings.sundayPct}%)`, fmtEUR(pay.sunday)]);
  rows.push([`Maggiorazione reperibilità (${settings.reperibilitaPct}%)`, fmtEUR(pay.standbyPct)]);
  rows.push([`Maggiorazione trasferta (${settings.trasfertaPct}%)`, fmtEUR(pay.travelPct)]);
  rows.push([`Indennità reperibilità (${settings.reperibilitaEuroPerDay} €/giorno)`, fmtEUR(pay.standbyAllowance)]);
  rows.push(["Totale stimato", fmtEUR(pay.total)]);
  if (pay.netEnabled) {
    rows.push([`Stima netto (trattenute ${settings.netPct}%)`, fmtEUR(pay.net)]);
  }
  rows.push([]);
  rows.push(["Nota: stima indicativa, non è un cedolino paga e non sostituisce la busta paga."]);

  return "\uFEFF" + rows.map((r) => r.map(esc).join(sep)).join("\r\n");
}
