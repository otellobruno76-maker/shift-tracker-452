import { useEffect, useRef } from "react";
import MonthNav from "./MonthNav";
import { isoDayList, parseMonthKey, weekdayShort } from "@/lib/dates";
import type { DayEntry } from "@/lib/types";

export default function DayNavigator({ date, days, onSelect }: {
  date: string; days: DayEntry[]; onSelect: (date: string) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const { year, month } = parseMonthKey(date.slice(0, 7));
  useEffect(() => {
    const selected = rail.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (selected && rail.current) {
      rail.current.scrollLeft = selected.offsetLeft - rail.current.offsetLeft - rail.current.clientWidth / 2 + selected.clientWidth / 2;
    }
  }, [date]);
  return <section className="mt-4 min-w-0" aria-label="Giorni del mese">
    <MonthNav value={date.slice(0, 7)} onChange={(month) => onSelect(`${month}-01`)} />
    <div ref={rail} className="relative mt-2 flex max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-3" data-testid="day-navigator">
      {isoDayList(year, month).map((day) => <button key={day} type="button"
        aria-label={`Giorno ${Number(day.slice(-2))}`} aria-pressed={day === date}
        data-testid={`select-day-${day}`} onClick={() => onSelect(day)}
        className={`flex min-h-16 w-14 shrink-0 flex-col items-center justify-center rounded-xl border text-sm ${day === date ? "border-[#0284C7] bg-[#0284C7] text-white" : "border-[#E2E5EA] bg-white text-[#0F172A]"}`}>
        <span>{weekdayShort(day)}</span><strong className="text-lg">{Number(day.slice(-2))}</strong>
        <span className="text-xs">{days.some((entry) => entry.date === day) ? "Salvato" : "—"}</span>
      </button>)}
    </div>
    <label className="flex items-center gap-2 text-sm font-bold">Vai al giorno
      <select aria-label="Vai al giorno" className="h-11 rounded-xl border bg-white px-3" value={date} onChange={(event) => { const next = event.target.value; event.target.value = date; onSelect(next); }}>
        {isoDayList(year, month).map((day) => <option key={day} value={day}>{Number(day.slice(-2))}</option>)}
      </select>
    </label>
  </section>;
}
