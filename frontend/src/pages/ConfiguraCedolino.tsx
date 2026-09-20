import { useRef, useState } from "react";
import { ChevronLeft, FileSearch, LockKeyhole, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { extractDocumentText } from "@/lib/documentText";
import {
  analyzePayslipText,
  buildPayslipSettingsPatch,
  type Confidence,
  type DetectedAllowance,
  type PayslipAnalysis,
} from "@/lib/payslip";
import { saveSettings } from "@/lib/store";

interface ReviewState {
  basePay: string;
  ordinaryHours: string;
  overtimeRates: string;
  nightPct: string;
  holidayPct: string;
  ccnl: string;
  level: string;
  selected: Record<string, boolean>;
  allowances: Array<DetectedAllowance & { selected: boolean; amountText: string }>;
}

const confidenceStyle: Record<Confidence, string> = {
  alta: "bg-[#DCFCE7] text-[#166534]",
  media: "bg-[#FEF3C7] text-[#92400E]",
  bassa: "bg-[#FEE2E2] text-[#991B1B]",
};

function displayNumber(value: number | null): string {
  return value === null ? "" : String(value).replace(".", ",");
}

function initialReview(analysis: PayslipAnalysis): ReviewState {
  const selected = (value: unknown, confidence: Confidence) => value !== null && confidence !== "bassa";
  return {
    basePay: displayNumber(analysis.basePay.value),
    ordinaryHours: displayNumber(analysis.ordinaryHours.value),
    overtimeRates: analysis.overtimeRates.map((rate) => displayNumber(rate.value)).join(", "),
    nightPct: displayNumber(analysis.nightPct.value),
    holidayPct: displayNumber(analysis.holidayPct.value),
    ccnl: analysis.ccnl.value ?? "",
    level: analysis.level.value ?? "",
    selected: {
      basePay: selected(analysis.basePay.value, analysis.basePay.confidence),
      ordinaryHours: selected(analysis.ordinaryHours.value, analysis.ordinaryHours.confidence),
      overtimeRates: analysis.overtimeRates.length > 0 && analysis.overtimeRates.every((rate) => rate.confidence !== "bassa"),
      nightPct: selected(analysis.nightPct.value, analysis.nightPct.confidence),
      holidayPct: selected(analysis.holidayPct.value, analysis.holidayPct.confidence),
      ccnl: selected(analysis.ccnl.value, analysis.ccnl.confidence),
      level: selected(analysis.level.value, analysis.level.confidence),
    },
    allowances: analysis.allowances.map((allowance) => ({
      ...allowance,
      selected: allowance.confidence !== "bassa",
      amountText: displayNumber(allowance.amount),
    })),
  };
}

function parseNumber(value: string): number | null {
  const parsed = Number(value.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export default function ConfiguraCedolino() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [analysis, setAnalysis] = useState<PayslipAnalysis | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ label: "", progress: 0 });
  const [error, setError] = useState("");
  const [filename, setFilename] = useState("");

  const analyze = async (file: File) => {
    setBusy(true);
    setError("");
    setAnalysis(null);
    setReview(null);
    setFilename(file.name);
    try {
      const text = await extractDocumentText(file, setProgress);
      const detected = analyzePayslipText(text);
      setAnalysis(detected);
      setReview(initialReview(detected));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Non è stato possibile leggere il documento.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!review) return;
    const chosen = review.selected;
    const values: Parameters<typeof buildPayslipSettingsPatch>[0] = {};
    const numericFields = [
      ["basePay", review.basePay],
      ["ordinaryHours", review.ordinaryHours],
      ["nightPct", review.nightPct],
      ["holidayPct", review.holidayPct],
    ] as const;
    for (const [key, raw] of numericFields) {
      if (!chosen[key]) continue;
      const value = parseNumber(raw);
      if (value === null) {
        toast.error(`Controlla il valore “${key}”.`);
        return;
      }
      values[key] = value;
    }
    if (chosen.overtimeRates) {
      const rates = review.overtimeRates
        .split(/[;\n]+|,\s+(?=\d)/)
        .map((part) => parseNumber(part))
        .filter((value): value is number => value !== null);
      if (rates.length === 0) {
        toast.error("Controlla le maggiorazioni dello straordinario.");
        return;
      }
      values.overtimeRates = rates;
    }
    if (chosen.ccnl) values.ccnl = review.ccnl.trim();
    if (chosen.level) values.level = review.level.trim();
    values.allowances = review.allowances
      .filter((item) => item.selected)
      .map((item) => ({ name: item.name, amount: parseNumber(item.amountText) }));

    if (Object.keys(values).length === 1 && values.allowances?.length === 0) {
      toast.error("Seleziona almeno un dato da applicare.");
      return;
    }
    saveSettings(buildPayslipSettingsPatch(values));
    toast.success("Dati confermati e applicati alle impostazioni.");
    navigate("/impostazioni");
  };

  return (
    <div className="pb-10">
      <header className="flex items-center gap-1 pt-2">
        <Button variant="ghost" size="icon" className="h-12 w-12" aria-label="Indietro" onClick={() => navigate("/impostazioni")}>
          <ChevronLeft className="h-6 w-6" />
        </Button>
        <div>
          <h1 className="font-heading text-xl font-extrabold" data-testid="payslip-config-title">Configura da cedolino</h1>
          <p className="text-xs text-[#64748B]">Stima automatica con verifica consigliata</p>
        </div>
      </header>

      <section className="mt-4 rounded-2xl border border-[#BAE6FD] bg-[#F0F9FF] p-4">
        <div className="flex gap-3">
          <LockKeyhole className="mt-0.5 h-6 w-6 shrink-0 text-[#0369A1]" />
          <div>
            <h2 className="font-bold text-[#0C4A6E]">Il documento resta sul dispositivo</h2>
            <p className="mt-1 text-sm leading-relaxed text-[#075985]">
              L'analisi avviene in questa app. Il cedolino non viene caricato su server esterni e non viene conservato dopo la lettura.
            </p>
          </div>
        </div>
      </section>

      {!analysis && (
        <section className="mt-4 rounded-2xl border border-[#E2E5EA] bg-white p-5 shadow-sm">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            data-testid="payslip-file-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void analyze(file);
            }}
          />
          <FileSearch className="mx-auto h-12 w-12 text-[#0284C7]" strokeWidth={1.6} />
          <h2 className="mt-3 text-center text-lg font-extrabold">Seleziona la busta paga</h2>
          <p className="mt-1 text-center text-sm text-[#64748B]">PDF, fotografia o scansione · massimo 15 MB</p>
          <Button
            className="mt-4 h-14 w-full text-base font-extrabold"
            data-testid="btn-select-payslip"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="mr-2 h-5 w-5" />
            {busy ? "Analisi in corso…" : "Carica PDF o immagine"}
          </Button>
          {busy && (
            <div className="mt-4" data-testid="payslip-progress">
              <div className="h-2 overflow-hidden rounded-full bg-[#E2E8F0]">
                <div className="h-full bg-[#0284C7] transition-all" style={{ width: `${Math.max(5, Math.round(progress.progress * 100))}%` }} />
              </div>
              <p className="mt-2 text-center text-sm text-[#4B5563]">{progress.label}</p>
            </div>
          )}
          {error && (
            <div className="mt-4 rounded-xl bg-[#FEF2F2] p-3 text-sm text-[#991B1B]" data-testid="payslip-error">
              <p className="font-bold">Documento non leggibile</p>
              <p className="mt-1">{error}</p>
            </div>
          )}
        </section>
      )}

      {analysis && review && (
        <Review
          analysis={analysis}
          review={review}
          filename={filename}
          onChange={setReview}
          onCancel={() => navigate("/impostazioni")}
          onReplace={() => {
            setAnalysis(null);
            setReview(null);
            setError("");
          }}
          onConfirm={confirm}
        />
      )}
    </div>
  );
}

function Review({
  analysis,
  review,
  filename,
  onChange,
  onCancel,
  onReplace,
  onConfirm,
}: {
  analysis: PayslipAnalysis;
  review: ReviewState;
  filename: string;
  onChange: (state: ReviewState) => void;
  onCancel: () => void;
  onReplace: () => void;
  onConfirm: () => void;
}) {
  const updateValue = (key: keyof Omit<ReviewState, "selected" | "allowances">, value: string) => onChange({ ...review, [key]: value });
  const updateSelected = (key: string, value: boolean) => onChange({ ...review, selected: { ...review.selected, [key]: value } });
  const sourceForRates = analysis.overtimeRates.length
    ? analysis.overtimeRates.map((rate) => rate.source).join(" · ")
    : "Non rilevata";
  const rateConfidence: Confidence = analysis.overtimeRates.some((rate) => rate.confidence === "media") ? "media" : analysis.overtimeRates[0]?.confidence ?? "bassa";

  return (
    <div className="mt-4 space-y-4" data-testid="payslip-review">
      <section className="rounded-2xl border border-[#E2E5EA] bg-white p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-[#64748B]">Documento analizzato</p>
        <p className="mt-1 truncate text-sm font-bold">{filename}</p>
        <p className="mt-2 text-xs text-[#64748B]">Controlla ogni valore. Nulla viene applicato finché non premi “Conferma e applica”.</p>
      </section>

      <ReviewField label="Paga oraria di riferimento" suffix="€/h" value={review.basePay} checked={review.selected.basePay} source={analysis.basePay.source} confidence={analysis.basePay.confidence} onValue={(value) => updateValue("basePay", value)} onChecked={(value) => updateSelected("basePay", value)} />
      <ReviewField label="Ore ordinarie indicate" suffix="ore" value={review.ordinaryHours} checked={review.selected.ordinaryHours} source={analysis.ordinaryHours.source} confidence={analysis.ordinaryHours.confidence} onValue={(value) => updateValue("ordinaryHours", value)} onChecked={(value) => updateSelected("ordinaryHours", value)} />
      <ReviewField label="Maggiorazioni straordinario" suffix="%" value={review.overtimeRates} checked={review.selected.overtimeRates} source={sourceForRates} confidence={rateConfidence} placeholder="Es. 15; 20; 25" onValue={(value) => updateValue("overtimeRates", value)} onChecked={(value) => updateSelected("overtimeRates", value)} />
      <ReviewField label="Maggiorazione notturna" suffix="%" value={review.nightPct} checked={review.selected.nightPct} source={analysis.nightPct.source} confidence={analysis.nightPct.confidence} onValue={(value) => updateValue("nightPct", value)} onChecked={(value) => updateSelected("nightPct", value)} />
      <ReviewField label="Maggiorazione festiva" suffix="%" value={review.holidayPct} checked={review.selected.holidayPct} source={analysis.holidayPct.source} confidence={analysis.holidayPct.confidence} onValue={(value) => updateValue("holidayPct", value)} onChecked={(value) => updateSelected("holidayPct", value)} />
      <ReviewField label="CCNL" value={review.ccnl} checked={review.selected.ccnl} source={analysis.ccnl.source} confidence={analysis.ccnl.confidence} onValue={(value) => updateValue("ccnl", value)} onChecked={(value) => updateSelected("ccnl", value)} />
      <ReviewField label="Livello" value={review.level} checked={review.selected.level} source={analysis.level.source} confidence={analysis.level.confidence} onValue={(value) => updateValue("level", value)} onChecked={(value) => updateSelected("level", value)} />

      <section className="rounded-2xl border border-[#E2E5EA] bg-white p-4 shadow-sm">
        <h2 className="font-extrabold">Indennità riconoscibili</h2>
        {review.allowances.length === 0 ? (
          <p className="mt-2 text-sm text-[#64748B]">Non rilevata</p>
        ) : (
          <div className="mt-3 space-y-3">
            {review.allowances.map((allowance, index) => (
              <label key={`${allowance.name}-${index}`} className="block rounded-xl bg-[#F8FAFC] p-3">
                <span className="flex items-center gap-2">
                  <Checkbox checked={allowance.selected} onCheckedChange={(checked) => {
                    const items = [...review.allowances];
                    items[index] = { ...allowance, selected: checked === true };
                    onChange({ ...review, allowances: items });
                  }} />
                  <span className="text-sm font-bold">{allowance.name}</span>
                </span>
                <Input
                  className="mt-2 h-11"
                  inputMode="decimal"
                  placeholder="Importo non rilevato"
                  value={allowance.amountText}
                  onChange={(event) => {
                    const items = [...review.allowances];
                    items[index] = { ...allowance, amountText: event.target.value };
                    onChange({ ...review, allowances: items });
                  }}
                />
                <p className="mt-2 text-xs text-[#64748B]">Provenienza: {allowance.source}</p>
              </label>
            ))}
          </div>
        )}
      </section>

      <div className="space-y-2">
        <Button className="h-14 w-full text-base font-extrabold" data-testid="btn-apply-payslip" onClick={onConfirm}>Conferma e applica</Button>
        <Button variant="outline" className="h-12 w-full" onClick={onReplace}>Scegli un altro documento</Button>
        <Button variant="ghost" className="h-12 w-full" data-testid="btn-cancel-payslip" onClick={onCancel}>Annulla senza modificare</Button>
      </div>
      <p className="text-center text-xs text-[#64748B]">Dati rilevati automaticamente: verifica consigliata sul cedolino originale.</p>
    </div>
  );
}

function ReviewField({ label, suffix, value, checked, source, confidence, placeholder, onValue, onChecked }: {
  label: string;
  suffix?: string;
  value: string;
  checked: boolean;
  source: string;
  confidence: Confidence;
  placeholder?: string;
  onValue: (value: string) => void;
  onChecked: (value: boolean) => void;
}) {
  const detected = source !== "Non rilevata";
  return (
    <section className="rounded-2xl border border-[#E2E5EA] bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <Checkbox checked={checked} onCheckedChange={(next) => onChecked(next === true)} className="mt-1 h-5 w-5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label className="font-extrabold">{label}</Label>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${confidenceStyle[confidence]}`}>Affidabilità {confidence}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Input value={value} placeholder={placeholder ?? (detected ? "" : "Non rilevata")} className="h-11" onChange={(event) => onValue(event.target.value)} />
            {suffix && <span className="shrink-0 text-sm font-bold text-[#64748B]">{suffix}</span>}
          </div>
          <p className="mt-2 break-words text-xs text-[#64748B]">Provenienza: {source}</p>
        </div>
      </div>
    </section>
  );
}
