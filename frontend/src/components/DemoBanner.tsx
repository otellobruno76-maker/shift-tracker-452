import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { removeDemoData, useDemoActive } from "@/lib/store";

export default function DemoBanner() {
  const demo = useDemoActive();
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
        Stai guardando giorni di esempio per provare l'app. Quando vuoi, rimuovili e inizia con i
        tuoi dati reali.
      </p>
      <Button
        className="mt-3 h-12 w-full bg-[#D97706] text-base font-bold text-white hover:bg-[#B45309]"
        data-testid="btn-remove-demo-data"
        onClick={() => {
          removeDemoData();
          toast.success("Dati di prova rimossi. L'app è vuota e pronta per i tuoi dati.");
        }}
      >
        Rimuovi dati di prova
      </Button>
    </div>
  );
}
