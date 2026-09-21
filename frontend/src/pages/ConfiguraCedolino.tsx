import { useRef, useState } from "react";
import { ChevronLeft, FileSearch, LockKeyhole, Upload } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { extractDocumentStructure } from "@/lib/documentText";
import {
  buildPayslipSettingsPatch,
  emptyPayslipAnalysis,
  estimatedDailyValue,
  reliablePayslipFieldCount,
  type Confidence,
  type PayslipAnalysis,
} from "@/lib/payslip";
import { analyzeStructuredPayslip } from "@/lib/payslipStructured";
import { initialReview, updateReviewValue, type ReviewState } from "@/lib/payslipReview";
import { savePayslip, saveSettings, usePayslips, useSettings } from "@/lib/store";
import { uid, type PayslipRecord } from "@/lib/types";


const confidenceStyle: Record<Confidence, string> = {
  alta: "bg-[#DCFCE7] text-[#166534]",
  media: "bg-[#FEF3C7] text-[#92400E]",
  bassa: "bg-[#FEE2E2] text-[#991B1B]",
};

function parseNumber(value: string): number | null {
  const parsed = Number(value.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export default function ConfiguraCedolino() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const settings = useSettings();
  const payslips = usePayslips();
  const replaceId = params.get("replace");
  const replaced = payslips.find((item) => item.id === replaceId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [analysis, setAnalysis] = useState<PayslipAnalysis | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ label: "", progress: 0 });
  const [error, setError] = useState("");
  const [filename, setFilename] = useState("");
  const [pendingSettings, setPendingSettings] = useState<Partial<typeof settings> | null>(null);

  const analyze = async (file: File) => {
    setBusy(true);
    setError("");
    setAnalysis(null);
    setReview(null);
    setFilename(file.name);
    try {
      const document = await extractDocumentStructure(file, setProgress);
      const detected = analyzeStructuredPayslip(document);
      setAnalysis(detected);
      setReview(initialReview(detected, replaced?.month ?? new Date().toISOString().slice(0, 7), settings.dailyOrdinaryHours));
    } catch {
      const detected = emptyPayslipAnalysis();
      setAnalysis(detected);
      setReview(initialReview(detected, replaced?.month ?? new Date().toISOString().slice(0, 7), settings.dailyOrdinaryHours));
      setError("Non siamo riusciti a leggere con sicurezza tutti i dati di questo cedolino. Completa i campi mancanti.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!review) return;
    const chosen = review.selected;
    const hasValue = (key: keyof ReviewState) => String(review[key] ?? "").trim() !== "";
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

    if (!review.month) {
      toast.error("Scegli mese e anno del cedolino.");
      return;
    }
    const existingMonth = payslips.find((item) => item.month === review.month && item.id !== replaced?.id);
    if (existingMonth) {
      toast.error("Esiste già un cedolino per questo mese. Aprilo e usa “Sostituisci”.");
      return;
    }
    const now = new Date().toISOString();
    const record: PayslipRecord = {
      id: replaced?.id ?? uid(),
      month: review.month,
      filename: filename || "Inserimento manuale",
      payType: review.payType,
      qualification: chosen.qualification ? review.qualification.trim() : "",
      contractCode: chosen.contractCode ? review.contractCode.trim() : "",
      partTimePct: chosen.partTimePct ? parseNumber(review.partTimePct) : null,
      basePay: chosen.basePay ? parseNumber(review.basePay) : null,
      dailyPay: chosen.dailyPay ? parseNumber(review.dailyPay) : null,
      monthlyPay: chosen.monthlyPay ? parseNumber(review.monthlyPay) : null,
      ordinaryHours: chosen.ordinaryHours ? parseNumber(review.ordinaryHours) : null,
      dailyOrdinaryHours: hasValue("dailyOrdinaryHours") ? parseNumber(review.dailyOrdinaryHours) : null,
      workedHours: chosen.workedHours ? parseNumber(review.workedHours) : null,
      workedDays: chosen.workedDays ? parseNumber(review.workedDays) : null,
      totalElementsPay: chosen.totalElementsPay ? parseNumber(review.totalElementsPay) : null,
      grossTotal: hasValue("grossTotal") ? parseNumber(review.grossTotal) : null,
      netTotal: hasValue("netTotal") ? parseNumber(review.netTotal) : null,
      overtimeHours: chosen.overtimeHours ? parseNumber(review.overtimeHours) : null,
      overtimeTariffs: chosen.overtimeTariffs ? review.overtimeTariffs.split(/[;,]/).map(parseNumber).filter((value): value is number => value !== null) : [],
      overtimeRates: values.overtimeRates ?? [],
      nightPct: chosen.nightPct ? parseNumber(review.nightPct) : null,
      holidayPct: chosen.holidayPct ? parseNumber(review.holidayPct) : null,
      allowances: values.allowances ?? [],
      ccnl: chosen.ccnl ? review.ccnl.trim() : "",
      level: chosen.level ? review.level.trim() : "",
      totals: review.totals,
      uploadedAt: replaced?.uploadedAt ?? now,
      updatedAt: now,
    };
    savePayslip(record);
    const patch = buildPayslipSettingsPatch(values);
    const changed = Object.entries(patch).some(([key, value]) => key !== "payslipConfiguredAt" && JSON.stringify(settings[key as keyof typeof settings]) !== JSON.stringify(value));
    if (changed) setPendingSettings(patch);
    else { toast.success("Cedolino salvato nello storico."); navigate("/cedolini"); }
  };

  return (
    <div className="pb-10">
      <header className="flex items-center gap-1 pt-2">
        <Button variant="ghost" size="icon" className="h-12 w-12" aria-label="Indietro" onClick={() => navigate("/impostazioni")}>
          <ChevronLeft className="h-6 w-6" />
        </Button>
        <div>
          <h1 className="font-heading text-xl font-extrabold" data-testid="payslip-config-title">{replaced ? "Sostituisci cedolino" : "Configura da cedolino"}</h1>
          <p className="text-xs text-[#64748B]">Stima automatica con verifica consigliata</p>
        </div>
      </header>

      <section className="mt-4 rounded-2xl border border-[#BAE6FD] bg-[#F0F9FF] p-4">
        <div className="flex gap-3">
          <LockKeyhole className="mt-0.5 h-6 w-6 shrink-0 text-[#0369A1]" />
          <div>
            <h2 className="font-bold text-[#0C4A6E]">Il documento resta sul dispositivo</h2>
            <p className="mt-1 text-sm leading-relaxed text-[#075985]">
              L'analisi avviene in questa app. Il cedolino non viene caricato su server esterni. Salviamo solo i dati che confermi, non il PDF o la foto originale.
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
            <div className="mt-4 rounded-xl bg-[#FFF7ED] p-3 text-sm text-[#9A3412]" data-testid="payslip-error">
              <p className="font-bold">Puoi continuare manualmente</p>
              <p className="mt-1">{error}</p>
            </div>
          )}
          {!busy && <Button variant="outline" className="mt-3 h-12 w-full" data-testid="btn-manual-payslip" onClick={() => { const detected = emptyPayslipAnalysis(); setFilename("Inserimento manuale"); setAnalysis(detected); setReview(initialReview(detected, replaced?.month ?? new Date().toISOString().slice(0, 7), settings.dailyOrdinaryHours)); }}>Compila senza caricare un documento</Button>}
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
      <Dialog open={pendingSettings !== null} onOpenChange={() => undefined}>
        <DialogContent className="rounded-2xl" data-testid="settings-comparison-dialog">
          <DialogHeader><DialogTitle>Vuoi aggiornare le impostazioni?</DialogTitle></DialogHeader>
          <p className="text-sm text-[#64748B]">Il cedolino è già salvato nello storico. Alcuni valori sono diversi da quelli configurati nell’app.</p>
          {pendingSettings && <div className="max-h-52 space-y-2 overflow-y-auto rounded-xl bg-[#F8FAFC] p-3 text-sm">
            {pendingSettings.basePay !== undefined && pendingSettings.basePay !== settings.basePay && <p>Paga oraria: <b>{settings.basePay} → {pendingSettings.basePay} €/h</b></p>}
            {pendingSettings.overtimePct !== undefined && pendingSettings.overtimePct !== settings.overtimePct && <p>Straordinario: <b>{settings.overtimePct}% → {pendingSettings.overtimePct}%</b></p>}
            {pendingSettings.nightPct !== undefined && pendingSettings.nightPct !== settings.nightPct && <p>Notturno: <b>{settings.nightPct}% → {pendingSettings.nightPct}%</b></p>}
            {pendingSettings.holidayPct !== undefined && pendingSettings.holidayPct !== settings.holidayPct && <p>Festivo: <b>{settings.holidayPct}% → {pendingSettings.holidayPct}%</b></p>}
            {pendingSettings.ccnl !== undefined && pendingSettings.ccnl !== settings.ccnl && <p>CCNL: <b>{settings.ccnl || "non impostato"} → {pendingSettings.ccnl}</b></p>}
            {pendingSettings.contractLevel !== undefined && pendingSettings.contractLevel !== settings.contractLevel && <p>Livello: <b>{settings.contractLevel || "non impostato"} → {pendingSettings.contractLevel}</b></p>}
          </div>}
          <DialogFooter className="gap-2"><Button variant="outline" data-testid="btn-keep-settings" onClick={() => { setPendingSettings(null); toast.success("Cedolino salvato. Impostazioni non modificate."); navigate("/cedolini"); }}>No, mantieni attuali</Button><Button data-testid="btn-update-settings" onClick={() => { if (pendingSettings) saveSettings(pendingSettings); setPendingSettings(null); toast.success("Cedolino salvato e impostazioni aggiornate."); navigate("/cedolini"); }}>Sì, aggiorna</Button></DialogFooter>
        </DialogContent>
      </Dialog>
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
  const updateValue = (key: "qualification" | "contractCode" | "partTimePct" | "basePay" | "dailyPay" | "monthlyPay" | "ordinaryHours" | "dailyOrdinaryHours" | "workedHours" | "workedDays" | "totalElementsPay" | "grossTotal" | "netTotal" | "overtimeHours" | "overtimeTariffs" | "overtimeRates" | "nightPct" | "holidayPct" | "ccnl" | "level", value: string) => onChange(updateReviewValue(review, key, value));
  const updateSelected = (key: string, value: boolean) => onChange({ ...review, selected: { ...review.selected, [key]: value } });
  const sourceForRates = analysis.overtimeRates.length
    ? analysis.overtimeRates.map((rate) => rate.source).join(" · ")
    : "Non rilevata";
  const rateConfidence: Confidence = analysis.overtimeRates.some((rate) => rate.confidence === "media") ? "media" : analysis.overtimeRates[0]?.confidence ?? "bassa";
  const incomplete = reliablePayslipFieldCount(analysis) < 4;
  const estimatedDaily = estimatedDailyValue(parseNumber(review.basePay), parseNumber(review.dailyOrdinaryHours));

  return (
    <div className="mt-4 space-y-4" data-testid="payslip-review">
      <section className="rounded-2xl border border-[#BAE6FD] bg-[#F0F9FF] p-4">
        <h2 className="text-lg font-extrabold text-[#0C4A6E]">Completa i dati del cedolino</h2>
        <p className="mt-1 text-sm text-[#075985]">Abbiamo precompilato quello che abbiamo riconosciuto. Correggi o completa soltanto ciò che ti serve.</p>
        {incomplete && <p className="mt-3 rounded-xl bg-white/80 p-3 text-sm font-semibold text-[#9A3412]">Non siamo riusciti a leggere con sicurezza tutti i dati di questo cedolino. Abbiamo precompilato quello che abbiamo riconosciuto: completa i campi mancanti.</p>}
      </section>
      <section className="rounded-2xl border border-[#E2E5EA] bg-white p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-[#64748B]">Documento analizzato</p>
        <p className="mt-1 truncate text-sm font-bold">{filename}</p>
        <p className="mt-2 text-xs text-[#64748B]">Controlla ogni valore. Il salvataggio nello storico non modifica automaticamente le impostazioni.</p>
        <div className="mt-3"><Label htmlFor="payslip-month" className="font-extrabold">Mese e anno</Label><Input id="payslip-month" type="month" className="mt-1 h-12" value={review.month} onChange={(event) => onChange({ ...review, month: event.target.value })} /></div>
        <div className="mt-3"><Label htmlFor="pay-type" className="font-extrabold">Tipo di retribuzione</Label><select id="pay-type" className="mt-1 h-12 w-full rounded-md border border-input bg-white px-3 text-base" value={review.payType} onChange={(event) => onChange({ ...review, payType: event.target.value as ReviewState["payType"] })}><option value="">Non specificato</option><option value="oraria">Oraria</option><option value="giornaliera">Giornaliera</option><option value="mensile">Mensile</option></select></div>
      </section>

      <ReviewField label="Qualifica" value={review.qualification} checked={review.selected.qualification} source={analysis.qualification.source} confidence={analysis.qualification.confidence} onValue={(value) => updateValue("qualification", value)} onChecked={(value) => updateSelected("qualification", value)} />
      <ReviewField label="Codice contratto" value={review.contractCode} checked={review.selected.contractCode} source={analysis.contractCode.source} confidence={analysis.contractCode.confidence} onValue={(value) => updateValue("contractCode", value)} onChecked={(value) => updateSelected("contractCode", value)} />
      <ReviewField label="Part-time" suffix="%" value={review.partTimePct} checked={review.selected.partTimePct} source={analysis.partTimePct.source} confidence={analysis.partTimePct.confidence} onValue={(value) => updateValue("partTimePct", value)} onChecked={(value) => updateSelected("partTimePct", value)} />
      <ReviewField label="Paga oraria di riferimento" suffix="€/h" value={review.basePay} checked={review.selected.basePay} source={analysis.basePay.source} confidence={analysis.basePay.confidence} onValue={(value) => updateValue("basePay", value)} onChecked={(value) => updateSelected("basePay", value)} />
      <ReviewField label="Retribuzione giornaliera" suffix="€/giorno" value={review.dailyPay} checked={review.selected.dailyPay} source={analysis.dailyPay.source} confidence={analysis.dailyPay.confidence} onValue={(value) => updateValue("dailyPay", value)} onChecked={(value) => updateSelected("dailyPay", value)} />
      <ReviewField label="Retribuzione mensile" suffix="€/mese" value={review.monthlyPay} checked={review.selected.monthlyPay} source={analysis.monthlyPay.source} confidence={analysis.monthlyPay.confidence} onValue={(value) => updateValue("monthlyPay", value)} onChecked={(value) => updateSelected("monthlyPay", value)} />
      <ReviewField label="Ore ordinarie indicate" suffix="ore" value={review.ordinaryHours} checked={review.selected.ordinaryHours} source={analysis.ordinaryHours.source} confidence={analysis.ordinaryHours.confidence} onValue={(value) => updateValue("ordinaryHours", value)} onChecked={(value) => updateSelected("ordinaryHours", value)} />
      <ReviewField label="Ore ordinarie giornaliere" suffix="ore/giorno" value={review.dailyOrdinaryHours} checked={review.dailyOrdinaryHours.trim() !== ""} source="Valore proposto dalle Impostazioni" confidence="media" onValue={(value) => updateValue("dailyOrdinaryHours", value)} onChecked={() => undefined} />
      {estimatedDaily !== null && <section className="rounded-2xl border border-dashed border-[#93C5FD] bg-[#EFF6FF] p-4"><p className="text-sm font-bold text-[#1E40AF]">Valore giornaliero stimato</p><p className="mt-1 text-xl font-extrabold text-[#1E3A8A]">{estimatedDaily.toLocaleString("it-IT", { minimumFractionDigits: 2 })} €</p><p className="mt-1 text-xs text-[#1D4ED8]">Calcolato: paga oraria × ore ordinarie giornaliere. Non è un dato letto dal cedolino.</p></section>}
      <ReviewField label="Ore lavorate" suffix="ore" value={review.workedHours} checked={review.selected.workedHours} source={analysis.workedHours.source} confidence={analysis.workedHours.confidence} onValue={(value) => updateValue("workedHours", value)} onChecked={(value) => updateSelected("workedHours", value)} />
      <ReviewField label="Giorni lavorati" suffix="giorni" value={review.workedDays} checked={review.selected.workedDays} source={analysis.workedDays.source} confidence={analysis.workedDays.confidence} onValue={(value) => updateValue("workedDays", value)} onChecked={(value) => updateSelected("workedDays", value)} />
      <ReviewField label="Totale elementi retributivi" suffix="€" value={review.totalElementsPay} checked={review.selected.totalElementsPay} source={analysis.totalElementsPay.source} confidence={analysis.totalElementsPay.confidence} onValue={(value) => updateValue("totalElementsPay", value)} onChecked={(value) => updateSelected("totalElementsPay", value)} />
      <ReviewField label="Lordo / totale competenze" suffix="€" value={review.grossTotal} checked={review.selected.grossTotal} source={analysis.totals.find((item) => /lordo|competenze/i.test(item.label))?.source ?? "Non rilevata"} confidence={analysis.totals.some((item) => /lordo|competenze/i.test(item.label)) ? "alta" : "bassa"} onValue={(value) => updateValue("grossTotal", value)} onChecked={(value) => updateSelected("grossTotal", value)} />
      <ReviewField label="Netto a pagare" suffix="€" value={review.netTotal} checked={review.selected.netTotal} source={analysis.totals.find((item) => /netto/i.test(item.label))?.source ?? "Non rilevata"} confidence={analysis.totals.some((item) => /netto/i.test(item.label)) ? "alta" : "bassa"} onValue={(value) => updateValue("netTotal", value)} onChecked={(value) => updateSelected("netTotal", value)} />
      <ReviewField label="Ore straordinarie indicate" suffix="ore" value={review.overtimeHours} checked={review.selected.overtimeHours} source={analysis.overtimeHours.source} confidence={analysis.overtimeHours.confidence} onValue={(value) => updateValue("overtimeHours", value)} onChecked={(value) => updateSelected("overtimeHours", value)} />
      <ReviewField label="Tariffe straordinarie" suffix="€/h" value={review.overtimeTariffs} checked={review.selected.overtimeTariffs} source={analysis.overtimeTariffs.map((item) => item.source).join(" · ") || "Non rilevata"} confidence={analysis.overtimeTariffs[0]?.confidence ?? "bassa"} onValue={(value) => updateValue("overtimeTariffs", value)} onChecked={(value) => updateSelected("overtimeTariffs", value)} />
      <ReviewField label="Maggiorazioni straordinario" suffix="%" value={review.overtimeRates} checked={review.selected.overtimeRates} source={sourceForRates} confidence={rateConfidence} placeholder="Es. 15; 20; 25" onValue={(value) => updateValue("overtimeRates", value)} onChecked={(value) => updateSelected("overtimeRates", value)} />
      <ReviewField label="Maggiorazione notturna" suffix="%" value={review.nightPct} checked={review.selected.nightPct} source={analysis.nightPct.source} confidence={analysis.nightPct.confidence} onValue={(value) => updateValue("nightPct", value)} onChecked={(value) => updateSelected("nightPct", value)} />
      <ReviewField label="Maggiorazione festiva" suffix="%" value={review.holidayPct} checked={review.selected.holidayPct} source={analysis.holidayPct.source} confidence={analysis.holidayPct.confidence} onValue={(value) => updateValue("holidayPct", value)} onChecked={(value) => updateSelected("holidayPct", value)} />
      <ReviewField label="CCNL" value={review.ccnl} checked={review.selected.ccnl} source={analysis.ccnl.source} confidence={analysis.ccnl.confidence} onValue={(value) => updateValue("ccnl", value)} onChecked={(value) => updateSelected("ccnl", value)} />
      <ReviewField label="Livello" value={review.level} checked={review.selected.level} source={analysis.level.source} confidence={analysis.level.confidence} onValue={(value) => updateValue("level", value)} onChecked={(value) => updateSelected("level", value)} />

      <section className="rounded-2xl border border-[#E2E5EA] bg-white p-4 shadow-sm">
        <h2 className="font-extrabold">Indennità riconoscibili</h2>
        {review.allowances.length === 0 ? (
          <p className="mt-2 text-sm text-[#64748B]">Nessuna indennità rilevata. Puoi aggiungerla manualmente se presente.</p>
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
                  <Input className="h-10" placeholder="Nome indennità" value={allowance.name} onChange={(event) => { const items = [...review.allowances]; items[index] = { ...allowance, name: event.target.value }; onChange({ ...review, allowances: items }); }} />
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
        <Button variant="outline" className="mt-3 h-11 w-full" onClick={() => onChange({ ...review, allowances: [...review.allowances, { name: "", amount: null, amountText: "", source: "Inserimento manuale", confidence: "bassa", selected: true }] })}>Aggiungi indennità</Button>
      </section>

      <section className="rounded-2xl border border-[#E2E5EA] bg-white p-4 shadow-sm"><h2 className="font-extrabold">Totali rilevabili</h2>{review.totals.length === 0 ? <p className="mt-2 text-sm text-[#64748B]">Non rilevati</p> : <div className="mt-2 space-y-1">{review.totals.map((total, index) => <p key={index} className="text-sm">{total.label}: <b>{total.value.toLocaleString("it-IT")}</b></p>)}</div>}</section>

      <div className="space-y-2">
        <Button className="h-14 w-full text-base font-extrabold" data-testid="btn-apply-payslip" onClick={onConfirm}>Salva cedolino</Button>
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
            {detected && <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${confidenceStyle[confidence]}`}>Affidabilità {confidence}</span>}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Input value={value} placeholder={placeholder ?? (detected ? "" : "Non rilevata")} className="h-11" onChange={(event) => onValue(event.target.value)} />
            {suffix && <span className="shrink-0 text-sm font-bold text-[#64748B]">{suffix}</span>}
          </div>
          {detected && <p className="mt-2 break-words text-xs text-[#64748B]">Provenienza: {source}</p>}
        </div>
      </div>
    </section>
  );
}
