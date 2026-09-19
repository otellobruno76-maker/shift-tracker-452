// Minimal dependency-free PDF writer (A4, Helvetica, WinAnsi encoding —
// covers Italian accents and the euro sign). Enough for a text summary.
// "Riepilogo Presenze e Stima Retribuzione" — never a payslip ("cedolino").

export interface PdfCell {
  text: string;
  x: number;
}

export interface PdfLine {
  text?: string;
  cells?: PdfCell[];
  x?: number;
  size?: number;
  bold?: boolean;
  before?: number;
  after?: number;
  /** draw a thin horizontal rule instead of text */
  rule?: boolean;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const TOP = PAGE_H - 56;
const BOTTOM = 48;

const WINANSI: Record<string, string> = {
  "\u20AC": "\x80", // €
  "\u2018": "\x91",
  "\u2019": "\x92",
  "\u201C": "\x93",
  "\u201D": "\x94",
  "\u2013": "\x96",
  "\u2014": "\x97",
};

function escapePdfText(text: string): string {
  let out = "";
  for (const ch of text) {
    if (ch === "\\" || ch === "(" || ch === ")") {
      out += `\\${ch}`;
      continue;
    }
    const mapped = WINANSI[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = ch.codePointAt(0) ?? 63;
    out += code <= 0xff ? ch : "?";
  }
  return out;
}

export function buildPdf(lines: PdfLine[]): Blob {
  const pageStreams: string[] = [];
  let ops: string[] = [];
  let y = TOP;

  const newPage = () => {
    pageStreams.push(ops.join("\n"));
    ops = [];
    y = TOP;
  };

  for (const line of lines) {
    const before = line.before ?? 0;
    if (line.rule) {
      if (y - before - 8 < BOTTOM) newPage();
      y -= before;
      ops.push(
        `0.75 G 0.7 w ${MARGIN} ${y.toFixed(2)} m ${(PAGE_W - MARGIN).toFixed(2)} ${y.toFixed(2)} l S 0 G`,
      );
      y -= 8 + (line.after ?? 4);
      continue;
    }
    const size = line.size ?? 10;
    if (y - size - before < BOTTOM) newPage();
    y -= before;
    const baseline = y - size;
    if (line.cells) {
      const parts = line.cells
        .filter((c) => c.text)
        .map((c) => `${(c.x ?? MARGIN).toFixed(2)} ${(baseline).toFixed(2)} Td (${escapePdfText(c.text)}) Tj`)
        .join(" ");
      if (parts) ops.push(`BT /${line.bold ? "F2" : "F1"} ${size} Tf ${parts} ET`);
    } else {
      const text = escapePdfText(line.text ?? "");
      if (text) {
        ops.push(
          `BT /${line.bold ? "F2" : "F1"} ${size} Tf ${(line.x ?? MARGIN).toFixed(2)} ${baseline.toFixed(2)} Td (${text}) Tj ET`,
        );
      }
    }
    y -= size * 1.25 + (line.after ?? 4);
  }
  newPage();

  // Object numbering: 1 catalog, 2 pages, 3 F1, 4 F2, then per page: page + content
  const count = pageStreams.length;
  const objects: string[] = [];
  const kids = pageStreams.map((_, i) => `${5 + 2 * i} 0 R`).join(" ");
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Kids [${kids}] /Count ${count} >>`;
  objects[2] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pageStreams.forEach((content, i) => {
    const pageObj = 5 + 2 * i;
    objects[pageObj - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W.toFixed(2)} ${PAGE_H.toFixed(2)}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageObj + 1} 0 R >>`;
    objects[pageObj] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    out += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: "application/pdf" });
}
