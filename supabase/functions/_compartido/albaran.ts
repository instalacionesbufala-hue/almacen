/* E-003 · Lectura de albaranes: prompt, esquema de respuesta, normalización y emparejado con el catálogo.
   Módulo puro compartido por la función de servidor "leer-albaran" (Gemini) y por la app (emparejado local). */

export interface ItemCatalogo { sku: string; ref?: string; ean?: string; codigos?: string[]; nombre: string; unidad: string; contenido?: number; proveedor?: string; custodia?: boolean }
export interface LineaLeida { codigo: string; descripcion: string; cantidad: number; sku: string | null; how: string | null; series: string[]; nota: string; confianza: number }
export interface AlbaranLeido { proveedor: string; cif: string; numero: string; fecha: string; bultos?: number; lineas: LineaLeida[] }

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** ¿Ese código es el de este artículo? Igual al SKU, EAN o código del proveedor, o empieza por él (sufijos del proveedor) */
export function mismoCodigo(p: ItemCatalogo, code: string | undefined): 'código' | 'código (prefijo)' | null {
  const c = String(code || '').replace(/\s/g, '').toUpperCase();
  if (!c) return null;
  const eq = (v?: string) => !!v && v.toUpperCase() === c;
  if (eq(p.sku) || eq(p.ean) || eq(p.ref) || (p.codigos || []).some(eq)) return 'código';
  return [p.sku, p.ref].some(v => v && v.length >= 6 && c.startsWith(v.toUpperCase())) ? 'código (prefijo)' : null;
}

/** Emparejado (cualquier proveedor): código exacto (SKU, EAN, código del proveedor) o prefijo (sufijos del proveedor).
    E-016: si la línea trae un código que no está en el catálogo, es un ARTÍCULO NUEVO (how = 'nuevo'): nunca se empareja por
    descripción con otro artículo de código distinto. La descripción solo se usa en las líneas sin código. */
export function emparejar(cat: ItemCatalogo[], code: string | undefined, desc: string | undefined): { sku: string | null; how: string | null } {
  const c = String(code || '').replace(/\s/g, '').toUpperCase();
  if (c) {
    const exact = cat.find(p => mismoCodigo(p, c) === 'código');
    if (exact) return { sku: exact.sku, how: 'código' };
    const pref = cat.find(p => mismoCodigo(p, c) === 'código (prefijo)');
    if (pref) return { sku: pref.sku, how: 'código (prefijo)' };
    return { sku: null, how: 'nuevo' };
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
  const lista = cat.map(p => `${p.sku}${p.ref ? ' / ' + p.ref : ''}${p.ean ? ' / ' + p.ean : ''} | ${p.nombre} | ${p.unidad}${p.contenido && p.contenido > 1 ? ' de ' + p.contenido : ''}${p.custodia ? ' | custodia' : ''}`).join('\n');
  return `El documento es un albarán de entrega de un proveedor de material eléctrico y de puntos de recarga de vehículo eléctrico para un almacén en España.
"proveedor" es el EMISOR del albarán (quien vende y envía, p. ej. Saltoki), NUNCA el cliente o destinatario (Búfala Tech).
Si el código de una línea no está en el catálogo, deja "sku" en null: no lo asignes a otro artículo aunque la descripción se parezca.
Extrae cada línea de material recibido. Ignora bolsas, portes y embalajes salvo que estén en el catálogo.
Para cada línea devuelve: el código tal como aparece, la descripción, la cantidad EN LA UNIDAD DEL CATÁLOGO y el SKU del catálogo que corresponde (o null si no hay).
La unidad del catálogo es como se guarda el stock: metros para cables y tubos (un rollo de 100 m son 100); unidades sueltas si pone "ud"; y si pone bote, sobre, bolsa, pack o caja "de N", la cantidad va en esos formatos (1000 tacos de una referencia "caja de 100" son 10 cajas). Si conviertes, explícalo en "nota".
No extraigas precios ni importes ni números de serie: no se usan (los artículos marcados como "custodia" no los llevan nunca).
Indica en "confianza" (0 a 1) lo seguro que estás de cada línea.

Catálogo (SKU / código del proveedor / EAN | nombre | unidad y contenido):
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
  const lineas = (Array.isArray(r?.lineas) ? r.lineas : []).map((l: Record<string, unknown>): LineaLeida => {
    const codigo = String(l.codigo ?? '').trim(), descripcion = String(l.descripcion ?? '').trim();
    // el SKU que propone el modelo solo vale si existe y, si la línea trae código, si es el de ese artículo (E-016)
    const skuIA = typeof l.sku === 'string' ? l.sku.toUpperCase() : '';
    const cand = skuIA ? cat.find(p => p.sku === skuIA) : undefined;
    const propuesto = cand && (!codigo || mismoCodigo(cand, codigo)) ? cand.sku : null;
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

/* ---------- E-024 · Albaranes de varias páginas ---------- */
/** Instrucciones extra cuando se envían varias páginas del mismo albarán en una sola llamada */
export const PROMPT_PAGINAS = (n: number) => `
Las ${n} imágenes o páginas que se adjuntan son hojas CONSECUTIVAS de UN SOLO albarán, en orden.
Devuelve una sola cabecera (proveedor, CIF, número y fecha) y cada línea de material UNA sola vez.
No copies las líneas de "suma y sigue", "suma anterior", subtotales, totales, cabeceras repetidas ni pies de página.`;

/** Líneas que no son material: arrastres de "suma y sigue", subtotales y totales que repiten importes de otra hoja */
export function esLineaDeArrastre(l: Pick<LineaLeida, 'codigo' | 'descripcion'>): boolean {
  const d = norm(l.descripcion).replace(/[.:·]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/suma y sigue|suma anterior|sigue a la vuelta|viene de la hoja|pasa a la hoja|continua en la hoja|continuacion hoja/.test(d)) return true;
  return !l.codigo && /^(sub ?total|total|base imponible|importe total|iva\b|total albaran|total pagina)/.test(d);
}

const claveLinea = (l: LineaLeida) => `${String(l.codigo).replace(/\s/g, '').toUpperCase()}|${norm(l.descripcion).replace(/\s+/g, ' ').trim()}|${l.cantidad}`;

/** Une las lecturas de varios lotes de páginas del mismo albarán: una cabecera (la primera que tenga cada dato),
    sin arrastres de "suma y sigue" y sin repetir una línea idéntica que salga en dos lotes (la misma hoja fotografiada dos veces). */
export function unirAlbaranes(partes: AlbaranLeido[]): AlbaranLeido & { avisos: string[] } {
  const prim = <K extends 'proveedor' | 'cif' | 'numero' | 'fecha'>(k: K) => partes.map(p => String(p[k] || '').trim()).find(Boolean) || '';
  const avisos: string[] = [];
  const numeros = [...new Set(partes.map(p => String(p.numero || '').trim()).filter(Boolean))];
  if (numeros.length > 1) avisos.push(`Las páginas traen números de albarán distintos (${numeros.join(', ')}): comprueba que son del mismo albarán.`);
  const vistas = new Map<string, number>(), lineas: LineaLeida[] = [];
  partes.forEach((p, k) => {
    const deEsta = new Set<string>();
    for (const l of p.lineas) {
      if (esLineaDeArrastre(l)) continue;
      const c = claveLinea(l);
      const antes = vistas.get(c);
      if (antes !== undefined && antes !== k && !deEsta.has(c)) {
        const x = lineas.find(y => claveLinea(y) === c);
        if (x && !/también en otra hoja/.test(x.nota)) x.nota = [x.nota, 'aparecía también en otra hoja: si eran dos, añádela a mano'].filter(Boolean).join(' · ');
        continue;
      }
      vistas.set(c, k); deEsta.add(c); lineas.push(l);
    }
  });
  const bultos = partes.map(p => p.bultos).find(b => b && b > 0);
  return { proveedor: prim('proveedor'), cif: prim('cif'), numero: prim('numero'), fecha: prim('fecha'), bultos, lineas, avisos };
}
/** Un PDF puede traer varias páginas del mismo albarán */
export const PROMPT_PDF = `
Si el documento tiene varias páginas, son hojas consecutivas del mismo albarán: una sola cabecera y cada línea una vez, sin "suma y sigue", subtotales ni totales.`;
