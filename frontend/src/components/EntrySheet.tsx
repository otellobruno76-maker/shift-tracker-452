import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { weekdayLong } from "@/lib/dates";
import { computeShift, fmtHours } from "@/lib/hours";
import { computeSplits } from "@/lib/stats";
import { deleteEntry, useDays, useSettings } from "@/lib/store";
import { DAY_TYPE_LABELS } from "@/lib/types";
import type { EntrySplit } from "@/lib/stats";

interface EntrySheetProps {
  date: string | null;
  onOpenChange: (open: boolean) => void;
}

export default function EntrySheet({ date, onOpenChange }: EntrySheetProps) {
  const days = useDays();
  const settings = useSettings();
  const navigate = useNavigate();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const splits = date ? computeSplits(days, settings).filter((s) => s.entry.date === date) : [];

  return (
    <Sheet open={date !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[85svh] w-full max-w-md overflow-y-auto rounded-t-3xl px-5 pb-10"
        data-testid="day-detail-sheet"
      >
        <SheetHeader className="pb-1">
          <SheetTitle className="font-heading text-xl font-extrabold" data-testid="day-detail-title">
            {date ? weekdayLong(date) : ""}
          </SheetTitle>
        </SheetHeader>

        {splits.length === 0 && (
          <p className="py-6 text-center text-sm text-[#64748B]" data-testid="day-detail-empty">
            Nessuna registrazione in questo giorno.
          </p>
        )}

        <div className="space-y-4 pt-1">
          {splits.map((split) => (
            <SplitCard
              key={split.entry.id}
              split={split}
              onEdit={() => {
                onOpenChange(false);
                navigate(`/inserisci?id=${split.entry.id}`);
              }}
              onCopy={() => {
                onOpenChange(false);
                navigate(`/inserisci?copia=${split.entry.id}`);
              }}
              onDelete={() => setDeleteId(split.entry.id)}
            />
          ))}
        </div>

        <Dialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
          <DialogContent className="rounded-2xl" data-testid="delete-confirm-dialog">
            <DialogHeader>
              <DialogTitle data-testid="delete-confirm-title">
                Vuoi davvero eliminare questa giornata?
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-[#64748B]">
              I totali del mese si aggiorneranno subito.
            </p>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                className="h-12 flex-1 text-base font-bold"
                data-testid="btn-cancel-delete"
                onClick={() => setDeleteId(null)}
              >
                Annulla
              </Button>
              <Button
                variant="destructive"
                className="h-12 flex-1 text-base font-bold"
                data-testid="btn-confirm-delete"
                onClick={() => {
                  if (deleteId) deleteEntry(deleteId);
                  setDeleteId(null);
                  onOpenChange(false);
                  toast.success("Giornata eliminata.");
                }}
              >
                Elimina
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

function SplitCard({
  split,
  onEdit,
  onCopy,
  onDelete,
}: {
  split: EntrySplit;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const e = split.entry;
  const shift =
    e.dayType === "lavoro" && e.start ? computeShift(e.start, e.end, e.breakMinutes) : null;
  return (
    <div
      className="rounded-2xl border border-[#E2E5EA] bg-white p-4 shadow-sm"
      data-testid={`day-detail-entry-${e.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className="bg-[#EFF6FF] text-[#0284C7]">{DAY_TYPE_LABELS[e.dayType]}</Badge>
          {split.festivo && (
            <Badge className="bg-[#FEE2E2] text-[#991B1B]">{split.holidayName ?? "Festivo"}</Badge>
          )}
          {e.notturno && <Badge className="bg-[#E0E7FF] text-[#3730A3]">Notturno</Badge>}
          {e.reperibilita && <Badge className="bg-[#D1FAE5] text-[#065F46]">Reperibilità</Badge>}
          {e.trasferta && <Badge className="bg-[#EDE9FE] text-[#5B21B6]">Trasferta</Badge>}
        </div>
        {e.dayType === "lavoro" && split.net > 0 && (
          <p className="shrink-0 text-xl font-extrabold tabular-nums text-[#0F172A]">
            {fmtHours(split.net)}
          </p>
        )}
      </div>

      {e.dayType === "lavoro" && e.start && (
        <p className="mt-2 text-sm tabular-nums text-[#4B5563]">
          {e.start} – {e.end} · pausa {e.breakMinutes} min
          {shift?.overnight ? " · turno oltre mezzanotte" : ""}
        </p>
      )}
      {split.overtime > 0 && (
        <p className="mt-1 text-sm font-bold tabular-nums text-[#D97706]">
          Straordinario +{fmtHours(split.overtime)}
        </p>
      )}
      {e.note && (
        <p className="mt-2 rounded-lg bg-[#F4F5F8] p-2 text-sm text-[#374151]">"{e.note}"</p>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          variant="outline"
          className="h-11 flex-1 text-sm font-bold"
          data-testid={`btn-edit-day-${e.id}`}
          onClick={onEdit}
        >
          <Pencil className="mr-1.5 h-4 w-4" />
          Modifica
        </Button>
        <Button
          variant="outline"
          className="h-11 flex-1 text-sm font-bold"
          data-testid={`btn-copy-day-${e.id}`}
          onClick={onCopy}
        >
          <Copy className="mr-1.5 h-4 w-4" />
          Duplica
        </Button>
        <Button
          variant="outline"
          className="h-11 flex-1 border-[#FECACA] text-sm font-bold text-[#B91C1C] hover:bg-[#FEF2F2]"
          data-testid={`btn-delete-day-${e.id}`}
          onClick={onDelete}
        >
          <Trash2 className="mr-1.5 h-4 w-4" />
          Elimina
        </Button>
      </div>
    </div>
  );
}
