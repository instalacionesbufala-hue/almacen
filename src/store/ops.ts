/* Operaciones de escritura. Cada una sabe:
   - aplicarse en local (validación previa con src/domain y respuesta inmediata en pantalla), y
   - traducirse a su función SQL del servidor (la fuente de verdad en modo nube).
   En modo nube la operación se guarda en la cola y se reaplica en local hasta que el servidor la confirma. */
import type { EstadoEquipo, Estado, Herramienta, LineaEntrega, Producto, TipoIncidencia, TipoMov } from '../data/tipos';
import { applyMovement, find } from '../domain/reglas';
import { asignarHerramienta, registrarIncidencia } from '../domain/herramientas';

export interface OpMovimiento { id: string; sku: string; tipo: TipoMov; qty: number; motivo: string; ref: string; series: string[]; equipo?: string }
export interface OpEntrega { id: string; numero?: string; ts: number; equipo: string; receptor: string; dni: string; lineas: LineaEntrega[]; firma: string; hash?: string }
export interface OpAlbaran { id: string; cabecera: { numero: string; proveedor: string; cif: string; fecha: string; confianza: number; modo: 'ia' | 'sim' }; lineas: { sku: string; cantidad: number; series: string[] }[] }
export interface OpProducto { producto: Producto; nuevo: boolean; stockInicial: number }
export interface OpIncidencia { id: string; dotacion: string; tipo: TipoIncidencia; nota: string; coste?: number; serieNueva?: string; caducaNueva?: string }

export type Op =
  | { op: 'movimiento'; args: OpMovimiento }
  | { op: 'entrega'; args: OpEntrega }
  | { op: 'albaran'; args: OpAlbaran }
  | { op: 'producto'; args: OpProducto }
  | { op: 'pedido'; args: { sku: string; qty: number } }
  | { op: 'equipo'; args: { id: string; nombre: string; flota: string; matricula: string; estado: EstadoEquipo } }
  | { op: 'estadoEquipo'; args: { id: string; estado: EstadoEquipo } }
  | { op: 'retirarEquipo'; args: { id: string; destino?: string } }
  | { op: 'tecnico'; args: { id: string; nombre: string; rol: string; dni: string; equipo?: string } }
  | { op: 'asignarTecnico'; args: { tecnico: string; equipo?: string } }
  | { op: 'altaDotacion'; args: Herramienta }
  | { op: 'asignarDotacion'; args: { id: string; dotacion: string; equipo?: string; tecnico?: string } }
  | { op: 'incidencia'; args: OpIncidencia };

type Def<A> = { local: (S: Estado, a: A) => void; rpc: (a: A) => [string, Record<string, unknown>]; desc: (S: Estado, a: A) => string };
type Defs = { [K in Op['op']]: Def<Extract<Op, { op: K }>['args']> };

const nombreProd = (S: Estado, sku: string) => find(S, sku)?.name || sku;

export const OPS: Defs = {
  movimiento: {
    local: (S, a) => { applyMovement(S, { id: a.id, sku: a.sku, type: a.tipo, qty: a.qty, reason: a.motivo, ref: a.ref, serials: a.series, equipo: a.equipo }); },
    rpc: a => ['registrar_movimiento', { p_id: a.id, p_sku: a.sku, p_tipo: a.tipo, p_cantidad: a.qty, p_motivo: a.motivo, p_referencia: a.ref, p_series: a.series, p_equipo: a.equipo ?? null }],
    desc: (S, a) => `${a.tipo} de ${a.qty} · ${nombreProd(S, a.sku)}`,
  },
  entrega: {
    local: (S, a) => {
      const copia = JSON.stringify(S.products);
      try { for (const l of a.lineas) applyMovement(S, { sku: l.sku, type: 'salida', qty: l.qty, reason: 'Entrega a equipo', ref: a.numero || 'Entrega pendiente', serials: l.serials, equipo: a.equipo, entrega: a.id }); }
      catch (e) { S.products = JSON.parse(copia); throw e; }
      S.entregas.unshift({ id: a.id, numero: a.numero, ts: a.ts, equipo: a.equipo, receptor: a.receptor, dni: a.dni, lineas: a.lineas, firma: a.firma, hash: a.hash, operator: S.operator });
    },
    rpc: a => ['registrar_entrega', { p_id: a.id, p_equipo: a.equipo, p_receptor: a.receptor, p_lineas: a.lineas.map(l => ({ sku: l.sku, cantidad: l.qty, series: l.serials })), p_firma: a.firma }],
    desc: (S, a) => `Entrega a ${S.equipos.find(e => e.id === a.equipo)?.nombre || a.equipo} (${a.lineas.length} líneas)`,
  },
  albaran: {
    local: (S, a) => {
      const copia = JSON.stringify(S.products);
      try { for (const l of a.lineas) applyMovement(S, { sku: l.sku, type: 'entrada', qty: l.cantidad, reason: 'Compra a proveedor', ref: `Alb. ${a.cabecera.numero || 's/n'}`, serials: l.series }); }
      catch (e) { S.products = JSON.parse(copia); throw e; }
      S.albaranes.unshift({ numero: a.cabecera.numero || 's/n', proveedor: a.cabecera.proveedor || 'Proveedor', fecha: a.cabecera.fecha, lineas: a.lineas.length,
        unidades: a.lineas.reduce((s, l) => s + l.cantidad, 0), ts: Date.now(), operator: S.operator, confianza: a.cabecera.confianza, modo: a.cabecera.modo });
    },
    rpc: a => ['aprobar_albaran', { p_id: a.id, p_cabecera: a.cabecera, p_lineas: a.lineas }],
    desc: (_S, a) => `Albarán ${a.cabecera.numero} (${a.lineas.length} líneas)`,
  },
  producto: {
    local: (S, { producto: p, nuevo, stockInicial }) => {
      const actual = find(S, p.sku);
      if (nuevo && actual) throw new Error(`Ya existe una referencia con el SKU ${p.sku}`);
      if (actual) { const { stock, serials } = actual; Object.assign(actual, p, { stock, serials: p.serialized ? (serials || []) : serials }); }
      else {
        S.products.push({ ...p, stock: 0, serials: p.serialized ? [] : undefined });
        if (stockInicial > 0 && !p.serialized) applyMovement(S, { sku: p.sku, type: 'ajuste', qty: stockInicial, reason: 'Alta de referencia', ref: 'Stock inicial' });
      }
    },
    rpc: ({ producto: p, nuevo, stockInicial }) => ['guardar_producto', { p_producto: {
      sku: p.sku, nuevo, ean: p.ean ?? '', ref_proveedor: p.supplierRef ?? '', nombre: p.name, categoria: p.cat, unidad: p.unit, formato: p.pack,
      formato_texto: p.packLabel, minimo: p.min, ubicacion: p.loc, proveedor: p.supplier, con_serie: !!p.serialized, precio: p.propiedad === 'custodia' ? null : p.price, stock_inicial: stockInicial,
      propiedad: p.propiedad || 'propia', propietario_id: p.propiedad === 'custodia' ? p.propietario : null } }],
    desc: (_S, a) => `${a.nuevo ? 'Alta' : 'Edición'} de ${a.producto.sku}`,
  },
  pedido: {
    local: (S, a) => { S.pedidos[a.sku] = { ts: Date.now(), qty: a.qty }; },
    rpc: a => ['marcar_pedido', { p_sku: a.sku, p_cantidad: a.qty }],
    desc: (S, a) => `Pedido de ${nombreProd(S, a.sku)}`,
  },
  equipo: {
    local: (S, a) => {
      if (!a.matricula.trim()) throw new Error('Indica la matrícula del vehículo');
      const e = S.equipos.find(x => x.id === a.id);
      if (e) Object.assign(e, { nombre: a.nombre, flota: a.flota, matricula: a.matricula, estado: a.estado });
      else S.equipos.push({ ...a, tecnicos: [] });
    },
    rpc: a => ['guardar_equipo', { p_equipo: a }],
    desc: (_S, a) => `Equipo ${a.nombre}`,
  },
  estadoEquipo: {
    local: (S, a) => { const e = S.equipos.find(x => x.id === a.id); if (!e) throw new Error('Equipo no encontrado'); e.estado = a.estado; },
    rpc: a => ['cambiar_estado_equipo', { p_equipo: a.id, p_estado: a.estado }],
    desc: (S, a) => `Estado de ${S.equipos.find(x => x.id === a.id)?.nombre || a.id}`,
  },
  retirarEquipo: {
    local: (S, a) => {
      const e = S.equipos.find(x => x.id === a.id); if (!e) throw new Error('Equipo no encontrado');
      if (e.tecnicos.length) throw new Error('El equipo aún tiene técnicos asignados');
      S.herramientas.forEach(h => { if (h.equipo === a.id) h.equipo = a.destino; });
      S.equipos = S.equipos.filter(x => x !== e);
    },
    rpc: a => ['retirar_equipo', { p_equipo: a.id, p_destino: a.destino ?? null }],
    desc: (_S, a) => `Retirar vehículo ${a.id}`,
  },
  tecnico: {
    local: (S, a) => {
      const t = S.tecnicos.find(x => x.id === a.id);
      if (t) Object.assign(t, { nombre: a.nombre, rol: a.rol, dni: a.dni });
      else S.tecnicos.push({ id: a.id, nombre: a.nombre, rol: a.rol, dni: a.dni });
      if (a.equipo !== undefined) OPS.asignarTecnico.local(S, { tecnico: a.id, equipo: a.equipo });
    },
    rpc: a => ['guardar_tecnico', { p_tecnico: { id: a.id, nombre: a.nombre, rol: a.rol, dni_mascara: a.dni, equipo_id: a.equipo ?? '' } }],
    desc: (_S, a) => `Técnico ${a.nombre}`,
  },
  asignarTecnico: {
    local: (S, a) => { S.equipos.forEach(e => { e.tecnicos = e.tecnicos.filter(t => t !== a.tecnico); }); if (a.equipo) { const e = S.equipos.find(x => x.id === a.equipo); if (!e) throw new Error('Equipo no encontrado'); e.tecnicos.push(a.tecnico); } },
    rpc: a => ['asignar_tecnico', { p_tecnico: a.tecnico, p_equipo: a.equipo ?? null }],
    desc: (S, a) => `Asignar ${S.tecnicos.find(t => t.id === a.tecnico)?.nombre || a.tecnico}`,
  },
  altaDotacion: {
    local: (S, h) => { if (S.herramientas.some(x => x.id === h.id)) return; S.herramientas.push(JSON.parse(JSON.stringify(h))); },
    rpc: h => ['alta_dotacion', { p_dotacion: { id: h.id, clase: h.clase, nombre: h.nombre, marca: h.marca, serie: h.serie, talla: h.talla ?? '', cantidad: h.cantidad, caduca: h.caduca ?? '', valor: h.valor, equipo_id: h.equipo ?? '', tecnico_id: h.tecnico ?? '' } }],
    desc: (_S, h) => `Alta de ${h.nombre}`,
  },
  asignarDotacion: {
    local: (S, a) => { asignarHerramienta(S, a.dotacion, a.equipo, a.tecnico); },
    rpc: a => ['asignar_dotacion', { p_id: a.id, p_dotacion: a.dotacion, p_equipo: a.equipo ?? null, p_tecnico: a.tecnico ?? null }],
    desc: (S, a) => `Asignar ${S.herramientas.find(h => h.id === a.dotacion)?.nombre || a.dotacion}`,
  },
  incidencia: {
    local: (S, a) => { registrarIncidencia(S, a.dotacion, a.tipo, { nota: a.nota, coste: a.coste, serieNueva: a.serieNueva, caducaNueva: a.caducaNueva }); },
    rpc: a => ['registrar_incidencia', { p_id: a.id, p_dotacion: a.dotacion, p_tipo: a.tipo, p_nota: a.nota, p_coste: a.coste ?? null, p_serie_nueva: a.serieNueva ?? null, p_caduca_nueva: a.caducaNueva ?? null }],
    desc: (S, a) => `${a.tipo} en ${S.herramientas.find(h => h.id === a.dotacion)?.nombre || a.dotacion}`,
  },
};

export function aplicarLocal(S: Estado, o: Op) { (OPS[o.op].local as (S: Estado, a: unknown) => void)(S, o.args); }
export function rpcDe(o: Op) { return (OPS[o.op].rpc as (a: unknown) => [string, Record<string, unknown>])(o.args); }
export function descripcion(S: Estado, o: Op) { return (OPS[o.op].desc as (S: Estado, a: unknown) => string)(S, o.args); }
/** UUID v4 generado en el cliente: es la clave de idempotencia de cada operación */
export function nuevoId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
