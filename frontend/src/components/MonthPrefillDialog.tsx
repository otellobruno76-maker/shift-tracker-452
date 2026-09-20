import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarRange, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildBulkEntries } from "@/lib/bulkDays";
import { fmtDateIt } from "@/lib/dates";
import { fmtHours } from "@/lib/hours";
import { datesForMonthPrefill } from "@/lib/monthPrefill";
import { applyBulkEntries, useDays, useSettings } from "@/lib/store";

const WEEKDAYS = ["L", "M", "M", "G", "V", "S", "D"];

interface Props {
  open: boolean;
  monthKey: string;
  initialDates?: string[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export default function MonthPrefillDialog({ open, monthKey, initialDates, onOpenChange, onSaved }: Props) {
  const days = useDays();
  const settings = useSettings();
  const [weekdays, setWeekdays] = useState([0, 1, 2, 3, 4]);
  const [hours, setHours] = useState(String(settings.dailyOrdinaryHours));
  const [excludeWeekends, setExcludeWeekends] = useState(true);
  const [excludeHolidays, setExcludeHolidays] = useState(true);
  const [period, setPeriod] = useState<"month" | "range">(initialDates?.length ? "range" : "month");
  const [startDate, setStartDate] = useState(initialDates?.[0] ?? `${monthKey}-01`);
  const [endDate, setEndDate] = useState(initialDates?.at(-1) ?? `${monthKey}-28`);
  const [overwrite, setOverwrite] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHours(String(settings.dailyOrdinaryHours));
    setOverwrite(false);
    setPeriod(initialDates?.length ? "range" : "month");
    setStartDate(initialDates?.[0] ?? `${monthKey}-01`);
    setEndDate(initialDates?.at(-1) ?? `${monthKey}-28`);
  }, [initialDates, monthKey, open, settings.dailyOrdinaryHours]);

  const candidateDates = useMemo(() => datesForMonthPrefill({
    monthKey,
    weekdays,
    excludeWeekends,
    excludeHolidays,
    startDate: period === "range" ? startDate : undefined,
    endDate: period === "range" ? endDate : undefined,
  }, settings), [endDate, excludeHolidays, excludeWeekends, monthKey, period, settings, startDate, weekdays]);
  const occupied = useMemo(() => [...new Set(days.filter((entry) => candidateDates.includes(entry.date)).map((entry) => entry.date))], [candidateDates, days]);
  const datesToWrite = overwrite ? candidateDates : candidateDates.filter((date) => !occupied.includes(date));
  const minutes = Math.round(Number(hours.replace(",", ".")) * 60);

  const save = () => {
    if (weekdays.length === 0) return toast.error("Scegli almeno un giorno lavorativo.");
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) return toast.error("Controlla le ore ordinarie giornaliere.");
    if (period === "range" && (!startDate || !endDate || startDate > endDate)) return toast.error("Controlla l’intervallo scelto.");
    const entries = buildBulkEntries(datesToWrite, {
      dayType: "lavoro", start: "", end: "", breakMinutes: 0,
    }).map((entry) => ({
      ...entry,
      scheduledOrdinaryMinutes: minutes,
      manualOvertimeMinutes: 0,
      note: "Ore ordinarie precompilate",
    }));
    applyBulkEntries(entries, overwrite ? occupied : []);
    onSaved();
    onOpenChange(false);
    toast.success(`${entries.length} giorni precompilati${occupied.length && !overwrite ? `; ${occupied.length} già presenti non modificati` : ""}.`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto rounded-2xl" data-testid="month-prefill-dialog">
        <DialogHeader><DialogTitle>Precompila mese</DialogTitle><p className="text-sm text-[#64748B]">Inserisci le ore ordinarie abituali in pochi tocchi.</p></DialogHeader>
        <div className="space-y-4">
          <div><Label>Giorni lavorativi abituali</Label><div className="mt-2 grid grid-cols-7 gap-1.5">{WEEKDAYS.map((label, index) => <button key={index} type="button" aria-label={["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"][index]} onClick={() => setWeekdays((current) => current.includes(index) ? current.filter((day) => day !== index) : [...current, index].sort())} className={`h-11 rounded-xl border font-extrabold ${weekdays.includes(index) ? "border-[#0284C7] bg-[#0284C7] text-white" : "border-[#CBD5E1] bg-white"}`}>{label}</button>)}</div></div>
          <div><Label htmlFor="prefill-hours">Ore ordinarie per giorno</Label><Input id="prefill-hours" inputMode="decimal" className="mt-1 h-12 text-base" value={hours} onChange={(event) => setHours(event.target.value)} /></div>
          <label className="flex items-center gap-3 rounded-xl border p-3"><Checkbox checked={excludeWeekends} onCheckedChange={(value) => setExcludeWeekends(value === true)} /><span className="font-bold">Escludi sabato e domenica</span></label>
          <label className="flex items-center gap-3 rounded-xl border p-3"><Checkbox checked={excludeHolidays} onCheckedChange={(value) => setExcludeHolidays(value === true)} /><span className="font-bold">Escludi festività</span></label>
          <div><Label>Periodo da compilare</Label><div className="mt-2 grid grid-cols-2 gap-2"><Button type="button" variant={period === "month" ? "default" : "outline"} className="h-12" onClick={() => setPeriod("month")}>Tutto il mese</Button><Button type="button" variant={period === "range" ? "default" : "outline"} className="h-12" onClick={() => setPeriod("range")}>Intervallo</Button></div></div>
          {period === "range" && <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="prefill-start">Dal</Label><Input id="prefill-start" type="date" className="mt-1 h-12" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div><div><Label htmlFor="prefill-end">Al</Label><Input id="prefill-end" type="date" className="mt-1 h-12" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div></div>}
          <div className="rounded-2xl bg-[#0F172A] p-4 text-white" data-testid="prefill-preview"><div className="flex gap-3"><CalendarRange className="h-5 w-5 text-[#38BDF8]" /><div><p className="font-extrabold">{datesToWrite.length} giorni da compilare</p><p className="text-sm text-[#CBD5E1]">{fmtHours(minutes)} al giorno · {fmtHours(minutes * datesToWrite.length)} ordinarie</p>{candidateDates.length > 0 && <p className="mt-1 text-xs text-[#94A3B8]">{fmtDateIt(candidateDates[0])} – {fmtDateIt(candidateDates.at(-1)!)}</p>}</div></div></div>
          {occupied.length > 0 && <div className="rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] p-4"><div className="flex gap-3"><AlertTriangle className="h-5 w-5 shrink-0 text-[#D97706]" /><div><p className="font-extrabold text-[#92400E]">{occupied.length} giorni contengono già dati</p><p className="text-sm text-[#92400E]">Non saranno modificati senza conferma.</p></div></div><label className="mt-3 flex items-center gap-3 rounded-xl bg-white p-3 font-bold"><Checkbox checked={overwrite} onCheckedChange={(value) => setOverwrite(value === true)} />Sovrascrivi questi giorni</label></div>}
        </div>
        <DialogFooter className="gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button><Button data-testid="btn-confirm-month-prefill" disabled={datesToWrite.length === 0} onClick={save}><Check className="mr-2 h-4 w-4" />Precompila</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
