import { parsePayslipNumber } from "./payslipNumber";
import type { ReviewState } from "./payslipReview";
import type {
  PayslipRecord, PayslipReviewDecisions, SavedAllowanceDecision,
  SavedItemDecision, SavedReviewFieldDecision, SavedTotalDecision,
} from "./types";

const fields = [
  "month", "payType", "qualification", "contractCode", "partTimePct", "basePay",
  "dailyPay", "monthlyPay", "ordinaryHours", "dailyOrdinaryHours", "workedHours",
  "workedDays", "totalElementsPay", "grossTotal", "netTotal", "overtimeHours",
  "overtimeTariffs", "overtimeRates", "nightPct", "holidayPct", "ccnl", "level",
] as const;
type Field = typeof fields[number];
type RowFlags = { decisionTouched?: boolean; valueEdited?: boolean };
type RowKind = "allowance" | "total" | "item";
type ReviewWithResolution = ReviewState & { resolvedMonthDecision?: boolean };
type ResolvedRow = { resolvedConflictId?: string };

export interface ReviewDecisionConflict {
  id: string;
  kind: RowKind | "month";
  label: string;
  reason: "missing" | "ambiguous" | "different";
  previousValue: string;
  proposedValues: string[];
  previous: SavedAllowanceDecision | SavedTotalDecision | SavedItemDecision | { month: string };
}

export type ReviewConflictChoice = "keep" | "new";

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("it-IT").replace(/[^a-z0-9]+/g, " ").trim();
const display = (value: number | null | undefined): string => value == null ? "" : String(value).replace(".", ",");
const allowanceKey = (name: string) => normalize(name);
const totalKey = (label: string) => normalize(label);
const itemKey = (description: string) => normalize(description);

/** Store only changes and explicit choices; the accepted rows and values remain in PayslipRecord. */
export function captureReviewDecisions(review: ReviewState): PayslipReviewDecisions {
  const chosenFields: Record<string, SavedReviewFieldDecision> = {};
  for (const key of fields) {
    if (!review.edited[key] && !review.selectionTouched[key]) continue;
    chosenFields[key] = {
      value: review[key],
      ...(key in review.selected ? { selected: review.selected[key] } : {}),
      edited: !!review.edited[key],
      selectionTouched: !!review.selectionTouched[key],
    };
  }
  return {
    fields: chosenFields,
    allowances: review.allowances.flatMap((row) => {
      const flags = row as typeof row & RowFlags;
      const valueEdited = !!flags.valueEdited || row.source === "Inserimento manuale";
      const decisionTouched = !!flags.decisionTouched;
      return valueEdited || decisionTouched ? [{
        name: row.name, amountText: row.amountText, selected: row.selected,
        valueEdited, decisionTouched,
      }] : [];
    }),
    totals: review.totals.flatMap((row) => {
      const flags = row as typeof row & RowFlags;
      const valueEdited = !!flags.valueEdited || row.source === "Correzione manuale";
      const decisionTouched = !!flags.decisionTouched;
      return valueEdited || decisionTouched ? [{
        label: row.label, valueText: row.valueText, selected: row.selected,
        valueEdited, decisionTouched,
      }] : [];
    }),
    items: review.items.flatMap((row) => {
      const flags = row as typeof row & RowFlags;
      const valueEdited = !!flags.valueEdited || row.source === "manuale";
      const decisionTouched = !!flags.decisionTouched;
      return valueEdited || decisionTouched ? [{
        originalDescription: row.originalDescription, category: row.category, unit: row.unit,
        quantityText: row.quantityText, ratePctText: row.ratePctText, amountText: row.amountText,
        selected: row.selected, valueEdited, decisionTouched,
        source: row.source, confidence: row.confidence,
      }] : [];
    }),
  };
}

function recordFieldValue(record: PayslipRecord, key: Field): string {
  const value = record[key];
  if (Array.isArray(value)) return value.map(display).join("; ");
  if (typeof value === "number") return display(value);
  return typeof value === "string" ? value : "";
}

function rowDecisions(record: PayslipRecord): PayslipReviewDecisions {
  const confirmed = {
    allowances: record.allowances.map((row) => ({
      name: row.name, amountText: display(row.amount), selected: true,
      valueEdited: false, decisionTouched: true,
    })),
    totals: record.totals.map((row) => ({
      label: row.label, valueText: display(row.value), selected: true,
      valueEdited: false, decisionTouched: true,
    })),
    items: (record.items ?? []).map((row) => ({
      originalDescription: row.originalDescription, category: row.category, unit: row.unit,
      quantityText: display(row.quantity), ratePctText: display(row.ratePct), amountText: display(row.amount),
      selected: true, valueEdited: row.source === "manuale", decisionTouched: row.source !== "manuale",
      source: row.source, confidence: row.confidence,
    })),
  };
  const saved = record.reviewDecisions;
  return {
    fields: saved?.fields ?? {},
    allowances: combineRecordedRows(confirmed.allowances, saved?.allowances ?? [],
      (row) => allowanceKey(row.name), (left, right) => sameTextNumber(left.amountText, right.amountText)),
    totals: combineRecordedRows(confirmed.totals, saved?.totals ?? [],
      (row) => totalKey(row.label), (left, right) => sameTextNumber(left.valueText, right.valueText)),
    items: combineRecordedRows(confirmed.items, saved?.items ?? [],
      (row) => itemKey(row.originalDescription), (left, right) => left.category === right.category &&
        left.unit === right.unit && sameTextNumber(left.quantityText, right.quantityText) &&
        sameTextNumber(left.ratePctText, right.ratePctText) && sameTextNumber(left.amountText, right.amountText)),
  };
}

function sameTextNumber(left: string, right: string): boolean {
  if (left === right) return true;
  const first = parsePayslipNumber(left);
  return first !== null && first === parsePayslipNumber(right);
}

function combineRecordedRows<T extends { selected: boolean }>(
  confirmed: T[], explicit: T[], key: (row: T) => string, sameValue: (left: T, right: T) => boolean,
): T[] {
  const consumed = new Set<number>();
  for (const decision of explicit) {
    const matches = confirmed.map((row, index) => key(row) === key(decision) ? index : -1).filter((index) => index >= 0);
    if (matches.length === 1 && decision.selected && sameValue(confirmed[matches[0]], decision)) consumed.add(matches[0]);
  }
  return [...confirmed.filter((_, index) => !consumed.has(index)), ...explicit];
}

function combineRows<T>(saved: T[], current: T[], key: (row: T) => string): T[] {
  const savedCounts = new Map<string, number>();
  const currentCounts = new Map<string, number>();
  for (const row of saved) savedCounts.set(key(row), (savedCounts.get(key(row)) ?? 0) + 1);
  for (const row of current) currentCounts.set(key(row), (currentCounts.get(key(row)) ?? 0) + 1);
  return [
    ...saved.filter((row) => savedCounts.get(key(row)) !== 1 || currentCounts.get(key(row)) !== 1),
    ...current,
  ];
}

function reconcileRows<TRow extends { selected: boolean }, TDecision extends { selected: boolean; valueEdited: boolean; decisionTouched: boolean }>(
  proposed: TRow[], decisions: TDecision[], kind: RowKind,
  rowKey: (row: TRow) => string, decisionKey: (decision: TDecision) => string,
  label: (decision: TDecision) => string, value: (decision: TDecision) => string,
  rowValue: (row: TRow) => string, apply: (row: TRow, decision: TDecision) => TRow,
): { rows: TRow[]; conflicts: ReviewDecisionConflict[] } {
  const rows = proposed.map((row) => ({ ...row }));
  const conflicts: ReviewDecisionConflict[] = [];
  const counts = new Map<string, number>();
  for (const decision of decisions) counts.set(decisionKey(decision), (counts.get(decisionKey(decision)) ?? 0) + 1);
  decisions.forEach((decision, index) => {
    const key = decisionKey(decision);
    const matches = rows.map((row, rowIndex) => rowKey(row) === key ? rowIndex : -1).filter((rowIndex) => rowIndex >= 0);
    if (matches.length === 1 && counts.get(key) === 1) {
      rows[matches[0]] = apply(rows[matches[0]], decision);
      return;
    }
    conflicts.push({
      id: `${kind}:${key}:${index}`, kind, label: label(decision),
      reason: matches.length === 0 ? "missing" : "ambiguous",
      previousValue: value(decision), proposedValues: matches.map((rowIndex) => rowValue(rows[rowIndex])),
      previous: decision as unknown as ReviewDecisionConflict["previous"],
    });
  });
  return { rows, conflicts };
}

/** Reapply saved decisions, then choices made in this replacement session, to a new analysis. */
export function restoreReviewDecisions(record: PayslipRecord, proposed: ReviewState, current?: ReviewState): {
  review: ReviewState; conflicts: ReviewDecisionConflict[]; preservedFields: string[];
} {
  const saved = rowDecisions(record);
  const session = current ? captureReviewDecisions(current) : null;
  const review: ReviewWithResolution = {
    ...proposed, selected: { ...proposed.selected }, edited: { ...proposed.edited },
    selectionTouched: { ...proposed.selectionTouched },
    ...((current as ReviewWithResolution | undefined)?.resolvedMonthDecision ? { resolvedMonthDecision: true } : {}),
  };
  const preservedFields = new Set<string>();
  const monthChanged = proposed.month !== "" && proposed.month !== record.month &&
    !(current as ReviewWithResolution | undefined)?.resolvedMonthDecision &&
    !(current?.edited.month && current.month !== record.month);
  const monthConflict: ReviewDecisionConflict[] = monthChanged ? [{
    id: `month:${record.month}:${proposed.month}`, kind: "month", label: "Mese e anno",
    reason: "different", previousValue: record.month, proposedValues: [proposed.month],
    previous: { month: record.month },
  }] : [];
  for (const key of fields) {
    const savedDecision = saved.fields[key];
    const manual = record.fieldProvenance?.[key]?.source === "manuale";
    const value = recordFieldValue(record, key);
    if (value !== "") {
      if (key === "payType") review.payType = value as ReviewState["payType"];
      else review[key] = value;
      if (key in review.selected) {
        review.selected[key] = true;
        review.selectionTouched[key] = true;
      }
      preservedFields.add(key);
    } else if (!record.reviewDecisions && key === "payType") {
      review.payType = "";
      review.selectionTouched.payType = true;
    } else if (!record.reviewDecisions && key in review.selected) {
      review.selected[key] = false;
      review.selectionTouched[key] = true;
    }
    if (savedDecision) {
      if (savedDecision.edited || (savedDecision.selectionTouched && (savedDecision.selected || key === "payType"))) {
        if (key === "payType") review.payType = savedDecision.value as ReviewState["payType"];
        else review[key] = savedDecision.value;
        preservedFields.add(key);
      }
      if (savedDecision.selected !== undefined) review.selected[key] = savedDecision.selected;
      if (savedDecision.edited) review.edited[key] = true;
      if (savedDecision.selectionTouched) review.selectionTouched[key] = true;
    }
    if (manual && value !== "") {
      if (key === "payType") review.payType = value as ReviewState["payType"];
      else review[key] = value;
      if (key in review.selected) review.selected[key] = true;
      review.edited[key] = true;
      preservedFields.add(key);
    }
    const sessionDecision = session?.fields[key];
    if (sessionDecision) {
      if (sessionDecision.edited || (sessionDecision.selectionTouched && (sessionDecision.selected || key === "payType"))) {
        if (key === "payType") review.payType = sessionDecision.value as ReviewState["payType"];
        else review[key] = sessionDecision.value;
      }
      if (sessionDecision.selected !== undefined) review.selected[key] = sessionDecision.selected;
      if (sessionDecision.edited) review.edited[key] = true;
      if (sessionDecision.selectionTouched) review.selectionTouched[key] = true;
    }
  }
  const allowances = reconcileRows(
    proposed.allowances,
    combineRows(saved.allowances, session?.allowances ?? [], (row) => allowanceKey(row.name)),
    "allowance", (row) => allowanceKey(row.name), (row) => allowanceKey(row.name),
    (row) => row.name, (row) => row.amountText, (row) => row.amountText,
    (row, decision) => ({
      ...row, selected: decision.selected,
      ...(decision.valueEdited || (decision.decisionTouched && decision.selected) ? {
        name: decision.name, amountText: decision.amountText,
        source: decision.valueEdited ? "Correzione manuale salvata" : "Revisione precedente",
        confidence: "media" as const,
      } : {}),
      decisionTouched: decision.decisionTouched, valueEdited: decision.valueEdited,
    }),
  );
  const totals = reconcileRows(
    proposed.totals,
    combineRows(saved.totals, session?.totals ?? [], (row) => totalKey(row.label)),
    "total", (row) => totalKey(row.label), (row) => totalKey(row.label),
    (row) => row.label, (row) => row.valueText, (row) => row.valueText,
    (row, decision) => ({
      ...row, selected: decision.selected,
      ...(decision.valueEdited || (decision.decisionTouched && decision.selected) ? {
        valueText: decision.valueText, source: decision.valueEdited ? "Correzione manuale" : "Revisione precedente",
      } : {}),
      decisionTouched: decision.decisionTouched, valueEdited: decision.valueEdited,
    }),
  );
  const items = reconcileRows(
    proposed.items,
    combineRows(saved.items, session?.items ?? [], (row) => itemKey(row.originalDescription)),
    "item", (row) => itemKey(row.originalDescription), (row) => itemKey(row.originalDescription),
    (row) => row.originalDescription, (row) => row.amountText, (row) => row.amountText,
    (row, decision) => ({
      ...row, selected: decision.selected, category: decision.category,
      ...(decision.valueEdited || (decision.decisionTouched && decision.selected) ? {
        category: decision.category, unit: decision.unit, quantityText: decision.quantityText,
        ratePctText: decision.ratePctText, amountText: decision.amountText,
        source: decision.source ?? (decision.valueEdited ? "manuale" as const : row.source),
        confidence: decision.confidence ?? (decision.valueEdited ? "media" as const : row.confidence),
        note: undefined,
      } : {}),
      decisionTouched: decision.decisionTouched, valueEdited: decision.valueEdited,
    }),
  );
  review.allowances = allowances.rows;
  review.totals = totals.rows;
  review.items = items.rows;
  if (!record.reviewDecisions) {
    const confirmedAllowances = new Set(record.allowances.map((row) => allowanceKey(row.name)));
    const confirmedTotals = new Set(record.totals.map((row) => totalKey(row.label)));
    const confirmedItems = new Set((record.items ?? []).map((row) => itemKey(row.originalDescription)));
    review.allowances = review.allowances.map((row) => confirmedAllowances.has(allowanceKey(row.name))
      ? row : { ...row, selected: false, decisionTouched: true });
    review.totals = review.totals.map((row) => confirmedTotals.has(totalKey(row.label))
      ? row : { ...row, selected: false, decisionTouched: true });
    review.items = review.items.map((row) => confirmedItems.has(itemKey(row.originalDescription))
      ? row : { ...row, selected: false, decisionTouched: true });
  }
  review.allowancesEdited = review.allowancesEdited || !!session?.allowances.length || !!saved.allowances.length;
  review.totalsEdited = review.totalsEdited || !!session?.totals.length || !!saved.totals.length;
  review.itemsEdited = review.itemsEdited || !!session?.items.length || !!saved.items.length;
  return {
    review, preservedFields: [...preservedFields],
    conflicts: [...monthConflict, ...allowances.conflicts, ...totals.conflicts, ...items.conflicts],
  };
}

/** Keep inserts the old decision; New accepts the proposal already visible in the review. */
export function resolveReviewDecisionConflict(
  review: ReviewState, conflict: ReviewDecisionConflict, choice: ReviewConflictChoice,
): ReviewState {
  if (conflict.kind === "month") {
    return {
      ...review, month: choice === "keep" ? conflict.previousValue : conflict.proposedValues[0],
      edited: { ...review.edited, month: true }, resolvedMonthDecision: true,
    } as ReviewWithResolution;
  }
  if (choice === "new") return review;
  if (conflict.kind === "allowance") {
    const previous = conflict.previous as SavedAllowanceDecision;
    const rows = review.allowances.filter((row) => allowanceKey(row.name) !== allowanceKey(previous.name) || !!(row as ResolvedRow).resolvedConflictId);
    const restored = {
      name: previous.name, amount: parsePayslipNumber(previous.amountText), amountText: previous.amountText,
      selected: previous.selected, source: "Inserimento manuale", confidence: "media",
      decisionTouched: true, valueEdited: true, resolvedConflictId: conflict.id,
    } as const;
    return { ...review, allowancesEdited: true, allowances: [...rows, restored] };
  }
  if (conflict.kind === "total") {
    const previous = conflict.previous as SavedTotalDecision;
    const rows = review.totals.filter((row) => totalKey(row.label) !== totalKey(previous.label) || !!(row as ResolvedRow).resolvedConflictId);
    const restored = {
      label: previous.label, valueText: previous.valueText, selected: previous.selected,
      source: "Correzione manuale", decisionTouched: true, valueEdited: true, resolvedConflictId: conflict.id,
    };
    return { ...review, totalsEdited: true, totals: [...rows, restored] };
  }
  const previous = conflict.previous as SavedItemDecision;
  const rows = review.items.filter((row) => itemKey(row.originalDescription) !== itemKey(previous.originalDescription) || !!(row as ResolvedRow).resolvedConflictId);
  const restored = {
    originalDescription: previous.originalDescription, category: previous.category, unit: previous.unit,
    quantity: parsePayslipNumber(previous.quantityText), quantityText: previous.quantityText,
    ratePct: parsePayslipNumber(previous.ratePctText), ratePctText: previous.ratePctText,
    amount: parsePayslipNumber(previous.amountText), amountText: previous.amountText,
    selected: previous.selected, source: previous.source ?? "manuale", confidence: previous.confidence ?? "media",
    decisionTouched: true, valueEdited: true, resolvedConflictId: conflict.id,
  } as const;
  return { ...review, itemsEdited: true, items: [...rows, restored] };
}
