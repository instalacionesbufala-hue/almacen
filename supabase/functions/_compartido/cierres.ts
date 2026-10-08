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
  /** E-032: la partida no descuenta: es solo mano de obra (servicio) o lleva material que aún no gestiona el almacén (no_gestionado) */
  sinDescuento?: SinDescuento | null;
}
export type SinDescuento = 'servicio' | 'no_gestionado';
export type Kits = Record<string, ArticuloRegla[]>;

export interface Cierre {
  numInst: string; esbrainUuid: string; cliente: string; direccion: string; fechaCierreIso: string; equipo: string; hardware: string;
  despFallido: boolean; version: number; [campo: string]: unknown;
}
export interface LineaTraducida {
  campo: string; formula: Formula; valor: number; sku: string | null; cantidad: number; estimada: boolean;
  estado: 'aplicable' | 'sin_equivalencia' | 'pendiente' | 'no_gestionado'; regla: string | null; nota: string;
}

/** E-026 · Partidas que vienen en la prefactura de Holded: sustituyen a las del cierre; las demás (tipoLinea, seccion, fase, pvc32, hardware, equipo, fecha) se conservan */
export const CAMPOS_FACTURABLES = ['metrosLinea', 'metrosUtp', 'rj45', 'corr32', 'acero32', 'acero40', 'canaleta', 'sot50', 'sot90', 'bornasMono', 'bornasTrif',
  'caja6', 'caja12', 'caja18', 'cerradura', 'cajaReg', 'mag1025', 'mag32', 'mag40', 'pica', 'preinst'] as const;
/** Lo que identifica qué material lleva un cierre (si no cambia nada de esto, la versión no trae cambios) */
const CAMPOS_IDENTICOS = [...CAMPOS_MATERIAL, 'hardware', 'equipo', 'despFallido', 'tipoLinea', 'fase', 'seccion', 'cableDatos', 'materialEspecial'];

const txt = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => txt(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const numero = (v: unknown) => { const n = typeof v === 'number' ? v : Number(txt(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

/** Limpia lo que envía el wizard (números como texto, booleanos como "true"…) */
export function normalizarCierre(raw: Record<string, unknown>): Cierre {
  const c: Cierre = {
    ...raw,
    numInst: txt(raw.numInst), esbrainUuid: txt(raw.esbrainUuid), cliente: txt(raw.cliente), direccion: txt(raw.direccion),
    fechaCierreIso: txt(raw.fechaCierreIso || raw.fechaIso), equipo: txt(raw.equipo), hardware: txt(raw.hardware), materialEspecial: materialEspecial(raw.materialEspecial),
    despFallido: raw.despFallido === true || raw.despFallido === 'true' || raw.despFallido === 1, version: Math.max(1, Math.trunc(numero(raw.version)) || 1),
  };
  for (const k of CAMPOS_MATERIAL) c[k] = Math.max(0, numero(raw[k]));
  return c;
}

/** "SÍ — 1× CUADRO…" se guarda; "", "no", "-" o "NO" = sin material especial */
export function materialEspecial(v: unknown): string {
  const t = txt(v);
  return /^(no|-|—|ninguno|n\/a|false|0)?$/i.test(t) ? '' : t;
}

/** E-026 · Una instalación = un cierre: la identidad es numInst (el n.º de presupuesto). Sin numInst, el esbrainUuid. */
export const normInst = (v: unknown) => txt(v).toUpperCase().replace(/\s+/g, '');
export function claveCierre(c: Pick<Cierre, 'esbrainUuid' | 'numInst'>): string {
  if (normInst(c.numInst)) return 'inst:' + normInst(c.numInst);
  if (c.esbrainUuid) return 'uuid:' + c.esbrainUuid;
  throw new Error('El cierre no trae numInst (n.º de instalación)');
}

/* ---------- E-026 · Versiones de un cierre: directo (wizard), histórico y prefactura aprobada de Holded ---------- */
export type OrigenVersion = 'wizard' | 'historico' | 'holded' | 'admin';
export interface PrefacturaHolded { documento: string; fechaAprobacion: string; lineas: Record<string, number>; atributos?: Record<string, string> }
/** E-032 · Atributos que manda la prefactura: los de la línea (sacados de los nombres de las líneas de Holded) mandan sobre el wizard,
    porque es lo facturado; los del calendario (equipo, cargador, fecha de la instalación) solo rellenan lo que el wizard no trae. */
// E-033: el cable de datos NO: en Holded la tarifa siempre dice U/UTP; lo decide el cargador (aunque lo envíe un Apps Script antiguo, se ignora)
export const ATRIBUTOS_LINEA = ['tipoLinea', 'fase', 'seccion'] as const;
export const ATRIBUTOS_CALENDARIO = ['equipo', 'hardware', 'fechaCierreIso', 'materialEspecial'] as const;
export function normalizarAtributos(raw: unknown): Record<string, string> {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, out: Record<string, string> = {};
  for (const k of [...ATRIBUTOS_LINEA, ...ATRIBUTOS_CALENDARIO]) {
    let v = txt(a[k]);
    if (!v) continue;
    if (k === 'tipoLinea') v = /tubo/i.test(v) ? 'tubo' : /manguera/i.test(v) ? 'manguera' : norm(v);
    if (k === 'fase') v = /tri/i.test(v) ? 'trif' : /mono/i.test(v) ? 'mono' : norm(v);
    if (k === 'seccion') { const m = v.match(/(\d+(?:[.,]\d+)?)\s*mm/i) || v.match(/(\d+(?:[.,]\d+)?)\s*$/); if (m) v = String(Number(m[1].replace(',', '.'))); }
    if (k === 'materialEspecial') v = materialEspecial(v);
    if (v) out[k] = v;
  }
  return out;
}
/** Lo que ya se sabe del cierre: los últimos datos del wizard (o del histórico), la última prefactura y qué orígenes han llegado */
export interface PrevioCierre { version: number; wizard: Record<string, unknown> | null; holded: PrefacturaHolded | null; origenes: string[]; correccion?: Record<string, string> | null }
/** E-035 · Datos que el administrador corrige a mano: mandan sobre lo automático hasta "Volver a lo automático" */
export const CAMPOS_CORREGIBLES = ['fase', 'tipoLinea', 'seccion', 'equipo'] as const;
export function aplicarCorreccion(c: Cierre, corr?: Record<string, string> | null): Cierre {
  if (!corr) return c;
  const out = { ...c };
  for (const k of CAMPOS_CORREGIBLES) if (txt(corr[k])) out[k] = txt(corr[k]);
  return out;
}
export interface Version { accion: 'nueva' | 'duplicado' | 'obsoleto'; origen: OrigenVersion; documento: string; wizard: Cierre | null; holded: PrefacturaHolded | null; efectivo: Cierre; avisos: string[] }

/** Prefactura de Holded tal como la manda el Apps Script → solo campos facturables, como números */
export function normalizarPrefactura(raw: Record<string, unknown>): PrefacturaHolded & { ignorados: string[] } {
  const lineas: Record<string, number> = {}, ignorados: string[] = [];
  for (const [k, v] of Object.entries((raw.lineas as Record<string, unknown>) || {})) {
    if ((CAMPOS_FACTURABLES as readonly string[]).includes(k)) lineas[k] = Math.max(0, numero(v)); else ignorados.push(k);
  }
  const atributos = normalizarAtributos(raw.atributos);
  return { documento: txt(raw.documento), fechaAprobacion: txt(raw.fechaAprobacion), lineas, ...(Object.keys(atributos).length ? { atributos } : {}), ignorados };
}

/** Los datos con los que se calcula el consumo: los del wizard con las partidas de la prefactura encima */
export function cierreEfectivo(wizard: Record<string, unknown> | null, holded: PrefacturaHolded | null, extra: Record<string, unknown> = {}): Cierre {
  const at = holded?.atributos || {}, base: Record<string, unknown> = { ...extra, ...(wizard || {}) };
  for (const k of ATRIBUTOS_CALENDARIO) if (!txt(base[k]) && at[k]) base[k] = at[k];      // manda el wizard; si no lo trae, el calendario
  for (const k of ATRIBUTOS_LINEA) if (at[k]) base[k] = at[k];                            // manda la prefactura aprobada
  return normalizarCierre({ ...base, ...(holded?.lineas || {}) });
}

const mismoMaterial = (a: Record<string, unknown>, b: Record<string, unknown>) => CAMPOS_IDENTICOS.every(k => norm(a[k]) === norm(b[k]) || (numero(a[k]) === numero(b[k]) && (CAMPOS_MATERIAL as readonly string[]).includes(k)));

/** Decide qué hacer con lo que llega para una instalación que ya puede existir:
    - wizard / histórico: una versión del wizard más antigua que la guardada es "obsoleto"; los mismos datos por el mismo camino, "duplicado";
      los mismos datos por otro camino (p. ej. el histórico de un cierre que llegó en directo), una versión nueva sin cambios.
    - holded: la misma prefactura otra vez es "duplicado"; si no, versión nueva cuyas partidas facturables sustituyen a las anteriores.
    El UUID y la fecha que lleguen después se guardan, pero no cambian la identidad (la da numInst). */
export function prepararVersion(previo: PrevioCierre | null, origen: OrigenVersion, raw: Record<string, unknown>): Version {
  const avisos: string[] = [];
  let wizard = previo?.wizard ? normalizarCierre(previo.wizard) : null, holded = previo?.holded || null, accion: Version['accion'] = 'nueva', documento = '';
  if (origen === 'holded') {
    const pf = normalizarPrefactura(raw);
    if (!normInst(raw.numInst)) throw new Error('La prefactura no trae numInst');
    if (pf.ignorados.length) avisos.push(`Partidas de la prefactura que no se usan: ${pf.ignorados.join(', ')}`);
    documento = pf.documento;
    const atributos = { ...(holded?.atributos || {}), ...(pf.atributos || {}) };
    const nueva: PrefacturaHolded = { documento: pf.documento, fechaAprobacion: pf.fechaAprobacion, lineas: { ...(holded?.lineas || {}), ...pf.lineas }, ...(Object.keys(atributos).length ? { atributos } : {}) };
    if (holded && JSON.stringify(nueva.lineas) === JSON.stringify(holded.lineas) && JSON.stringify(nueva.atributos || {}) === JSON.stringify(holded.atributos || {})
        && (previo?.origenes || []).includes('holded')) accion = 'duplicado';
    holded = nueva;
    // prefactura sin cierre del wizard (aún): se guarda con lo que traiga; E-032: equipo, cargador y fecha de la instalación del calendario
    const hayWizard = (previo?.origenes || []).some(o => o === 'wizard' || o === 'historico');
    if (!hayWizard) wizard = normalizarCierre({ numInst: raw.numInst, equipo: raw.equipo || atributos.equipo, fechaCierreIso: raw.fechaCierreIso || atributos.fechaCierreIso || raw.fecha || pf.fechaAprobacion,
      cliente: raw.cliente || wizard?.cliente, direccion: raw.direccion || wizard?.direccion, hardware: raw.hardware || atributos.hardware, materialEspecial: atributos.materialEspecial });
  } else {
    const c = normalizarCierre(raw);
    if (wizard) {
      if (c.version < wizard.version) accion = 'obsoleto';
      else if (c.version === wizard.version && mismoMaterial(c, wizard) && (previo?.origenes || []).includes(origen)) accion = 'duplicado';
      // lo que no traiga (el histórico no lleva UUID) se conserva; la fecha de la primera llegada no cambia la identidad
      if (accion === 'nueva') wizard = { ...wizard, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== '' && v !== undefined && v !== null)), esbrainUuid: c.esbrainUuid || wizard.esbrainUuid } as Cierre;
    } else wizard = c;
  }
  const efectivo = aplicarCorreccion(cierreEfectivo(wizard, holded), previo?.correccion);
  return { accion, origen, documento, wizard, holded, efectivo, avisos };
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

/** E-042 · Tramos de la línea que no van en tubo PVC */
export const OTRAS_CANALIZACIONES = ['corr32', 'acero32', 'acero40', 'canaleta', 'sot50', 'sot90'] as const;
/** E-042 · La canalización completa son los metros de línea. Si la línea va bajo tubo y el cierre no trae pvc32 (la prefactura de
    Holded no lo lleva), el tubo PVC son los metros de línea menos los tramos de otra canalización (nunca negativo). Si el cierre trae
    pvc32 > 0, se respeta. Con manguera solo cuenta el pvc32 que venga (el wizard no dice si va entubada). */
export function deducirPvc(c: Cierre): Cierre {
  if (numero(c.pvc32) > 0 || c.pvcDeducido || !/tubo/.test(norm(c.tipoLinea)) || /manguera/.test(norm(c.tipoLinea))) return c;
  const linea = numero(c.metrosLinea), tramos = OTRAS_CANALIZACIONES.filter(k => numero(c[k]) > 0);
  const pvc = Math.round((linea - tramos.reduce((a, k) => a + numero(c[k]), 0)) * 1000) / 1000;
  if (!(pvc > 0)) return c;
  const es = (v: number) => String(v).replace('.', ',');
  return { ...c, pvc32: pvc, pvcDeducido: `PVC deducido de los metros de línea (${tramos.length ? `${[es(linea), ...tramos.map(k => es(numero(c[k])))].join(' − ')} = ` : ''}${es(pvc)} m)` };
}

export const manguitos = (m: number) => (m > 0 ? Math.floor(m / 3) + 1 : 0);
export const fijaciones = (m: number) => (m > 0 ? Math.ceil(m / 0.5 - 1e-9) : 0);

/** Traduce un cierre a líneas de consumo. Dentro de cada (campo, fórmula) aplica la PRIMERA regla activa que cumpla las condiciones. */
export function traducirCierre(c: Cierre, reglas: Regla[], kits: Kits, kitDefecto = 'A', catalogo?: Set<string>): LineaTraducida[] {
  if (c.despFallido) return [];
  c = deducirPvc(c);
  const deducido = typeof c.pvcDeducido === 'string' ? c.pvcDeducido : '';
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
    // E-032: partidas sin descuento. "servicio": nada; "no_gestionado": queda la línea con su cantidad (para contar), sin artículo ni pendiente
    if (r.sinDescuento) {
      r.campo.split('+').forEach(k => cubiertos.add(k.trim()));
      const v = valorCampo(c, r.campo);
      if (r.sinDescuento === 'no_gestionado') out.push({ campo: r.campo, formula: r.formula, valor: v, sku: null, cantidad: r.formula === 'unidad' ? 1 : v, estimada: r.estimada, estado: 'no_gestionado', regla: r.id,
        nota: ['material no gestionado en el almacén: no descuenta', r.nota].filter(Boolean).join(' · ') });
      continue;
    }
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
    // E-042: que se vea que el tubo PVC (y lo que se calcula con él) no lo puso el técnico
  if (deducido) for (const l of out) if (l.campo.split('+').some(k => k.trim() === 'pvc32')) l.nota = [deducido, l.nota].filter(Boolean).join(' · ');
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
  // E-042: 1 fijación cada 0,50 m de tubo PVC (el del wizard o el deducido de los metros de línea) y de acero; el corrugado no cuenta
  R('pvc32+acero32+acero40', 'fijaciones', {}, [], { estimada: true, kit: null, nota: '1 cada 0,50 m; el corrugado no cuenta' }),
  // E-026: texto real del calendario ("V2C TRYDAN MONOFÁSICO PROTECCIONES M5 + SCHUKO", "POLICHARGER NW MONOFÁSICO PROTECCIÓN REARME M5"…)
  R('hardware', 'unidad', { 'hardware~': 'trydan&schuko' }, [['8900500015', 1]], { nota: 'Trydan 7,4 kW 5 m + Schuko' }),
  R('hardware', 'unidad', { 'hardware~': ['trydan&trif&m10', 'trydan&22&m10'] }, [['8900500030', 1]], { nota: 'Trydan 22 kW 10 m' }),
  R('hardware', 'unidad', { 'hardware~': ['trydan&trif', 'trydan&22'] }, [['8900500025', 1]], { nota: 'Trydan 22 kW 5 m' }),
  R('hardware', 'unidad', { 'hardware~': 'trydan&m10' }, [['8900500020', 1]], { nota: 'Trydan 7,4 kW 10 m' }),
  R('hardware', 'unidad', { 'hardware~': 'trydan' }, [['8900590300', 1]], { nota: 'Trydan 7,4 kW 5 m (el más habitual)' }),
  // E-035: el trifásico (NW-DBLT23F) antes que el genérico, que queda para los monofásicos
  R('hardware', 'unidad', { 'hardware~': ['policharger&trif', 'policharger&dblt'] }, [['8437024504283', 1]], { nota: 'Policharger NW-DBLT23F trifásico' }),
  R('hardware', 'unidad', { 'hardware~': 'policharger' }, [['8906000665', 1]], { nota: 'Policharger NW T2' }),
  // E-032/E-033: el cable de datos del wizard, solo como último recurso (sin cargador reconocido): manda el cargador (V2C → U/UTP, Policharger → F/UTP).
  // F/UTP antes que U/UTP, porque "utp" también está en "f/utp"
  R('metrosUtp', 'directa', { 'cableDatos~': ['f/utp', 'ftp'] }, [['7270021010', 1]], { id: 'P-UTP-F', orden: 65, nota: 'Cat6 F/UTP (sin cargador: lo dice el cable de datos)' }),
  R('metrosUtp', 'directa', { 'cableDatos~': 'utp' }, [['7270020010', 1]], { id: 'P-UTP-U', orden: 66, nota: 'Cat6 U/UTP (sin cargador: lo dice el cable de datos)' }),
];

export const KITS_PROPUESTA: Kits = {
  A: [{ sku: '5102012032', factor: 1 }, { sku: null, factor: 1, nombre: 'clavo' }],
  B: [{ sku: '5102012032', factor: 1 }, { sku: '5301012054', factor: 1 }, { sku: '5150000106', factor: 1 }],
  C: [{ sku: '5101010032', factor: 1 }, { sku: '5108000003', factor: 1 }, { sku: '5150000106', factor: 1 }],
};
