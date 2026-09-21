export type DocumentSource = "pdf" | "ocr" | "synthetic";

export interface DocumentToken {
  text: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  source: DocumentSource;
}

export interface DocumentCell {
  text: string;
  x: number;
  right: number;
  tokens: DocumentToken[];
}

export interface DocumentRow {
  page: number;
  y: number;
  height: number;
  text: string;
  tokens: DocumentToken[];
  cells: DocumentCell[];
}

export interface DocumentColumn { x: number; right: number; rows: number[] }
export interface DocumentTable { page: number; rows: DocumentRow[]; columns: DocumentColumn[] }
export interface StructuredDocument { tokens: DocumentToken[]; rows: DocumentRow[]; tables: DocumentTable[]; text: string }

function makeCells(tokens: DocumentToken[], height: number): DocumentCell[] {
  const ordered = [...tokens].sort((a, b) => a.x - b.x);
  const result: DocumentCell[] = [];
  for (const token of ordered) {
    const previous = result.at(-1);
    const gap = previous ? token.x - previous.right : 0;
    if (!previous || gap > Math.max(14, height * 1.4)) {
      result.push({ text: token.text, x: token.x, right: token.x + token.width, tokens: [token] });
    } else {
      previous.text = `${previous.text} ${token.text}`.trim();
      previous.right = Math.max(previous.right, token.x + token.width);
      previous.tokens.push(token);
    }
  }
  return result;
}

export function buildStructuredDocument(input: DocumentToken[]): StructuredDocument {
  const tokens = input.filter((token) => token.text.trim()).map((token) => ({ ...token, text: token.text.trim() }));
  const rows: DocumentRow[] = [];
  for (const token of [...tokens].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)) {
    const row = rows.find((candidate) => candidate.page === token.page && Math.abs(candidate.y - token.y) <= Math.max(2.5, Math.min(candidate.height, token.height) * .45));
    if (row) {
      row.tokens.push(token); row.height = Math.max(row.height, token.height);
      row.y = (row.y * (row.tokens.length - 1) + token.y) / row.tokens.length;
    } else rows.push({ page: token.page, y: token.y, height: token.height || 10, text: "", tokens: [token], cells: [] });
  }
  rows.sort((a, b) => a.page - b.page || b.y - a.y);
  for (const row of rows) {
    row.cells = makeCells(row.tokens, row.height);
    row.text = row.cells.map((cell) => cell.text).join(" | ");
  }
  const tables: DocumentTable[] = [];
  let current: DocumentRow[] = [];
  const flush = () => {
    if (current.length >= 2) {
      const columns: DocumentColumn[] = [];
      current.forEach((row, rowIndex) => row.cells.forEach((cell) => {
        const column = columns.find((item) => Math.abs(item.x - cell.x) <= Math.max(12, row.height));
        if (column) { column.right = Math.max(column.right, cell.right); column.rows.push(rowIndex); }
        else columns.push({ x: cell.x, right: cell.right, rows: [rowIndex] });
      }));
      tables.push({ page: current[0].page, rows: current, columns: columns.sort((a, b) => a.x - b.x) });
    }
    current = [];
  };
  rows.forEach((row) => {
    if (row.cells.length >= 2 && (!current.length || current[0].page === row.page)) current.push(row);
    else flush();
  });
  flush();
  return { tokens, rows, tables, text: rows.map((row) => row.text).join("\n") };
}

export function structuredDocumentFromText(text: string): StructuredDocument {
  const tokens: DocumentToken[] = [];
  text.split(/\r?\n/).filter((line) => line.trim()).forEach((line, row) => {
    let x = 0;
    line.split(/\s*\|\s*/).forEach((cell) => {
      const width = Math.max(20, cell.length * 6);
      tokens.push({ text: cell.trim(), page: 1, x, y: 1000 - row * 18, width, height: 10, source: "synthetic" });
      x += width + 30;
    });
  });
  return buildStructuredDocument(tokens);
}
