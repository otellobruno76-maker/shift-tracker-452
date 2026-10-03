import {
  DEFAULT_SETTINGS,
  type DayEntry,
  type DayTemplate,
  type PayslipRecord,
  type Settings,
} from "./types";

export interface ValidBackup {
  days: DayEntry[];
  settings: Settings;
  dayTemplates: DayTemplate[];
  payslips: PayslipRecord[];
}

type RecordValue = Record<string, unknown>;

const DAY_TYPES = ["lavoro", "ferie", "malattia", "permesso", "rol", "ex_festivita", "riposo"];
const ITEM_CATEGORIES = [
  "ordinary", "overtime", "holiday", "night", "vacation", "permission", "rol",
  "former_holiday", "sickness", "absence", "allowance", "gross", "earnings",
  "deductions", "net", "other",
];
const ITEM_UNITS = ["hours", "days", "euro", "percent", "unknown"];
const DATA_SOURCES = ["registro", "locale", "ai", "manuale"];
const CONFIDENCES = ["alta", "media", "bassa"];

function invalid(path: string, expectation: string): never {
  throw new Error(`Backup non valido: il campo "${path}" ${expectation}.`);
}

function object(value: unknown, path: string): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(path, "deve essere un oggetto");
  }
  return value as RecordValue;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) return invalid(path, "deve essere un elenco");
  return value;
}

function string(value: unknown, path: string, nonempty = false): string {
  if (typeof value !== "string" || (nonempty && value.trim().length === 0)) {
    return invalid(path, nonempty ? "deve essere un testo non vuoto" : "deve essere un testo");
  }
  return value;
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return invalid(path, "deve essere un numero finito");
  }
  return value;
}

function boundedNumber(value: unknown, path: string, minimum: number, maximum = Infinity): number {
  const result = number(value, path);
  if (result < minimum || result > maximum) {
    invalid(path, maximum === Infinity
      ? `deve essere almeno ${minimum}`
      : `deve essere tra ${minimum} e ${maximum}`);
  }
  return result;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return invalid(path, "deve essere vero o falso");
  return value;
}

function nullableNumber(value: unknown, path: string): void {
  if (value !== null) number(value, path);
}

function optionalString(value: unknown, path: string): void {
  if (value !== undefined) string(value, path);
}

function optionalNullableNumber(value: unknown, path: string): void {
  if (value !== undefined) nullableNumber(value, path);
}

function oneOf(value: unknown, choices: readonly string[], path: string): void {
  if (typeof value !== "string" || !choices.includes(value)) {
    invalid(path, `deve essere uno dei valori supportati (${choices.join(", ")})`);
  }
}

function date(value: unknown, path: string): void {
  const text = string(value, path);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) invalid(path, "deve avere il formato AAAA-MM-GG");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    invalid(path, "deve contenere una data reale");
  }
}

function month(value: unknown, path: string): void {
  const text = string(value, path);
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    invalid(path, "deve avere il formato AAAA-MM e un mese valido");
  }
}

function time(value: unknown, path: string): void {
  const text = string(value, path);
  if (text !== "" && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    invalid(path, "deve avere il formato OO:MM oppure essere vuoto");
  }
}

function timestamp(value: unknown, path: string): void {
  const text = string(value, path);
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!match) invalid(path, "deve contenere data e ora ISO valide");
  date(match[1], path);
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) {
    invalid(path, "deve contenere un'ora valida");
  }
  if (match[5] !== "Z") {
    const hours = Number(match[5].slice(1, 3));
    const minutes = Number(match[5].slice(4, 6));
    if (hours > 23 || minutes > 59) invalid(path, "deve contenere un fuso orario valido");
  }
}

function numberArray(value: unknown, path: string, minimum = -Infinity, maximum = Infinity): void {
  array(value, path).forEach((item, index) => boundedNumber(item, `${path}[${index}]`, minimum, maximum));
}

function allowances(value: unknown, path: string, nonnegative = false): void {
  array(value, path).forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    const entry = object(item, itemPath);
    string(entry.name, `${itemPath}.name`);
    if (entry.amount !== null) {
      if (nonnegative) boundedNumber(entry.amount, `${itemPath}.amount`, 0);
      else number(entry.amount, `${itemPath}.amount`);
    }
  });
}

function uniqueIds(records: RecordValue[], path: string): void {
  const ids = new Set<string>();
  records.forEach((entry, index) => {
    const id = string(entry.id, `${path}[${index}].id`, true);
    if (ids.has(id)) invalid(`${path}[${index}].id`, "è duplicato");
    ids.add(id);
  });
}

function validateDay(value: unknown, path: string): RecordValue {
  const entry = object(value, path);
  string(entry.id, `${path}.id`, true);
  date(entry.date, `${path}.date`);
  oneOf(entry.dayType, DAY_TYPES, `${path}.dayType`);
  time(entry.start, `${path}.start`);
  time(entry.end, `${path}.end`);
  const breakMinutes = number(entry.breakMinutes, `${path}.breakMinutes`);
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0) invalid(`${path}.breakMinutes`, "deve essere un numero intero non negativo");
  for (const key of ["notturno", "reperibilita", "trasferta"] as const) boolean(entry[key], `${path}.${key}`);
  if (entry.festivo !== null) boolean(entry.festivo, `${path}.festivo`);
  string(entry.note, `${path}.note`);
  for (const key of ["scheduledOrdinaryMinutes", "manualOvertimeMinutes"] as const) {
    if (entry[key] === undefined) continue;
    const minutes = number(entry[key], `${path}.${key}`);
    if (!Number.isInteger(minutes) || minutes < 0) invalid(`${path}.${key}`, "deve essere un numero intero non negativo");
  }
  timestamp(entry.createdAt, `${path}.createdAt`);
  timestamp(entry.updatedAt, `${path}.updatedAt`);
  return entry;
}

function validateTemplate(value: unknown, path: string): RecordValue {
  const entry = object(value, path);
  string(entry.id, `${path}.id`, true);
  string(entry.name, `${path}.name`, true);
  oneOf(entry.dayType, DAY_TYPES, `${path}.dayType`);
  time(entry.start, `${path}.start`);
  time(entry.end, `${path}.end`);
  const breakMinutes = number(entry.breakMinutes, `${path}.breakMinutes`);
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0) invalid(`${path}.breakMinutes`, "deve essere un numero intero non negativo");
  for (const key of ["notturno", "reperibilita", "trasferta"] as const) boolean(entry[key], `${path}.${key}`);
  string(entry.note, `${path}.note`);
  timestamp(entry.createdAt, `${path}.createdAt`);
  timestamp(entry.updatedAt, `${path}.updatedAt`);
  return entry;
}

function validateSettings(value: unknown, version: 1 | 2): Settings {
  const entry = object(value, "settings");
  for (const key of ["workerName", "company", "patronalName"] as const) {
    string(entry[key], `settings.${key}`);
  }
  const dailyHours = boundedNumber(entry.dailyOrdinaryHours, "settings.dailyOrdinaryHours", 0);
  const weeklyHours = boundedNumber(entry.weeklyOrdinaryHours, "settings.weeklyOrdinaryHours", 0);
  if (dailyHours > weeklyHours) invalid("settings.dailyOrdinaryHours", "non può superare le ore settimanali");
  for (const key of ["basePay", "reperibilitaEuroPerDay"] as const) {
    boundedNumber(entry[key], `settings.${key}`, 0);
  }
  for (const key of [
    "overtimePct", "holidayPct", "nightPct", "sundayPct", "reperibilitaPct", "trasfertaPct",
  ] as const) boundedNumber(entry[key], `settings.${key}`, 0, 200);
  boundedNumber(entry.netPct, "settings.netPct", 0, 100);
  // These fields were added after the first backup format. A missing field in an
  // older export receives today's default, while a present field is always checked.
  if (entry.monthlyReferencePay !== undefined) boundedNumber(entry.monthlyReferencePay, "settings.monthlyReferencePay", 0);
  boolean(entry.netEnabled, "settings.netEnabled");
  for (const key of ["patronalMonth", "patronalDay"] as const) {
    const value = entry[key];
    if (value !== null) {
      const item = number(value, `settings.${key}`);
      const maximum = key === "patronalMonth" ? 12 : 31;
      if (!Number.isInteger(item) || item < 1 || item > maximum) {
        invalid(`settings.${key}`, `deve essere un intero tra 1 e ${maximum} oppure null`);
      }
    }
  }
  for (const key of ["ccnl", "contractLevel"] as const) {
    if (version === 2 || entry[key] !== undefined) string(entry[key], `settings.${key}`);
  }
  if (version === 2 || entry.overtimeRates !== undefined) numberArray(entry.overtimeRates, "settings.overtimeRates", 0, 200);
  if (version === 2 || entry.payslipReferenceHours !== undefined) {
    if (entry.payslipReferenceHours !== null) {
      const referenceHours = number(entry.payslipReferenceHours, "settings.payslipReferenceHours");
      if (referenceHours <= 0) invalid("settings.payslipReferenceHours", "deve essere positivo oppure null");
    }
  }
  if (version === 2 || entry.payslipAllowances !== undefined) allowances(entry.payslipAllowances, "settings.payslipAllowances", true);
  if (version === 2 || entry.payslipConfiguredAt !== undefined) {
    if (entry.payslipConfiguredAt !== null) timestamp(entry.payslipConfiguredAt, "settings.payslipConfiguredAt");
  }
  return { ...DEFAULT_SETTINGS, ...entry } as Settings;
}

function validatePayslipItem(value: unknown, path: string): void {
  const entry = object(value, path);
  string(entry.originalDescription, `${path}.originalDescription`);
  oneOf(entry.category, ITEM_CATEGORIES, `${path}.category`);
  nullableNumber(entry.quantity, `${path}.quantity`);
  oneOf(entry.unit, ITEM_UNITS, `${path}.unit`);
  nullableNumber(entry.ratePct, `${path}.ratePct`);
  nullableNumber(entry.amount, `${path}.amount`);
  oneOf(entry.confidence, CONFIDENCES, `${path}.confidence`);
  oneOf(entry.source, DATA_SOURCES, `${path}.source`);
  optionalString(entry.note, `${path}.note`);
}

function validatePayslip(value: unknown, path: string): RecordValue {
  const entry = object(value, path);
  string(entry.id, `${path}.id`, true);
  month(entry.month, `${path}.month`);
  string(entry.filename, `${path}.filename`, true);
  if (entry.payType !== undefined) oneOf(entry.payType, ["oraria", "giornaliera", "mensile", ""], `${path}.payType`);
  for (const key of ["qualification", "contractCode"] as const) optionalString(entry[key], `${path}.${key}`);
  for (const key of ["partTimePct", "dailyPay", "monthlyPay", "dailyOrdinaryHours", "workedHours", "workedDays", "totalElementsPay", "grossTotal", "netTotal", "overtimeHours"] as const) {
    optionalNullableNumber(entry[key], `${path}.${key}`);
  }
  for (const key of ["basePay", "ordinaryHours", "nightPct", "holidayPct"] as const) {
    nullableNumber(entry[key], `${path}.${key}`);
  }
  numberArray(entry.overtimeRates, `${path}.overtimeRates`, 0, 200);
  if (entry.overtimeTariffs !== undefined) numberArray(entry.overtimeTariffs, `${path}.overtimeTariffs`, 0);
  allowances(entry.allowances, `${path}.allowances`);
  string(entry.ccnl, `${path}.ccnl`);
  string(entry.level, `${path}.level`);
  array(entry.totals, `${path}.totals`).forEach((item, index) => {
    const totalPath = `${path}.totals[${index}]`;
    const total = object(item, totalPath);
    string(total.label, `${totalPath}.label`);
    number(total.value, `${totalPath}.value`);
  });
  if (entry.items !== undefined) {
    array(entry.items, `${path}.items`).forEach((item, index) => validatePayslipItem(item, `${path}.items[${index}]`));
  }
  if (entry.fieldProvenance !== undefined) {
    const provenance = object(entry.fieldProvenance, `${path}.fieldProvenance`);
    for (const [key, value] of Object.entries(provenance)) {
      const fieldPath = `${path}.fieldProvenance.${key}`;
      const field = object(value, fieldPath);
      oneOf(field.source, DATA_SOURCES, `${fieldPath}.source`);
      oneOf(field.confidence, CONFIDENCES, `${fieldPath}.confidence`);
      optionalString(field.evidence, `${fieldPath}.evidence`);
    }
  }
  timestamp(entry.uploadedAt, `${path}.uploadedAt`);
  timestamp(entry.updatedAt, `${path}.updatedAt`);
  return entry;
}

/** Validate the whole file before the caller starts any IndexedDB operation. */
export function validateBackup(data: unknown): ValidBackup {
  const input = object(data, "backup");
  if (input.app !== "registro-ore-lavoro" || (input.version !== 1 && input.version !== 2)) {
    throw new Error("Backup incompatibile: applicazione o versione non supportata.");
  }
  timestamp(input.exportedAt, "exportedAt");

  const settings = validateSettings(input.settings, input.version);
  const days = array(input.days, "days").map((item, index) => validateDay(item, `days[${index}]`));
  uniqueIds(days, "days");

  if (input.version === 2 && (input.dayTemplates === undefined || input.payslips === undefined)) {
    invalid("dayTemplates/payslips", "deve contenere tutti gli elenchi della versione 2");
  }
  const dayTemplates = array(input.dayTemplates === undefined ? [] : input.dayTemplates, "dayTemplates")
    .map((item, index) => validateTemplate(item, `dayTemplates[${index}]`));
  uniqueIds(dayTemplates, "dayTemplates");
  const payslips = array(input.payslips === undefined ? [] : input.payslips, "payslips")
    .map((item, index) => validatePayslip(item, `payslips[${index}]`));
  uniqueIds(payslips, "payslips");
  const months = new Set<string>();
  payslips.forEach((record, index) => {
    const value = record.month as string;
    if (months.has(value)) invalid(`payslips[${index}].month`, "è duplicato");
    months.add(value);
  });

  const hasSettings = (Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>)
    .some((key) => JSON.stringify(settings[key]) !== JSON.stringify(DEFAULT_SETTINGS[key]));
  if (days.length === 0 && dayTemplates.length === 0 && payslips.length === 0 && !hasSettings) {
    throw new Error("Backup vuoto: non contiene dati da importare.");
  }

  return {
    days: days as unknown as DayEntry[],
    settings,
    dayTemplates: dayTemplates as unknown as DayTemplate[],
    payslips: payslips as unknown as PayslipRecord[],
  };
}
