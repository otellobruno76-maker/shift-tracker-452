import type { Totals } from "./stats";
import type { PayslipItem, PayslipRecord, Settings } from "./types";

export type ComparisonStatus = "coerente" | "differenza" | "insufficiente";
export interface ComparisonRow {
  key: string;
  label: string;
  registerValue: number | null;
  payslipValue: number | null;
  unit: "h" | "giorni" | "€" | "%";
  difference: number | null;
  status: ComparisonStatus;
  explanation: string;
  sourceDescription?: string;
}

const round = (value: number) => Math.round(value * 100) / 100;
const sum = (items: PayslipItem[], category: PayslipItem["category"], unit: PayslipItem["unit"]): number | null => {
  const values = items.filter((item) => item.category === category && item.unit === unit && item.quantity !== null && item.confidence !== "bassa");
  return values.length ? round(values.reduce((total, item) => total + (item.quantity ?? 0), 0)) : null;
};

function compare(
  key: string,
  label: string,
  registerValue: number | null,
  payslipValue: number | null,
  unit: ComparisonRow["unit"],
  tolerance: number,
  sourceDescription?: string,
): ComparisonRow {
  if (registerValue === null || payslipValue === null) {
    return { key, label, registerValue, payslipValue, unit, difference: null, status: "insufficiente", sourceDescription,
      explanation: payslipValue === null
        ? "Dato non trovato nel cedolino con sufficiente affidabilità. Verifica questa voce."
        : "Dati insufficienti nel registro per un confronto affidabile." };
  }
  const difference = round(registerValue - payslipValue);
  if (Math.abs(difference) <= tolerance) {
    return { key, label, registerValue, payslipValue, unit, difference, status: "coerente", sourceDescription,
      explanation: "I valori risultano coerenti considerando i normali arrotondamenti." };
  }
  const direction = difference > 0 ? "in più" : "in meno";
  return { key, label, registerValue, payslipValue, unit, difference, status: "differenza", sourceDescription,
    explanation: `Nel registro risultano ${Math.abs(difference).toLocaleString("it-IT")} ${unit} ${direction}. Il valore potrebbe essere contabilizzato con una voce diversa o in un periodo successivo.` };
}

function quantity(record: PayslipRecord, category: PayslipItem["category"], preferred: "hours" | "days", dailyHours: number): number | null {
  const items = record.items ?? [];
  const direct = sum(items, category, preferred);
  if (direct !== null) return direct;
  const alternative = sum(items, category, preferred === "hours" ? "days" : "hours");
  if (alternative === null || dailyHours <= 0) return null;
  return preferred === "hours" ? round(alternative * dailyHours) : round(alternative / dailyHours);
}

export function compareMonthWithPayslip(totals: Totals, record: PayslipRecord, settings: Settings): ComparisonRow[] {
  const hours = (minutes: number) => round(minutes / 60);
  const daily = settings.dailyOrdinaryHours;
  const rows: ComparisonRow[] = [
    compare("workedDays", "Giorni lavorati", totals.workDays, record.workedDays ?? null, "giorni", 0.01),
    compare("ordinary", "Ore ordinarie", hours(totals.ordinaryMinutes), record.ordinaryHours, "h", 0.1),
    compare("total", "Ore totali", hours(totals.netMinutes), record.workedHours ?? null, "h", 0.1),
    compare("overtime", "Straordinari", hours(totals.overtimeMinutes), record.overtimeHours ?? null, "h", 0.1),
    compare("holiday", "Lavoro festivo", hours(totals.holidayMinutes), quantity(record, "holiday", "hours", daily), "h", 0.1),
    compare("night", "Lavoro notturno", hours(totals.nightMinutes), quantity(record, "night", "hours", daily), "h", 0.1),
    compare("vacation", "Ferie", totals.ferieDays, quantity(record, "vacation", "days", daily), "giorni", 0.01),
    compare("permission", "Permessi", totals.permessiDays, quantity(record, "permission", "days", daily), "giorni", 0.01),
    compare("sickness", "Malattia", totals.malattiaDays, quantity(record, "sickness", "days", daily), "giorni", 0.01),
    compare("rol", "ROL", null, quantity(record, "rol", "hours", daily), "h", 0.1),
    compare("formerHoliday", "Ex festività", null, quantity(record, "former_holiday", "hours", daily), "h", 0.1),
  ];
  if (settings.basePay > 0 || record.basePay !== null) rows.push(compare("basePay", "Paga oraria di riferimento", settings.basePay > 0 ? settings.basePay : null, record.basePay, "€", 0.01));
  if (settings.monthlyReferencePay > 0 || (record.monthlyPay ?? null) !== null) rows.push(compare("monthlyPay", "Retribuzione mensile di riferimento", settings.monthlyReferencePay > 0 ? settings.monthlyReferencePay : null, record.monthlyPay ?? null, "€", 0.01));
  if (settings.overtimePct > 0 || record.overtimeRates.length > 0) rows.push(compare("overtimeRate", "Maggiorazione straordinario", settings.overtimePct > 0 ? settings.overtimePct : null, record.overtimeRates[0] ?? null, "%", 0.01));
  const overtimeItems = (record.items ?? []).filter((item) => item.category === "overtime" && item.ratePct !== null && item.quantity !== null);
  for (const item of overtimeItems) {
    rows.push(compare(`overtime-${item.ratePct}`, `Straordinario +${item.ratePct}%`, null, item.quantity, item.unit === "days" ? "giorni" : "h", 0.1, item.originalDescription));
  }
  return rows;
}

export function periodMatches(selectedMonth: string, record: PayslipRecord): boolean {
  return selectedMonth === record.month;
}
