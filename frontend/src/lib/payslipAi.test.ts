import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyPayslipAnalysis } from "./payslip";
import { mergePayslipAnalyses, payslipAIEndpoint, requestPayslipAI, type PayslipAIResult } from "./payslipAi";

afterEach(() => vi.restoreAllMocks());

const ai = (patch: Partial<PayslipAIResult> = {}): PayslipAIResult => ({
  month: 8, year: 2026, qualification: "Operaio a mese", level: "2", ccnl: null, contract_code: "607",
  employment_type: null, part_time_pct: 65, pay_type: "monthly", hourly_pay: 8.2826, daily_pay: null,
  monthly_pay: 931.38, ordinary_hours: null, worked_hours: null, worked_days: null, overtime_hours: null,
  overtime_rates: [], overtime_tariffs: [], night_rate: null, holiday_rate: null, minimum_contractual_pay: null,
  contingency: null, edr: null, seniority_increments: null, allowances: [], gross_pay: null,
  total_earnings: null, total_deductions: null, net_pay: null,
  fields: {
    qualification: { confidence: "high", evidence: "colonna Qualifica" }, level: { confidence: "high", evidence: "colonna Livello" },
    contract_code: { confidence: "high", evidence: "colonna Contratto" }, part_time_pct: { confidence: "high", evidence: "colonna %Part-Time" },
    monthly_pay: { confidence: "high", evidence: "Retribuzione mese" }, hourly_pay: { confidence: "medium", evidence: "Dato Base ripetuto in due voci orarie" },
  }, line_items: [], ...patch,
});

describe("diagnostica endpoint AI", () => {
  const file = new File(["%PDF-test"], "test.pdf", { type: "application/pdf" });

  it("usa il backend Render della preview", () => {
    expect(payslipAIEndpoint).toBe("https://shift-tracker-452.onrender.com/api/analyze-payslip-ai");
  });

  it("riconosce una route backend assente", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 405 })));
    await expect(requestPayslipAI(file)).rejects.toThrow("Backend AI non raggiungibile");
    expect(fetch).toHaveBeenCalledWith(payslipAIEndpoint, expect.objectContaining({ method: "POST" }));
  });

  it("mostra il codice diagnostico sicuro restituito dal backend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: { code: "NO_API_CREDIT", message: "Credito API non disponibile" } }),
      { status: 402, headers: { "Content-Type": "application/json" } },
    )));
    await expect(requestPayslipAI(file)).rejects.toThrow("Credito API non disponibile");
  });
});

describe("merge lettura locale e analisi AI", () => {
  it("mantiene il caso sintetico INAZ senza inventare altri valori", () => {
    const merged = mergePayslipAnalyses(emptyPayslipAnalysis(), ai());
    expect(merged.analysis).toMatchObject({ qualification: { value: "Operaio a mese" }, level: { value: "2" }, contractCode: { value: "607" }, partTimePct: { value: 65 }, monthlyPay: { value: 931.38 }, basePay: { value: 8.2826, confidence: "media" } });
    expect(merged.analysis.dailyPay.value).toBeNull();
    expect(merged.analysis.ordinaryHours.value).toBeNull();
  });

  it("aumenta la fiducia quando locale e AI concordano", () => {
    const local = emptyPayslipAnalysis(); local.level = { value: "2", confidence: "media", source: "Lettura locale" };
    const merged = mergePayslipAnalyses(local, ai());
    expect(merged.analysis.level.confidence).toBe("alta");
    expect(merged.analysis.level.source).toContain("Concordanza");
  });

  it("espone un conflitto senza scegliere automaticamente", () => {
    const local = emptyPayslipAnalysis(); local.level = { value: "3", confidence: "alta", source: "colonna Livello" };
    const merged = mergePayslipAnalyses(local, ai());
    expect(merged.conflicts).toContain("Livello: locale “3”, AI “2”");
    expect(merged.analysis.level).toMatchObject({ value: "3", confidence: "bassa" });
  });

  it("non usa automaticamente un dato AI a bassa affidabilità contro un dato locale", () => {
    const local = emptyPayslipAnalysis(); local.basePay = { value: 10, confidence: "media", source: "lettura locale" };
    const result = ai({ hourly_pay: 99, fields: { ...ai().fields, hourly_pay: { confidence: "low", evidence: "numero ambiguo" } } });
    expect(mergePayslipAnalyses(local, result).analysis.basePay.value).toBe(10);
  });
});

describe('attese e richieste duplicate', () => {
  it('riusa la stessa richiesta in corso e il risultato per il file selezionato',async () => {
    const file=new File(['%PDF-ok'],'cache.pdf',{type:'application/pdf'});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(ai()))));
    const first=requestPayslipAI(file);const second=requestPayslipAI(file);
    expect(first).toBe(second);await first;await requestPayslipAI(file);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('interrompe una risposta lenta entro il limite, permette un nuovo tentativo',async () => {
    vi.useFakeTimers();
    try {
      const file=new File(['%PDF-ok'],'slow.pdf',{type:'application/pdf'});
      vi.stubGlobal('fetch',vi.fn().mockImplementation((_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))));
      const onPhase=vi.fn();const pending=requestPayslipAI(file,{onPhase});const assertion=expect(pending).rejects.toThrow('75 secondi');
      await vi.advanceTimersByTimeAsync(25_000);expect(onPhase).toHaveBeenLastCalledWith(expect.stringContaining('più tempo'));
      await vi.advanceTimersByTimeAsync(50_000);await assertion;
      vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(ai()))));
      await expect(requestPayslipAI(file)).resolves.toMatchObject({level:'2'});
    } finally {vi.useRealTimers();}
  });
  it('consente di annullare senza aspettare il backend',async () => {
    const file=new File(['%PDF-ok'],'cancel.pdf',{type:'application/pdf'});const controller=new AbortController();
    vi.stubGlobal('fetch',vi.fn().mockImplementation((_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))));
    const pending=requestPayslipAI(file,{signal:controller.signal});controller.abort();await expect(pending).rejects.toThrow('interrotta');
  });
  it('non memorizza un errore backend e può riprovare',async () => {
    const file=new File(['%PDF-ok'],'retry.pdf',{type:'application/pdf'});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(null,{status:503})).mockResolvedValueOnce(new Response(JSON.stringify(ai()))));
    await expect(requestPayslipAI(file)).rejects.toThrow('503');await expect(requestPayslipAI(file)).resolves.toMatchObject({level:'2'});expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('misura la risposta senza includere il documento',async () => {
    const file=new File(['%PDF-ok'],'privacy.pdf',{type:'application/pdf'});const onTimings=vi.fn();
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(ai()),{headers:{'Server-Timing':'openai;dur=100'}})));
    await requestPayslipAI(file,{onTimings});expect(onTimings).toHaveBeenCalledWith({requestMs:expect.any(Number),parseMs:expect.any(Number),serverTiming:'openai;dur=100'});
  });
});
