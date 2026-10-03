import type { Totals } from "./stats";
import type { PayslipItem, PayslipRecord, Settings } from "./types";

export type ComparisonStatus = "coerente" | "differenza" | "insufficiente";
export interface ComparisonRow {
  key: string;
  label: string;
  registerValue: number | null;
  payslipValue: number | null;
  unit: "h" | "giorni" | "€" | "%" | "€/h" | "€/mese";
  difference: number | null;
  status: ComparisonStatus;
  explanation: string;
  sourceDescription?: string;
  registerLabel?: string;
  payslipLabel?: string;
  missingReason?: string;
}

const round = (value: number) => Math.round(value * 100) / 100;
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
  const validRegister = registerValue !== null && Number.isFinite(registerValue) ? registerValue : null;
  const validPayslip = payslipValue !== null && Number.isFinite(payslipValue) ? payslipValue : null;
  if (validRegister === null || validPayslip === null) {
    const reason = missingReason ?? (validPayslip === null
      ? `nel cedolino manca un valore verificabile di ${label.toLowerCase()}`
      : `nel registro manca un valore verificabile di ${label.toLowerCase()}`);
    return { key, label, registerValue: validRegister, payslipValue: validPayslip, unit, difference: null, status: "insufficiente", sourceDescription, missingReason,
      explanation: `Non calcolabile automaticamente: ${reason}.` };
  }
  const difference = round(validRegister - validPayslip);
  if (Math.abs(difference) <= tolerance) {
    return { key, label, registerValue: validRegister, payslipValue: validPayslip, unit, difference, status: "coerente", sourceDescription,
      explanation: "I valori risultano coerenti considerando i normali arrotondamenti." };
  }
  return { key, label, registerValue: validRegister, payslipValue: validPayslip, unit, difference, status: "differenza", sourceDescription,
    explanation: `Scostamento di ${Math.abs(difference).toLocaleString("it-IT")} ${unit} oltre la tolleranza di ${tolerance.toLocaleString("it-IT")} ${unit}; controlla la voce e il periodo indicato.` };
}

function explicitAmount(record: PayslipRecord, pattern: RegExp): number | null {
  const items = (record.items ?? []).filter((item) => item.confidence !== "bassa" && pattern.test(item.originalDescription) && item.amount !== null);
  if (items.length) {
    const explicitTotals = items.filter((item) => /\btotale\b/i.test(item.originalDescription));
    if (explicitTotals.length) {
      const values = explicitTotals.map((item) => item.amount as number);
      return values.every((value) => Math.abs(value - values[0]) <= 0.01) ? round(values[0]) : null;
    }
    return round(items.reduce((sum, item) => sum + (item.amount ?? 0), 0));
  }
  const totals = record.totals.filter((item) => pattern.test(item.label));
  return totals.length && totals.every((item) => Math.abs(item.value - totals[0].value) <= 0.01) ? round(totals[0].value) : null;
}

function fiscalRows(record: PayslipRecord): ComparisonRow[] {
  const items = (record.items ?? []).filter((item) => item.confidence !== "bassa");
  const rows: ComparisonRow[] = [];
  const previdentialBase = explicitAmount(record, /imponibile\s+(previdenziale|inps|contributivo)/i);
  const fiscalBase = explicitAmount(record, /imponibile\s+(fiscale|irpef)/i);
  const contributions = items.filter((item) => /contribut[oi]|\binps\b/i.test(item.originalDescription) && !/imponibile/i.test(item.originalDescription) && item.amount !== null);
  const totalContributionPattern = /totale\s+(?:contribut[oi]|inps)|(?:contribut[oi]|inps)\s+totale/i;
  const hasTotalContribution = contributions.some((item) => totalContributionPattern.test(item.originalDescription))
    || record.totals.some((item) => totalContributionPattern.test(item.label));
  const componentContributions = contributions.filter((item) => !totalContributionPattern.test(item.originalDescription));
  const contributionValue = hasTotalContribution ? explicitAmount(record, totalContributionPattern)
    : componentContributions.length ? round(componentContributions.reduce((sum, item) => sum + (item.amount ?? 0), 0))
      : explicitAmount(record, /(?:contribut[oi]|\binps\b)(?!.*imponibile)/i);
  if (previdentialBase !== null) rows.push(compare("previdentialBase", "Imponibile previdenziale", null, previdentialBase, "€", 0.05, undefined, "manca il dettaglio completo delle voci soggette a contributi"));
  if (fiscalBase !== null) rows.push(compare("fiscalBase", "Imponibile fiscale", null, fiscalBase, "€", 0.05, undefined, "manca il dettaglio completo delle voci fiscalmente imponibili"));
  const rated = componentContributions.filter((item) => item.ratePct !== null);
  const contributionBase = previdentialBase ?? (rated.length === 1 && rated[0].unit === "euro" ? rated[0].quantity : null);
  if (contributionBase !== null || contributionValue !== null || hasTotalContribution) {
    rows.push(compare("contributions", "Contributi previdenziali", null, contributionValue, "€", 0.05, undefined,
      hasTotalContribution && contributionValue === null ? "i totali dei contributi sono discordanti"
        : contributionBase === null ? "manca l’imponibile previdenziale esplicito" : "manca l’aliquota contributiva esplicita"));
    if (!hasTotalContribution && contributionBase !== null && rated.length === 1 && componentContributions.length === 1 && rated[0].ratePct !== null) {
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
  // I totali confermati dall'utente sono autorevoli: null significa anche esclusi.
  const gross = record.grossTotal ?? null;
  const withheld = explicitAmount(record, /totale\s+(ritenute|trattenute)/i);
  const net = record.netTotal ?? null;
  if (net !== null) rows.push(compare("netArithmetic", "Netto matematico", gross !== null && withheld !== null ? round(gross - withheld) : null, net, "€", 0.05, undefined,
    gross === null ? "manca il totale competenze esplicito" : "manca il totale trattenute esplicito"));
  return rows;
}

interface QuantityResult {
  value: number | null;
  missingReason?: string;
}

function quantity(record: PayslipRecord, category: PayslipItem["category"], preferred: "hours" | "days", dailyHours: number): QuantityResult {
  const categoryItems = (record.items ?? []).filter((item) => item.category === category);
  if (categoryItems.some((item) => item.quantity === null)) {
    return { value: null, missingReason: "una o più voci del cedolino non hanno una quantità esplicita" };
  }
  const items = categoryItems.filter((item): item is PayslipItem & { quantity: number } => item.quantity !== null);
  if (!items.length) return { value: null };
  if (items.some((item) => !Number.isFinite(item.quantity))) {
    return { value: null, missingReason: "una o più quantità del cedolino non sono numeri verificabili" };
  }
  if (items.some((item) => item.confidence === "bassa")) {
    return { value: null, missingReason: "una o più quantità del cedolino hanno affidabilità bassa" };
  }
  if (items.some((item) => item.unit !== "hours" && item.unit !== "days")) {
    return { value: null, missingReason: "l’unità della quantità nel cedolino non è compatibile con ore o giorni" };
  }
  const needsConversion = items.some((item) => item.unit !== preferred);
  // Le giornate di lavoro festivo o notturno non attestano quante ore siano state lavorate.
  const canConvert = category === "vacation" || category === "permission" || category === "sickness"
    || category === "rol" || category === "former_holiday" || category === "absence";
  if (needsConversion && (!canConvert || !Number.isFinite(dailyHours) || dailyHours <= 0)) {
    return { value: null, missingReason: canConvert
      ? "mancano le ore ordinarie giornaliere necessarie per convertire ore e giorni"
      : "i giorni indicati nel cedolino non determinano le ore effettive di lavoro" };
  }
  const total = items.reduce((value, item) => value + (item.unit === preferred ? item.quantity : preferred === "hours" ? item.quantity * dailyHours : item.quantity / dailyHours), 0);
  return { value: round(total) };
}

export function compareMonthWithPayslip(totals: Totals, record: PayslipRecord, settings: Settings): ComparisonRow[] {
  const hours = (minutes: number) => round(minutes / 60);
  const daily = settings.dailyOrdinaryHours;
  const quantityRow = (key: string, label: string, registerValue: number, category: PayslipItem["category"], preferred: "hours" | "days", tolerance: number): ComparisonRow => {
    const extracted = quantity(record, category, preferred, daily);
    return compare(key, label, registerValue, extracted.value, preferred === "hours" ? "h" : "giorni", tolerance,
      descriptions(record.items ?? [], category), extracted.missingReason);
  };
  const rows: ComparisonRow[] = [
    compare("workedDays", "Giorni lavorati", totals.workDays, record.workedDays ?? null, "giorni", 0.01),
    compare("ordinary", "Ore ordinarie", hours(totals.ordinaryMinutes), record.ordinaryHours, "h", 0.1),
    compare("total", "Ore totali", hours(totals.netMinutes), record.workedHours ?? null, "h", 0.1),
    compare("overtime", "Straordinari", hours(totals.overtimeMinutes), record.overtimeHours ?? null, "h", 0.1),
    quantityRow("holiday", "Lavoro festivo", hours(totals.holidayMinutes), "holiday", "hours", 0.1),
    quantityRow("night", "Lavoro notturno", hours(totals.nightMinutes), "night", "hours", 0.1),
    quantityRow("vacation", "Ferie", totals.ferieDays, "vacation", "days", 0.01),
    quantityRow("permission", "Permessi", totals.permessiDays, "permission", "days", 0.01),
    quantityRow("sickness", "Malattia", totals.malattiaDays, "sickness", "days", 0.01),
    quantityRow("rol", "ROL", totals.rolDays, "rol", "days", 0.01),
    quantityRow("formerHoliday", "Ex festività", totals.exFestivitaDays, "former_holiday", "days", 0.01),
  ];
  if (settings.basePay > 0 || record.basePay !== null) rows.push(compare("basePay", "Paga oraria di riferimento", settings.basePay > 0 ? settings.basePay : null, record.basePay, "€/h", 0.01));
  if (settings.monthlyReferencePay > 0 || (record.monthlyPay ?? null) !== null) rows.push(compare("monthlyPay", "Retribuzione mensile di riferimento", settings.monthlyReferencePay > 0 ? settings.monthlyReferencePay : null, record.monthlyPay ?? null, "€/mese", 0.01));
  const recordOvertimeRates = record.overtimeRates ?? [];
  if (settings.overtimePct > 0 || recordOvertimeRates.length > 0) rows.push(compare(
    "overtimeRate", "Maggiorazione straordinario", settings.overtimePct > 0 ? settings.overtimePct : null,
    recordOvertimeRates.length === 1 ? recordOvertimeRates[0] : null, "%", 0.01, undefined,
    recordOvertimeRates.length > 1 ? "il cedolino indica più aliquote e non è nota la ripartizione delle ore" : undefined,
  ));
  const allOvertimeItems = (record.items ?? []).filter((item) => item.category === "overtime");
  const overtimeItems = allOvertimeItems.filter((item) => item.ratePct !== null && item.quantity !== null && item.confidence !== "bassa");
  for (const [index, item] of overtimeItems.entries()) {
    const canMatchAllRegisteredOvertime = allOvertimeItems.length === 1
      && settings.overtimePct === item.ratePct && item.unit === "hours";
    const unit = item.unit === "days" ? "giorni" : item.unit === "euro" ? "€" : item.unit === "percent" ? "%" : "h";
    rows.push(compare(`overtime-${item.ratePct}-${index}`, `Straordinario +${item.ratePct}%`,
      canMatchAllRegisteredOvertime ? hours(totals.overtimeMinutes) : null,
      item.unit === "unknown" ? null : item.quantity, unit, 0.1, item.originalDescription,
      item.unit !== "hours" ? "la quantità di straordinario non è espressa in ore verificabili"
        : "non è possibile attribuire tutte le ore registrate a questa singola voce e aliquota"));
  }

  const items = record.items ?? [];
  const absence = quantity(record, "absence", "days", daily);
  if (absence.value !== null || absence.missingReason) rows.push(compare("otherAbsence", "Altre assenze", null, absence.value, "giorni", 0.01, descriptions(items, "absence"), absence.missingReason));

  const allowanceItems = items.filter((item) => item.category === "allowance" && item.amount !== null && item.confidence !== "bassa");
  const standbyItems = items.filter((item) => item.category === "allowance" && /reperibil/i.test(item.originalDescription));
  for (const [index, item] of allowanceItems.entries()) {
    const isStandby = /reperibil/i.test(item.originalDescription);
    const coversRegisteredDays = item.unit === "days" && item.quantity === totals.reperibilitaDays;
    const isExplicitTotal = /totale\s+.*reperibil|reperibil.*\s+totale/i.test(item.originalDescription);
    const canMatchStandbyTotal = isStandby && standbyItems.length === 1 && totals.reperibilitaDays > 0
      && settings.reperibilitaEuroPerDay > 0 && (coversRegisteredDays || isExplicitTotal);
    rows.push(compare(`allowance-${index}`, item.originalDescription || "Indennità", canMatchStandbyTotal ? totals.pay.standbyAllowance : null, item.amount, "€", 0.01, item.originalDescription));
  }

  const appGross = settings.basePay > 0 ? totals.pay.total : null;
  const payslipGross = record.grossTotal ?? null;
  if (appGross !== null || payslipGross !== null) {
    rows.push({ ...compare("gross", "Lordo / totale competenze", appGross, payslipGross, "€", 0.05, descriptions(items, "gross") ?? descriptions(items, "earnings")), registerLabel: "Stima dell’app", payslipLabel: "Importo letto nel cedolino" });
  }
  const appDeductions = settings.basePay > 0 && totals.pay.netEnabled ? round(totals.pay.total - totals.pay.net) : null;
  const payslipDeductions = explicitAmount(record, /totale\s+(?:ritenute|trattenute)/i);
  if (appDeductions !== null || payslipDeductions !== null) {
    rows.push({ ...compare("deductions", "Totale trattenute", appDeductions, payslipDeductions, "€", 0.05, descriptions(items, "deductions")), registerLabel: "Stima dell’app", payslipLabel: "Importo letto nel cedolino" });
  }
  const appNet = settings.basePay > 0 && totals.pay.netEnabled ? totals.pay.net : null;
  const payslipNet = record.netTotal ?? null;
  if (appNet !== null || payslipNet !== null) {
    rows.push({ ...compare("net", "Netto", appNet, payslipNet, "€", 0.05, descriptions(items, "net")), registerLabel: "Stima dell’app", payslipLabel: "Importo letto nel cedolino" });
  }
  return [...rows, ...fiscalRows(record)].filter((row) => row.registerValue !== null && row.registerValue !== 0 || row.payslipValue !== null || row.missingReason !== undefined);
}

export function periodMatches(selectedMonth: string, record: PayslipRecord): boolean {
  return selectedMonth === record.month;
}
