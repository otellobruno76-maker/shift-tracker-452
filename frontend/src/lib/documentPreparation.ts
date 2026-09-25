export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const imageTypes = ["image/jpeg", "image/png", "image/webp"];

export async function validateDocument(file: File): Promise<string> {
  if (!file.size) throw new Error("Il file è vuoto o danneggiato.");
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error("Il documento supera il limite di 15 MB.");
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const starts = (bytes: number[]) => bytes.every((byte, i) => head[i] === byte);
  const mime = starts([37, 80, 68, 70, 45]) ? "application/pdf"
    : starts([255, 216, 255]) ? "image/jpeg"
    : starts([137, 80, 78, 71, 13, 10, 26, 10]) ? "image/png"
    : starts([82, 73, 70, 70]) && new TextDecoder().decode(head.slice(8)) === "WEBP" ? "image/webp" : "";
  if (file.type && !["application/pdf", ...imageTypes, "application/octet-stream"].includes(file.type)) {
    throw new Error("Formato non supportato. Usa PDF, JPG o PNG.");
  }
  if (!mime || (file.type && file.type !== "application/octet-stream" && file.type !== mime)) {
    throw new Error("File danneggiato o formato non corrispondente. Scegli un PDF, JPG o PNG valido.");
  }
  return mime;
}

export function imageDimensions(width: number, height: number) {
  if (width <= 0 || height <= 0 || width * height > 100_000_000) throw new Error("Immagine troppo grande o non valida. Usa una foto con risoluzione inferiore.");
  const scale = Math.min(1, 2800 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Browser decoding applies EXIF orientation; the canvas removes EXIF/GPS metadata.
 * A 2800px long edge preserves small text on an A4 photo without sending 48MP. */
export async function prepareDocument(file: File): Promise<File> {
  const mime = await validateDocument(file);
  if (mime === "application/pdf") return new File([file], "documento.pdf", { type: mime });
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new Error("Foto non leggibile. Prova una foto più nitida oppure esportala come JPG o PNG."); }
  try {
    const size = imageDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Impossibile preparare la foto su questo dispositivo.");
    context.fillStyle = "white"; context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error("Impossibile preparare la foto.")), "image/jpeg", .92,
    ));
    canvas.width = 0; canvas.height = 0;
    return new File([blob], "documento.jpg", { type: "image/jpeg" });
  } finally { bitmap.close(); }
}

export async function bounded<T>(operation: Promise<T>, ms: number, message: string, cancel?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { cancel?.(); reject(new Error(message)); }, ms);
  });
  try { return await Promise.race([operation, timeout]); }
  finally { clearTimeout(timer!); }
}
