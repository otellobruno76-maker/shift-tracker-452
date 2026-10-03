import { describe, expect, it } from "vitest";
import { validateBackup } from "./backup";
import { DEFAULT_SETTINGS, type DayEntry, type DayTemplate, type PayslipRecord, type Settings } from "./types";

const stamp = "2026-09-20T10:00:00.000Z";

const day: DayEntry = {
  id: "giorno-1", date: "2026-09-20", dayType: "lavoro", start: "08:00", end: "17:00",
  breakMinutes: 60, notturno: false, reperibilita: false, trasferta: false,
  festivo: null, note: "Turno reale", createdAt: stamp, updatedAt: stamp,
};

const template: DayTemplate = {
  id: "modello-1", name: "Turno mattina", dayType: "lavoro", start: "08:00", end: "12:00",
  breakMinutes: 0, notturno: false, reperibilita: false, trasferta: false,
  note: "", createdAt: stamp, updatedAt: stamp,
};

const payslip: PayslipRecord = {
  id: "cedolino-1", month: "2026-09", filename: "settembre.pdf", basePay: 12.5,
  ordinaryHours: 160, overtimeRates: [25], nightPct: null, holidayPct: 30,
  allowances: [{ name: "Mensa", amount: 20 }], ccnl: "Contratto", level: "C2",
  totals: [{ label: "Netto", value: 1800 }], uploadedAt: stamp, updatedAt: stamp,
  items: [{ originalDescription: "Straordinario", category: "overtime", quantity: 4,
    unit: "hours", ratePct: 25, amount: 60, confidence: "alta", source: "manuale" }],
  fieldProvenance: { basePay: { source: "manuale", confidence: "alta", evidence: "Confermato" } },
};

function sample() {
  return {
    app: "registro-ore-lavoro",
    version: 2,
    exportedAt: stamp,
    settings: { ...DEFAULT_SETTINGS, workerName: "Maria Bianchi" } as Settings,
    days: [{ ...day }],
    dayTemplates: [{ ...template }],
    payslips: [structuredClone(payslip)],
  };
}

// These are the Settings keys written by the original version 1 exporter.
const originalSettings = {
  workerName: "Maria Bianchi", company: "Azienda storica",
  dailyOrdinaryHours: 8, weeklyOrdinaryHours: 40, basePay: 10,
  overtimePct: 25, holidayPct: 30, nightPct: 20, sundayPct: 15,
  reperibilitaPct: 10, trasfertaPct: 10, reperibilitaEuroPerDay: 15,
  netEnabled: true, netPct: 25, patronalName: "", patronalMonth: null, patronalDay: null,
};

const historicV2Settings = {
  ...originalSettings,
  overtimeRates: [25], payslipReferenceHours: 160, ccnl: "Contratto",
  contractLevel: "C2", payslipAllowances: [{ name: "Mensa", amount: 20 }],
  payslipConfiguredAt: stamp,
};

describe("validazione backup", () => {
  it("accetta un backup completo senza modificarlo", () => {
    const input = sample();
    const original = structuredClone(input);
    expect(validateBackup(input)).toEqual({
      days: input.days, settings: input.settings,
      dayTemplates: input.dayTemplates, payslips: input.payslips,
    });
    expect(input).toEqual(original);
  });

  it("accetta un vero schema storico v1 e completa i campi introdotti in seguito", () => {
    const input = { app: "registro-ore-lavoro", version: 1, exportedAt: stamp, settings: originalSettings, days: [{ ...day }] };
    expect(validateBackup(input)).toEqual({
      days: input.days, settings: { ...DEFAULT_SETTINGS, ...originalSettings }, dayTemplates: [], payslips: [],
    });
  });

  it("accetta un vero schema storico v2 senza monthlyReferencePay", () => {
    const input = {
      app: "registro-ore-lavoro", version: 2, exportedAt: stamp,
      settings: historicV2Settings, days: [{ ...day }],
      dayTemplates: [{ ...template }], payslips: [structuredClone(payslip)],
    };
    expect(validateBackup(input).settings).toEqual({
      ...DEFAULT_SETTINGS, ...historicV2Settings,
    });
  });

  it("rifiuta il backup vuoto anche quando lo schema è formalmente completo", () => {
    const input = sample();
    input.settings = { ...DEFAULT_SETTINGS };
    input.days = [];
    input.dayTemplates = [];
    input.payslips = [];
    expect(() => validateBackup(input)).toThrow(/Backup vuoto/);
  });

  it("rifiuta backup incompleti senza inventare le sezioni mancanti", () => {
    const input = sample();
    Reflect.deleteProperty(input, "payslips");
    expect(() => validateBackup(input)).toThrow(/dayTemplates\/payslips/);
    const missingSettings = sample();
    Reflect.deleteProperty(missingSettings, "settings");
    expect(() => validateBackup(missingSettings)).toThrow(/settings/);
    const missingDayField = sample();
    Reflect.deleteProperty(missingDayField.days[0], "start");
    expect(() => validateBackup(missingDayField)).toThrow(/days\[0\]\.start/);
  });

  it("richiede la data di esportazione per entrambe le versioni", () => {
    const v1 = { app: "registro-ore-lavoro", version: 1, settings: originalSettings, days: [{ ...day }] };
    expect(() => validateBackup(v1)).toThrow(/exportedAt/);
    const v2 = sample();
    Reflect.deleteProperty(v2, "exportedAt");
    expect(() => validateBackup(v2)).toThrow(/exportedAt/);
  });

  it("rifiuta campi richiesti mancanti nello schema della rispettiva versione", () => {
    const v1Settings = { ...originalSettings };
    Reflect.deleteProperty(v1Settings, "basePay");
    expect(() => validateBackup({ app: "registro-ore-lavoro", version: 1, exportedAt: stamp, settings: v1Settings, days: [{ ...day }] })).toThrow(/settings\.basePay/);
    const v2 = {
      app: "registro-ore-lavoro", version: 2, exportedAt: stamp,
      settings: { ...historicV2Settings }, days: [{ ...day }], dayTemplates: [], payslips: [],
    };
    Reflect.deleteProperty(v2.settings, "payslipAllowances");
    expect(() => validateBackup(v2)).toThrow(/settings\.payslipAllowances/);
  });

  it("controlla anche i campi più recenti se presenti in un vecchio backup", () => {
    const input = {
      app: "registro-ore-lavoro", version: 1, exportedAt: stamp,
      settings: { ...originalSettings, monthlyReferencePay: Infinity }, days: [{ ...day }],
    };
    expect(() => validateBackup(input)).toThrow(/settings\.monthlyReferencePay/);
  });

  it("rifiuta contenuti malformati senza scartare silenziosamente record", () => {
    const input = sample();
    input.days.push({ ...day, id: "giorno-2", date: "2026-02-30" });
    expect(() => validateBackup(input)).toThrow(/days\[1\]\.date/);
    expect(input.days).toHaveLength(2);
  });

  it("rifiuta applicazioni e versioni incompatibili", () => {
    const app = sample();
    app.app = "altra-app";
    expect(() => validateBackup(app)).toThrow(/Backup incompatibile/);
    const version = sample();
    version.version = 99;
    expect(() => validateBackup(version)).toThrow(/Backup incompatibile/);
  });

  it("rifiuta ID delle giornate e dei modelli duplicati", () => {
    const days = sample();
    days.days.push({ ...day });
    expect(() => validateBackup(days)).toThrow(/days\[1\]\.id.*duplicato/);
    const templates = sample();
    templates.dayTemplates.push({ ...template });
    expect(() => validateBackup(templates)).toThrow(/dayTemplates\[1\]\.id.*duplicato/);
  });

  it("rifiuta ID e mesi dei cedolini duplicati", () => {
    const ids = sample();
    ids.payslips.push({ ...payslip });
    expect(() => validateBackup(ids)).toThrow(/payslips\[1\]\.id.*duplicato/);
    const months = sample();
    months.payslips.push({ ...payslip, id: "cedolino-2" });
    expect(() => validateBackup(months)).toThrow(/payslips\[1\]\.month.*duplicato/);
  });

  it("rifiuta orari, mesi e date ISO invalidi", () => {
    const time = sample();
    time.days[0].start = "25:00";
    expect(() => validateBackup(time)).toThrow(/days\[0\]\.start/);
    const month = sample();
    month.payslips[0].month = "2026-13";
    expect(() => validateBackup(month)).toThrow(/payslips\[0\]\.month/);
    const timestamp = sample();
    timestamp.exportedAt = "2026-02-30T10:00:00.000Z";
    expect(() => validateBackup(timestamp)).toThrow(/exportedAt/);
  });

  it("rifiuta numeri non finiti e durate negative", () => {
    const settings = sample();
    settings.settings.basePay = Infinity;
    expect(() => validateBackup(settings)).toThrow(/settings\.basePay/);
    const days = sample();
    days.days[0].breakMinutes = -1;
    expect(() => validateBackup(days)).toThrow(/days\[0\]\.breakMinutes/);
    const optional = sample();
    optional.payslips[0].partTimePct = NaN;
    expect(() => validateBackup(optional)).toThrow(/payslips\[0\]\.partTimePct/);
  });

  it("rifiuta ore negative e ore giornaliere superiori alle settimanali", () => {
    const negative = sample();
    negative.settings.dailyOrdinaryHours = -1;
    expect(() => validateBackup(negative)).toThrow(/settings\.dailyOrdinaryHours/);
    const reversed = sample();
    reversed.settings.dailyOrdinaryHours = 41;
    reversed.settings.weeklyOrdinaryHours = 40;
    expect(() => validateBackup(reversed)).toThrow(/settings\.dailyOrdinaryHours/);
  });

  it("rifiuta netPct=500 e maggiorazioni fuori intervallo", () => {
    const net = sample();
    net.settings.netPct = 500;
    expect(() => validateBackup(net)).toThrow(/settings\.netPct/);
    const overtime = sample();
    overtime.settings.overtimePct = 201;
    expect(() => validateBackup(overtime)).toThrow(/settings\.overtimePct/);
  });

  it("rifiuta paga e indennità negative e ore di riferimento non positive", () => {
    const pay = sample();
    pay.settings.monthlyReferencePay = -1;
    expect(() => validateBackup(pay)).toThrow(/settings\.monthlyReferencePay/);
    const allowance = sample();
    allowance.settings.payslipAllowances = [{ name: "Mensa", amount: -5 }];
    expect(() => validateBackup(allowance)).toThrow(/settings\.payslipAllowances\[0\]\.amount/);
    const hours = sample();
    hours.settings.payslipReferenceHours = 0;
    expect(() => validateBackup(hours)).toThrow(/settings\.payslipReferenceHours/);
  });

  it("rifiuta percentuali e tariffe non sensate negli elenchi numerici", () => {
    const settings = sample();
    settings.settings.overtimeRates = [250];
    expect(() => validateBackup(settings)).toThrow(/settings\.overtimeRates\[0\]/);
    const payslipRates = sample();
    payslipRates.payslips[0].overtimeRates = [-1];
    expect(() => validateBackup(payslipRates)).toThrow(/payslips\[0\]\.overtimeRates\[0\]/);
    const tariffs = sample();
    tariffs.payslips[0].overtimeTariffs = [-1];
    expect(() => validateBackup(tariffs)).toThrow(/payslips\[0\]\.overtimeTariffs\[0\]/);
  });

  it("controlla anche gli oggetti annidati e i campi facoltativi presenti", () => {
    const allowance = sample();
    allowance.settings.payslipAllowances = [{ name: "Indennità", amount: Infinity }];
    expect(() => validateBackup(allowance)).toThrow(/settings\.payslipAllowances\[0\]\.amount/);
    const item = sample();
    item.payslips[0].items![0].category = "bad" as never;
    expect(() => validateBackup(item)).toThrow(/payslips\[0\]\.items\[0\]\.category/);
    const provenance = sample();
    provenance.payslips[0].fieldProvenance!.basePay.source = "bad" as "manuale";
    expect(() => validateBackup(provenance)).toThrow(/fieldProvenance\.basePay\.source/);
    const templateInput = sample();
    templateInput.dayTemplates[0].name = "";
    expect(() => validateBackup(templateInput)).toThrow(/dayTemplates\[0\]\.name/);
  });
});
