import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, FilePlus2, FileText, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deletePayslip, savePayslip, usePayslips } from "@/lib/store";
import { MONTHS_IT, type PayslipRecord } from "@/lib/types";

const numberText = (value: number | null) => value === null ? "" : String(value).replace(".", ",");
const parseNumber = (value: string) => {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

function monthLabel(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return `${MONTHS_IT[index - 1] ?? month} ${year}`;
}

export default function Cedolini() {
  const navigate = useNavigate();
  const payslips = usePayslips();
  const [editing, setEditing] = useState<PayslipRecord | null>(null);
  const [deleting, setDeleting] = useState<PayslipRecord | null>(null);

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
      <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}><DialogContent className="rounded-2xl"><DialogHeader><DialogTitle>Eliminare il cedolino di {deleting ? monthLabel(deleting.month) : "questo mese"}?</DialogTitle></DialogHeader><p className="text-sm text-[#64748B]">Saranno rimossi solo i dati salvati di questo cedolino. Le impostazioni generali non cambieranno.</p><DialogFooter className="gap-2"><Button variant="outline" onClick={() => setDeleting(null)}>Annulla</Button><Button variant="destructive" onClick={() => { if (deleting) deletePayslip(deleting.id); setDeleting(null); toast.success("Cedolino eliminato."); }}>Elimina</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

function EditDialog({ record, onClose }: { record: PayslipRecord | null; onClose: () => void }) {
  const payslips = usePayslips();
  const [draft, setDraft] = useState<PayslipRecord | null>(record);
  useEffect(() => setDraft(record), [record]);
  const update = (patch: Partial<PayslipRecord>) => draft && setDraft({ ...draft, ...patch });
  return <Dialog open={record !== null} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[92svh] overflow-y-auto rounded-2xl"><DialogHeader><DialogTitle>Dettaglio cedolino</DialogTitle></DialogHeader>{draft && <div className="space-y-3">
    <Field label="Mese e anno"><Input type="month" value={draft.month} onChange={(event) => update({ month: event.target.value })} /></Field>
    <Field label="Tipo di retribuzione"><select className="h-11 w-full rounded-md border border-input bg-white px-3" value={draft.payType ?? ""} onChange={(event) => update({ payType: event.target.value as PayslipRecord["payType"] })}><option value="">Non specificato</option><option value="oraria">Oraria</option><option value="giornaliera">Giornaliera</option><option value="mensile">Mensile</option></select></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="Qualifica"><Input value={draft.qualification ?? ""} onChange={(event) => update({ qualification: event.target.value })} /></Field><Field label="Codice contratto"><Input value={draft.contractCode ?? ""} onChange={(event) => update({ contractCode: event.target.value })} /></Field></div>
    <Field label="Part-time %"><Input inputMode="decimal" value={numberText(draft.partTimePct ?? null)} onChange={(event) => update({ partTimePct: parseNumber(event.target.value) })} /></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="Paga oraria"><Input inputMode="decimal" value={numberText(draft.basePay)} onChange={(event) => update({ basePay: parseNumber(event.target.value) })} /></Field><Field label="Ore ordinarie"><Input inputMode="decimal" value={numberText(draft.ordinaryHours)} onChange={(event) => update({ ordinaryHours: parseNumber(event.target.value) })} /></Field></div>
    <Field label="Ore ordinarie giornaliere"><Input inputMode="decimal" value={numberText(draft.dailyOrdinaryHours ?? null)} onChange={(event) => update({ dailyOrdinaryHours: parseNumber(event.target.value) })} /></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="Ore lavorate"><Input inputMode="decimal" value={numberText(draft.workedHours ?? null)} onChange={(event) => update({ workedHours: parseNumber(event.target.value) })} /></Field><Field label="Giorni lavorati"><Input inputMode="decimal" value={numberText(draft.workedDays ?? null)} onChange={(event) => update({ workedDays: parseNumber(event.target.value) })} /></Field></div>
    <Field label="Totale elementi retributivi"><Input inputMode="decimal" value={numberText(draft.totalElementsPay ?? null)} onChange={(event) => update({ totalElementsPay: parseNumber(event.target.value) })} /></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="Lordo / competenze"><Input inputMode="decimal" value={numberText(draft.grossTotal ?? null)} onChange={(event) => update({ grossTotal: parseNumber(event.target.value) })} /></Field><Field label="Netto a pagare"><Input inputMode="decimal" value={numberText(draft.netTotal ?? null)} onChange={(event) => update({ netTotal: parseNumber(event.target.value) })} /></Field></div>
    <div className="grid grid-cols-2 gap-3"><Field label="Paga giornaliera"><Input inputMode="decimal" value={numberText(draft.dailyPay ?? null)} onChange={(event) => update({ dailyPay: parseNumber(event.target.value) })} /></Field><Field label="Paga mensile"><Input inputMode="decimal" value={numberText(draft.monthlyPay ?? null)} onChange={(event) => update({ monthlyPay: parseNumber(event.target.value) })} /></Field></div>
    <div className="grid grid-cols-2 gap-3"><Field label="Ore straordinarie"><Input inputMode="decimal" value={numberText(draft.overtimeHours ?? null)} onChange={(event) => update({ overtimeHours: parseNumber(event.target.value) })} /></Field><Field label="Tariffe straordinario"><Input value={(draft.overtimeTariffs ?? []).join("; ")} onChange={(event) => update({ overtimeTariffs: event.target.value.split(/[;,]/).map(parseNumber).filter((value): value is number => value !== null) })} /></Field></div>
    <Field label="Maggiorazioni straordinari (%)"><Input value={draft.overtimeRates.join("; ")} onChange={(event) => update({ overtimeRates: event.target.value.split(/[;,]/).map((part) => parseNumber(part)).filter((value): value is number => value !== null) })} /></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="Notturno %"><Input value={numberText(draft.nightPct)} onChange={(event) => update({ nightPct: parseNumber(event.target.value) })} /></Field><Field label="Festivo %"><Input value={numberText(draft.holidayPct)} onChange={(event) => update({ holidayPct: parseNumber(event.target.value) })} /></Field></div>
    <div className="grid grid-cols-2 gap-3"><Field label="CCNL"><Input value={draft.ccnl} onChange={(event) => update({ ccnl: event.target.value })} /></Field><Field label="Livello"><Input value={draft.level} onChange={(event) => update({ level: event.target.value })} /></Field></div>
    {draft.allowances.length > 0 && <div className="rounded-xl bg-[#F8FAFC] p-3"><p className="text-sm font-extrabold">Indennità</p>{draft.allowances.map((item, index) => <p key={index} className="mt-1 text-sm">{item.name}: {item.amount === null ? "importo non rilevato" : `${item.amount.toLocaleString("it-IT")} €`}</p>)}</div>}
    {draft.totals.length > 0 && <div className="rounded-xl bg-[#F8FAFC] p-3"><p className="text-sm font-extrabold">Totali rilevati</p>{draft.totals.map((item, index) => <p key={index} className="mt-1 text-sm">{item.label}: {item.value.toLocaleString("it-IT")}</p>)}</div>}
    <p className="text-xs text-[#64748B]">Caricato il {new Date(draft.uploadedAt).toLocaleDateString("it-IT")} · Base pronta per il futuro confronto con le ore registrate nell’app.</p>
  </div>}<DialogFooter className="gap-2"><Button variant="outline" onClick={onClose}>Chiudi</Button><Button data-testid="btn-save-payslip-edits" onClick={() => { if (!draft?.month) return toast.error("Scegli mese e anno."); if (payslips.some((item) => item.month === draft.month && item.id !== draft.id)) return toast.error("Esiste già un cedolino per questo mese."); savePayslip({ ...draft, updatedAt: new Date().toISOString() }); onClose(); toast.success("Correzioni salvate."); }}>Salva correzioni</Button></DialogFooter></DialogContent></Dialog>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><Label className="text-sm font-bold">{label}</Label><div className="mt-1">{children}</div></div>;
}
