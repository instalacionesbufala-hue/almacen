/* E-009 · Compresión en el móvil antes de subir: WebP de 1.000 px como máximo (unos 100 KB) y miniatura de 200 px.
   Si el navegador no sabe codificar WebP (Safari antiguo), se usa JPEG. */
import { medidas } from '../../domain/fotos';

export interface FotoComprimida { grande: Blob; mini: Blob; ext: 'webp' | 'jpg' }

export async function decodificar(archivo: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; cerrar: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const b = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
      return { img: b, w: b.width, h: b.height, cerrar: () => b.close() };
    } catch { /* formato que solo entiende <img> (p. ej. HEIC en Safari) */ }
  }
  const url = URL.createObjectURL(archivo);
  const img = new Image();
  img.decoding = 'async';
  await new Promise<void>((ok, ko) => { img.onload = () => ok(); img.onerror = () => ko(new Error('No se puede leer la imagen: prueba con una foto JPG o PNG')); img.src = url; });
  return { img, w: img.naturalWidth, h: img.naturalHeight, cerrar: () => URL.revokeObjectURL(url) };
}

const aBlob = (c: HTMLCanvasElement, tipo: string, q: number) => new Promise<Blob | null>(ok => c.toBlob(ok, tipo, q));

async function reducir(fuente: { img: CanvasImageSource; w: number; h: number }, max: number, calidad: number, objetivo: number): Promise<{ blob: Blob; ext: 'webp' | 'jpg' }> {
  const { w, h } = medidas(fuente.w, fuente.h, max);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);   // PNG con transparencia → fondo blanco
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fuente.img, 0, 0, w, h);
  let q = calidad, blob = await aBlob(c, 'image/webp', q);
  const ext: 'webp' | 'jpg' = blob?.type === 'image/webp' ? 'webp' : 'jpg';
  if (ext === 'jpg') blob = await aBlob(c, 'image/jpeg', q);
  // si sale muy pesada (foto con mucho detalle), se baja la calidad un par de veces
  while (blob && blob.size > objetivo * 1.6 && q > 0.5) { q -= 0.12; blob = await aBlob(c, ext === 'webp' ? 'image/webp' : 'image/jpeg', q); }
  if (!blob) throw new Error('No se ha podido comprimir la foto');
  return { blob, ext };
}

export async function comprimir(archivo: Blob): Promise<FotoComprimida> {
  if (archivo.type && !/^image\//.test(archivo.type)) throw new Error('Eso no es una imagen');
  const f = await decodificar(archivo);
  try {
    const grande = await reducir(f, 1000, 0.8, 100 * 1024);
    const mini = await reducir(f, 200, 0.72, 12 * 1024);
    // las dos con la misma extensión (la ruta del bucket la lleva)
    return { grande: grande.blob, mini: mini.blob, ext: grande.ext === 'webp' && mini.ext === 'webp' ? 'webp' : 'jpg' };
  } finally { f.cerrar(); }
}

/** Imagen (URL o Blob) a JPEG en data URL, para meterla en un PDF (jsPDF no lee WebP en todos los navegadores) */
export async function aJpegDataUrl(fuente: string | Blob, max = 200): Promise<string | null> {
  try {
    const blob = typeof fuente === 'string' ? await (await fetch(fuente)).blob() : fuente;
    const f = await decodificar(blob);
    try {
      const { w, h } = medidas(f.w, f.h, max);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d')!; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(f.img, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.8);
    } finally { f.cerrar(); }
  } catch { return null; }
}
