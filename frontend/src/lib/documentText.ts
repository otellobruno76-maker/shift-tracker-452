import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createWorker, OEM } from "tesseract.js";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ExtractionProgress {
  label: string;
  progress: number;
}

const MAX_FILE_BYTES = 15 * 1024 * 1024;

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
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ");
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
