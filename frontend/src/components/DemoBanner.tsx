import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { removeDemoData, useDemoActive } from "@/lib/store";

export default function DemoBanner() {
  const demo = useDemoActive();
  const [removing, setRemoving] = useState(false);
  if (!demo) return null;
  return (
    <div
      className="mt-4 rounded-2xl border border-[#FCD34D] bg-[#FFFBEB] p-4"
      data-testid="demo-banner"
    >
      <p className="text-sm font-extrabold uppercase tracking-wide text-[#78350F]">
        Dati di prova
      </p>
      <p className="mt-1 text-sm text-[#92400E]">
        Puoi rimuovere i dati di prova identificabili con certezza. Le tue registrazioni e i dati
        di origine incerta resteranno salvati.
      </p>
      <Button
        className="mt-3 h-12 w-full bg-[#D97706] text-base font-bold text-white hover:bg-[#B45309]"
        data-testid="btn-remove-demo-data"
        disabled={removing}
        onClick={async () => {
          setRemoving(true);
          try {
            await removeDemoData();
          } catch {
            toast.error("Impossibile rimuovere i dati di prova. Riprova.");
            setRemoving(false);
            return;
          }
          setRemoving(false);
          toast.success("Dati di prova identificati rimossi. Le tue registrazioni sono state conservate.");
        }}
      >
        Rimuovi dati di prova
      </Button>
    </div>
  );
}
