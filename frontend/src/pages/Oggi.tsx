import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarClock, Copy, Plus } from "lucide-react";
import DemoBanner from "@/components/DemoBanner";
import MonthNav from "@/components/MonthNav";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { currentMonthKey, fmtDateIt, parseMonthKey, todayISO } from "@/lib/dates";
import { fmtEUR, fmtHours } from "@/lib/hours";
import { entryNetMinutes, monthlyReferenceEstimate, statsForMonth } from "@/lib/stats";
import { useDays, useSettings } from "@/lib/store";
import { DAY_TYPE_LABELS } from "@/lib/types";
import type { DayEntry } from "@/lib/types";

export default function Oggi() {
  const days = useDays();
  const settings = useSettings();
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const { year, month } = parseMonthKey(selectedMonth);
  const totals = useMemo(
    () => statsForMonth(days, settings, year, month),
    [days, settings, year, month],
  );
  const monthlyEstimate = monthlyReferenceEstimate(totals, settings);
  const today = todayISO();
  const todayEntries = days.filter((d) => d.date === today);
  const todayNet = todayEntries.reduce((sum, d) => sum + entryNetMinutes(d), 0);
  const recent = useMemo(
    () =>
      days.filter((entry) => entry.date.startsWith(selectedMonth))
        .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)),
    [days, selectedMonth],
  );

  return (
    <div>
      <header className="pt-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#0284C7]">
          Registro Ore Lavoro
        </p>
        <h1
          className="mt-1 text-2xl font-extrabold tracking-tight text-[#0F172A]"
          data-testid="worker-name"
        >
          {settings.workerName || (
            <Link to="/impostazioni" className="underline decoration-[#94A3B8]">
              Imposta il tuo nome
            </Link>
          )}
        </h1>
        <p className="text-sm text-[#4B5563]" data-testid="worker-company">
          {settings.company || "Azienda non impostata"}
        </p>
        <div className="mt-3">
          <MonthNav value={selectedMonth} onChange={setSelectedMonth} />
        </div>
      </header>

      <DemoBanner />

      <section
        className="mt-4 flex items-center justify-between rounded-2xl border border-[#E2E5EA] bg-white p-4 shadow-sm"
        data-testid="today-card"
      >
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[#64748B]">
            Oggi · {fmtDateIt(today)}
          </p>
          {todayEntries.length === 0 ? (
            <p className="mt-1 text-sm text-[#64748B]" data-testid="today-empty">
              Nessuna ora registrata oggi.
            </p>
          ) : (
            <p className="mt-1 text-lg font-extrabold tabular-nums" data-testid="today-hours">
              {fmtHours(todayNet)} lavorate
            </p>
          )}
        </div>
        <CalendarClock className="h-9 w-9 text-[#0284C7]" strokeWidth={1.8} />
      </section>

      <section className="mt-3 rounded-3xl bg-[#0F172A] p-5 text-white shadow-lg" data-testid="primary-metrics">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
          <Metric label="Ore lavorate" value={fmtHours(totals.netMinutes)} testid="metric-total-hours" />
          <Metric label="Ore ordinarie" value={fmtHours(totals.ordinaryMinutes)} testid="metric-regular-hours" />
          <Metric
            label="Ore straordinarie"
            value={fmtHours(totals.overtimeMinutes)}
            testid="metric-overtime-hours"
            amber
          />
          <Metric label="Giorni lavorati" value={String(totals.workDays)} testid="metric-worked-days" />
        </div>
      </section>

      <section className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-[#E2E5EA] bg-white p-4 shadow-sm" data-testid="metric-holiday-hours">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">Ore festive</p>
          <p className="mt-1 text-xl font-extrabold tabular-nums text-[#0F172A]">
            {fmtHours(totals.holidayMinutes)}
          </p>
        </div>
        <div className="rounded-2xl border border-[#E2E5EA] bg-white p-4 shadow-sm" data-testid="metric-night-hours">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">Ore notturne</p>
          <p className="mt-1 text-xl font-extrabold tabular-nums text-[#0F172A]">
            {fmtHours(totals.nightMinutes)}
          </p>
        </div>
      </section>

      <section
        className="mt-3 rounded-2xl border border-[#E2E5EA] bg-white p-5 shadow-sm"
        data-testid="estimated-wage-card"
      >
        <p className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
          Stima compenso del mese
        </p>
        <p
          className="mt-1 text-3xl font-extrabold tabular-nums text-[#0F172A]"
          data-testid="metric-estimated-wage"
        >
          {settings.basePay > 0 ? fmtEUR(totals.pay.total) : monthlyEstimate !== null ? fmtEUR(monthlyEstimate) : "—"}
        </p>
        {settings.basePay <= 0 && monthlyEstimate === null && (
          <p className="mt-1 text-sm text-[#B45309]">
            Imposta la paga oraria oppure retribuzione e ore mensili di riferimento per vedere la stima.
          </p>
        )}
        {settings.basePay <= 0 && monthlyEstimate !== null && <p className="mt-1 text-xs text-[#64748B]">STIMA DELL’APP maturata sulle ore ordinarie registrate. Non è un importo letto dal cedolino.</p>}
        {settings.basePay > 0 && totals.pay.netEnabled && (
          <p className="mt-1 text-sm font-bold text-[#15803D]" data-testid="estimated-net-wage">
            Stima netto: {fmtEUR(totals.pay.net)}
          </p>
        )}
        <p className="mt-2 text-xs text-[#64748B]">Stima indicativa, non sostituisce la busta paga.</p>
      </section>

      <Link
        to={`/inserisci?data=${selectedMonth === today.slice(0, 7) ? today : `${selectedMonth}-01`}`}
        data-testid="btn-add-entry-main"
        className={buttonVariants({
          className: "mt-4 h-16 w-full rounded-2xl text-lg font-extrabold shadow-lg",
        })}
      >
        <Plus className="mr-2 h-6 w-6" />
        Inserisci giornata
      </Link>

      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[#64748B]">Giornate del mese</h2>
        <div className="mt-2 max-h-96 space-y-2 overflow-y-auto">
          {recent.length === 0 && (
            <p
              className="rounded-2xl border border-[#E2E5EA] bg-white p-4 text-sm text-[#64748B]"
              data-testid="recent-empty"
            >
              Nessuna giornata ancora: premi "Inserisci giornata" per iniziare.
            </p>
          )}
          {recent.map((entry) => (
            <RecentRow key={entry.id} entry={entry} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  testid,
  amber,
}: {
  label: string;
  value: string;
  testid: string;
  amber?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">{label}</p>
      <p
        className={`mt-1 text-2xl font-extrabold tracking-tight tabular-nums ${
          amber ? "text-[#FBBF24]" : "text-white"
        }`}
        data-testid={testid}
      >
        {value}
      </p>
    </div>
  );
}

function RecentRow({ entry }: { entry: DayEntry }) {
  const navigate = useNavigate();
  const net = entryNetMinutes(entry);
  return (
    <div
      className="flex items-center gap-3 rounded-2xl border border-[#E2E5EA] bg-white p-3 shadow-sm"
      data-testid={`recent-row-${entry.id}`}
    >
      <button
        className="min-w-0 flex-1 text-left"
        data-testid={`open-day-${entry.id}`}
        onClick={() => navigate(`/inserisci?id=${entry.id}`)}
      >
        <p className="text-sm font-bold text-[#0F172A]">
          {fmtDateIt(entry.date)}{" "}
          <span className="font-medium text-[#64748B]">· {DAY_TYPE_LABELS[entry.dayType]}</span>
        </p>
        <p className="text-xs tabular-nums text-[#64748B]">
          {entry.dayType === "lavoro" && entry.start
            ? `${entry.start}–${entry.end}${entry.breakMinutes ? ` · pausa ${entry.breakMinutes} min` : ""}`
            : DAY_TYPE_LABELS[entry.dayType]}
        </p>
      </button>
      <div className="shrink-0 text-right">
        {entry.dayType === "lavoro" && net > 0 ? (
          <p className="font-extrabold tabular-nums text-[#0F172A]">{fmtHours(net)}</p>
        ) : (
          <Badge variant="secondary">{DAY_TYPE_LABELS[entry.dayType]}</Badge>
        )}
      </div>
      <Link
        to={`/inserisci?copia=${entry.id}`}
        className={buttonVariants({ variant: "outline", size: "icon-sm" })}
        data-testid={`copy-day-${entry.id}`}
        aria-label="Copia giornata"
      >
        <Copy className="h-4 w-4" />
      </Link>
    </div>
  );
}
