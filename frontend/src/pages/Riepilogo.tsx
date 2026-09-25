import { useMemo } from "react";
import { Archive, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import MonthNav from "@/components/MonthNav";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { monthLabel, parseMonthKey } from "@/lib/dates";
import { useActiveMonth } from "@/lib/activeMonth";
import { exportBackupFile, exportMonthCSV, exportMonthPDF } from "@/lib/export";
import { fmtEUR, fmtHours } from "@/lib/hours";
import { monthlyReferenceEstimate, statsForMonth, statsForYear } from "@/lib/stats";
import { compareMonthWithPayslip, type ComparisonRow } from "@/lib/payslipComparison";
import { useDays, usePayslips, useSettings } from "@/lib/store";
import { MONTHS_IT } from "@/lib/types";

function fmtGiorni(n: number): string {
  return `${n} ${n === 1 ? "giorno" : "giorni"}`;
}

export default function Riepilogo() {
  const days = useDays();
  const settings = useSettings();
  const payslips = usePayslips();
  const [selectedMonth, setSelectedMonth] = useActiveMonth();
  const { year, month } = parseMonthKey(selectedMonth);
  const totals = useMemo(
    () => statsForMonth(days, settings, year, month),
    [days, settings, year, month],
  );
  const yearStats = useMemo(() => statsForYear(days, settings, year), [days, settings, year]);
  const pay = totals.pay;
  const monthlyEstimate = monthlyReferenceEstimate(totals, settings);
  const payslip = payslips.find((item) => item.month === selectedMonth);
  const comparison = useMemo(() => payslip ? compareMonthWithPayslip(totals, payslip, settings) : [], [payslip, totals, settings]);

  const oreRows: Array<[string, string, string]> = [
    ["Giorni lavorati", String(totals.workDays), "summary-work-days"],
    ["Ore totali", fmtHours(totals.netMinutes), "summary-total-hours"],
    ["Ore ordinarie", fmtHours(totals.ordinaryMinutes), "summary-ordinary-hours"],
    ["Ore straordinarie", fmtHours(totals.overtimeMinutes), "summary-overtime-hours"],
    ["Ore festive", fmtHours(totals.holidayMinutes), "summary-holiday-hours"],
    ["Ore notturne", fmtHours(totals.nightMinutes), "summary-night-hours"],
    ["Ferie", fmtGiorni(totals.ferieDays), "summary-ferie-days"],
    ["Malattia", fmtGiorni(totals.malattiaDays), "summary-malattia-days"],
    ["Permessi", fmtGiorni(totals.permessiDays), "summary-permessi-days"],
    ["ROL", fmtGiorni(totals.rolDays), "summary-rol-days"],
    ["Ex festività", fmtGiorni(totals.exFestivitaDays), "summary-former-holiday-days"],
    ["Reperibilità", fmtGiorni(totals.reperibilitaDays), "summary-reperibilita-days"],
    ["Trasferte", fmtGiorni(totals.trasferteDays), "summary-trasferte-days"],
  ];

  const payRows: Array<[string, number]> = [
    [`Maggiorazione straordinario (${settings.overtimePct}%)`, pay.overtime],
    [`Maggiorazione festivo (${settings.holidayPct}%)`, pay.holiday],
    [`Maggiorazione notturna (${settings.nightPct}%)`, pay.night],
    [`Maggiorazione domenicale (${settings.sundayPct}%)`, pay.sunday],
    [`Maggiorazione reperibilità (${settings.reperibilitaPct}%)`, pay.standbyPct],
    [`Maggiorazione trasferta (${settings.trasfertaPct}%)`, pay.travelPct],
    [`Indennità reperibilità (${settings.reperibilitaEuroPerDay} €/giorno)`, pay.standbyAllowance],
  ];
  const payRowsVisible = payRows.filter(([, v]) => v !== 0);

  return (
    <div>
      <header className="pt-2">
        <h1
          className="font-heading text-2xl font-extrabold tracking-tight text-[#0F172A]"
          data-testid="riepilogo-title"
        >
          Riepilogo {monthLabel(year, month)}
        </h1>
        <div className="mt-3">
          <MonthNav value={selectedMonth} onChange={setSelectedMonth} />
        </div>
      </header>

      <Tabs defaultValue="mese" className="mt-4">
        <TabsList className="h-12 w-full">
          <TabsTrigger value="mese" className="text-base font-bold" data-testid="tab-mese">
            Mese
          </TabsTrigger>
          <TabsTrigger value="anno" className="text-base font-bold" data-testid="tab-anno">
            Anno
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mese" className="mt-4">
          <section
            className="rounded-2xl border border-[#E2E5EA] bg-white p-5 shadow-sm"
            data-testid="month-summary-card"
          >
            <div>
              {oreRows.map(([label, value, testid]) => (
                <SummaryRow key={label} label={label} value={value} testid={testid} />
              ))}
            </div>
            {totals.netMinutes === 0 && totals.workDays === 0 && totals.ferieDays === 0 && totals.malattiaDays === 0 && totals.permessiDays === 0 && totals.rolDays === 0 && totals.exFestivitaDays === 0 && totals.riposiDays === 0 && (
              <p className="mt-3 text-sm text-[#64748B]" data-testid="month-summary-empty">
                Nessuna giornata registrata in questo mese.
              </p>
            )}
          </section>

          <section
            className="mt-3 rounded-2xl border border-[#E2E5EA] bg-white p-5 shadow-sm"
            data-testid="wage-summary-card"
          >
            <h2 className="font-heading text-lg font-extrabold text-[#0F172A]">
              Compenso stimato
            </h2>
            {settings.basePay <= 0 && settings.monthlyReferencePay <= 0 ? (
              <p className="mt-2 text-sm text-[#B45309]" data-testid="wage-not-configured">
                Imposta la paga oraria o la retribuzione mensile di riferimento per vedere una stima.
              </p>
            ) : (
              <div className="mt-2">
                {settings.basePay <= 0 && settings.monthlyReferencePay > 0 ? (
                  <>
                    <SummaryRow label="Retribuzione mensile di riferimento" value={fmtEUR(settings.monthlyReferencePay)} testid="summary-monthly-reference" />
                    {monthlyEstimate !== null ? (
                      <>
                        <SummaryRow label="STIMA DELL’APP maturata finora" value={fmtEUR(monthlyEstimate)} testid="summary-monthly-estimate" />
                        <p className="mt-2 text-xs text-[#64748B]">Calcolata sulle ore ordinarie registrate rispetto alle {settings.payslipReferenceHours} ore mensili confermate. Non è una paga oraria né un importo letto dal cedolino.</p>
                      </>
                    ) : <p className="mt-2 text-sm text-[#B45309]">Per una stima progressiva servono anche le ore mensili di riferimento confermate.</p>}
                    <p className="mt-2 text-sm text-[#B45309]">Le maggiorazioni orarie non sono stimate perché manca una paga oraria confermata.</p>
                  </>
                ) : <>
                <SummaryRow label="Compenso base" value={fmtEUR(pay.base)} testid="summary-pay-base" />
                {payRowsVisible.map(([label, value]) => (
                  <SummaryRow key={label} label={label} value={fmtEUR(value)} testid={`summary-pay-${payRows.findIndex((r) => r[0] === label)}`} />
                ))}
                <div className="my-2 border-t border-[#E2E5EA]" />
                <div className="flex items-center justify-between py-1" data-testid="summary-total-pay">
                  <span className="text-base font-extrabold text-[#0F172A]">Totale stimato</span>
                  <span className="text-xl font-extrabold tabular-nums text-[#0F172A]">
                    {fmtEUR(pay.total)}
                  </span>
                </div>
                {pay.netEnabled && (
                  <div className="flex items-center justify-between py-1" data-testid="summary-net-pay">
                    <span className="text-base font-extrabold text-[#15803D]">
                      Stima netto ({settings.netPct}% trattenute)
                    </span>
                    <span className="text-lg font-extrabold tabular-nums text-[#15803D]">
                      {fmtEUR(pay.net)}
                    </span>
                  </div>
                )}
                {payRowsVisible.length === 0 && (
                  <p className="mt-1 text-xs text-[#64748B]">
                    Nessuna maggiorazione configurata: puoi impostarla in Impostazioni.
                  </p>
                )}
                </>}
              </div>
            )}
            <p className="mt-3 text-xs text-[#64748B]">
              Stima indicativa, non sostituisce la busta paga.
            </p>
          </section>

          <section className="mt-3 rounded-2xl border border-[#E2E5EA] bg-white p-5 shadow-sm" data-testid="payslip-comparison-card">
            <h2 className="font-heading text-lg font-extrabold text-[#0F172A]">Confronto mese e cedolino</h2>
            {!payslip ? <p className="mt-2 text-sm text-[#64748B]">Nessun cedolino salvato per questo mese.</p> : (
              <div className="mt-3 space-y-3">
                {comparison.length === 0 && <p className="text-sm text-[#64748B]">Non calcolabile con i dati disponibili: il cedolino non contiene voci leggibili per il confronto.</p>}
                {comparison.map((row) => <ComparisonItem key={row.key} row={row} />)}
                <p className="text-xs text-[#64748B]">Il confronto segnala possibili differenze da verificare: non stabilisce che il cedolino sia errato.</p>
              </div>
            )}
          </section>

          <section
            className="mt-3 rounded-2xl border border-[#E2E5EA] bg-white p-5 shadow-sm"
            data-testid="export-card"
          >
            <h2 className="font-heading text-lg font-extrabold text-[#0F172A]">
              Esporta Riepilogo Presenze e Stima Retribuzione
            </h2>
            <p className="mt-1 text-sm text-[#64748B]">
              Mese esportato: {monthLabel(year, month)}
            </p>
            <div className="mt-3 grid gap-2">
              <Button
                className="h-14 text-base font-extrabold"
                data-testid="btn-export-csv"
                onClick={() => {
                  exportMonthCSV(days, settings, selectedMonth);
                  toast.success("File CSV scaricato.");
                }}
              >
                <FileSpreadsheet className="mr-2 h-5 w-5" />
                Esporta CSV
              </Button>
              <Button
                variant="outline"
                className="h-14 text-base font-extrabold"
                data-testid="btn-export-pdf"
                onClick={() => {
                  exportMonthPDF(days, settings, selectedMonth);
                  toast.success("Riepilogo PDF scaricato.");
                }}
              >
                <FileText className="mr-2 h-5 w-5" />
                Esporta Riepilogo PDF
              </Button>
              <Button
                variant="outline"
                className="h-14 text-base font-extrabold"
                data-testid="btn-export-backup"
                onClick={() => {
                  exportBackupFile();
                  toast.success("Backup scaricato.");
                }}
              >
                <Archive className="mr-2 h-5 w-5" />
                Esporta Backup JSON
              </Button>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="anno" className="mt-4">
          <div
            className="overflow-hidden rounded-2xl border border-[#E2E5EA] bg-white shadow-sm"
            data-testid="annual-table"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mese</TableHead>
                  <TableHead className="text-right">Ore</TableHead>
                  <TableHead className="text-right">Straord.</TableHead>
                  <TableHead className="text-right">Giorni</TableHead>
                  <TableHead className="text-right">Compenso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {yearStats.months.map((m, i) => (
                  <TableRow key={i} data-testid={`annual-row-${i + 1}`}>
                    <TableCell className="font-medium">{MONTHS_IT[i]}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtHours(m.netMinutes)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtHours(m.overtimeMinutes)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.workDays}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {settings.basePay > 0 ? fmtEUR(m.pay.total) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow data-testid="annual-total-row">
                  <TableCell className="font-extrabold">Totale annuale</TableCell>
                  <TableCell className="text-right font-extrabold tabular-nums">
                    {fmtHours(yearStats.year.netMinutes)}
                  </TableCell>
                  <TableCell className="text-right font-extrabold tabular-nums">
                    {fmtHours(yearStats.year.overtimeMinutes)}
                  </TableCell>
                  <TableCell className="text-right font-extrabold tabular-nums">
                    {yearStats.year.workDays}
                  </TableCell>
                  <TableCell className="text-right font-extrabold tabular-nums">
                    {settings.basePay > 0 ? fmtEUR(yearStats.year.pay.total) : "—"}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          <p className="mt-2 text-xs text-[#64748B]" data-testid="annual-disclaimer">
            Compenso stimato: valore indicativo, non sostituisce la busta paga.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryRow({ label, value, testid }: { label: string; value: string; testid: string }) {
  return (
    <div className="flex items-center justify-between py-1.5" data-testid={testid}>
      <span className="text-[15px] text-[#374151]">{label}</span>
      <span className="font-bold tabular-nums text-[#0F172A]">{value}</span>
    </div>
  );
}

function ComparisonItem({ row }: { row: ComparisonRow }) {
  const appearance = row.status === "coerente"
    ? { icon: "✓", title: "Coerente", className: "border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]" }
    : row.status === "differenza"
      ? { icon: "⚠", title: "Possibile differenza da verificare", className: "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]" }
      : { icon: "?", title: "Non calcolabile con i dati disponibili", className: "border-[#CBD5E1] bg-[#F8FAFC] text-[#475569]" };
  const value = (number: number | null) => number === null ? "dato non individuato" : `${number.toLocaleString("it-IT")} ${row.unit}`;
  return <article className={`rounded-xl border p-3 ${appearance.className}`} data-testid={`comparison-${row.key}`}>
    <h3 className="font-extrabold uppercase tracking-wide">{row.label}</h3>
    <div className="mt-2 grid gap-1 text-sm text-[#334155]"><p>{row.registerLabel ?? "Valore registro / atteso"}: <b>{value(row.registerValue)}</b></p><p>{row.payslipLabel ?? "Dato letto dal cedolino"}: <b>{value(row.payslipValue)}</b></p>{row.difference !== null && <p>Differenza (registro − cedolino): <b>{value(row.difference)}</b></p>}</div>
    <p className="mt-2 text-xs font-semibold uppercase">Risultato del controllo</p>
    <p className="mt-2 font-bold">{appearance.icon} {appearance.title}</p>
    <p className="mt-1 text-sm leading-relaxed">{row.explanation}</p>
    {row.sourceDescription && <p className="mt-1 text-xs">Voce originale: {row.sourceDescription}</p>}
  </article>;
}
