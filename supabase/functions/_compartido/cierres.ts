/* E-012 · Cierres de instalación del wizard "bufala" (cierre-esbrain.html) → consumos del vehículo del equipo.
   El material no llega por SKU sino por partidas (metrosLinea, pvc32, rj45…). Una tabla de EQUIVALENCIAS (editable por el
   administrador) las traduce a artículos, con condiciones sobre cualquier campo del cierre (hardware, tipoLinea, fase, seccion…)
   y fórmulas: directa, manguitos floor(m/3)+1, fijaciones ceil(m/0,5) con un kit, o 1 ud (el cargador).
   Todas las cantidades que salen de aquí van en UNIDADES DE CONTENIDO (2 RJ45 = 2 ud de un sobre de 25), que es como se
   guarda el stock de los vehículos. Módulo puro: lo usan la función "registrar-cierre", la app (histórico y vista previa) y las pruebas. */

/** Partidas de material del wizard. Lo demás (fechas, hitos, fotos…) no consume nada. */
export const CAMPOS_MATERIAL = [
  'metrosLinea', 'metrosUtp', 'rj45', 'bornasMono', 'bornasTrif',
  'pvc32', 'corr32', 'acero32', 'acero40', 'canaleta', 'sot50', 'sot90',
  'cajaReg', 'caja6', 'caja12', 'caja18', 'cerradura', 'perfTab', 'perfForj', 'pica', 'preinst', 'mag1025', 'mag32', 'mag40',
] as const;

export type Formula = 'directa' | 'manguitos' | 'fijaciones' | 'unidad';
export interface ArticuloRegla { sku: string | null; factor: number; nombre?: string }
/** Regla de equivalencia. campo: una partida o una suma ("pvc32+acero32"); "hardware" para el cargador.
    condiciones: { campo: valor | [valores] } (igual, sin mayúsculas) o { "campo~": "texto" } (contiene; "a&b" = contiene a y b). */
export interface Regla {
  id: string; campo: string; formula: Formula; condiciones: Record<string, string | string[]>;
  articulos: ArticuloRegla[]; kit?: string | null; estimada: boolean; activa: boolean; orden: number; nota?: string;
}
export type Kits = Record<string, ArticuloRegla[]>;

export interface Cierre {
  numInst: string; esbrainUuid: string; cliente: string; direccion: string; fechaCierreIso: string; equipo: string; hardware: string;
  despFallido: boolean; version: number; [campo: string]: unknown;
}
export interface LineaTraducida {
  campo: string; formula: Formula; valor: number; sku: string | null; cantidad: number; estimada: boolean;
  estado: 'aplicable' | 'sin_equivalencia' | 'pendiente'; regla: string | null; nota: string;
}

const txt = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => txt(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const numero = (v: unknown) => { const n = typeof v === 'number' ? v : Number(txt(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

/** Limpia lo que envía el wizard (números como texto, booleanos como "true"…) */
export function normalizarCierre(raw: Record<string, unknown>): Cierre {
  const c: Cierre = {
    ...raw,
    numInst: txt(raw.numInst), esbrainUuid: txt(raw.esbrainUuid), cliente: txt(raw.cliente), direccion: txt(raw.direccion),
    fechaCierreIso: txt(raw.fechaCierreIso || raw.fechaIso), equipo: txt(raw.equipo), hardware: txt(raw.hardware),
    despFallido: raw.despFallido === true || raw.despFallido === 'true' || raw.despFallido === 1, version: Math.max(1, Math.trunc(numero(raw.version)) || 1),
  };
  for (const k of CAMPOS_MATERIAL) c[k] = Math.max(0, numero(raw[k]));
  return c;
}

/** Clave de idempotencia: esbrainUuid o, si falta, numInst + fechaCierreIso */
export function claveCierre(c: Pick<Cierre, 'esbrainUuid' | 'numInst' | 'fechaCierreIso'>): string {
  if (c.esbrainUuid) return 'uuid:' + c.esbrainUuid;
  if (c.numInst && c.fechaCierreIso) return `inst:${c.numInst}|${c.fechaCierreIso}`;
  throw new Error('El cierre no trae esbrainUuid ni numInst + fechaCierreIso');
}

/** Valor de un campo o de una suma de campos ("pvc32+acero32") */
export const valorCampo = (c: Cierre, campo: string) => campo === 'hardware' ? (c.hardware ? 1 : 0) : campo.split('+').reduce((a, k) => a + numero(c[k.trim()]), 0);

export function cumple(c: Cierre, cond: Record<string, string | string[]>): boolean {
  return Object.entries(cond || {}).every(([k, v]) => {
    if (k.endsWith('~')) return (Array.isArray(v) ? v : [v]).some(x => norm(x).split('&').every(t => norm(c[k.slice(0, -1)]).includes(t.trim())));
    const actual = norm(c[k]);
    return (Array.isArray(v) ? v : [v]).some(x => norm(x) === actual);
  });
}

export const manguitos = (m: number) => (m > 0 ? Math.floor(m / 3) + 1 : 0);
export const fijaciones = (m: number) => (m > 0 ? Math.ceil(m / 0.5 - 1e-9) : 0);

/** Traduce un cierre a líneas de consumo. Dentro de cada (campo, fórmula) aplica la PRIMERA regla activa que cumpla las condiciones. */
export function traducirCierre(c: Cierre, reglas: Regla[], kits: Kits, kitDefecto = 'A', catalogo?: Set<string>): LineaTraducida[] {
  if (c.despFallido) return [];
  const out: LineaTraducida[] = [];
  const activas = reglas.filter(r => r.activa).sort((a, b) => a.orden - b.orden);
  const grupos = new Map<string, Regla[]>();
  for (const r of activas) { const g = `${r.campo}|${r.formula}`; grupos.set(g, [...(grupos.get(g) || []), r]); }
  const cubiertos = new Set<string>();
  const linea = (r: Regla, a: ArticuloRegla, valor: number, cantidad: number, extra = ''): LineaTraducida => {
    const falta = !a.sku ? `${a.nombre || 'artículo'} sin dar de alta` : catalogo && !catalogo.has(a.sku) ? `el artículo ${a.sku} no está en el catálogo` : '';
    return { campo: r.campo, formula: r.formula, valor, sku: falta ? null : a.sku, cantidad: Math.round(cantidad * 1000) / 1000, estimada: r.estimada,
      estado: falta ? 'sin_equivalencia' : 'aplicable', regla: r.id, nota: [falta, extra, r.nota].filter(Boolean).join(' · ') };
  };
  for (const lista of grupos.values()) {
    const r = lista.find(x => cumple(c, x.condiciones) && valorCampo(c, x.campo) > 0);
    if (!r) continue;
    if (r.formula === 'directa') r.campo.split('+').forEach(k => cubiertos.add(k.trim()));   // manguitos y fijaciones son extras: no cubren la partida
    const v = valorCampo(c, r.campo);
    if (r.formula === 'fijaciones') {
      const n = fijaciones(v), kit = r.kit || kitDefecto, arts = kits[kit] || [];
      if (!arts.length) out.push({ campo: r.campo, formula: r.formula, valor: v, sku: null, cantidad: n, estimada: true, estado: 'sin_equivalencia', regla: r.id, nota: `kit de fijación ${kit} sin definir` });
      for (const a of arts) out.push(linea(r, a, v, n * a.factor, `${n} fijaciones · kit ${kit}`));
      continue;
    }
    const base = r.formula === 'manguitos' ? manguitos(v) : r.formula === 'unidad' ? 1 : v;
    for (const a of r.articulos) out.push(linea(r, a, v, base * a.factor, r.formula === 'manguitos' ? `${base} manguitos` : ''));
    if (!r.articulos.length) out.push({ campo: r.campo, formula: r.formula, valor: v, sku: null, cantidad: base, estimada: r.estimada, estado: 'sin_equivalencia', regla: r.id, nota: r.nota || 'sin artículo' });
  }
  // partidas con cantidad y sin ninguna regla que las cubra: no descuentan hasta que se definan
  for (const k of CAMPOS_MATERIAL) {
    const v = numero(c[k]);
    if (v > 0 && !cubiertos.has(k)) out.push({ campo: k, formula: 'directa', valor: v, sku: null, cantidad: v, estimada: false,
      estado: k === 'metrosUtp' ? 'pendiente' : 'sin_equivalencia', regla: null, nota: k === 'metrosUtp' ? `cable de datos con "${c.hardware || 'sin modelo'}": elige el artículo` : 'sin equivalencia' });
  }
  // el cargador (de cualquier socio de custodia, según el propietario del artículo): 1 ud del modelo; si no se reconoce, a "Pendientes"
  if (c.hardware && !activas.some(r => r.campo === 'hardware' && cumple(c, r.condiciones)))
    out.push({ campo: 'hardware', formula: 'unidad', valor: 1, sku: null, cantidad: 1, estimada: false, estado: 'pendiente', regla: null, nota: `modelo de cargador no reconocido: "${c.hardware}"` });
  return out;
}

/* ---------- Propuesta inicial (datos/equivalencias-cierres.csv, con las respuestas del usuario) ---------- */
let n = 0;
const R = (campo: string, formula: Formula, condiciones: Regla['condiciones'], articulos: [string | null, number, string?][], extra: Partial<Regla> = {}): Regla =>
  ({ id: `P${String(++n).padStart(2, '0')}`, campo, formula, condiciones, articulos: articulos.map(([sku, factor, nombre]) => ({ sku, factor, ...(nombre ? { nombre } : {}) })), estimada: false, activa: true, orden: n * 10, ...extra });

export const EQUIVALENCIAS_PROPUESTA: Regla[] = [
  R('metrosLinea', 'directa', { tipoLinea: 'tubo', fase: 'mono', seccion: '6' }, [['6000650603', 1], ['6000650604', 1], ['6000650605', 1]], { nota: 'fase marrón, neutro azul, tierra amarillo/verde' }),
  R('metrosLinea', 'directa', { tipoLinea: 'tubo', fase: 'mono', seccion: '10' }, [['6000650653', 1], ['6000650654', 1], ['6000650655', 1]]),
  R('metrosLinea', 'directa', { tipoLinea: 'tubo', fase: 'trif', seccion: '6' }, [['6000650603', 1], ['6000650601', 1], ['6000650602', 1], ['6000650604', 1], ['6000650605', 1]], { nota: '3 fases + neutro + tierra' }),
  R('metrosLinea', 'directa', { tipoLinea: 'manguera', fase: 'mono', seccion: '6' }, [['6040610306', 1]], { nota: 'RZ1-K 3G6' }),
  R('metrosUtp', 'directa', { 'hardware~': ['v2c', 'trydan'] }, [['7270020010', 1]], { nota: 'Cat6 U/UTP con V2C' }),
  R('metrosUtp', 'directa', { 'hardware~': 'policharger' }, [['7270021010', 1]], { nota: 'Cat6 F/UTP con Policharger' }),
  R('rj45', 'directa', {}, [['7280040060', 1]], { nota: 'sobre de 25: cada RJ45 es 1 ud del sobre' }),
  R('bornasMono', 'directa', {}, [['8909080510', 1]]),
  R('pvc32', 'directa', {}, [['6201000032', 1]]),
  R('corr32', 'directa', {}, [['6200020032', 1]]),
  R('acero32', 'directa', {}, [['6203000032', 1]]),
  R('canaleta', 'directa', {}, [['6222106082', 1]], { nota: 'moldura Hager ATEHA 30x12' }),
  R('pvc32', 'manguitos', {}, [['6201025023', 1]], { estimada: true, nota: 'manguito M-32: floor(m/3)+1' }),
  R('acero32', 'manguitos', {}, [[null, 1, 'manguito de acero M-32']], { estimada: true }),
  R('pvc32+acero32', 'fijaciones', {}, [], { estimada: true, kit: null, nota: '1 cada 0,50 m; el corrugado no cuenta' }),
  R('hardware', 'unidad', { 'hardware~': 'trydan&schuko' }, [['8900500015', 1]], { nota: 'Trydan 7,4 kW + Schuko (custodia Esmove)' }),
  R('hardware', 'unidad', { 'hardware~': 'trydan&22' }, [['8900500025', 1]], { nota: 'Trydan 22 kW (custodia Esmove)' }),
  R('hardware', 'unidad', { 'hardware~': ['trydan&7,4', 'trydan&7.4'] }, [['8900590300', 1]], { nota: 'Trydan 7,4 kW (custodia Esmove)' }),
];

export const KITS_PROPUESTA: Kits = {
  A: [{ sku: '5102012032', factor: 1 }, { sku: null, factor: 1, nombre: 'clavo' }],
  B: [{ sku: '5102012032', factor: 1 }, { sku: '5301012054', factor: 1 }, { sku: '5150000106', factor: 1 }],
  C: [{ sku: '5101010032', factor: 1 }, { sku: '5108000003', factor: 1 }, { sku: '5150000106', factor: 1 }],
};
