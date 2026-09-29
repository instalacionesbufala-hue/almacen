/* Lectura de albaranes con IA.
   La app nunca lleva la clave de la IA: envía la foto o el PDF a una función de servidor (E-003, Gemini gratuito)
   cuya URL se configura en VITE_ALBARANES_URL. Si no hay URL, se usa el modo simulado con albaranes de ejemplo.
   Para cambiar de proveedor (Gemini, Claude…) solo cambia la función de servidor; la app no se toca. */
import type { AlbaranIA, Estado } from '../../data/tipos';
import { DEMOS, UNIT } from '../../data/catalogo';

export const URL_IA = (import.meta.env.VITE_ALBARANES_URL as string | undefined)?.trim() || '';
export const iaReal = () => !!URL_IA;
export const iaEtiqueta = () => (iaReal() ? 'IA ACTIVA' : 'OCR SIMULADO');

/** Catálogo que se envía al servidor para que la IA empareje cada línea con un SKU */
export const catalogoParaIA = (S: Estado) =>
  S.products.map(p => ({ sku: p.sku, ref: p.supplierRef || '', ean: p.ean || '', nombre: p.name, unidad: UNIT[p.unit], proveedor: p.supplier }));

export async function leerConIA(file: File, S: Estado): Promise<AlbaranIA> {
  const fd = new FormData();
  fd.append('archivo', file);
  fd.append('catalogo', JSON.stringify(catalogoParaIA(S)));
  const r = await fetch(URL_IA, { method: 'POST', body: fd });
  if (!r.ok) throw new Error(r.status === 429 ? 'Se ha alcanzado el límite gratuito de lecturas por hoy. Prueba más tarde.' : `El servidor de IA ha respondido ${r.status}`);
  return r.json() as Promise<AlbaranIA>;
}

/** Elige un albarán de ejemplo según el nombre del archivo (modo simulado) */
export function demoPara(nombre: string): string {
  if (/polich|carg|ve/i.test(nombre)) return 've';
  if (/salt/i.test(nombre)) return 'saltoki';
  return 'dist';
}
export { DEMOS };
