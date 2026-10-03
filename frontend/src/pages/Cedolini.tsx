import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, FilePlus2, FileText, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inspectPayslipNumber, parsePayslipNumber } from "@/lib/payslipNumber";
import { deletePayslip, savePayslip, usePayslips } from "@/lib/store";
import { MONTHS_IT, type PayslipRecord } from "@/lib/types";

const numberText = (value: number | null | undefined) => value == null ? "" : String(value).replace(".", ",");
const numericLabels = {
  partTimePct: "Part-time %", basePay: "Paga oraria", ordinaryHours: "Ore ordinarie",
  dailyOrdinaryHours: "Ore ordinarie giornaliere", workedHours: "Ore lavorate", workedDays: "Giorni lavorati",
  totalElementsPay: "Totale elementi retributivi", grossTotal: "Lordo / competenze", netTotal: "Netto a pagare",
  dailyPay: "Paga giornaliera", monthlyPay: "Paga mensile", overtimeHours: "Ore straordinarie",
  nightPct: "Notturno %", holidayPct: "Festivo %",
} as const;
type NumericField = keyof typeof numericLabels;
type NumericDraft = Record<NumericField, string>;
const numericFields = Object.keys(numericLabels) as NumericField[];
const numericDraftFor = (record: PayslipRecord | null): NumericDraft => Object.fromEntries(
  numericFields.map((key) => [key, numberText(record?.[key])]),
) as NumericDraft;

function parseNumberList(raw: string): number[] | null {
  if (!raw.trim()) return [];
  const parts = raw.split(/[;\n]+/).map((part) => part.trim());
  if (parts.some((part) => !part)) return null;
  const values = parts.map(parsePayslipNumber);
  return values.every((value): value is number => value !== null && value >= 0) ? values : null;
}

function monthLabel(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return `${MONTHS_IT[index - 1] ?? month} ${year}`;
}

export default function Cedolini() {
  const navigate = useNavigate();
  const payslips = usePayslips();
  const [editing, setEditing] = useState<PayslipRecord | null>(null);
  const [deleting, setDeleting] = useState<PayslipRecord | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const confirmDelete = async () => {
    if (!deleting || deletingBusy) return;
    setDeletingBusy(true);
    try {
      await deletePayslip(deleting.id, deleting);
      setDeleting(null);
      toast.success("Cedolino eliminato.");
    } catch (error) {
      toast.error(error instanceof Error && error.message.includes("un'altra scheda")
        ? error.message : "Impossibile eliminare il cedolino. Riprova.");
    } finally {
      setDeletingBusy(false);
    }
  };

  return (
    <div className="pb-10">
      <header className="flex items-center gap-1 pt-2">
        <Button variant="ghost" size="icon" className="h-12 w-12" aria-label="Indietro" onClick={() => navigate("/impostazioni")}><ChevronLeft className="h-6 w-6" /></Button>
        <div><h1 className="font-heading text-xl font-extrabold">I miei cedolini</h1><p className="text-xs text-[#64748B]">Storico locale mese per mese</p></div>
      </header>

      <Button className="mt-4 h-14 w-full text-base font-extrabold" data-testid="btn-add-payslip" onClick={() => navigate("/configura-cedolino")}><FilePlus2 className="mr-2 h-5 w-5" />Aggiungi cedolino</Button>
      <p className="mt-2 text-xs leading-relaxed text-[#64748B]">Salviamo soltanto i dati confermati. Il PDF o la foto originale non vengono conservati e non sono inviati a servizi esterni.</p>

      {payslips.length === 0 ? (
        <section className="mt-5 rounded-2xl border border-dashed border-[#CBD5E1] bg-white p-6 text-center" data-testid="payslips-empty"><FileText className="mx-auto h-10 w-10 text-[#94A3B8]" /><h2 className="mt-3 font-extrabold">Nessun cedolino salvato</h2><p className="mt-1 text-sm text-[#64748B]">Aggiungi il primo mese per iniziare lo storico.</p></section>
      ) : (
        <div className="mt-5 space-y-3" data-testid="payslips-list">
          {payslips.map((record) => <section key={record.id} className="rounded-2xl border border-[#E2E5EA] bg-white p-4 shadow-sm">
            <button className="w-full text-left" onClick={() => setEditing(record)}>
              <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-extrabold">{monthLabel(record.month)}</h2><p className="mt-0.5 truncate text-xs text-[#64748B]">{record.filename}</p></div>{record.basePay !== null && <span className="rounded-full bg-[#E0F2FE] px-2.5 py-1 text-sm font-bold text-[#0369A1]">{record.basePay.toLocaleString("it-IT")} €/h</span>}</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm"><p>Ordinarie: <b>{record.ordinaryHours ?? "—"} h</b></p><p>Straordinari: <b>{record.overtimeRates.length ? record.overtimeRates.map((rate) => `+${rate}%`).join(", ") : "—"}</b></p><p>CCNL: <b>{record.ccnl || "—"}</b></p><p>Livello: <b>{record.level || "—"}</b></p></div>
            </button>
            <div className="mt-3 grid grid-cols-3 gap-2"><Button variant="outline" className="h-11" onClick={() => setEditing(record)}><Pencil className="mr-1 h-4 w-4" />Apri</Button><Button variant="outline" className="h-11" onClick={() => navigate(`/configura-cedolino?replace=${record.id}`)}><RefreshCw className="mr-1 h-4 w-4" />Sostituisci</Button><Button variant="outline" className="h-11 border-[#FECACA] text-[#B91C1C]" onClick={() => setDeleting(record)}><Trash2 className="mr-1 h-4 w-4" />Elimina</Button></div>
          </section>)}
        </div>
      )}

      <EditDialog record={editing} onClose={() => setEditing(null)} />
      <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open && !deletingBusy) setDeleting(null); }}><DialogContent className="rounded-2xl"><DialogHeader><DialogTitle>Eliminare il cedolino di {deleting ? monthLabel(deleting.month) : "questo mese"}?</DialogTitle></DialogHeader><p className="text-sm text-[#64748B]">Saranno rimossi solo i dati salvati di questo cedolino. Le impostazioni generali non cambieranno.</p><DialogFooter className="gap-2"><Button variant="outline" disabled={deletingBusy} onClick={() => setDeleting(null)}>Annulla</Button><Button variant="destructive" disabled={deletingBusy} onClick={() => void confirmDelete()}>Elimina</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

function EditDialog({ record, onClose }: { record: PayslipRecord | null; onClose: () => void }) {
  const payslips = usePayslips();
  const [draft, setDraft] = useState<PayslipRecord | null>(record);
  const [numericDraft, setNumericDraft] = useState<NumericDraft>(() => numericDraftFor(record));
  const [tariffsDraft, setTariffsDraft] = useState(() => record?.overtimeTariffs?.join("; ") ?? "");
  const [ratesDraft, setRatesDraft] = useState(() => record?.overtimeRates.join("; ") ?? "");
  const [validationError, setValidationError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(record);
    setNumericDraft(numericDraftFor(record));
    setTariffsDraft(record?.overtimeTariffs?.join("; ") ?? "");
    setRatesDraft(record?.overtimeRates.join("; ") ?? "");
    setValidationError("");
  }, [record]);
  const update = (patch: Partial<PayslipRecord>) => draft && setDraft({ ...draft, ...patch });
  const updateNumber = (key: NumericField, value: string) => {
    setNumericDraft((previous) => ({ ...previous, [key]: value }));
    setValidationError("");
  };
  const numericInput = (key: NumericField) => <Input aria-label={numericLabels[key]} inputMode="decimal" value={numericDraft[key]} onChange={(event) => updateNumber(key, event.target.value)} />;
  const confirmSave = async () => {
    if (!draft || !record) return;
    if (!draft.month) return toast.error("Scegli mese e anno.");
    if (payslips.some((item) => item.month === draft.month && item.id !== draft.id)) return toast.error("Esiste già un cedolino per questo mese.");
    if (saving) return;
    const parsed: Partial<Record<NumericField, number | null>> = {};
    for (const key of numericFields) {
      const raw = numericDraft[key].trim();
      if (!raw) { parsed[key] = null; continue; }
      const value = parsePayslipNumber(raw);
      if (value === null) {
        const reason = inspectPayslipNumber(raw).status === "uncertain" ? "ambiguo" : "non valido";
        setValidationError(`Il valore di “${numericLabels[key]}” è ${reason}. Correggilo o svuota il campo per escluderlo.`);
        return;
      }
      if (value < 0 && key !== "grossTotal" && key !== "netTotal") {
        setValidationError(`Il valore di “${numericLabels[key]}” non può essere negativo.`);
        return;
      }
      parsed[key] = value;
    }
    const overtimeTariffs = parseNumberList(tariffsDraft);
    const overtimeRates = parseNumberList(ratesDraft);
    if (overtimeTariffs === null || overtimeRates === null) {
      setValidationError(`Controlla ${overtimeTariffs === null ? "le tariffe" : "le maggiorazioni"} dello straordinario: separa i valori con “;” e correggi quelli ambigui.`);
      return;
    }
    const provenance = { ...(draft.fieldProvenance ?? {}) };
    for (const key of numericFields) {
      if (parsed[key] === null) delete provenance[key];
      else if (parsed[key] !== (record[key] ?? null)) provenance[key] = { source: "manuale", confidence: "alta" };
    }
    for (const [key, value, previous] of [
      ["overtimeTariffs", overtimeTariffs, record.overtimeTariffs ?? []],
      ["overtimeRates", overtimeRates, record.overtimeRates],
    ] as const) {
      if (value.length === 0) delete provenance[key];
      else if (JSON.stringify(value) !== JSON.stringify(previous)) provenance[key] = { source: "manuale", confidence: "alta" };
    }
    for (const key of ["qualification", "contractCode", "ccnl", "level"] as const) {
      if (draft[key] === "") delete provenance[key];
      else if (draft[key] !== record[key]) provenance[key] = { source: "manuale", confidence: "alta" };
    }
    const grossOrNet = /\b(?:lordo|totale\s+competenze|netto)\b/i;
    const updated: PayslipRecord = {
      ...draft, ...parsed, overtimeTariffs, overtimeRates, fieldProvenance: provenance,
      totals: draft.totals.filter((item) => !grossOrNet.test(item.label)),
      items: draft.items?.filter((item) => item.category !== "gross" && item.category !== "net" && !grossOrNet.test(item.originalDescription)),
      updatedAt: new Date().toISOString(),
    };
    setSaving(true);
    try {
      await savePayslip(updated, record);
      onClose();
      toast.success("Correzioni salvate.");
    } catch (error) {
      toast.error(error instanceof Error && (error.message.includes("un'altra scheda") || error.message.includes("Esiste già"))
        ? error.message : "Impossibile salvare le correzioni. Riprova.");
    } finally {
      setSaving(false);
    }
  };
  return <Dialog open={record !== null} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[92svh] overflow-y-auto rounded-2xl"><DialogHeader><DialogTitle>Dettaglio cedolino</DialogTitle></DialogHeader>{draft && <div className="space-y-3">
    <Field label="Mese e anno"><Input type="month" value={draft.month} onChange={(event) => update({ month: event.target.value })} /></Field>
    <Field label="Tipo di retribuzione"><select className="h-11 w-full rounded-md border border-input bg-white px-3" value={draft.payType ?? ""} onChange={(event) => update({ payType: event.target.value as PayslipRecord["payType"] })}><option value="">Non specificato</option><option value="oraria">Oraria</option><option value="giornaliera">Giornaliera</option><option value="mensile">Mensile</option></select></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="Qualifica"><Input value={draft.qualification ?? ""} onChange={(event) => update({ qualification: event.target.value })} /></Field><Field label="Codice contratto"><Input value={draft.contractCode ?? ""} onChange={(event) => update({ contractCode: event.target.value })} /></Field></div>
    <Field label="Part-time %">{numericInput("partTimePct")}</Field>
    <div className="grid grid-cols-2 gap-3"><Field label="Paga oraria">{numericInput("basePay")}</Field><Field label="Ore ordinarie">{numericInput("ordinaryHours")}</Field></div>
    <Field label="Ore ordinarie giornaliere">{numericInput("dailyOrdinaryHours")}</Field>
    <div className="grid grid-cols-2 gap-3"><Field label="Ore lavorate">{numericInput("workedHours")}</Field><Field label="Giorni lavorati">{numericInput("workedDays")}</Field></div>
    <Field label="Totale elementi retributivi">{numericInput("totalElementsPay")}</Field>
    <div className="grid grid-cols-2 gap-3"><Field label="Lordo / competenze">{numericInput("grossTotal")}</Field><Field label="Netto a pagare">{numericInput("netTotal")}</Field></div>
    <p className="text-xs text-[#64748B]">Svuota Lordo o Netto per escludere quel valore dai confronti.</p>
    <div className="grid grid-cols-2 gap-3"><Field label="Paga giornaliera">{numericInput("dailyPay")}</Field><Field label="Paga mensile">{numericInput("monthlyPay")}</Field></div>
    <div className="grid grid-cols-2 gap-3"><Field label="Ore straordinarie">{numericInput("overtimeHours")}</Field><Field label="Tariffe straordinario"><Input aria-label="Tariffe straordinario" value={tariffsDraft} onChange={(event) => { setTariffsDraft(event.target.value); setValidationError(""); }} /></Field></div>
    <Field label="Maggiorazioni straordinari (%)"><Input aria-label="Maggiorazioni straordinari (%)" value={ratesDraft} onChange={(event) => { setRatesDraft(event.target.value); setValidationError(""); }} /></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="Notturno %">{numericInput("nightPct")}</Field><Field label="Festivo %">{numericInput("holidayPct")}</Field></div>
    <div className="grid grid-cols-2 gap-3"><Field label="CCNL"><Input value={draft.ccnl} onChange={(event) => update({ ccnl: event.target.value })} /></Field><Field label="Livello"><Input value={draft.level} onChange={(event) => update({ level: event.target.value })} /></Field></div>
    {draft.allowances.length > 0 && <div className="rounded-xl bg-[#F8FAFC] p-3"><p className="text-sm font-extrabold">Indennità</p>{draft.allowances.map((item, index) => <p key={index} className="mt-1 text-sm">{item.name}: {item.amount === null ? "importo non rilevato" : `${item.amount.toLocaleString("it-IT")} €`}</p>)}</div>}
    {draft.totals.length > 0 && <div className="rounded-xl bg-[#F8FAFC] p-3"><p className="text-sm font-extrabold">Totali rilevati</p>{draft.totals.map((item, index) => <p key={index} className="mt-1 text-sm">{item.label}: {item.value.toLocaleString("it-IT")}</p>)}</div>}
    <p className="text-xs text-[#64748B]">Caricato il {new Date(draft.uploadedAt).toLocaleDateString("it-IT")} · Base pronta per il futuro confronto con le ore registrate nell’app.</p>
  </div>}{validationError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{validationError}</p>}<DialogFooter className="gap-2"><Button variant="outline" disabled={saving} onClick={onClose}>Chiudi</Button><Button data-testid="btn-save-payslip-edits" disabled={saving} onClick={() => void confirmSave()}>Salva correzioni</Button></DialogFooter></DialogContent></Dialog>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><Label className="text-sm font-bold">{label}</Label><div className="mt-1">{children}</div></div>;
}
