/* E-020 / E-021 · Códigos leídos por la cámara: cuál vale para el almacén, de qué tipo es y si sirve como SKU */
import type { CodigoArticulo, Estado } from '../data/tipos';

/** Lo que devuelve el lector por cada código del fotograma */
export interface Lectura { texto: string; formato: string }
export type TipoCodigo = 'EAN' | 'UPC' | 'Code 128' | 'QR' | 'otro';
export type Eleccion = { tipo: 'codigo'; codigo: string; formato: string } | { tipo: 'ajena'; url: string } | null;

export const esUrl = (t: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(t.trim()) || /^www\./i.test(t.trim());
const esQR = (f: string) => /^(QRCode|MicroQRCode|RMQRCode|QRCodeModel\d)$/i.test(f) || f === 'qr_code';

/** Qué código manda en un fotograma: un QR del almacén (BUF:) siempre; luego un código de barras; luego un QR que no sea una URL ajena.
    Si solo hay URL ajenas (el QR del fabricante), se indica para avisar y seguir escaneando. */
export function elegirCodigo(l: Lectura[]): Eleccion {
  const v = l.map(x => ({ ...x, texto: x.texto.trim() })).filter(x => x.texto);
  const buf = v.find(x => /^BUF:/i.test(x.texto)); if (buf) return { tipo: 'codigo', codigo: buf.texto, formato: buf.formato };
  const barras = v.find(x => !esQR(x.formato) && !esUrl(x.texto)); if (barras) return { tipo: 'codigo', codigo: barras.texto, formato: barras.formato };
  const qr = v.find(x => !esUrl(x.texto)); if (qr) return { tipo: 'codigo', codigo: qr.texto, formato: qr.formato };
  const url = v.find(x => esUrl(x.texto)); return url ? { tipo: 'ajena', url: url.texto } : null;
}

/** Tipo para guardar un código alternativo (por el formato del lector o, si se escribe a mano, por su forma) */
export function tipoCodigo(codigo: string, formato = ''): TipoCodigo {
  if (/^(EAN13|EAN8|ISBN|EANUPC|ean_13|ean_8)$/i.test(formato)) return 'EAN';
  if (/^(UPCA|UPCE|upc_a|upc_e)$/i.test(formato)) return 'UPC';
  if (/^(Code128|code_128)$/i.test(formato)) return 'Code 128';
  if (esQR(formato)) return 'QR';
  if (!formato && /^\d{8}$|^\d{13}$/.test(codigo)) return 'EAN';
  if (!formato && /^\d{12}$/.test(codigo)) return 'UPC';
  return 'otro';
}

/* ---------- E-021 · Formato de SKU ---------- */
export const SKU_RE = /^[A-Z0-9._-]{2,40}$/;
/** null si vale; si no, el motivo en lenguaje normal */
export function motivoSkuNoValido(sku: string): string | null {
  const s = String(sku || '').trim().toUpperCase();
  if (s.length < 2) return 'El código debe tener al menos 2 caracteres.';
  if (s.length > 40) return 'El código no puede tener más de 40 caracteres.';
  if (SKU_RE.test(s)) return null;
  const malos = [...new Set(s.replace(/[A-Z0-9._-]/g, '').split(''))].map(c => c === ' ' ? 'espacios' : c).join(' ');
  return `El código tiene caracteres no válidos (${malos}): usa solo letras, números, guion, guion bajo y punto.`;
}
export const skuValido = (sku: string) => motivoSkuNoValido(sku) === null;

/** SKU interno correlativo para lo que no sirve como SKU (una URL, por ejemplo): BF-000123 */
export function siguienteSkuInterno(skus: Iterable<string>): string {
  let n = 0;
  for (const s of skus) { const m = /^BF-(\d{6})$/.exec(s); if (m) n = Math.max(n, Number(m[1])); }
  return `BF-${String(n + 1).padStart(6, '0')}`;
}

/* ---------- E-020 · Códigos alternativos de un artículo ---------- */
const igual = (a?: string, b?: string) => !!a && !!b && a.replace(/\s/g, '').toUpperCase() === b.replace(/\s/g, '').toUpperCase();

/** Asocia un código leído a un artículo. Misma regla que el servidor: un código, un solo artículo. Devuelve false si ya lo tenía. */
export function asociarLocal(S: Estado, a: { codigo: string; sku: string; tipo?: TipoCodigo }): boolean {
  const c = a.codigo.trim(); if (!c) throw new Error('Indica el código');
  const p = S.products.find(x => x.sku === a.sku.toUpperCase());
  if (!p) throw new Error(S.archivados?.some(x => x.sku === a.sku.toUpperCase()) ? `${a.sku} está archivado: asocia el código al artículo que lo sustituye` : `Producto no encontrado: ${a.sku}`);
  const ya = S.codigos.find(x => igual(x.codigo, c));
  if (ya) { if (ya.sku === p.sku) return false; throw new Error(`El código ${c} ya está asociado a ${S.products.find(x => x.sku === ya.sku)?.name || ''} (${ya.sku})`); }
  const otro = S.products.find(x => x.sku !== p.sku && [x.sku, x.ean, x.supplierRef].some(v => igual(v, c)));
  if (otro) throw new Error(`El código ${c} ya es de ${otro.name} (${otro.sku})`);
  if (igual(p.sku, c) || igual(p.ean, c)) return false;
  S.codigos.push({ codigo: c, sku: p.sku, tipo: a.tipo || tipoCodigo(c), ts: Date.now(), operator: S.operator } satisfies CodigoArticulo);
  return true;
}
export function quitarCodigoLocal(S: Estado, codigo: string) {
  if (S.rol !== 'admin') throw new Error('Solo el administrador puede quitar un código');
  S.codigos = S.codigos.filter(x => x.codigo !== codigo.trim());
}
export const codigosDe = (S: Pick<Estado, 'codigos'>, sku: string) => (S.codigos || []).filter(x => x.sku === sku);
/** ¿Hay que guardar el código leído como alternativo del artículo creado? (si no es ya su SKU ni su EAN) */
export const guardarComoAlternativo = (codigo: string, p: { sku: string; ean?: string }) => !!codigo.trim() && !igual(codigo, p.sku) && !igual(codigo, p.ean);

/** E-021: SKU que se propone al crear desde un código leído: el propio código si vale como SKU; si no (una URL…), uno interno BF-000123 */
export function skuPropuesto(S: Pick<Estado, 'products' | 'archivados'>, codigo: string): string {
  const c = codigo.trim().toUpperCase().replace(/\s/g, '');
  return !esUrl(codigo) && skuValido(c) ? c : siguienteSkuInterno([...S.products, ...(S.archivados || [])].map(p => p.sku));
}
export const skuInternoDe = (S: Pick<Estado, 'products' | 'archivados'>) => siguienteSkuInterno([...S.products, ...(S.archivados || [])].map(p => p.sku));
