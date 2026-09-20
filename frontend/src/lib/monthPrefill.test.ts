import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./types";
import { datesForMonthPrefill } from "./monthPrefill";

describe("precompilazione mese", () => {
  it("precompila settembre 2026 dal lunedì al venerdì", () => {
    const dates = datesForMonthPrefill({
      monthKey: "2026-09",
      weekdays: [0, 1, 2, 3, 4],
      excludeWeekends: true,
      excludeHolidays: true,
    }, DEFAULT_SETTINGS);
    expect(dates).toHaveLength(22);
    expect(dates[0]).toBe("2026-09-01");
    expect(dates.at(-1)).toBe("2026-09-30");
  });

  it("limita la compilazione a un intervallo scelto", () => {
    const dates = datesForMonthPrefill({
      monthKey: "2026-09",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      excludeWeekends: false,
      excludeHolidays: false,
      startDate: "2026-09-21",
      endDate: "2026-09-25",
    }, DEFAULT_SETTINGS);
    expect(dates).toEqual(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"]);
  });
});
