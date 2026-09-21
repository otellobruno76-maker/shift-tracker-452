import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createWorker, OEM } from "tesseract.js";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ExtractionProgress {
  label: string;
  progress: number;
}

const MAX_FILE_BYTES = 15 * 1024 * 1024;

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

function assertFile(file: File): void {
  const supported = file.type === "application/pdf" || file.type.startsWith("image/");
  if (!supported) throw new Error("Formato non supportato. Usa un PDF oppure un'immagine.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Il documento supera il limite di 15 MB.");
}

async function createLocalOcr(onProgress: (state: ExtractionProgress) => void) {
  return createWorker("ita", OEM.LSTM_ONLY, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/tesseract-core-simd-lstm.wasm.js",
    langPath: "/ocr",
    workerBlobURL: false,
    logger: (message) => {
      if (typeof message.progress === "number") {
        onProgress({ label: "Lettura locale dell'immagine…", progress: message.progress });
      }
    },
  });
}

async function extractImage(file: File, onProgress: (state: ExtractionProgress) => void): Promise<string> {
  onProgress({ label: "Avvio lettura locale…", progress: 0.05 });
  const worker = await createLocalOcr(onProgress);
  try {
    const result = await worker.recognize(file);
    return result.data.text.trim();
  } finally {
    await worker.terminate();
  }
}

async function extractPdf(file: File, onProgress: (state: ExtractionProgress) => void): Promise<string> {
  onProgress({ label: "Lettura del PDF…", progress: 0.05 });
  const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
  const pageTexts: string[] = [];
  const pagesToRead = Math.min(pdf.numPages, 12);
  for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = reconstructPdfText(content.items.filter((item): item is typeof item & { str: string } => "str" in item));
    pageTexts.push(text);
    onProgress({ label: `Lettura pagina ${pageNumber} di ${pagesToRead}…`, progress: pageNumber / pagesToRead });
  }
  const embeddedText = pageTexts.join("\n").trim();
  if (embeddedText.length >= 40) return embeddedText;

  const worker = await createLocalOcr(onProgress);
  try {
    const scannedPages: string[] = [];
    const pagesToScan = Math.min(pdf.numPages, 3);
    for (let pageNumber = 1; pageNumber <= pagesToScan; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.7 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Impossibile preparare la pagina per la lettura.");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const result = await worker.recognize(canvas);
      scannedPages.push(result.data.text);
      onProgress({ label: `Analisi immagine pagina ${pageNumber} di ${pagesToScan}…`, progress: pageNumber / pagesToScan });
    }
    return scannedPages.join("\n").trim();
  } finally {
    await worker.terminate();
  }
}

export async function extractDocumentText(
  file: File,
  onProgress: (state: ExtractionProgress) => void,
): Promise<string> {
  assertFile(file);
  const text = file.type === "application/pdf"
    ? await extractPdf(file, onProgress)
    : await extractImage(file, onProgress);
  if (text.replace(/\s/g, "").length < 20) {
    throw new Error("Documento non leggibile: prova una foto più nitida o un PDF con testo selezionabile.");
  }
  return text;
}
