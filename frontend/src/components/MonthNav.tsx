import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addMonthsKey, monthLabel, parseMonthKey } from "@/lib/dates";

interface MonthNavProps {
  value: string;
  onChange: (next: string) => void;
}

export default function MonthNav({ value, onChange }: MonthNavProps) {
  const { year, month } = parseMonthKey(value);
  return (
    <div
      className="flex items-center justify-between rounded-2xl border border-[#E2E5EA] bg-white p-1 shadow-sm"
      data-testid="month-nav"
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-12 w-12 rounded-xl"
        data-testid="month-prev"
        aria-label="Mese precedente"
        onClick={() => onChange(addMonthsKey(value, -1))}
      >
        <ChevronLeft className="h-6 w-6" />
      </Button>
      <div className="text-base font-bold tracking-tight text-[#0F172A]" data-testid="month-label">
        {monthLabel(year, month)}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-12 w-12 rounded-xl"
        data-testid="month-next"
        aria-label="Mese successivo"
        onClick={() => onChange(addMonthsKey(value, 1))}
      >
        <ChevronRight className="h-6 w-6" />
      </Button>
    </div>
  );
}
