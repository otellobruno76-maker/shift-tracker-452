import { describe, expect, it } from "vitest";
import { inspectPayslipNumber, parsePayslipNumber } from "./payslipNumber";

describe("parser numerico del cedolino", () => {
  it.each([
    ["12,5", 12.5],
    ["12.5", 12.5],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["1432,89", 1432.89],
    ["1 432,89", 1432.89],
    ["€ 1.432,89", 1432.89],
    ["-123,45", -123.45],
    ["0,00", 0],
  ])("interpreta %s come %s", (raw, expected) => {
    expect(inspectPayslipNumber(raw)).toEqual({ status: "valid", value: expected });
    expect(parsePayslipNumber(raw)).toBe(expected);
  });

  it.each(["1.234", "1,234", "12.345", "12,345"])("segnala %s come incerto", (raw) => {
    expect(inspectPayslipNumber(raw)).toEqual({ status: "uncertain", value: null });
    expect(parsePayslipNumber(raw)).toBeNull();
  });

  it.each(["1.23.4", "1,23,4", "12abc", "1 43,89"])("rifiuta %s senza conversioni parziali", (raw) => {
    expect(inspectPayslipNumber(raw)).toEqual({ status: "invalid", value: null });
  });
});
