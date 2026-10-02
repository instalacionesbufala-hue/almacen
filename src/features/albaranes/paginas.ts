/* E-024 · Páginas de un albarán en el navegador: de foto a imagen editable, y de vuelta a JPEG comprimido (~1600 px). */
import type { Img } from '../../domain/documento';
import { decodificar } from '../fotos/imagen';

export const LADO_PAGINA = 1600, CALIDAD_PAGINA = 0.82;

/** Píxeles de una foto (reducida a `maxLado` para no llenar la memoria del móvil) */
export async function blobAImg(b: Blob, maxLado = 2400): Promise<Img> {
  const f = await decodificar(b);
  try {
    const e = Math.min(1, maxLado / Math.max(f.w, f.h)), w = Math.round(f.w * e), h = Math.round(f.h * e);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(f.img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    return { data: d.data, width: w, height: h };
  } finally { f.cerrar(); }
}

/** Fotograma actual del vídeo, en pequeño (para detectar la hoja en vivo) o grande (para la foto) */
export function fotograma(v: HTMLVideoElement, maxLado: number, lienzo?: HTMLCanvasElement): Img | null {
  const W = v.videoWidth, H = v.videoHeight; if (!W || !H) return null;
  const e = Math.min(1, maxLado / Math.max(W, H)), w = Math.round(W * e), h = Math.round(H * e);
  const c = lienzo || document.createElement('canvas'); if (c.width !== w) c.width = w; if (c.height !== h) c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(v, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  return { data: d.data, width: w, height: h };
}

export function imgACanvas(img: Img, c = document.createElement('canvas')): HTMLCanvasElement {
  c.width = img.width; c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

/** JPEG de la página (lado largo como mucho LADO_PAGINA): lo que se envía a la IA y se guarda con el albarán */
export async function imgAJpeg(img: Img, max = LADO_PAGINA, calidad = CALIDAD_PAGINA): Promise<Blob> {
  const fuente = imgACanvas(img), e = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * e); c.height = Math.round(img.height * e);
  const ctx = c.getContext('2d')!; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(fuente, 0, 0, c.width, c.height);
  const b = await new Promise<Blob | null>(ok => c.toBlob(ok, 'image/jpeg', calidad));
  if (!b) throw new Error('No se ha podido guardar la página');
  return b;
}

/** Foto de la galería → página comprimida. Un PDF se envía tal cual (la IA lee todas sus páginas). */
export async function comprimirPagina(b: Blob): Promise<Blob> {
  if (b.type === 'application/pdf') return b;
  return imgAJpeg(await blobAImg(b, LADO_PAGINA));
}
