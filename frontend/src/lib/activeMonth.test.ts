// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("mese di lavoro attivo", () => {
  beforeEach(() => { vi.resetModules(); localStorage.clear(); });
  it("resta agosto dopo il 5 e il 7, cambia solo alla scelta di settembre", async () => {
    const month = await import("./activeMonth");
    month.setActiveMonth("2026-08");
    expect(month.getActiveMonth()).toBe("2026-08");
    month.setActiveMonth("2026-08");
    expect(month.getActiveMonth()).toBe("2026-08");
    month.setActiveMonth("2026-09");
    expect(month.getActiveMonth()).toBe("2026-09");
    vi.resetModules();
    expect((await import("./activeMonth")).getActiveMonth()).toBe("2026-09");
  });
  it("conserva dicembre e gennaio oltre il cambio di anno e rifiuta un mese invalido", async () => {
    const month = await import("./activeMonth");
    month.setActiveMonth("2026-12");
    expect(month.getActiveMonth()).toBe("2026-12");
    month.setActiveMonth("2027-01");
    month.setActiveMonth("2027-13");
    expect(month.getActiveMonth()).toBe("2027-01");
  });
});
