import { isoDayList, parseISODate, parseMonthKey, weekdayIndex } from "./dates";
import { holidayName } from "./holidays";
import type { Settings } from "./types";

export interface MonthPrefillOptions {
  monthKey: string;
  weekdays: number[];
  excludeWeekends: boolean;
  excludeHolidays: boolean;
  startDate?: string;
  endDate?: string;
}

export function datesForMonthPrefill(options: MonthPrefillOptions, settings: Settings): string[] {
  const { year, month } = parseMonthKey(options.monthKey);
  return isoDayList(year, month).filter((date) => {
    if (options.startDate && date < options.startDate) return false;
    if (options.endDate && date > options.endDate) return false;
    const weekday = weekdayIndex(date);
    if (!options.weekdays.includes(weekday)) return false;
    const jsDay = parseISODate(date).getDay();
    if (options.excludeWeekends && (jsDay === 0 || jsDay === 6)) return false;
    if (options.excludeHolidays && holidayName(date, settings) !== null) return false;
    return true;
  });
}
