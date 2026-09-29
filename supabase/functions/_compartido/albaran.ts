/* E-003 · Lectura de albaranes: prompt, esquema de respuesta, normalización y emparejado con el catálogo.
   Módulo puro compartido por la función de servidor "leer-albaran" (Gemini) y por la app (emparejado local). */

export interface ItemCatalogo { sku: string; ref?: string; ean?: string; nombre: string; unidad: string; proveedor?: string; custodia?: boolean }
export interface LineaLeida { codigo: string; descripcion: string; cantidad: number; sku: string | null; how: string | null; series: string[]; nota: string; confianza: number }
export interface AlbaranLeido { proveedor: string; cif: string; numero: string; fecha: string; bultos?: number; lineas: LineaLeida[] }

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Emparejado (cualquier proveedor): código exacto (SKU, EAN, código del proveedor), prefijo (sufijos del proveedor) o descripción */
export function emparejar(cat: ItemCatalogo[], code: string | undefined, desc: string | undefined): { sku: string | null; how: string | null } {
  const c = String(code || '').replace(/\s/g, '').toUpperCase();
  if (c) {
    const eq = (v?: string) => !!v && v.toUpperCase() === c;
    const exact = cat.find(p => eq(p.sku) || eq(p.ean) || eq(p.ref));
    if (exact) return { sku: exact.sku, how: 'código' };
    const pref = cat.find(p => [p.sku, p.ref].some(v => v && v.length >= 6 && c.startsWith(v.toUpperCase())));
    if (pref) return { sku: pref.sku, how: 'código (prefijo)' };
  }
  const tk = (s: unknown) => norm(s).replace(/[(),.×x²]/g, ' ').split(/\s+/).filter(t => t.length >= 2);
  const dt = new Set(tk(desc));
  let best: ItemCatalogo | null = null, bs = 0;
  for (const p of cat) {
    const pt = tk(p.nombre); const hit = pt.filter(t => dt.has(t)).length;
    const sc = hit / Math.max(4, Math.min(pt.length, dt.size));
    if (sc > bs) { bs = sc; best = p; }
  }
  return best && bs >= 0.5 ? { sku: best.sku, how: 'descripción' } : { sku: null, how: null };
}

/** Instrucciones para el modelo de visión. Sin precios: el almacén no los necesita y el material en custodia no los lleva. */
export function construirPrompt(cat: ItemCatalogo[]): string {
  const lista = cat.map(p => `${p.sku}${p.ref ? ' / ' + p.ref : ''}${p.ean ? ' / ' + p.ean : ''} | ${p.nombre} | ${p.unidad}${p.custodia ? ' | custodia' : ''}`).join('\n');
  return `El documento es un albarán de entrega de un proveedor de material eléctrico, fontanería o movilidad eléctrica para un almacén en España.
Extrae cada línea de material recibido. Ignora bolsas, portes y embalajes salvo que estén en el catálogo.
Para cada línea devuelve: el código tal como aparece, la descripción, la cantidad en la unidad base del catálogo (metros para cables y tubos, unidades para el resto; si pone cajas, rollos o bobinas, multiplica y explícalo en "nota"), los números de serie si aparecen y el SKU del catálogo que corresponde (o null si no hay).
No extraigas precios ni importes: no se usan (los artículos marcados como "custodia" no los llevan nunca).
Indica en "confianza" (0 a 1) lo seguro que estás de cada línea.

Catálogo (SKU / código del proveedor / EAN | nombre | unidad):
${lista}`;
}

/** Esquema de salida (formato JSON estructurado de Gemini) */
export const ESQUEMA_RESPUESTA = {
  type: 'OBJECT',
  properties: {
    proveedor: { type: 'STRING' }, cif: { type: 'STRING' }, numero: { type: 'STRING' }, fecha: { type: 'STRING' }, bultos: { type: 'INTEGER' },
    lineas: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      codigo: { type: 'STRING' }, descripcion: { type: 'STRING' }, cantidad: { type: 'NUMBER' }, sku: { type: 'STRING', nullable: true },
      series: { type: 'ARRAY', items: { type: 'STRING' } }, nota: { type: 'STRING' }, confianza: { type: 'NUMBER' },
    }, required: ['descripcion', 'cantidad'] } },
  },
  required: ['lineas'],
};

const numero = (v: unknown): number => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim().replace(/\s/g, '');
  // "1.500,5" o "1.000" (España: punto de miles, coma decimal) o "1500.5"
  const n = /,\d{1,3}$/.test(s) ? Number(s.replace(/\./g, '').replace(',', '.'))
    : /^\d{1,3}(\.\d{3})+$/.test(s) ? Number(s.replace(/\./g, ''))
      : Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Limpia la respuesta del modelo y empareja cada línea con el catálogo (el SKU propuesto por el modelo solo vale si existe) */
export function normalizarRespuesta(raw: unknown, cat: ItemCatalogo[]): AlbaranLeido {
  const r = (typeof raw === 'string' ? JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim()) : raw) as Record<string, unknown>;
  const skus = new Set(cat.map(p => p.sku));
  const lineas = (Array.isArray(r?.lineas) ? r.lineas : []).map((l: Record<string, unknown>): LineaLeida => {
    const codigo = String(l.codigo ?? '').trim(), descripcion = String(l.descripcion ?? '').trim();
    const propuesto = typeof l.sku === 'string' && skus.has(l.sku.toUpperCase()) ? l.sku.toUpperCase() : null;
    const m = propuesto ? { sku: propuesto, how: 'IA' } : emparejar(cat, codigo, descripcion);
    const conf = Math.max(0, Math.min(1, numero(l.confianza) || 0.8));
    return {
      codigo, descripcion, cantidad: Math.max(0, numero(l.cantidad)), sku: m.sku, how: m.how,
      series: (Array.isArray(l.series) ? l.series : []).map(String).map(s => s.trim()).filter(Boolean),
      nota: String(l.nota ?? '').trim(),
      // si el modelo no sabe el SKU y nosotros tampoco, la confianza baja
      confianza: m.sku ? conf : Math.min(conf, 0.6),
    };
  }).filter(l => l.descripcion || l.codigo);
  return { proveedor: String(r?.proveedor ?? ''), cif: String(r?.cif ?? ''), numero: String(r?.numero ?? ''), fecha: String(r?.fecha ?? ''), bultos: r?.bultos ? Number(r.bultos) : undefined, lineas };
}
