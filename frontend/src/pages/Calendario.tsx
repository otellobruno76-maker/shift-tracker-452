import { useMemo, useState } from "react";
import EntrySheet from "@/components/EntrySheet";
import MonthNav from "@/components/MonthNav";
import { currentMonthKey, isoDayList, parseMonthKey, todayISO, weekdayIndex } from "@/lib/dates";
import { fmtHours } from "@/lib/hours";
import { holidayName } from "@/lib/holidays";
import { computeSplits } from "@/lib/stats";
import { useDays, useSettings } from "@/lib/store";
import { DAY_TYPE_LABELS } from "@/lib/types";
import type { DayType } from "@/lib/types";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

const TYPE_COLORS: Record<DayType, string> = {
  lavoro: "text-[#0284C7]",
  ferie: "text-[#3730A3]",
  malattia: "text-[#9D174D]",
  permesso: "text-[#EA580C]",
  riposo: "text-[#64748B]",
};

interface DayInfo {
  net: number;
  overtime: number;
  types: Set<DayType>;
}

export default function Calendario() {
  const days = useDays();
  const settings = useSettings();
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [openDate, setOpenDate] = useState<string | null>(null);
  const { year, month } = parseMonthKey(selectedMonth);
  const dayList = isoDayList(year, month);
  const today = todayISO();

  const byDate = useMemo(() => {
    const map = new Map<string, DayInfo>();
    for (const s of computeSplits(days, settings)) {
      const cur = map.get(s.entry.date) ?? { net: 0, overtime: 0, types: new Set<DayType>() };
      cur.net += s.net;
      cur.overtime += s.overtime;
      cur.types.add(s.entry.dayType);
      map.set(s.entry.date, cur);
    }
    return map;
  }, [days, settings]);

  const leading = weekdayIndex(dayList[0]);

  return (
    <div>
      <header className="pt-2">
        <h1 className="font-heading text-2xl font-extrabold tracking-tight text-[#0F172A]">
          Calendario
        </h1>
        <p className="text-sm text-[#4B5563]">
          Tocca un giorno per aprire il dettaglio.
        </p>
        <div className="mt-3">
          <MonthNav value={selectedMonth} onChange={setSelectedMonth} />
        </div>
      </header>

      <div className="mt-3 grid grid-cols-7 gap-1" data-testid="calendar-grid">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={`pb-1 text-center text-[11px] font-bold uppercase ${
              i === 6 ? "text-[#DC2626]" : "text-[#64748B]"
            }`}
          >
            {w}
          </div>
        ))}
        {Array.from({ length: leading }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {dayList.map((iso) => {
          const info = byDate.get(iso);
          const holiday = holidayName(iso, settings);
          const isSunday = weekdayIndex(iso) === 6;
          const isToday = iso === today;
          const altType = info
            ? (["ferie", "malattia", "permesso", "riposo"] as DayType[]).find((t) =>
                info.types.has(t),
              )
            : undefined;
          return (
            <button
              key={iso}
              data-testid={`calendar-day-${iso}`}
              onClick={() => setOpenDate(iso)}
              className={`flex h-20 flex-col items-center rounded-xl border p-1 pt-1.5 transition-transform duration-150 active:scale-[0.96] ${
                holiday ? "border-[#FECACA] bg-[#FEF2F2]" : "border-[#E2E5EA] bg-white"
              } ${isToday ? "ring-2 ring-[#0284C7]" : ""}`}
            >
              <span
                className={`text-xs font-bold ${
                  isToday
                    ? "flex h-5 w-5 items-center justify-center rounded-full bg-[#0284C7] text-white"
                    : holiday || isSunday
                      ? "text-[#DC2626]"
                      : "text-[#0F172A]"
                }`}
              >
                {Number(iso.slice(8))}
              </span>
              {info && info.net > 0 ? (
                <>
                  <span className="mt-0.5 text-[11px] font-extrabold tabular-nums text-[#0F172A]">
                    {fmtHours(info.net)}
                  </span>
                  {info.overtime > 0 && (
                    <span className="text-[10px] font-bold tabular-nums text-[#D97706]">
                      +{fmtHours(info.overtime)}
                    </span>
                  )}
                </>
              ) : altType ? (
                <span className={`mt-1 text-[10px] font-bold ${TYPE_COLORS[altType]}`}>
                  {DAY_TYPE_LABELS[altType]}
                </span>
              ) : info && info.types.has("lavoro") ? (
                <span className="mt-1 text-[10px] font-bold text-[#94A3B8]">0h</span>
              ) : (
                <span className="mt-1 text-[10px] text-[#CBD5E1]">·</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-2" data-testid="calendar-legend">
        <LegendChip color="#DC2626" label="Festivo" />
        <LegendChip color="#D97706" label="Straordinario" />
        <LegendChip color="#3730A3" label="Ferie" />
        <LegendChip color="#DB2777" label="Malattia" />
        <LegendChip color="#64748B" label="Riposo" />
      </div>

      <EntrySheet date={openDate} onOpenChange={(open) => { if (!open) setOpenDate(null); }} />
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-[#E2E5EA] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#374151]">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
