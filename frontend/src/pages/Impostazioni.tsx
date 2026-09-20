import { useEffect, useRef, useState } from "react";
import { FileSearch, Files, Trash2, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtDateIt } from "@/lib/dates";
import { exportBackupFile, importBackupFile } from "@/lib/export";
import { nationalHolidays } from "@/lib/holidays";
import { removeDemoData, saveSettings, useDemoActive, useSettings } from "@/lib/store";
import { MONTHS_IT } from "@/lib/types";
import type { ReactNode } from "react";

export default function Impostazioni() {
  const navigate = useNavigate();
  const settings = useSettings();
  const demo = useDemoActive();
  const fileRef = useRef<HTMLInputElement>(null);
  const thisYear = new Date().getFullYear();

  return (
    <div>
      <header className="pt-2">
        <h1
          className="font-heading text-2xl font-extrabold tracking-tight text-[#0F172A]"
          data-testid="settings-title"
        >
          Impostazioni
        </h1>
        <p className="text-sm text-[#4B5563]">
          Tutto viene salvato solo su questo telefono.
        </p>
      </header>

      <Section title="I tuoi dati" testid="settings-profile">
        <TextField
          label="Nome e cognome"
          placeholder="Es. Mario Rossi"
          testid="input-worker-name"
          value={settings.workerName}
          onCommit={(v) => saveSettings({ workerName: v })}
        />
        <TextField
          label="Azienda / datore di lavoro"
          placeholder="Es. Edil Costruzioni S.r.l."
          testid="input-company"
          value={settings.company}
          onCommit={(v) => saveSettings({ company: v })}
        />
      </Section>

      <Section title="Configura da cedolino" testid="settings-payslip-config">
        <p className="text-sm leading-relaxed text-[#4B5563]">
          Leggi localmente un PDF o una foto della busta paga, controlla i dati rilevati e scegli cosa applicare.
        </p>
        <Button
          className="h-14 w-full text-base font-extrabold"
          data-testid="btn-configure-from-payslip"
          onClick={() => navigate("/configura-cedolino")}
        >
          <FileSearch className="mr-2 h-5 w-5" />
          Analizza un cedolino
        </Button>
        <Button
          variant="outline"
          className="h-14 w-full text-base font-extrabold"
          data-testid="btn-my-payslips"
          onClick={() => navigate("/cedolini")}
        >
          <Files className="mr-2 h-5 w-5" />
          I miei cedolini
        </Button>
        {settings.payslipConfiguredAt && (
          <div className="rounded-xl bg-[#F0FDF4] p-3 text-sm text-[#166534]" data-testid="payslip-applied-summary">
            <p className="font-extrabold">Ultimi dati confermati</p>
            <div className="mt-1 space-y-0.5">
              {settings.ccnl && <p>CCNL: {settings.ccnl}</p>}
              {settings.contractLevel && <p>Livello: {settings.contractLevel}</p>}
              {settings.overtimeRates.length > 0 && <p>Straordinari: {settings.overtimeRates.map((rate) => `+${rate}%`).join(", ")}</p>}
              {settings.payslipReferenceHours !== null && <p>Ore indicate sul cedolino: {settings.payslipReferenceHours}</p>}
              {settings.payslipAllowances.length > 0 && <p>Indennità rilevate: {settings.payslipAllowances.map((item) => item.name).join(", ")}</p>}
            </div>
          </div>
        )}
        <p className="text-xs text-[#64748B]">Il documento non viene salvato né inviato a servizi esterni. I risultati sono una stima: verifica consigliata.</p>
      </Section>

      <Section title="Orario ordinario" testid="settings-schedule">
        <NumberField
          label="Ore ordinarie giornaliere"
          value={settings.dailyOrdinaryHours}
          suffix="h"
          testid="settings-daily-hours"
          onCommit={(v) => {
            if (v > settings.weeklyOrdinaryHours) {
              toast.error("Le ore giornaliere non possono superare quelle settimanali.");
              return;
            }
            saveSettings({ dailyOrdinaryHours: v });
          }}
        />
        <NumberField
          label="Ore ordinarie settimanali"
          value={settings.weeklyOrdinaryHours}
          suffix="h"
          testid="settings-weekly-hours"
          onCommit={(v) => {
            if (v < settings.dailyOrdinaryHours) {
              toast.error("Le ore settimanali non possono essere meno di quelle giornaliere.");
              return;
            }
            saveSettings({ weeklyOrdinaryHours: v });
          }}
        />
        <p className="text-xs text-[#64748B]">
          Le ore oltre questi limiti contano come straordinario.
        </p>
      </Section>

      <Section title="Paga e maggiorazioni" testid="settings-pay">
        <NumberField
          label="Paga oraria base"
          value={settings.basePay}
          suffix="€/h"
          testid="settings-base-pay"
          onCommit={(v) => saveSettings({ basePay: v })}
        />
        <NumberField
          label="Straordinario"
          value={settings.overtimePct}
          suffix="%"
          max={200}
          testid="settings-overtime-pct"
          onCommit={(v) => saveSettings({ overtimePct: v })}
        />
        <NumberField
          label="Festivo"
          value={settings.holidayPct}
          suffix="%"
          max={200}
          testid="settings-holiday-pct"
          onCommit={(v) => saveSettings({ holidayPct: v })}
        />
        <NumberField
          label="Notturno"
          value={settings.nightPct}
          suffix="%"
          max={200}
          testid="settings-night-pct"
          onCommit={(v) => saveSettings({ nightPct: v })}
        />
        <NumberField
          label="Domenicale"
          value={settings.sundayPct}
          suffix="%"
          max={200}
          testid="settings-sunday-pct"
          onCommit={(v) => saveSettings({ sundayPct: v })}
        />
        <NumberField
          label="Reperibilità (maggiorazione)"
          value={settings.reperibilitaPct}
          suffix="%"
          max={200}
          testid="settings-reperibilita-pct"
          onCommit={(v) => saveSettings({ reperibilitaPct: v })}
        />
        <NumberField
          label="Trasferta (maggiorazione)"
          value={settings.trasfertaPct}
          suffix="%"
          max={200}
          testid="settings-trasferta-pct"
          onCommit={(v) => saveSettings({ trasfertaPct: v })}
        />
        <NumberField
          label="Indennità di reperibilità"
          value={settings.reperibilitaEuroPerDay}
          suffix="€/g"
          testid="settings-standby-allowance"
          onCommit={(v) => saveSettings({ reperibilitaEuroPerDay: v })}
        />
        <p className="text-xs text-[#64748B]">
          Tutte le percentuali sono tue: imposta i valori del tuo contratto. Valori a zero = nessuna
          maggiorazione.
        </p>
      </Section>

      <Section title="Stima netto mensile" testid="settings-net">
        <label className="flex items-center gap-3 rounded-xl border border-[#E2E5EA] p-3">
          <Checkbox
            checked={settings.netEnabled}
            onCheckedChange={(v) => saveSettings({ netEnabled: v === true })}
            data-testid="settings-net-toggle"
            className="h-6 w-6"
          />
          <span>
            <span className="block text-[15px] font-bold">Attiva Stima netto</span>
            <span className="block text-xs text-[#64748B]">
              Percentuale indicativa di trattenute. Non è un calcolo fiscale ufficiale.
            </span>
          </span>
        </label>
        {settings.netEnabled && (
          <NumberField
            label="Percentuale di trattenute"
            value={settings.netPct}
            suffix="%"
            max={100}
            testid="settings-net-pct"
            onCommit={(v) => saveSettings({ netPct: v })}
          />
        )}
      </Section>

      <Section title="Festività" testid="settings-holidays">
        <TextField
          label="Nome festività patronale (facoltativa)"
          placeholder="Es. Festività patronale"
          testid="settings-patronal-name"
          value={settings.patronalName}
          onCommit={(v) => saveSettings({ patronalName: v })}
        />
        <div>
          <Label className="text-sm font-bold">Mese</Label>
          <Select
            value={settings.patronalMonth ? String(settings.patronalMonth) : "none"}
            onValueChange={(v) => saveSettings({ patronalMonth: v === "none" ? null : Number(v) })}
          >
            <SelectTrigger className="mt-1 h-12 w-full text-base" data-testid="settings-patronal-month">
              <SelectValue>
                {(v) => (v === "none" ? "Nessuna" : MONTHS_IT[Number(v) - 1])}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nessuna</SelectItem>
              {MONTHS_IT.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-sm font-bold">Giorno</Label>
          <Select
            value={settings.patronalDay ? String(settings.patronalDay) : "none"}
            onValueChange={(v) => saveSettings({ patronalDay: v === "none" ? null : Number(v) })}
          >
            <SelectTrigger className="mt-1 h-12 w-full text-base" data-testid="settings-patronal-day">
              <SelectValue>{(v) => (v === "none" ? "Nessuno" : String(v))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nessuno</SelectItem>
              {Array.from({ length: 31 }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {i + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {settings.patronalMonth && settings.patronalDay && (
          <p className="text-xs font-semibold text-[#15803D]" data-testid="patronal-preview">
            Ricorre ogni anno il {String(settings.patronalDay).padStart(2, "0")}/
            {String(settings.patronalMonth).padStart(2, "0")}
          </p>
        )}
        <div className="rounded-xl border border-[#E2E5EA] p-3" data-testid="national-holidays-list">
          <p className="text-sm font-bold">Festività nazionali {thisYear}</p>
          <ul className="mt-2 space-y-1">
            {nationalHolidays(thisYear).map((h) => (
              <li key={h.date} className="flex justify-between text-sm">
                <span className="text-[#374151]">{h.name}</span>
                <span className="tabular-nums text-[#64748B]">{fmtDateIt(h.date)}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section title="Dati e backup" testid="settings-data">
        <Button
          variant="outline"
          className="h-14 w-full text-base font-extrabold"
          data-testid="btn-settings-backup-export"
          onClick={() => {
            exportBackupFile();
            toast.success("Backup scaricato.");
          }}
        >
          <Upload className="mr-2 h-5 w-5 rotate-180" />
          Esporta backup JSON
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          data-testid="input-backup-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void importBackupFile(file).then((ok) => {
              if (ok) toast.success("Backup importato: dati sostituiti.");
              else toast.error("File non valido: scegli un backup esportato dall'app.");
            });
          }}
        />
        <Button
          variant="outline"
          className="h-14 w-full text-base font-extrabold"
          data-testid="btn-settings-backup-import"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="mr-2 h-5 w-5" />
          Importa backup JSON
        </Button>
        {demo && (
          <Button
            variant="outline"
            className="h-14 w-full border-[#FCD34D] bg-[#FFFBEB] text-base font-extrabold text-[#92400E] hover:bg-[#FEF3C7]"
            data-testid="btn-remove-demo-data-settings"
            onClick={() => {
              removeDemoData();
              toast.success("Dati di prova rimossi: l'app è vuota.");
            }}
          >
            <Trash2 className="mr-2 h-5 w-5" />
            Rimuovi dati di prova
          </Button>
        )}
        <p className="text-xs text-[#64748B]">
          I tuoi dati restano solo su questo dispositivo: nessun account, nessun cloud. Per
          spostarli su un altro telefono usa Esporta/Importa backup.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children, testid }: { title: string; children: ReactNode; testid: string }) {
  return (
    <section
      className="mt-4 rounded-2xl border border-[#E2E5EA] bg-white p-5 shadow-sm"
      data-testid={testid}
    >
      <h2 className="font-heading text-lg font-extrabold text-[#0F172A]">{title}</h2>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

function TextField({
  label,
  value,
  onCommit,
  placeholder,
  testid,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  testid: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <div>
      <Label htmlFor={testid} className="text-sm font-bold">
        {label}
      </Label>
      <Input
        id={testid}
        className="mt-1 h-12 text-base"
        placeholder={placeholder}
        value={draft}
        data-testid={testid}
        onChange={(e) => {
          setDraft(e.target.value);
          onCommit(e.target.value);
        }}
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onCommit,
  suffix,
  testid,
  max,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  suffix?: string;
  testid: string;
  max?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  const handle = (raw: string) => {
    setDraft(raw);
    if (raw.trim() === "") {
      onCommit(0);
      return;
    }
    const n = Number(raw.replace(",", "."));
    if (Number.isNaN(n)) return;
    if (n < 0) {
      toast.error("Il valore non può essere negativo.");
      return;
    }
    if (max !== undefined && n > max) {
      toast.error(`Il valore non può superare ${max}.`);
      return;
    }
    onCommit(n);
  };
  return (
    <div>
      <Label htmlFor={testid} className="text-sm font-bold">
        {label}
      </Label>
      <div className="relative mt-1">
        <Input
          id={testid}
          inputMode="decimal"
          className="h-12 pr-14 text-base"
          value={draft}
          data-testid={testid}
          onChange={(e) => handle(e.target.value)}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-[#64748B]">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}
