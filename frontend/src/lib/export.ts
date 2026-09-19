// Download helpers for the three exports: CSV, simple PDF
// ("Riepilogo Presenze e Stima Retribuzione") and JSON backup.
import { buildMonthCSV } from "./csv";
import { fmtDateIt, monthLabel, parseMonthKey, weekdayShort } from "./dates";
import { fmtEUR, fmtHours } from "./hours";
import { buildPdf, type PdfCell, type PdfLine } from "./pdf";
import { computeSplits, statsForMonth } from "./stats";
import { exportBackupPayload, importBackup } from "./store";
import { DAY_TYPE_LABELS, type DayEntry, type Settings } from "./types";

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportMonthCSV(days: DayEntry[], settings: Settings, monthKeyValue: string): void {
  const { year, month } = parseMonthKey(monthKeyValue);
  const csv = buildMonthCSV(days, settings, year, month);
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `registro-ore-${monthKeyValue}.csv`);
}

export function exportBackupFile(): void {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(
    new Blob([exportBackupPayload()], { type: "application/json" }),
    `registro-ore-backup-${stamp}.json`,
  );
}

export async function importBackupFile(file: File): Promise<boolean> {
  try {
    const data = JSON.parse(await file.text());
    return importBackup(data);
  } catch {
    return false;
  }
}

function monthPdfLines(days: DayEntry[], settings: Settings, monthKeyValue: string): PdfLine[] {
  const { year, month } = parseMonthKey(monthKeyValue);
  const prefix = monthKeyValue;
  const totals = statsForMonth(days, settings, year, month);
  const splits = computeSplits(days, settings).filter((s) => s.entry.date.startsWith(prefix));
  const pay = totals.pay;
  const cell = (text: string, x: number): PdfCell => ({ text, x });
  const row = (label: string, value: string, opts: { bold?: boolean; size?: number; before?: number } = {}): PdfLine => ({
    cells: [cell(label, MARGIN_LABEL), cell(value, 200)],
    size: opts.size ?? 9,
    bold: opts.bold,
    after: 1.5,
    before: opts.before,
  });
  const MARGIN_LABEL = 48;

  const lines: PdfLine[] = [
    { text: "Registro Ore Lavoro", size: 17, bold: true, after: 1 },
    { text: "Riepilogo Presenze e Stima Retribuzione", size: 11, bold: true, after: 8 },
    {
      text: `Lavoratore: ${settings.workerName || "-"}   ·   Azienda: ${settings.company || "-"}`,
      size: 9,
      after: 1,
    },
    { text: `Mese: ${monthLabel(year, month)}`, size: 9, after: 5 },
    { rule: true, after: 6 },
    { text: "Dettaglio giornaliero", size: 10, bold: true, after: 3 },
    {
      cells: [
        cell("Data", 48),
        cell("Tipo", 98),
        cell("Orario", 150),
        cell("Ore", 218),
        cell("Straord.", 258),
        cell("Note", 310),
      ],
      size: 7.5,
      bold: true,
      after: 2,
    },
  ];

  for (const s of splits) {
    const e = s.entry;
    const orario = e.dayType === "lavoro" && e.start ? `${e.start}-${e.end}` : "-";
    lines.push({
      size: 8.5,
      after: 1.5,
      cells: [
        cell(fmtDateIt(e.date), 48),
        cell(DAY_TYPE_LABELS[e.dayType], 98),
        cell(orario, 150),
        cell(s.net > 0 ? fmtHours(s.net) : "", 218),
        cell(s.overtime > 0 ? `+${fmtHours(s.overtime)}` : "", 258),
        cell((e.note || "").replace(/\s+/g, " ").slice(0, 42), 310),
      ],
    });
  }

  lines.push({ rule: true, before: 4, after: 4 });
  lines.push({ text: "Totali del mese", size: 10, bold: true, after: 3 });
  const totalRows: Array<[string, string]> = [
    ["Giorni lavorati", String(totals.workDays)],
    ["Ore totali", fmtHours(totals.netMinutes)],
    ["Ore ordinarie", fmtHours(totals.ordinaryMinutes)],
    ["Ore straordinarie", fmtHours(totals.overtimeMinutes)],
    ["Ore festive", fmtHours(totals.holidayMinutes)],
    ["Ore notturne", fmtHours(totals.nightMinutes)],
    ["Ferie", `${totals.ferieDays} giorni`],
    ["Malattia", `${totals.malattiaDays} giorni`],
    ["Permessi", `${totals.permessiDays} giorni`],
    ["Reperibilità", `${totals.reperibilitaDays} giorni`],
    ["Trasferte", `${totals.trasferteDays} giorni`],
  ];
  for (const [label, value] of totalRows) lines.push(row(label, value));

  lines.push({ rule: true, before: 4, after: 4 });
  lines.push({ text: "Stima retribuzione", size: 10, bold: true, after: 3 });
  lines.push(row("Compenso base", fmtEUR(pay.base)));
  lines.push(row(`Maggiorazione straordinario (${settings.overtimePct}%)`, fmtEUR(pay.overtime)));
  lines.push(row(`Maggiorazione festivo (${settings.holidayPct}%)`, fmtEUR(pay.holiday)));
  lines.push(row(`Maggiorazione notturna (${settings.nightPct}%)`, fmtEUR(pay.night)));
  lines.push(row(`Maggiorazione domenicale (${settings.sundayPct}%)`, fmtEUR(pay.sunday)));
  lines.push(row(`Maggiorazione reperibilità (${settings.reperibilitaPct}%)`, fmtEUR(pay.standbyPct)));
  lines.push(row(`Maggiorazione trasferta (${settings.trasfertaPct}%)`, fmtEUR(pay.travelPct)));
  lines.push(
    row(
      `Indennità reperibilità (${settings.reperibilitaEuroPerDay} €/giorno)`,
      fmtEUR(pay.standbyAllowance),
    ),
  );
  lines.push(row("Totale stimato", fmtEUR(pay.total), { bold: true, size: 11, before: 4 }));
  if (pay.netEnabled) {
    lines.push(row(`Stima netto (trattenute ${settings.netPct}%)`, fmtEUR(pay.net), { bold: true }));
  }
  lines.push({
    text: "Stima indicativa: non è un cedolino paga e non sostituisce la busta paga.",
    size: 8,
    before: 8,
  });

  return lines;
}

export function exportMonthPDF(days: DayEntry[], settings: Settings, monthKeyValue: string): void {
  downloadBlob(
    buildPdf(monthPdfLines(days, settings, monthKeyValue)),
    `riepilogo-presenze-${monthKeyValue}.pdf`,
  );
}

export function weekdayLabel(iso: string): string {
  return weekdayShort(iso);
}
