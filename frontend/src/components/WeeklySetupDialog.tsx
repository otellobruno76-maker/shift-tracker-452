import { useMemo, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDateIt, parseISODate, toISODate, todayISO, weekdayIndex } from "@/lib/dates";
import { fmtHours } from "@/lib/hours";
import { saveEntries, useDays, useSettings } from "@/lib/store";
import { uid } from "@/lib/types";
import type { DayEntry } from "@/lib/types";

const WEEKDAYS = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];

function mondayOf(iso: string): Date {
  const date = parseISODate(iso);
  date.setDate(date.getDate() - weekdayIndex(iso));
  return date;
}

export default function WeeklySetupDialog() {
  const days = useDays();
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const [anchorDate, setAnchorDate] = useState(todayISO());
  const [selectedDays, setSelectedDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [hours, setHours] = useState(String(settings.dailyOrdinaryHours));

  const monday = useMemo(() => mondayOf(anchorDate), [anchorDate]);
  const dates = useMemo(
    () => WEEKDAYS.map((_, index) => {
      const date = new Date(monday);
      date.setDate(date.getDate() + index);
      return toISODate(date);
    }),
    [monday],
  );
  const minutes = Math.round((Number(hours.replace(",", ".")) || 0) * 60);
  const total = minutes * selectedDays.length;

  const createWeek = () => {
    if (selectedDays.length === 0) {
      toast.error("Scegli almeno un giorno lavorativo.");
      return;
    }
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
      toast.error("Controlla le ore ordinarie giornaliere.");
      return;
    }
    const occupied = new Set(days.map((entry) => entry.date));
    const now = new Date().toISOString();
    const entries: DayEntry[] = selectedDays
      .map((index) => dates[index])
      .filter((date) => !occupied.has(date))
      .map((date) => ({
        id: uid(),
        date,
        dayType: "lavoro",
        start: "",
        end: "",
        breakMinutes: 0,
        notturno: false,
        reperibilita: false,
        trasferta: false,
        festivo: null,
        note: "Ore ordinarie programmate",
        scheduledOrdinaryMinutes: minutes,
        manualOvertimeMinutes: 0,
        createdAt: now,
        updatedAt: now,
      }));
    const skipped = selectedDays.length - entries.length;
    saveEntries(entries);
    setOpen(false);
    if (entries.length === 0) {
      toast.error("I giorni scelti contengono già delle registrazioni.");
    } else if (skipped > 0) {
      toast.success(`${entries.length} giorni compilati; ${skipped} già presenti non modificati.`);
    } else {
      toast.success(`${entries.length} giorni compilati: ${fmtHours(total)} ordinarie.`);
    }
  };

  return (
    <>
      <Button
        className="mt-3 h-14 w-full rounded-2xl text-base font-extrabold"
        data-testid="btn-open-weekly-setup"
        onClick={() => {
          setHours(String(settings.dailyOrdinaryHours));
          setOpen(true);
        }}
      >
        <CalendarPlus className="mr-2 h-5 w-5" />
        Imposta settimana lavorativa
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto rounded-2xl" data-testid="weekly-setup-dialog">
          <DialogHeader>
            <DialogTitle>Imposta settimana lavorativa</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="weekly-anchor-date" className="text-sm font-bold">Scegli una data della settimana</Label>
              <Input
                id="weekly-anchor-date"
                type="date"
                className="mt-1 h-12 text-base"
                value={anchorDate}
                data-testid="weekly-anchor-date"
                onChange={(event) => setAnchorDate(event.target.value)}
              />
              <p className="mt-1 text-xs text-[#64748B]">
                Settimana dal {fmtDateIt(dates[0])} al {fmtDateIt(dates[6])}
              </p>
            </div>

            <div>
              <Label className="text-sm font-bold">Giorni lavorativi</Label>
              <div className="mt-2 space-y-2">
                {WEEKDAYS.map((label, index) => (
                  <label key={label} className="flex items-center justify-between rounded-xl border border-[#E2E5EA] bg-white p-3">
                    <span className="text-sm font-bold">{label} <span className="font-normal text-[#64748B]">{fmtDateIt(dates[index]).slice(0, 5)}</span></span>
                    <Checkbox
                      checked={selectedDays.includes(index)}
                      data-testid={`weekly-day-${index}`}
                      onCheckedChange={(checked) => setSelectedDays((current) =>
                        checked === true
                          ? [...current, index].sort((a, b) => a - b)
                          : current.filter((day) => day !== index),
                      )}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="weekly-ordinary-hours" className="text-sm font-bold">Ore ordinarie per giorno</Label>
              <Input
                id="weekly-ordinary-hours"
                inputMode="decimal"
                className="mt-1 h-12 text-base"
                value={hours}
                data-testid="weekly-ordinary-hours"
                onChange={(event) => setHours(event.target.value)}
              />
            </div>

            <div className="rounded-2xl bg-[#0F172A] p-4 text-white" data-testid="weekly-total-preview">
              <p className="text-xs font-bold uppercase tracking-wide text-[#94A3B8]">Totale settimana</p>
              <p className="mt-1 text-3xl font-extrabold tabular-nums">{fmtHours(total)}</p>
              <p className="mt-1 text-sm text-[#CBD5E1]">
                {selectedDays.length} giorni × {fmtHours(minutes)} ordinarie
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Annulla</Button>
            <Button data-testid="btn-confirm-weekly-setup" onClick={createWeek}>Inserisci nel calendario</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
