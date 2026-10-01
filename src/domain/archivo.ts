/* E-022 · Borrar (solo sin rastro), archivar, restaurar, deshacer fusión y reutilizar el código de un archivado.
   Mismas reglas que el servidor (_rastro_producto, borrar_producto, archivar_producto, restaurar_producto, deshacer_fusion). */
import type { Estado, Producto } from '../data/tipos';
import { redondea } from './formato';
import { applyMovement, contenidoDe, find, reservado, unidadesABordo } from './reglas';

const ORDEN = ['movimientos', 'pendientes', 'entregas', 'cierres', 'avisos', 'codigos', 'foto', 'reservas', 'plantillas', 'vehiculos', 'propuestas', 'fusionados'] as const;
type Clave = typeof ORDEN[number];
const NOMBRES: Record<Clave, [string, string]> = {
  movimientos: ['movimiento', 'movimientos'], pendientes: ['pendiente en tu bandeja', 'pendientes en tu bandeja'], entregas: ['línea de entrega', 'líneas de entregas'],
  cierres: ['consumo de cierres', 'consumos de cierres'], avisos: ['aviso de reposición', 'avisos de reposición'], codigos: ['código alternativo', 'códigos alternativos'],
  foto: ['foto', 'fotos'], reservas: ['reserva', 'reservas'], plantillas: ['plantilla de entrega', 'plantillas de entrega'], vehiculos: ['vehículo con material', 'vehículos con material'],
  propuestas: ['propuesta de cambio', 'propuestas de cambio'], fusionados: ['artículo fusionado en ella', 'artículos fusionados en ella'],
};

/** Lo que retiene una referencia y el texto "Tiene 2 movimientos y 1 pendiente en tu bandeja" */
export function rastro(S: Estado, sku: string): { conteos: Record<Clave, number>; texto: string; borrable: boolean } {
  const p = find(S, sku);
  const c: Record<Clave, number> = {
    movimientos: S.movements.filter(m => m.sku === sku).length,
    pendientes: S.pendientes.filter(x => x.sku === sku).length,
    entregas: S.entregas.reduce((n, e) => n + e.lineas.filter(l => l.sku === sku).length, 0),
    cierres: S.lineasCierre.filter(l => l.sku === sku).length,
    avisos: S.avisos.filter(v => v.sku === sku).length,
    codigos: (S.codigos || []).filter(x => x.sku === sku).length,
    foto: p?.foto ? 1 : 0,
    reservas: 0, plantillas: 0,                                     // solo existen en el servidor
    vehiculos: S.aBordo.filter(x => x.sku === sku && x.unidades !== 0).length,
    propuestas: S.propuestas.filter(x => x.sku === sku).length,
    fusionados: (S.archivados || []).filter(x => x.fusionadoEn === sku).length,
  };
  const partes = ORDEN.filter(k => c[k] > 0).map(k => k === 'foto' ? 'foto' : `${c[k]} ${NOMBRES[k][c[k] === 1 ? 0 : 1]}`);
  const texto = !partes.length ? '' : partes.length === 1 ? `Tiene ${partes[0]}` : `Tiene ${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
  return { conteos: c, texto, borrable: !partes.length };
}

const exigirAdmin = (S: Estado) => { if (S.rol !== 'admin') throw new Error('Solo el administrador puede hacer esto'); };
const archivado = (S: Estado, sku: string) => (S.archivados || []).find(p => p.sku === sku);

export function borrarLocal(S: Estado, sku: string) {
  exigirAdmin(S);
  const p = find(S, sku); if (!p) throw new Error('Producto no encontrado');
  const r = rastro(S, sku);
  if (!r.borrable) throw new Error(`No se puede borrar definitivamente: ${r.texto}. Archívala: deja de salir en listas, buscador, escáner y entregas, y el historial se conserva.`);
  if (p.stock !== 0) throw new Error('Solo se puede borrar una referencia sin stock');
  S.products = S.products.filter(x => x.sku !== sku);
  S.archivados = (S.archivados || []).filter(x => x.sku !== sku);
  S.aBordo = S.aBordo.filter(x => x.sku !== sku);
}

/** Por qué no se puede archivar (null si se puede) */
export function motivoNoArchivar(S: Estado, p: Producto): string | null {
  if (p.stock !== 0) return `${p.name} tiene ${p.stock} en el almacén: haz antes un ajuste de inventario o fusiónala en otro artículo`;
  if (S.aBordo.some(x => x.sku === p.sku && x.unidades !== 0)) return `${p.name} tiene material en vehículos: devuélvelo o ajústalo antes de archivar`;
  if (reservado(S, p.sku) > 0) return `${p.name} tiene entregas preparadas: fírmalas o anúlalas antes de archivar`;
  return null;
}
export function archivarLocal(S: Estado, sku: string) {
  exigirAdmin(S);
  const p = S.products.find(x => x.sku === sku); if (!p) { if (archivado(S, sku)) return; throw new Error('Producto no encontrado'); }
  const m = motivoNoArchivar(S, p); if (m) throw new Error(m);
  S.products = S.products.filter(x => x !== p);
  S.archivados = [...(S.archivados || []), { ...p, archivado: true, fusionadoEn: undefined, archivadoTs: Date.now(), archivadoPor: S.operator }];
  S.avisos.forEach(v => { if (v.sku === sku && v.estado !== 'cerrado') v.estado = 'cerrado'; });
}

/** Vuelve a estar activo con su código; si estaba fusionado, con stock 0 */
export function restaurarLocal(S: Estado, sku: string) {
  exigirAdmin(S);
  const a = archivado(S, sku); if (!a) return;
  S.archivados = (S.archivados || []).filter(x => x !== a);
  S.products.push({ ...a, archivado: undefined, fusionadoEn: undefined, archivadoTs: undefined, archivadoPor: undefined });
}

/** Reutilizar el código de un archivado (alta, importación, cambio de código): solo con stock 0 */
export function reactivarArchivado(S: Estado, sku: string): Producto | null {
  const a = archivado(S, sku); if (!a) return null;
  if (a.stock !== 0 || S.aBordo.some(x => x.sku === sku && x.unidades !== 0)) throw new Error(`${sku} está archivado con stock: restáuralo desde Configuración → Archivados`);
  S.archivados = (S.archivados || []).filter(x => x !== a);
  const p: Producto = { ...a, archivado: undefined, fusionadoEn: undefined, archivadoTs: undefined, archivadoPor: undefined };
  S.products.push(p);
  return p;
}

/** Deshacer una fusión: revierte los ajustes de ESA fusión si el destino aún tiene lo que recibió */
export function deshacerFusionLocal(S: Estado, sku: string) {
  exigirAdmin(S);
  const a = archivado(S, sku); if (!a?.fusionadoEn) throw new Error(`${sku} no está fusionado en otro artículo`);
  const b = S.products.find(x => x.sku === a.fusionadoEn); if (!b) throw new Error(`El artículo en el que se fusionó (${a.fusionadoEn}) también está archivado: deshaz antes esa fusión`);
  const desde = (a.archivadoTs ?? 0) - 5000;
  const recibidos = S.movements.filter(m => m.sku === b.sku && m.type === 'ajuste' && m.reason === `Fusión desde ${a.sku}` && m.ts >= desde);
  for (const m of recibidos) {
    if (!m.vehiculo && b.stock < m.qty) throw new Error(`No se puede deshacer: ${b.name} ya no tiene las ${m.qty} ${b.unit} que recibió en la fusión (tiene ${b.stock}). Haz antes un ajuste de inventario.`);
    if (m.vehiculo && unidadesABordo(S, m.vehiculo, b.sku) < (m.unidades ?? 0)) throw new Error(`No se puede deshacer: el vehículo ya no lleva lo que recibió ${b.name} en la fusión`);
  }
  restaurarLocal(S, sku);
  for (const m of recibidos) {
    const qa = redondea(m.qty * contenidoDe(b) / contenidoDe(a));
    applyMovement(S, { sku: b.sku, type: 'ajuste', qty: -m.qty, reason: `Deshacer fusión de ${a.sku}`, ref: 'Fusión deshecha', vehiculo: m.vehiculo });
    applyMovement(S, { sku: a.sku, type: 'ajuste', qty: qa, reason: `Deshacer fusión en ${b.sku}`, ref: 'Fusión deshecha', vehiculo: m.vehiculo });
  }
  return { destino: b.sku };
}
