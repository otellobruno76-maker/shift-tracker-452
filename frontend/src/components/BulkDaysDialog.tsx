import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Clock3, Layers3 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildBulkEntries, valuesFromTemplate } from "@/lib/bulkDays";
import { fmtDateIt } from "@/lib/dates";
import { computeShift, fmtHours } from "@/lib/hours";
import { deleteEntry, saveEntries, useDayTemplates, useDays } from "@/lib/store";
import { DAY_TYPE_LABELS } from "@/lib/types";
import type { BulkDayValues } from "@/lib/bulkDays";
import type { DayType } from "@/lib/types";

type Mode = "template" | "orario" | "assenza";

interface Props {
  open: boolean;
  dates: string[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const ABSENCE_TYPES: DayType[] = ["ferie", "malattia", "permesso", "riposo"];

export default function BulkDaysDialog({ open, dates, onOpenChange, onSaved }: Props) {
  const days = useDays();
  const templates = useDayTemplates();
  const [step, setStep] = useState<"edit" | "preview">("edit");
  const [mode, setMode] = useState<Mode>(templates.length ? "template" : "orario");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("17:00");
  const [breakMinutes, setBreakMinutes] = useState("60");
  const [absenceType, setAbsenceType] = useState<DayType>("ferie");
  const [overwrite, setOverwrite] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("edit");
    setOverwrite(false);
    setMode(templates.length ? "template" : "orario");
    setTemplateId(templates[0]?.id ?? "");
  }, [open, templates]);

  const occupiedDates = useMemo(() => {
    const selected = new Set(dates);
    return [...new Set(days.filter((entry) => selected.has(entry.date)).map((entry) => entry.date))];
  }, [dates, days]);

  const values = useMemo<BulkDayValues | null>(() => {
    if (mode === "template") {
      const template = templates.find((item) => item.id === templateId);
      return template ? valuesFromTemplate(template) : null;
    }
    if (mode === "assenza") {
      return { dayType: absenceType, start: "", end: "", breakMinutes: 0 };
    }
    return {
      dayType: "lavoro",
      start,
      end,
      breakMinutes: Number(breakMinutes.replace(",", ".")),
    };
  }, [absenceType, breakMinutes, end, mode, start, templateId, templates]);

  const shift = values?.dayType === "lavoro" && values.start && values.end
    ? computeShift(values.start, values.end, values.breakMinutes)
    : null;
  const datesToWrite = overwrite ? dates : dates.filter((date) => !occupiedDates.includes(date));

  const validate = () => {
    if (!values) {
      toast.error("Scegli una giornata tipo.");
      return false;
    }
    if (values.dayType === "lavoro") {
      if (!values.start || !values.end || !shift || shift.net <= 0) {
        toast.error("Controlla orario e pausa.");
        return false;
      }
      if (!Number.isFinite(values.breakMinutes) || values.breakMinutes < 0) {
        toast.error("Controlla i minuti di pausa.");
        return false;
      }
    }
    return true;
  };

  const save = () => {
    if (!validate() || !values) return;
    if (overwrite) {
      days.filter((entry) => occupiedDates.includes(entry.date)).forEach((entry) => deleteEntry(entry.id));
    }
    const entries = buildBulkEntries(datesToWrite, values);
    saveEntries(entries);
    onSaved();
    onOpenChange(false);
    const skipped = dates.length - datesToWrite.length;
    toast.success(skipped > 0
      ? `${entries.length} giorni salvati; ${skipped} già compilati non modificati.`
      : `${entries.length} giorni salvati.`);
  };

  const summary = values?.dayType === "lavoro"
    ? `${values.start}–${values.end} · pausa ${values.breakMinutes} min`
    : values ? DAY_TYPE_LABELS[values.dayType] : "Da configurare";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto rounded-2xl" data-testid="bulk-days-dialog">
        <DialogHeader>
          <DialogTitle>{step === "edit" ? "Compila i giorni selezionati" : "Anteprima prima di salvare"}</DialogTitle>
          <p className="text-sm text-[#64748B]">
            {dates.length > 0 ? `${fmtDateIt(dates[0])} – ${fmtDateIt(dates[dates.length - 1])} · ${dates.length} giorni` : "Nessun giorno"}
          </p>
        </DialogHeader>

        {step === "edit" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2" data-testid="bulk-mode-selector">
              <ModeButton active={mode === "template"} disabled={templates.length === 0} label="Giornata tipo" onClick={() => setMode("template")} />
              <ModeButton active={mode === "orario"} label="Stesso orario" onClick={() => setMode("orario")} />
              <ModeButton active={mode === "assenza"} label="Assenza/riposo" onClick={() => setMode("assenza")} />
            </div>

            {mode === "template" && (
              <div>
                <Label htmlFor="bulk-template">Giornata tipo</Label>
                <select id="bulk-template" className="mt-1 h-12 w-full rounded-xl border border-[#CBD5E1] bg-white px-3 text-base" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                  {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </select>
              </div>
            )}

            {mode === "orario" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label htmlFor="bulk-start">Inizio</Label><Input id="bulk-start" type="time" className="mt-1 h-12 text-base" value={start} onChange={(event) => setStart(event.target.value)} /></div>
                  <div><Label htmlFor="bulk-end">Fine</Label><Input id="bulk-end" type="time" className="mt-1 h-12 text-base" value={end} onChange={(event) => setEnd(event.target.value)} /></div>
                </div>
                <div><Label htmlFor="bulk-break">Pausa in minuti</Label><Input id="bulk-break" inputMode="numeric" className="mt-1 h-12 text-base" value={breakMinutes} onChange={(event) => setBreakMinutes(event.target.value)} /></div>
              </div>
            )}

            {mode === "assenza" && (
              <div>
                <Label>Tipo di giornata</Label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {ABSENCE_TYPES.map((type) => <ModeButton key={type} active={absenceType === type} label={DAY_TYPE_LABELS[type]} onClick={() => setAbsenceType(type)} />)}
                </div>
              </div>
            )}

            <div className="rounded-2xl bg-[#F1F5F9] p-4">
              <div className="flex items-start gap-3"><Clock3 className="mt-0.5 h-5 w-5 text-[#0284C7]" /><div><p className="font-extrabold">{summary}</p>{shift && <p className="text-sm text-[#64748B]">{fmtHours(shift.net)} nette per giorno · {fmtHours(shift.net * dates.length)} complessive</p>}</div></div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-[#BAE6FD] bg-[#F0F9FF] p-4" data-testid="bulk-preview">
              <div className="flex items-start gap-3"><Layers3 className="mt-0.5 h-5 w-5 text-[#0284C7]" /><div><p className="font-extrabold">{dates.length} giorni selezionati</p><p className="text-sm text-[#475569]">{summary}</p><p className="mt-1 text-sm font-bold text-[#0F172A]">Saranno salvati: {datesToWrite.length}</p></div></div>
            </div>
            {occupiedDates.length > 0 && (
              <div className="rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] p-4" data-testid="bulk-overwrite-warning">
                <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#D97706]" /><div><p className="font-extrabold text-[#92400E]">{occupiedDates.length} giorni contengono già dati</p><p className="text-sm text-[#92400E]">Per sicurezza non saranno modificati, salvo tua conferma.</p></div></div>
                <label className="mt-3 flex items-center gap-3 rounded-xl bg-white p-3 font-bold">
                  <Checkbox checked={overwrite} data-testid="confirm-overwrite-days" onCheckedChange={(checked) => setOverwrite(checked === true)} />
                  Sovrascrivi anche questi giorni
                </label>
              </div>
            )}
            <div className="max-h-32 overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white p-3 text-sm text-[#475569]">
              {dates.map((date) => <span key={date} className="mr-2 inline-block">{fmtDateIt(date)}</span>)}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "preview" ? <Button variant="outline" onClick={() => setStep("edit")}><ArrowLeft className="mr-2 h-4 w-4" />Indietro</Button> : <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>}
          {step === "edit" ? <Button data-testid="btn-show-bulk-preview" onClick={() => validate() && setStep("preview")}>Mostra anteprima</Button> : <Button data-testid="btn-save-bulk-days" disabled={datesToWrite.length === 0} onClick={save}><Check className="mr-2 h-4 w-4" />Conferma e salva</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeButton({ active, disabled, label, onClick }: { active: boolean; disabled?: boolean; label: string; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`min-h-12 rounded-xl border px-2 py-2 text-sm font-extrabold leading-tight disabled:opacity-40 ${active ? "border-[#0284C7] bg-[#0284C7] text-white" : "border-[#CBD5E1] bg-white text-[#334155]"}`}>{label}</button>;
}
