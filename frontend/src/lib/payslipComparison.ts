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
  registerLabel?: string;
  payslipLabel?: string;
  missingReason?: string;
}

const round = (value: number) => Math.round(value * 100) / 100;
const sum = (items: PayslipItem[], category: PayslipItem["category"], unit: PayslipItem["unit"]): number | null => {
  const values = items.filter((item) => item.category === category && item.unit === unit && item.quantity !== null && item.confidence !== "bassa");
  return values.length ? round(values.reduce((total, item) => total + (item.quantity ?? 0), 0)) : null;
};
const sumAmounts = (items: PayslipItem[], category: PayslipItem["category"]): number | null => {
  const values = items.filter((item) => item.category === category && item.amount !== null && item.confidence !== "bassa");
  return values.length ? round(values.reduce((total, item) => total + (item.amount ?? 0), 0)) : null;
};
const descriptions = (items: PayslipItem[], category: PayslipItem["category"]): string | undefined => {
  const labels = [...new Set(items.filter((item) => item.category === category && item.confidence !== "bassa").map((item) => item.originalDescription).filter(Boolean))];
  return labels.length ? labels.join(" · ") : undefined;
};

function compare(
  key: string,
  label: string,
  registerValue: number | null,
  payslipValue: number | null,
  unit: ComparisonRow["unit"],
  tolerance: number,
  sourceDescription?: string,
  missingReason?: string,
): ComparisonRow {
  if (registerValue === null || payslipValue === null) {
    return { key, label, registerValue, payslipValue, unit, difference: null, status: "insufficiente", sourceDescription,
      explanation: `Non calcolabile automaticamente: ${missingReason ?? (payslipValue === null ? `nel cedolino manca la quantità esplicita di ${label.toLowerCase()}` : `nel registro manca il valore atteso di ${label.toLowerCase()}`)}.` };
  }
  const difference = round(registerValue - payslipValue);
  if (Math.abs(difference) <= tolerance) {
    return { key, label, registerValue, payslipValue, unit, difference, status: "coerente", sourceDescription,
      explanation: "I valori risultano coerenti considerando i normali arrotondamenti." };
  }
  return { key, label, registerValue, payslipValue, unit, difference, status: "differenza", sourceDescription,
    explanation: `Scostamento di ${Math.abs(difference).toLocaleString("it-IT")} ${unit} oltre la tolleranza di ${tolerance.toLocaleString("it-IT")} ${unit}; controlla la voce e il periodo indicato.` };
}

function explicitAmount(record: PayslipRecord, pattern: RegExp): number | null {
  const items = (record.items ?? []).filter((item) => item.confidence !== "bassa" && pattern.test(item.originalDescription) && item.amount !== null);
  if (items.length) return round(items.reduce((sum, item) => sum + (item.amount ?? 0), 0));
  const totals = record.totals.filter((item) => pattern.test(item.label));
  return totals.length ? round(totals.reduce((sum, item) => sum + item.value, 0)) : null;
}

function fiscalRows(record: PayslipRecord): ComparisonRow[] {
  const items = (record.items ?? []).filter((item) => item.confidence !== "bassa");
  const rows: ComparisonRow[] = [];
  const previdentialBase = explicitAmount(record, /imponibile\s+(previdenziale|inps|contributivo)/i);
  const fiscalBase = explicitAmount(record, /imponibile\s+(fiscale|irpef)/i);
  const contributions = items.filter((item) => /contribut[oi]|\binps\b/i.test(item.originalDescription) && !/imponibile/i.test(item.originalDescription) && item.amount !== null);
  const contributionValue = contributions.length ? round(contributions.reduce((sum, item) => sum + (item.amount ?? 0), 0)) : explicitAmount(record, /(?:contribut[oi]|\binps\b)(?!.*imponibile)/i);
  if (previdentialBase !== null) rows.push(compare("previdentialBase", "Imponibile previdenziale", null, previdentialBase, "€", 0.05, undefined, "manca il dettaglio completo delle voci soggette a contributi"));
  if (fiscalBase !== null) rows.push(compare("fiscalBase", "Imponibile fiscale", null, fiscalBase, "€", 0.05, undefined, "manca il dettaglio completo delle voci fiscalmente imponibili"));
  const rated = contributions.filter((item) => item.ratePct !== null);
  const contributionBase = previdentialBase ?? (rated.length === 1 && rated[0].unit === "euro" ? rated[0].quantity : null);
  if (contributionBase !== null || contributionValue !== null) {
    rows.push(compare("contributions", "Contributi previdenziali", null, contributionValue, "€", 0.05, undefined,
      contributionBase === null ? "manca l’imponibile previdenziale esplicito" : "manca l’aliquota contributiva esplicita"));
    if (contributionBase !== null && rated.length === 1 && contributions.length === 1 && rated[0].ratePct !== null) {
      rows[rows.length - 1] = compare("contributions", "Contributi previdenziali", round(contributionBase * rated[0].ratePct / 100), contributionValue, "€", 0.05, rated[0].originalDescription);
    }
  }
  const grossTax = explicitAmount(record, /irpef\s+lorda|imposta\s+lorda/i);
  const deductions = explicitAmount(record, /detrazion/i);
  const withheldTax = explicitAmount(record, /irpef\s+(trattenuta|netta)|imposta\s+netta/i);
  if (grossTax !== null) rows.push(compare("grossTax", "IRPEF lorda", null, grossTax, "€", 0.05, undefined, "mancano base fiscale e parametri espliciti per ricostruire l’imposta lorda"));
  if (deductions !== null) rows.push(compare("taxDeductions", "Detrazioni", null, deductions, "€", 0.05, undefined, "mancano le regole e i dati individuali per ricostruire le detrazioni"));
  if (withheldTax !== null) rows.push(compare("withheldTax", "IRPEF trattenuta", grossTax !== null && deductions !== null ? round(grossTax - deductions) : null, withheldTax, "€", 0.05, undefined,
    grossTax === null ? "manca l’IRPEF lorda esplicita" : "mancano le detrazioni applicate esplicite"));
  for (const [key, pattern, label] of [["regionalTax", /addizionale\s+regionale/i, "Addizionale regionale"], ["municipalTax", /addizionale\s+comunale/i, "Addizionale comunale"]] as const) {
    const amount = explicitAmount(record, pattern);
    if (amount !== null) rows.push(compare(key, label, null, amount, "€", 0.05, undefined,
      fiscalBase === null ? "manca l’imponibile fiscale esplicito" : "mancano aliquota, acconti e rate applicate espliciti"));
  }
  const gross = record.grossTotal ?? explicitAmount(record, /totale\s+competenze|lordo/i);
  const withheld = explicitAmount(record, /totale\s+(ritenute|trattenute)/i);
  const net = record.netTotal ?? explicitAmount(record, /netto\s+(?:a\s+)?pagare/i);
  if (net !== null) rows.push(compare("netArithmetic", "Netto matematico", gross !== null && withheld !== null ? round(gross - withheld) : null, net, "€", 0.05, undefined,
    gross === null ? "manca il totale competenze esplicito" : "manca il totale trattenute esplicito"));
  return rows;
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
    compare("rol", "ROL", totals.rolDays, quantity(record, "rol", "days", daily), "giorni", 0.01, descriptions(record.items ?? [], "rol")),
    compare("formerHoliday", "Ex festività", totals.exFestivitaDays, quantity(record, "former_holiday", "days", daily), "giorni", 0.01, descriptions(record.items ?? [], "former_holiday")),
  ];
  if (settings.basePay > 0 || record.basePay !== null) rows.push(compare("basePay", "Paga oraria di riferimento", settings.basePay > 0 ? settings.basePay : null, record.basePay, "€", 0.01));
  if (settings.monthlyReferencePay > 0 || (record.monthlyPay ?? null) !== null) rows.push(compare("monthlyPay", "Retribuzione mensile di riferimento", settings.monthlyReferencePay > 0 ? settings.monthlyReferencePay : null, record.monthlyPay ?? null, "€", 0.01));
  const recordOvertimeRates = record.overtimeRates ?? [];
  if (settings.overtimePct > 0 || recordOvertimeRates.length > 0) rows.push(compare("overtimeRate", "Maggiorazione straordinario", settings.overtimePct > 0 ? settings.overtimePct : null, recordOvertimeRates[0] ?? null, "%", 0.01));
  const overtimeItems = (record.items ?? []).filter((item) => item.category === "overtime" && item.ratePct !== null && item.quantity !== null && item.confidence !== "bassa");
  const uniqueOvertimeRates = new Set(overtimeItems.map((item) => item.ratePct));
  for (const [index, item] of overtimeItems.entries()) {
    const canMatchAllRegisteredOvertime = uniqueOvertimeRates.size === 1 && settings.overtimePct === item.ratePct;
    rows.push(compare(`overtime-${item.ratePct}-${index}`, `Straordinario +${item.ratePct}%`, canMatchAllRegisteredOvertime ? hours(totals.overtimeMinutes) : null, item.quantity, item.unit === "days" ? "giorni" : "h", 0.1, item.originalDescription));
  }

  const items = record.items ?? [];
  const absence = quantity(record, "absence", "days", daily);
  if (absence !== null) rows.push(compare("otherAbsence", "Altre assenze", null, absence, "giorni", 0.01, descriptions(items, "absence")));

  const allowanceItems = items.filter((item) => item.category === "allowance" && item.amount !== null && item.confidence !== "bassa");
  for (const [index, item] of allowanceItems.entries()) {
    const isStandby = /reperibil/i.test(item.originalDescription);
    rows.push(compare(`allowance-${index}`, item.originalDescription || "Indennità", isStandby && totals.reperibilitaDays > 0 ? totals.pay.standbyAllowance : null, item.amount, "€", 0.01, item.originalDescription));
  }

  const appGross = settings.basePay > 0 ? totals.pay.total : null;
  const payslipGross = record.grossTotal ?? sumAmounts(items, "gross") ?? sumAmounts(items, "earnings");
  if (appGross !== null || payslipGross !== null) {
    rows.push({ ...compare("gross", "Lordo / totale competenze", appGross, payslipGross, "€", 0.05, descriptions(items, "gross") ?? descriptions(items, "earnings")), registerLabel: "Stima dell’app", payslipLabel: "Importo letto nel cedolino" });
  }
  const appDeductions = settings.basePay > 0 && totals.pay.netEnabled ? round(totals.pay.total - totals.pay.net) : null;
  const payslipDeductions = sumAmounts(items, "deductions") ?? record.totals.find((item) => /ritenut|trattenut/i.test(item.label))?.value ?? null;
  if (appDeductions !== null || payslipDeductions !== null) {
    rows.push({ ...compare("deductions", "Totale trattenute", appDeductions, payslipDeductions, "€", 0.05, descriptions(items, "deductions")), registerLabel: "Stima dell’app", payslipLabel: "Importo letto nel cedolino" });
  }
  const appNet = settings.basePay > 0 && totals.pay.netEnabled ? totals.pay.net : null;
  const payslipNet = record.netTotal ?? sumAmounts(items, "net");
  if (appNet !== null || payslipNet !== null) {
    rows.push({ ...compare("net", "Netto", appNet, payslipNet, "€", 0.05, descriptions(items, "net")), registerLabel: "Stima dell’app", payslipLabel: "Importo letto nel cedolino" });
  }
  return [...rows, ...fiscalRows(record)].filter((row) => row.registerValue !== null && row.registerValue !== 0 || row.payslipValue !== null);
}

export function periodMatches(selectedMonth: string, record: PayslipRecord): boolean {
  return selectedMonth === record.month;
}
