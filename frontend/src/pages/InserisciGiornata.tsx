import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BedDouble,
  BookmarkPlus,
  ChevronLeft,
  Coffee,
  Hammer,
  Palmtree,
  Thermometer,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { fmtDateIt, toISODate, todayISO } from "@/lib/dates";
import { computeShift, fmtHours, nightWindowMinutes } from "@/lib/hours";
import { holidayName } from "@/lib/holidays";
import {
  deleteDayTemplate,
  saveDayTemplate,
  saveEntry,
  useDays,
  useDayTemplates,
  useSettings,
} from "@/lib/store";
import { BREAK_PRESETS, DAY_TYPES, DAY_TYPE_LABELS, uid } from "@/lib/types";
import type { DayEntry, DayTemplate, DayType } from "@/lib/types";

const TYPE_ICONS: Record<DayType, LucideIcon> = {
  lavoro: Hammer,
  ferie: Palmtree,
  malattia: Thermometer,
  permesso: Coffee,
  riposo: BedDouble,
};

const PAUSE_OPTIONS: Array<{ value: string; label: string }> = [
  ...BREAK_PRESETS.map((m) => ({ value: String(m), label: m === 0 ? "Nessuna" : `${m} min` })),
  { value: "custom", label: "Personalizzata" },
];

export default function InserisciGiornata() {
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  return (
    <FormBody
      key={location.key}
      editId={params.get("id")}
      copiaId={params.get("copia")}
      prefillDate={params.get("data")}
    />
  );
}

function FormBody({
  editId,
  copiaId,
  prefillDate,
}: {
  editId: string | null;
  copiaId: string | null;
  prefillDate: string | null;
}) {
  const days = useDays();
  const templates = useDayTemplates();
  const settings = useSettings();
  const navigate = useNavigate();

  const source = (editId ? days.find((d) => d.id === editId) : undefined) ??
    (copiaId ? days.find((d) => d.id === copiaId) : undefined);

  const [date, setDate] = useState(source?.date ?? prefillDate ?? todayISO());
  const [dayType, setDayType] = useState<DayType>(source?.dayType ?? "lavoro");
  const [start, setStart] = useState(source?.start ?? "");
  const [end, setEnd] = useState(source?.end ?? "");
  const [breakChoice, setBreakChoice] = useState(() =>
    source && !BREAK_PRESETS.includes(source.breakMinutes) ? "custom" : String(source?.breakMinutes ?? 0),
  );
  const [breakCustom, setBreakCustom] = useState(() =>
    source && !BREAK_PRESETS.includes(source.breakMinutes) ? String(source.breakMinutes) : "",
  );
  const [notturnoManual, setNotturnoManual] = useState(source?.notturno ?? false);
  const [notturnoTouched, setNotturnoTouched] = useState(source !== undefined);
  const [reperibilita, setReperibilita] = useState(source?.reperibilita ?? false);
  const [trasferta, setTrasferta] = useState(source?.trasferta ?? false);
  const [festivoManual, setFestivoManual] = useState(source ? source.festivo === true : false);
  const [festivoTouched, setFestivoTouched] = useState(source !== undefined && source.festivo !== null);
  const [note, setNote] = useState(source?.note ?? "");
  const scheduledMode = Boolean(editId && source?.scheduledOrdinaryMinutes !== undefined);
  const [scheduledHours, setScheduledHours] = useState(String((source?.scheduledOrdinaryMinutes ?? settings.dailyOrdinaryHours * 60) / 60));
  const [scheduledOvertime, setScheduledOvertime] = useState(String((source?.manualOvertimeMinutes ?? 0) / 60));
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");

  const breakMinutes =
    breakChoice === "custom" ? (Number(breakCustom.replace(",", ".")) || 0) : Number(breakChoice);

  const autoFestivo = holidayName(date, settings) !== null;
  const festivo = festivoTouched ? festivoManual : autoFestivo;
  const shift = dayType === "lavoro" && start && end ? computeShift(start, end, breakMinutes) : null;
  const net = shift && shift.net > 0 ? shift.net : null;
  const autoNight = dayType === "lavoro" && nightWindowMinutes(start, end) > 0;
  const notturno = notturnoTouched ? notturnoManual : autoNight;

  const dailyLimit = Math.max(0, settings.dailyOrdinaryHours) * 60;
  const ordinaryPreview = net !== null ? Math.min(net, dailyLimit) : 0;

  const applyTemplate = (template: DayTemplate) => {
    setDayType(template.dayType);
    setStart(template.start);
    setEnd(template.end);
    if (BREAK_PRESETS.includes(template.breakMinutes)) {
      setBreakChoice(String(template.breakMinutes));
      setBreakCustom("");
    } else {
      setBreakChoice("custom");
      setBreakCustom(String(template.breakMinutes));
    }
    setNotturnoManual(template.notturno);
    setNotturnoTouched(true);
    setReperibilita(template.reperibilita);
    setTrasferta(template.trasferta);
    setNote(template.note);
    toast.success(`Giornata tipo “${template.name}” applicata.`);
  };

  const openTemplateDialog = () => {
    if (dayType === "lavoro" && (!start || !end || !shift || shift.net <= 0)) {
      toast.error("Inserisci un turno valido prima di salvarlo come giornata tipo.");
      return;
    }
    setTemplateName("");
    setTemplateDialogOpen(true);
  };

  const persistTemplate = () => {
    const name = templateName.trim();
    if (!name) {
      toast.error("Dai un nome alla giornata tipo.");
      return;
    }
    const now = new Date().toISOString();
    const existing = templates.find((item) => item.name.toLocaleLowerCase("it") === name.toLocaleLowerCase("it"));
    saveDayTemplate({
      id: existing?.id ?? uid(),
      name,
      dayType,
      start: dayType === "lavoro" ? start : "",
      end: dayType === "lavoro" ? end : "",
      breakMinutes: dayType === "lavoro" ? Math.max(0, breakMinutes) : 0,
      notturno: dayType === "lavoro" ? notturno : false,
      reperibilita: dayType === "lavoro" ? reperibilita : false,
      trasferta: dayType === "lavoro" ? trasferta : false,
      note: note.trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    setTemplateDialogOpen(false);
    toast.success(existing ? "Giornata tipo aggiornata." : "Giornata tipo salvata.");
  };

  const save = () => {
    if (!date) {
      toast.error("Scegli la data della giornata.");
      return;
    }
    if (dayType === "lavoro" && scheduledMode) {
      const ordinary = Number(scheduledHours.replace(",", "."));
      const overtime = Number(scheduledOvertime.replace(",", "."));
      if (!Number.isFinite(ordinary) || ordinary <= 0 || ordinary > 24) {
        toast.error("Controlla le ore ordinarie.");
        return;
      }
      if (!Number.isFinite(overtime) || overtime < 0 || overtime > 16) {
        toast.error("Controlla le ore straordinarie.");
        return;
      }
    } else if (dayType === "lavoro") {
      if (!start) {
        toast.error("Inserisci l'ora di inizio.");
        return;
      }
      if (!end) {
        toast.error("Controlla l'orario di fine lavoro.");
        return;
      }
      if (!shift) {
        toast.error("Controlla l'orario di fine lavoro.");
        return;
      }
      if (breakChoice === "custom") {
        const n = Number(breakCustom.replace(",", "."));
        if (!Number.isFinite(n) || n < 0) {
          toast.error("Controlla i minuti di pausa.");
          return;
        }
      }
      if (shift.net <= 0) {
        toast.error("La pausa non può superare la durata del turno.");
        return;
      }
    }
    const now = new Date().toISOString();
    const entry: DayEntry = {
      id: editId ?? uid(),
      date,
      dayType,
      start: dayType === "lavoro" ? start : "",
      end: dayType === "lavoro" ? end : "",
      breakMinutes: dayType === "lavoro" ? Math.max(0, breakMinutes) : 0,
      notturno: dayType === "lavoro" ? notturno : false,
      reperibilita: dayType === "lavoro" ? reperibilita : false,
      trasferta: dayType === "lavoro" ? trasferta : false,
      festivo: festivoTouched ? festivo : null,
      note: note.trim(),
      scheduledOrdinaryMinutes: dayType === "lavoro" && scheduledMode
        ? Math.round(Number(scheduledHours.replace(",", ".")) * 60)
        : undefined,
      manualOvertimeMinutes: dayType === "lavoro" && scheduledMode
        ? Math.round(Number(scheduledOvertime.replace(",", ".")) * 60)
        : undefined,
      createdAt: source && editId ? source.createdAt : now,
      updatedAt: now,
    };
    saveEntry(entry);
    toast.success(editId ? "Giornata aggiornata." : "Giornata salvata.");
    navigate("/");
  };

  return (
    <div className="pb-44">
      <header className="flex items-center gap-1 pt-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-12 w-12"
          data-testid="btn-back"
          aria-label="Indietro"
          onClick={() => navigate("/")}
        >
          <ChevronLeft className="h-6 w-6" />
        </Button>
        <h1
          className="font-heading text-xl font-extrabold tracking-tight text-[#0F172A]"
          data-testid="entry-form-title"
        >
          {editId ? "Modifica giornata" : copiaId ? "Duplica giornata" : "Nuova giornata"}
        </h1>
      </header>

      {copiaId && source && (
        <p
          className="mt-2 rounded-xl bg-[#EFF6FF] p-3 text-sm font-medium text-[#1D4ED8]"
          data-testid="copy-hint"
        >
          Stai copiando la giornata del {fmtDateIt(source.date)}: cambia la data e salva.
        </p>
      )}

      <section
        className="mt-4 rounded-2xl border border-[#BAE6FD] bg-[#F0F9FF] p-4"
        data-testid="day-templates-section"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-base font-extrabold">Giornate tipo</h2>
            <p className="text-xs text-[#4B5563]">Richiama un turno abituale con un tocco.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0 border-[#7DD3FC] bg-white px-3 text-sm font-bold"
            data-testid="btn-save-day-template"
            onClick={openTemplateDialog}
          >
            <BookmarkPlus className="mr-1.5 h-4 w-4" />
            Salva tipo
          </Button>
        </div>
        {templates.length === 0 ? (
          <p className="mt-3 rounded-xl bg-white/80 p-3 text-sm text-[#64748B]" data-testid="day-templates-empty">
            Nessuna giornata tipo salvata. Compila un turno e premi “Salva tipo”.
          </p>
        ) : (
          <div className="mt-3 space-y-2" data-testid="day-templates-list">
            {templates.map((template) => (
              <div key={template.id} className="flex items-center gap-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-xl border border-[#BAE6FD] bg-white px-3 py-2.5 text-left"
                  data-testid={`apply-day-template-${template.id}`}
                  onClick={() => applyTemplate(template)}
                >
                  <span className="block truncate text-sm font-extrabold">{template.name}</span>
                  <span className="block text-xs tabular-nums text-[#64748B]">
                    {template.dayType === "lavoro"
                      ? `${template.start}–${template.end} · pausa ${template.breakMinutes} min`
                      : DAY_TYPE_LABELS[template.dayType]}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 shrink-0 border-[#FECACA] text-[#B91C1C]"
                  aria-label={`Elimina ${template.name}`}
                  data-testid={`delete-day-template-${template.id}`}
                  onClick={() => {
                    deleteDayTemplate(template.id);
                    toast.success("Giornata tipo eliminata.");
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mt-4">
        <Label className="text-sm font-bold">Tipo di giornata</Label>
        <div className="mt-1.5 grid grid-cols-5 gap-1.5" data-testid="day-type-selector">
          {DAY_TYPES.map((t) => {
            const Icon = TYPE_ICONS[t];
            return (
              <button
                key={t}
                type="button"
                data-testid={`type-${t}`}
                onClick={() => setDayType(t)}
                className={`flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-[10px] font-bold leading-tight transition-colors duration-150 ${
                  dayType === t
                    ? "border-[#0284C7] bg-[#0284C7] text-white"
                    : "border-[#E2E5EA] bg-white text-[#4B5563]"
                }`}
              >
                <Icon className="h-5 w-5" />
                {DAY_TYPE_LABELS[t]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <Label htmlFor="input-entry-date" className="text-sm font-bold">
          Data <span className="tabular-nums text-[#64748B]">({fmtDateIt(date)})</span>
        </Label>
        <Input
          id="input-entry-date"
          type="date"
          className="mt-1 h-14 text-lg"
          value={date}
          data-testid="input-entry-date"
          onChange={(e) => setDate(e.target.value)}
        />
        <div className="mt-2 flex gap-2">
          <Button
            variant="outline"
            className="h-11 px-5 text-sm font-bold"
            data-testid="quick-date-today"
            onClick={() => setDate(todayISO())}
          >
            Oggi
          </Button>
          <Button
            variant="outline"
            className="h-11 px-5 text-sm font-bold"
            data-testid="quick-date-yesterday"
            onClick={() => {
              const d = new Date();
              d.setDate(d.getDate() - 1);
              setDate(toISODate(d));
            }}
          >
            Ieri
          </Button>
        </div>
      </div>

      {dayType === "lavoro" && scheduledMode && (
        <>
          <section className="mt-4 rounded-2xl border border-[#BAE6FD] bg-[#F0F9FF] p-4" data-testid="scheduled-day-editor">
            <h2 className="font-heading text-base font-extrabold">Giornata precompilata</h2>
            <p className="mt-1 text-xs text-[#475569]">Modifica solo l’eccezione di questo giorno.</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div><Label htmlFor="scheduled-hours">Ore ordinarie</Label><Input id="scheduled-hours" inputMode="decimal" className="mt-1 h-12 text-base" value={scheduledHours} onChange={(event) => setScheduledHours(event.target.value)} /></div>
              <div><Label htmlFor="scheduled-overtime">Straordinario</Label><Input id="scheduled-overtime" inputMode="decimal" className="mt-1 h-12 text-base" value={scheduledOvertime} onChange={(event) => setScheduledOvertime(event.target.value)} /></div>
            </div>
          </section>
          <div className="mt-4 space-y-2" data-testid="flag-section">
            <FlagRow label="Giorno festivo" checked={festivo} onCheckedChange={(v) => { setFestivoTouched(true); setFestivoManual(v); }} testid="flag-festivo" />
            <FlagRow label="Reperibilità" checked={reperibilita} onCheckedChange={setReperibilita} testid="flag-reperibilita" />
            <FlagRow label="Trasferta" checked={trasferta} onCheckedChange={setTrasferta} testid="flag-trasferta" />
          </div>
        </>
      )}

      {dayType === "lavoro" && !scheduledMode && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="input-entry-time-start" className="text-sm font-bold">
                Ora inizio
              </Label>
              <Input
                id="input-entry-time-start"
                type="time"
                className="mt-1 h-14 text-lg"
                value={start}
                data-testid="input-entry-time-start"
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="input-entry-time-end" className="text-sm font-bold">
                Ora fine
              </Label>
              <Input
                id="input-entry-time-end"
                type="time"
                className="mt-1 h-14 text-lg"
                value={end}
                data-testid="input-entry-time-end"
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>

          <div
            className="mt-4 rounded-2xl bg-[#0F172A] p-4 text-white"
            data-testid="live-calc-card"
          >
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#94A3B8]">
              Ore lavorate nette
            </p>
            <p
              className="mt-1 text-3xl font-extrabold tabular-nums"
              data-testid="live-net-hours"
            >
              {net !== null ? fmtHours(net) : "—"}
            </p>
            {net !== null ? (
              <p className="mt-1 text-sm text-[#94A3B8]" data-testid="live-split">
                Ordinarie {fmtHours(ordinaryPreview)} ·{" "}
                <span className="font-bold text-[#FBBF24]">
                  Straordinario +{fmtHours(net - ordinaryPreview)}
                </span>
                {shift?.overnight ? " · turno oltre mezzanotte" : ""}
              </p>
            ) : (
              <p className="mt-1 text-sm text-[#94A3B8]">
                Inserisci ora di inizio e ora di fine: il calcolo è automatico.
              </p>
            )}
          </div>

          <div className="mt-4">
            <Label className="text-sm font-bold">Pausa</Label>
            <div className="mt-1.5 grid grid-cols-3 gap-2" data-testid="pause-selector">
              {PAUSE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  data-testid={`pause-${o.value}`}
                  onClick={() => setBreakChoice(o.value)}
                  className={`h-12 rounded-xl border text-sm font-bold transition-colors duration-150 ${
                    breakChoice === o.value
                      ? "border-[#0284C7] bg-[#0284C7] text-white"
                      : "border-[#E2E5EA] bg-white text-[#0F172A]"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {breakChoice === "custom" && (
              <div className="mt-2">
                <Label htmlFor="pause-custom" className="text-xs font-bold text-[#64748B]">
                  Minuti di pausa
                </Label>
                <Input
                  id="pause-custom"
                  inputMode="numeric"
                  className="mt-1 h-12 text-base"
                  placeholder="Es. 20"
                  value={breakCustom}
                  data-testid="pause-custom-input"
                  onChange={(e) => setBreakCustom(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="mt-4 space-y-2" data-testid="flag-section">
            <FlagRow
              label="Giorno festivo"
              hint={autoFestivo ? `Festività: ${holidayName(date, settings)}` : "Attivala se il giorno è festivo per il tuo contratto"}
              checked={festivo}
              onCheckedChange={(v) => {
                setFestivoTouched(true);
                setFestivoManual(v);
              }}
              testid="flag-festivo"
            />
            <FlagRow
              label="Lavoro notturno"
              hint="Tutte le ore del turno contano come notturne"
              checked={notturno}
              onCheckedChange={(v) => {
                setNotturnoTouched(true);
                setNotturnoManual(v);
              }}
              testid="flag-notturno"
            />
            <FlagRow
              label="Reperibilità"
              hint="Indennità giornaliera e maggiorazione da Impostazioni"
              checked={reperibilita}
              onCheckedChange={(v) => setReperibilita(v)}
              testid="flag-reperibilita"
            />
            <FlagRow
              label="Trasferta"
              hint="Lavoro fuori sede"
              checked={trasferta}
              onCheckedChange={(v) => setTrasferta(v)}
              testid="flag-trasferta"
            />
          </div>
        </>
      )}

      {dayType !== "lavoro" && (
        <p
          className="mt-4 rounded-xl bg-[#F4F5F8] p-3 text-sm text-[#4B5563]"
          data-testid="non-work-hint"
        >
          Giornata di {DAY_TYPE_LABELS[dayType].toLowerCase()}: nessun orario da inserire. Viene
          contato nei riepiloghi del mese.
        </p>
      )}

      <div className="mt-4">
        <Label htmlFor="input-entry-note" className="text-sm font-bold">
          Note (facoltative)
        </Label>
        <Textarea
          id="input-entry-note"
          className="mt-1 min-h-20 text-base"
          placeholder="Es. Intervento Alessandria, Cantiere Torino…"
          value={note}
          data-testid="input-entry-note"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[#E2E5EA] bg-white p-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
        data-testid="entry-form-footer"
      >
        <div className="mx-auto flex max-w-md gap-2">
          <Button
            variant="outline"
            className="h-16 flex-1 text-base font-bold"
            data-testid="btn-cancel-entry"
            onClick={() => navigate("/")}
          >
            Annulla
          </Button>
          <Button
            className="h-16 flex-[2] text-lg font-extrabold"
            data-testid="btn-save-entry"
            onClick={save}
          >
            Salva giornata
          </Button>
        </div>
      </div>

      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="rounded-2xl" data-testid="save-template-dialog">
          <DialogHeader>
            <DialogTitle>Salva giornata tipo</DialogTitle>
          </DialogHeader>
          <div>
            <Label htmlFor="template-name" className="text-sm font-bold">Nome</Label>
            <Input
              id="template-name"
              autoFocus
              className="mt-1 h-12 text-base"
              placeholder="Es. Turno lungo"
              value={templateName}
              data-testid="input-template-name"
              onChange={(event) => setTemplateName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") persistTemplate();
              }}
            />
            <p className="mt-2 text-xs text-[#64748B]">
              Salva orari, pausa e opzioni. La data e lo stato festivo non vengono copiati.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setTemplateDialogOpen(false)}>
              Annulla
            </Button>
            <Button type="button" data-testid="btn-confirm-save-template" onClick={persistTemplate}>
              Salva
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FlagRow({
  label,
  hint,
  checked,
  onCheckedChange,
  testid,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  testid: string;
}) {
  return (
    <label
      className="flex items-center gap-3 rounded-xl border border-[#E2E5EA] bg-white p-3"
      data-testid={testid}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="h-6 w-6"
        data-testid={`${testid}-checkbox`}
      />
      <span className="min-w-0">
        <span className="block text-[15px] font-bold text-[#0F172A]">{label}</span>
        {hint && <span className="block text-xs text-[#64748B]">{hint}</span>}
      </span>
    </label>
  );
}
