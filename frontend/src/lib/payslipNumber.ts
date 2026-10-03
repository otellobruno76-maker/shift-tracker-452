export type PayslipNumberResult =
  | { status: "valid"; value: number }
  | { status: "uncertain" | "invalid"; value: null };

/**
 * Reads a complete number, with either comma or period as the decimal mark.
 * A single separator followed by exactly three digits (e.g. 1.234) may be
 * either a decimal or a thousands mark, so it needs human review.
 */
export function inspectPayslipNumber(raw: string): PayslipNumberResult {
  let text = raw.trim();
  let sign = 1;
  if (/^[+-]/.test(text)) {
    sign = text[0] === "-" ? -1 : 1;
    text = text.slice(1).trim();
  }
  if (text.startsWith("€")) text = text.slice(1).trim();
  if (/^[+-]/.test(text) && raw.trim().startsWith("€")) {
    sign = text[0] === "-" ? -1 : 1;
    text = text.slice(1).trim();
  }
  if (text.endsWith("€")) text = text.slice(0, -1).trim();
  if (!text || /[€+-]/.test(text)) return { status: "invalid", value: null };

  let integer: string;
  let fraction = "";
  if (/^\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?$/.test(text)) {
    const compacted = text.replace(/[ \u00a0\u202f]/g, "");
    const match = compacted.match(/^(\d+)(?:([.,])(\d+))?$/);
    integer = match![1];
    fraction = match?.[3] ?? "";
  } else if (text.includes(",") && text.includes(".")) {
    const decimal = text.lastIndexOf(",") > text.lastIndexOf(".") ? "," : ".";
    const group = decimal === "," ? "." : ",";
    const decimalIndex = text.lastIndexOf(decimal);
    const grouped = text.slice(0, decimalIndex);
    fraction = text.slice(decimalIndex + 1);
    if (!/^\d+$/.test(fraction) || !new RegExp(`^\\d{1,3}(?:\\${group}\\d{3})+$`).test(grouped)) {
      return { status: "invalid", value: null };
    }
    integer = grouped.replaceAll(group, "");
  } else if (/[.,]/.test(text)) {
    const separator = text.includes(",") ? "," : ".";
    const pieces = text.split(separator);
    if (pieces.length > 2) {
      if (!/^\d{1,3}$/.test(pieces[0]) || !pieces.slice(1).every((piece) => /^\d{3}$/.test(piece))) {
        return { status: "invalid", value: null };
      }
      integer = pieces.join("");
    } else if (pieces.length === 2 && /^\d+$/.test(pieces[0]) && /^\d+$/.test(pieces[1])) {
      if (pieces[0].length <= 3 && pieces[0] !== "0" && pieces[1].length === 3) {
        return { status: "uncertain", value: null };
      }
      integer = pieces[0];
      fraction = pieces[1];
    } else {
      return { status: "invalid", value: null };
    }
  } else if (/^\d+$/.test(text)) {
    integer = text;
  } else {
    return { status: "invalid", value: null };
  }

  if (!Number.isSafeInteger(Number(integer))) return { status: "invalid", value: null };
  const value = sign * Number(fraction ? `${integer}.${fraction}` : integer);
  return Number.isFinite(value) ? { status: "valid", value } : { status: "invalid", value: null };
}

export function parsePayslipNumber(raw: string): number | null {
  return inspectPayslipNumber(raw).value;
}
