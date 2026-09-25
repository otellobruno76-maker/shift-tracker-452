import { useSyncExternalStore } from "react";
import { currentMonthKey } from "./dates";

const KEY = "cedolino-chiaro-active-month";
const valid = (value: string | null): value is string => !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const read = () => {
  try { const value = localStorage.getItem(KEY); return valid(value) ? value : currentMonthKey(); }
  catch { return currentMonthKey(); }
};
let activeMonth = read();
const listeners = new Set<() => void>();
export function setActiveMonth(value: string): void {
  if (!valid(value) || value === activeMonth) return;
  activeMonth = value;
  try { localStorage.setItem(KEY, value); } catch { /* private storage may be unavailable */ }
  listeners.forEach((listener) => listener());
}
export function getActiveMonth(): string { return activeMonth; }
export function useActiveMonth(): [string, typeof setActiveMonth] {
  return [useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getActiveMonth), setActiveMonth];
}
if (typeof window !== "undefined") window.addEventListener("storage", (event) => {
  if (event.key !== KEY) return;
  const next = valid(event.newValue) ? event.newValue : currentMonthKey();
  if (next !== activeMonth) { activeMonth = next; listeners.forEach((listener) => listener()); }
});
