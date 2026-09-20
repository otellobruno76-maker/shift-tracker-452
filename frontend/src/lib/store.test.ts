import { describe, expect, it } from "vitest";
import { exportBackupPayload, saveSettings } from "./store";

describe("salvataggio impostazioni da cedolino", () => {
  it("salva i valori confermati e li include nel backup compatibile", () => {
    saveSettings({
      basePay: 10,
      overtimePct: 15,
      overtimeRates: [15, 20],
      ccnl: "CCNL di prova",
      contractLevel: "L2",
      payslipReferenceHours: 173,
    });

    const backup = JSON.parse(exportBackupPayload());
    expect(backup.version).toBe(1);
    expect(backup.settings).toMatchObject({
      basePay: 10,
      overtimePct: 15,
      overtimeRates: [15, 20],
      ccnl: "CCNL di prova",
      contractLevel: "L2",
      payslipReferenceHours: 173,
    });
  });
});
