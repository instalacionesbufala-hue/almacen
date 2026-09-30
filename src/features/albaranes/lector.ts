/* Lectura de albaranes con IA.
   La app nunca lleva la clave de la IA: envía la foto o el PDF a una función de servidor (E-003, Gemini gratuito)
   cuya URL se configura en VITE_ALBARANES_URL. Si no hay URL, se usa el modo simulado con albaranes de ejemplo.
   Para cambiar de proveedor (Gemini, Claude…) solo cambia la función de servidor; la app no se toca. */
import type { AlbaranIA, Estado } from '../../data/tipos';
import { DEMOS, UNIT } from '../../data/catalogo';
import { claveAnon, supabase } from '../../store/nube/cliente';
import type { PropuestaIA } from '../../domain/altaCamara';

export const URL_IA = (import.meta.env.VITE_ALBARANES_URL as string | undefined)?.trim() || '';
export const iaReal = () => !!URL_IA;
export const iaEtiqueta = () => (iaReal() ? 'IA ACTIVA (GEMINI)' : 'OCR SIMULADO');
/** Aviso de la revisión del chat: el nivel gratuito de Gemini puede usar el contenido para mejorar sus productos */
export const AVISO_GEMINI = 'Lectura con Gemini (nivel gratuito): según las condiciones de Google, el contenido enviado puede usarse para mejorar sus productos. Los albaranes llevan precios y direcciones de obra; si no lo aceptas, activa la facturación en Google AI Studio (los datos dejan de usarse) o deja la lectura simulada.';

/** Catálogo que se envía al servidor para que la IA empareje cada línea con un SKU */
export const catalogoParaIA = (S: Estado) =>
  S.products.map(p => ({ sku: p.sku, ref: p.supplierRef || '', ean: p.ean || '', nombre: p.name, unidad: UNIT[p.unit], proveedor: p.supplier }));

export async function leerConIA(file: File, _S: Estado): Promise<AlbaranIA> {
  const fd = new FormData();
  fd.append('archivo', file);
  // la función de servidor comprueba la sesión y lee el catálogo con los permisos del usuario
  const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
  const r = await fetch(URL_IA, { method: 'POST', body: fd, headers: token ? { Authorization: 'Bearer ' + token, apikey: claveAnon } : {} });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(cuerpo.error || (r.status === 429 ? 'Se ha alcanzado el límite gratuito de lecturas por hoy. Prueba más tarde.' : 'El servidor de IA ha respondido ' + r.status));
  return cuerpo as AlbaranIA;
}

/** Elige un albarán de ejemplo según el nombre del archivo (modo simulado) */
export function demoPara(nombre: string): string {
  if (/polich|carg|ve/i.test(nombre)) return 've';
  if (/salt/i.test(nombre)) return 'saltoki';
  return 'dist';
}
export { DEMOS };

/* E-015 · Alta de artículos con la cámara: la función "leer-articulo" (misma IA y misma clave, solo en el servidor).
   Su URL sale de VITE_ARTICULOS_URL o, si no está, de la de albaranes cambiando el nombre de la función. */
export const URL_ARTICULO = (import.meta.env.VITE_ARTICULOS_URL as string | undefined)?.trim() || (URL_IA ? URL_IA.replace(/leer-albaran\/?$/, 'leer-articulo') : '');
export const iaArticulo = () => !!URL_ARTICULO && URL_ARTICULO !== URL_IA;

export async function leerArticuloConIA(foto: Blob, codigo: string): Promise<PropuestaIA> {
  const fd = new FormData();
  fd.append('foto', foto, 'articulo.' + (foto.type.split('/')[1] || 'jpg'));
  if (codigo) fd.append('codigo', codigo);
  const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
  const r = await fetch(URL_ARTICULO, { method: 'POST', body: fd, headers: token ? { Authorization: 'Bearer ' + token, apikey: claveAnon } : {} });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(cuerpo.error || 'El servidor de IA ha respondido ' + r.status);
  return cuerpo as PropuestaIA;
}
