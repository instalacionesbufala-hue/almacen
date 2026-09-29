/* E-008 · Lectura del código impreso en la pegatina de un cuadro de protecciones (no llevan código de barras).
   Usa la detección de texto del navegador si existe o, si no, Tesseract.js, que se descarga solo cuando se usa. */
import type { Estado } from '../../data/tipos';
import { resolveCode } from '../../domain/reglas';

interface TesseractGlobal { recognize(img: HTMLCanvasElement, idioma: string): Promise<{ data: { text: string } }> }
declare global { interface Window { Tesseract?: TesseractGlobal } }

function cargarTesseract(): Promise<TesseractGlobal> {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = () => window.Tesseract ? ok(window.Tesseract) : ko(new Error('No se pudo cargar el lector de texto'));
    s.onerror = () => ko(new Error('Sin conexión: no se puede cargar el lector de texto. Escribe el código a mano.'));
    document.head.appendChild(s);
  });
}

/** Posibles códigos en un texto: bloques de letras, números y guiones de 5 o más caracteres */
export const candidatos = (texto: string) => [...new Set((texto.toUpperCase().match(/[A-Z0-9][A-Z0-9-]{3,}[A-Z0-9]/g) || []))];

/** Primer candidato que corresponde a una referencia del catálogo (por código del modelo, SKU o EAN) */
export function codigoConocido(S: Estado, texto: string): string | null {
  for (const c of candidatos(texto)) if (resolveCode(S, c)) return c;
  return null;
}

export async function leerTexto(video: HTMLVideoElement): Promise<string> {
  const cv = document.createElement('canvas');
  cv.width = video.videoWidth; cv.height = video.videoHeight;
  cv.getContext('2d')!.drawImage(video, 0, 0);
  const t = await cargarTesseract();
  const r = await t.recognize(cv, 'eng');
  return r.data.text || '';
}
