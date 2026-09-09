import type { PDFDocumentProxy } from "pdfjs-dist";

const MAX_FILE = 10 * 1024 * 1024;
export const FILE_ERROR = "Fayl açıla bilmir. Şifrəsiz PDF, PNG və ya JPG formatında, maksimum 10 MB fayl seç.";
export async function openPlanFile(file: File): Promise<{ pdf: PDFDocumentProxy | null; image: string; pages: number }> {
  if (!['application/pdf','image/png','image/jpeg'].includes(file.type) || file.size > MAX_FILE || !file.size) throw new Error(FILE_ERROR);
  if (file.type === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/' });
    task.onPassword = () => { void task.destroy(); };
    const pdf = await task.promise;
    if (pdf.numPages > 100) { await pdf.loadingTask.destroy(); throw new Error('Maksimum 100 səhifəlik PDF seç.'); }
    return { pdf, image: await renderPlanPage(pdf, 1), pages: pdf.numPages };
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error(FILE_ERROR);
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { pdf: null, image: compress(canvas), pages: 1 };
  } finally { bitmap.close(); }
}
function compress(canvas: HTMLCanvasElement) {
  for (const quality of [.9, .75, .55, .35]) {
    const result = canvas.toDataURL('image/jpeg', quality);
    if (result.length <= 1_200_000) return result;
  }
  throw new Error('Fayl çox detallıdır. Daha kiçik ölçüdə ixrac et.');
}
export async function renderPlanPage(pdf: PDFDocumentProxy, pageNumber: number) {
  const page = await pdf.getPage(pageNumber);
  const original = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: 1400 / Math.max(original.width, original.height) });
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  page.cleanup(); return compress(canvas);
}
async function fileDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('hara-seat-plan-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function storePlanFile(id: string, file: File) {
  const db = await fileDb();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('files','readwrite'); tx.objectStore('files').put(file, id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
}
export async function readPlanFile(id: string): Promise<File | null> {
  const db = await fileDb();
  try { return await new Promise((resolve,reject) => { const r = db.transaction('files').objectStore('files').get(id); r.onsuccess = () => resolve(r.result || null); r.onerror = () => reject(r.error); }); } finally { db.close(); }
}
