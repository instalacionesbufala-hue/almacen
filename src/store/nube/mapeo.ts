/* Filas de Supabase → estado de la app (src/data/tipos.ts) */
import type { Pendiente, PerfilUsuario, Rol, Albaran, CatId, ClaseDotacion, Entrega, Equipo, EstadoEquipo, EstadoHerramienta, Estado, Herramienta, Movimiento, Producto, Tecnico, TipoIncidencia, TipoMov, Unidad } from '../../data/tipos';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Fila = Record<string, any>;
export interface Tablas {
  productos: Fila[]; costes_producto: Fila[]; series: Fila[]; equipos: Fila[]; tecnicos: Fila[]; movimientos: Fila[];
  albaranes: Fila[]; entregas: Fila[]; entrega_lineas: Fila[]; dotacion: Fila[]; costes_dotacion: Fila[];
  dotacion_historial: Fila[]; costes_incidencia: Fila[]; pedidos_reposicion: Fila[]; propietarios: Fila[];
  perfiles: Fila[]; pendientes: Fila[]; valores_pendientes?: Fila[];
}
export const TABLAS: (keyof Tablas)[] = ['productos', 'costes_producto', 'series', 'equipos', 'tecnicos', 'movimientos', 'albaranes', 'entregas',
  'entrega_lineas', 'dotacion', 'costes_dotacion', 'dotacion_historial', 'costes_incidencia', 'pedidos_reposicion', 'propietarios', 'perfiles', 'pendientes'];
/** Columnas legibles por cada rol (en pendientes el importe se lee aparte, solo el administrador) */
export const COLUMNAS: Partial<Record<keyof Tablas, string>> = {
  pendientes: 'id, ts, tipo, sku, cantidad, motivo, referencia, series, operario, estado, resuelto_por, nota_resolucion',
};

const ms = (t: string) => new Date(t).getTime();
const n = (v: unknown) => Number(v ?? 0);

export function aEstado(t: Tablas, base: Pick<Estado, 'cesta' | 'seq'>, operador: string, rol: Rol = 'almacen'): Estado {
  const precio = new Map(t.costes_producto.map(c => [c.sku, n(c.precio)]));
  const series = new Map<string, string[]>();
  for (const s of t.series) if (s.en_stock) series.set(s.sku, [...(series.get(s.sku) || []), s.serie]);
  const products: Producto[] = t.productos.map(p => ({
    sku: p.sku, ean: p.ean ?? undefined, supplierRef: p.ref_proveedor ?? undefined, name: p.nombre, cat: p.categoria as CatId, unit: p.unidad as Unidad,
    pack: n(p.formato) || 1, packLabel: p.formato_texto || '', stock: n(p.stock), min: n(p.minimo), loc: p.ubicacion, supplier: p.proveedor || '',
    price: precio.get(p.sku) ?? 0, serialized: !!p.con_serie, serials: p.con_serie ? (series.get(p.sku) || []) : undefined, borrador: !!p.borrador,
    propiedad: p.propiedad === 'custodia' ? 'custodia' : 'propia', propietario: p.propietario_id ?? undefined,
  }));
  const activos = t.equipos.filter(e => e.activo);
  const equipos: Equipo[] = activos.map(e => ({ id: e.id, nombre: e.nombre, flota: e.flota, matricula: e.matricula, estado: e.estado as EstadoEquipo,
    tecnicos: t.tecnicos.filter(x => x.activo && x.equipo_id === e.id).map(x => x.id) }));
  const tecnicos: Tecnico[] = t.tecnicos.filter(x => x.activo).map(x => ({ id: x.id, nombre: x.nombre, rol: x.rol, dni: x.dni_mascara }));
  const movements: Movimiento[] = t.movimientos.map(m => ({ id: m.id, ts: ms(m.ts), sku: m.sku, type: m.tipo as TipoMov, qty: n(m.cantidad), reason: m.motivo,
    ref: m.referencia || '', operator: m.operario, serials: m.series || [], equipo: m.equipo_id ?? undefined, entrega: m.entrega_id ?? undefined })).sort((a, b) => b.ts - a.ts);
  const albaranes: Albaran[] = t.albaranes.map(a => ({ numero: a.numero, proveedor: a.proveedor, fecha: a.fecha, lineas: a.lineas, unidades: n(a.unidades),
    ts: ms(a.ts), operator: a.operario, confianza: a.confianza == null ? .95 : n(a.confianza), modo: a.modo })).sort((a, b) => b.ts - a.ts);
  const lineas = new Map<string, Fila[]>();
  for (const l of t.entrega_lineas) lineas.set(l.entrega_id, [...(lineas.get(l.entrega_id) || []), l]);
  const entregas: Entrega[] = t.entregas.map(e => ({ id: e.id, numero: e.numero, ts: ms(e.ts), equipo: e.equipo_id, receptor: e.receptor_id, dni: e.dni, firma: e.firma, hash: e.hash, operator: e.operario,
    lineas: (lineas.get(e.id) || []).sort((a, b) => a.n - b.n).map(l => ({ sku: l.sku, qty: n(l.cantidad), serials: l.series || [] })) })).sort((a, b) => b.ts - a.ts);
  const valor = new Map(t.costes_dotacion.map(c => [c.id, n(c.valor)]));
  const coste = new Map(t.costes_incidencia.map(c => [c.incidencia_id, n(c.coste)]));
  const hist = new Map<string, Fila[]>();
  for (const h of t.dotacion_historial) hist.set(h.dotacion_id, [...(hist.get(h.dotacion_id) || []), h]);
  const herramientas: Herramienta[] = t.dotacion.map(d => ({
    id: d.id, clase: d.clase as ClaseDotacion, nombre: d.nombre, marca: d.marca, serie: d.serie, talla: d.talla ?? undefined, cantidad: d.cantidad, caduca: d.caduca ?? undefined,
    valor: valor.get(d.id) ?? 0, estado: d.estado as EstadoHerramienta, equipo: d.equipo_id ?? undefined, tecnico: d.tecnico_id ?? undefined,
    historial: (hist.get(d.id) || []).sort((a, b) => ms(a.ts) - ms(b.ts)).map(h => ({ id: h.id, ts: ms(h.ts), tipo: h.tipo as TipoIncidencia, nota: h.nota, operator: h.operario,
      coste: coste.get(h.id), serieAnterior: h.serie_anterior ?? undefined })),
  }));
  const pedidos = Object.fromEntries(t.pedidos_reposicion.map(p => [p.sku, { ts: ms(p.ts), qty: n(p.cantidad) }]));
  const propietarios = t.propietarios.filter(o => o.activo).map(o => ({ id: o.id, nombre: o.nombre, contacto: o.contacto || '', correosReposicion: o.correos_reposicion || [], correosInformes: o.correos_informes || [] }));
  const valorPend = new Map((t.valores_pendientes || []).map(v => [v.id, v.valor == null ? undefined : n(v.valor)]));
  const pendientes: Pendiente[] = t.pendientes.map(p => ({ id: p.id, ts: ms(p.ts), tipo: p.tipo, sku: p.sku, qty: n(p.cantidad), reason: p.motivo, ref: p.referencia || '',
    serials: p.series || [], operator: p.operario, estado: p.estado, resueltoPor: p.resuelto_por ?? undefined, nota: p.nota_resolucion ?? undefined, valor: valorPend.get(p.id) })).sort((a, b) => b.ts - a.ts);
  const perfiles: PerfilUsuario[] = t.perfiles.map(p => ({ id: p.id, nombre: p.nombre, email: p.email ?? null, rol: p.rol, activo: !!p.activo }));
  return { v: 3, products, movements, albaranes, equipos, tecnicos, entregas, herramientas, propietarios, pendientes, perfiles, rol, operator: operador, pedidos, cesta: base.cesta, seq: base.seq };
}
