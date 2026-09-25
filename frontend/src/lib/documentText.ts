import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createWorker, OEM } from "tesseract.js";
import { bounded, prepareDocument } from "./documentPreparation";
import { buildStructuredDocument, type DocumentToken, type StructuredDocument } from "./documentModel";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ExtractionProgress {
  label: string;
  progress: number;
}



export interface PositionedPdfText {
  str: string;
  transform?: number[];
  width?: number;
  height?: number;
}

/** Rebuilds PDF text by visual rows instead of flattening the whole page. */
export function reconstructPdfText(items: PositionedPdfText[]): string {
  const tokens = items
    .filter((item) => item.str.trim() && item.transform?.length && Number.isFinite(item.transform[4]) && Number.isFinite(item.transform[5]))
    .map((item) => ({ text: item.str.trim(), x: item.transform![4], y: item.transform![5], width: item.width ?? 0, height: Math.abs(item.height ?? item.transform![3] ?? 10) }));
  if (!tokens.length) return items.map((item) => item.str.trim()).filter(Boolean).join("\n");

  const rows: Array<{ y: number; height: number; tokens: typeof tokens }> = [];
  for (const token of tokens.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((candidate) => Math.abs(candidate.y - token.y) <= Math.max(2.5, Math.min(candidate.height, token.height) * 0.45));
    if (row) {
      row.tokens.push(token);
      row.y = (row.y * (row.tokens.length - 1) + token.y) / row.tokens.length;
      row.height = Math.max(row.height, token.height);
    } else rows.push({ y: token.y, height: token.height, tokens: [token] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      const ordered = row.tokens.sort((a, b) => a.x - b.x);
      return ordered.map((token, index) => {
        if (!index) return token.text;
        const previous = ordered[index - 1];
        const gap = token.x - (previous.x + previous.width);
        return `${gap > 18 ? " | " : " "}${token.text}`;
      }).join("").trim();
    })
    .filter(Boolean)
    .join("\n");
}

function pdfTokens(items: PositionedPdfText[], page: number): DocumentToken[] {
  return items.filter((item) => item.str.trim() && item.transform?.length).map((item) => ({
    text: item.str, page, x: item.transform![4], y: item.transform![5], width: item.width ?? 0,
    height: Math.abs(item.height ?? item.transform![3] ?? 10), source: "pdf" as const,
  }));
}

function ocrTokens(data: unknown, page: number): DocumentToken[] {
  type OcrWord = { text?: string; bbox?: { x0: number; y0: number; x1: number; y1: number } };
  const parsed = data as { words?: OcrWord[]; blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ words?: OcrWord[] }> }> }> };
  const words = parsed.words ?? parsed.blocks?.flatMap((block) => block.paragraphs?.flatMap((paragraph) => paragraph.lines?.flatMap((line) => line.words ?? []) ?? []) ?? []) ?? [];
  return words.filter((word) => word.text?.trim() && word.bbox).map((word) => ({
    text: word.text!, page, x: word.bbox!.x0, y: -word.bbox!.y0,
    width: word.bbox!.x1 - word.bbox!.x0, height: word.bbox!.y1 - word.bbox!.y0, source: "ocr" as const,
  }));
}

async function withLocalOcr<T>(onProgress: (state: ExtractionProgress) => void, run: (worker: Awaited<ReturnType<typeof createWorker>>) => Promise<T>): Promise<T> {
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  let expired = false;
  let fail: (error: Error) => void = () => undefined;
  const failure = new Promise<never>((_, reject) => { fail = reject; });
  const work = (async () => {
    worker = await createWorker("ita", OEM.LSTM_ONLY, {
      workerPath: "/ocr/worker.min.js", corePath: "/ocr", langPath: "/ocr", workerBlobURL: false,
      errorHandler: () => fail(new Error("Lettura locale della foto non disponibile. Puoi usare l’AI con il tuo consenso oppure compilare i campi.")),
      logger: (message) => { if (!expired && typeof message.progress === "number") onProgress({ label: "Lettura locale dell’immagine…", progress: message.progress }); },
    });
    if (expired) { await worker.terminate(); throw new Error("Lettura locale interrotta"); }
    return run(worker);
  })();
  try { return await bounded(Promise.race([work, failure]), 30_000, "La lettura locale richiede troppo tempo. Puoi usare l’AI con il tuo consenso o compilare i dati.", () => { expired = true; void worker?.terminate(); }); }
  finally { expired = true; if (worker) await worker.terminate(); }
}

async function extractImageStructure(file: File, onProgress: (state: ExtractionProgress) => void): Promise<StructuredDocument> {
  onProgress({ label: "Avvio lettura locale…", progress: 0.05 });
  return withLocalOcr(onProgress, async (worker) => {
    const result = await worker.recognize(file, { rotateAuto: true }, { text: true, blocks: true });
    const tokens = ocrTokens(result.data, 1);
    return tokens.length ? buildStructuredDocument(tokens) : buildStructuredDocument([{ text: result.data.text, page: 1, x: 0, y: 0, width: 1, height: 10, source: "ocr" }]);
  });
}

async function extractPdfStructure(file: File, onProgress: (state: ExtractionProgress) => void): Promise<StructuredDocument> {
  onProgress({ label: "Lettura della struttura del PDF…", progress: 0.05 });
  const task = getDocument({ data: await file.arrayBuffer() });
  try {
  const pdf = await task.promise;
  const tokens: DocumentToken[] = [];
  const pagesToRead = Math.min(pdf.numPages, 12);
  for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    tokens.push(...pdfTokens(content.items.filter((item): item is typeof item & { str: string } => "str" in item), pageNumber));
    onProgress({ label: `Lettura pagina ${pageNumber} di ${pagesToRead}…`, progress: pageNumber / pagesToRead });
  }
  if (tokens.map((token) => token.text).join("").replace(/\s/g, "").length >= 20) return buildStructuredDocument(tokens);
  return await withLocalOcr(onProgress, async (worker) => {
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 3); pageNumber++) {
      const page = await pdf.getPage(pageNumber); const viewport = page.getViewport({ scale: 1.7 });
      const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d"); if (!context) throw new Error("Impossibile preparare la pagina.");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const result = await worker.recognize(canvas, { rotateAuto: true }, { text: true, blocks: true }); tokens.push(...ocrTokens(result.data, pageNumber));
    }
    return buildStructuredDocument(tokens);
  });
  } finally { await task.destroy(); }
}

export async function extractDocumentText(file: File, onProgress: (state: ExtractionProgress) => void): Promise<string> {
  return (await extractDocumentStructure(file, onProgress)).text;
}

export async function extractDocumentStructure(file: File, onProgress: (state: ExtractionProgress) => void, prepared = false): Promise<StructuredDocument> {
  const input = prepared ? file : await prepareDocument(file);
  const result = input.type === "application/pdf" ? await extractPdfStructure(input, onProgress) : await extractImageStructure(input, onProgress);
  if (result.text.replace(/\s/g, "").length < 20) throw new Error("Testo poco leggibile: verifica luce e inquadratura. Puoi usare l’AI con il tuo consenso o compilare i campi mancanti.");
  return result;
}
