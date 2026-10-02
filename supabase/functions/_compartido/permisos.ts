/* E-027 · Roles y permisos configurables. Módulo puro: lo usan la app (interfaz), las funciones de servidor y las pruebas.
   Cada apartado tiene "ver" y, si se puede, "modificar" ("modificar" implica "ver"). La base de datos tiene la misma lista
   (roles.permisos y permisos_funcion) y es la que de verdad decide. */

export type Accion = 'ver' | 'modificar';
export interface Apartado { id: string; nombre: string; ver: string; modificar: string | null; soloAdmin?: boolean }
export type Permisos = Record<string, boolean>;

export const APARTADOS: Apartado[] = [
  { id: 'inventario', nombre: 'Inventario', ver: 'ver stock y fichas', modificar: 'crear y editar artículos · fotos' },
  { id: 'movimientos', nombre: 'Movimientos', ver: 'ver movimientos', modificar: 'entradas, salidas, mermas, traspasos y ajustes' },
  { id: 'albaranes', nombre: 'Albaranes', ver: 'ver albaranes', modificar: 'leer con IA y aprobar · reasignar líneas' },
  { id: 'entregas', nombre: 'Entregas y firmas', ver: 'ver entregas y sus PDF', modificar: 'preparar, firmar y anular' },
  { id: 'equipos', nombre: 'Equipos, técnicos y vehículos', ver: 'ver', modificar: 'altas, bajas y asignaciones' },
  { id: 'recuentos', nombre: 'Recuentos de furgoneta y cíclicos', ver: 'ver', modificar: 'hacer recuentos' },
  { id: 'dotacion', nombre: 'Herramientas, EPIs y ropa', ver: 'ver', modificar: 'asignar e incidencias' },
  { id: 'custodia', nombre: 'Custodia de socios', ver: 'ver stock e informes', modificar: 'solicitudes, informes y actas' },
  { id: 'cierres', nombre: 'Cierres del wizard', ver: 'ver cierres y consumos', modificar: 'reprocesar y resolver pendientes' },
  { id: 'bandeja', nombre: 'Avisos y bandeja', ver: 'ver avisos', modificar: 'validar pendientes' },
  { id: 'exportar', nombre: 'Exportar e imprimir', ver: 'CSV, PDF y listas', modificar: null },
  { id: 'configuracion', nombre: 'Configuración', ver: 'ver', modificar: 'categorías, socios, equivalencias, avisos e integraciones' },
  { id: 'usuarios', nombre: 'Usuarios y roles', ver: 'solo el administrador', modificar: 'solo el administrador', soloAdmin: true },
];
export const ROL_ADMIN = 'admin', ROL_ALMACEN = 'almacen', ROL_LECTURA = 'lectura';
export const ROLES_SISTEMA = [ROL_ADMIN, ROL_ALMACEN, ROL_LECTURA];

const todo = (ver: string[], modificar: string[]): Permisos =>
  Object.fromEntries(APARTADOS.flatMap(a => [[`${a.id}.ver`, ver.includes(a.id) || modificar.includes(a.id)], ...(a.modificar ? [[`${a.id}.modificar`, modificar.includes(a.id)]] : [])]));
/** Almacén: exactamente lo que podía antes de E-027 (E-004, E-018, E-022) */
export const PERMISOS_ALMACEN = todo(
  ['inventario', 'movimientos', 'albaranes', 'entregas', 'equipos', 'recuentos', 'dotacion', 'custodia', 'cierres', 'bandeja'],
  ['inventario', 'movimientos', 'albaranes', 'entregas', 'equipos', 'recuentos', 'dotacion', 'custodia']);
/** Solo lectura (dirección): ve casi todo y exporta; no modifica nada; no ve configuración, usuarios ni la bandeja de validación */
export const PERMISOS_LECTURA = todo(
  ['inventario', 'movimientos', 'albaranes', 'entregas', 'equipos', 'recuentos', 'dotacion', 'custodia', 'cierres', 'bandeja', 'exportar'], []);

/** ¿Este conjunto de permisos permite la acción? ("modificar" implica "ver"; usuarios y roles, nunca fuera del administrador) */
export function permite(rol: string, permisos: Permisos | undefined, apartado: string, accion: Accion): boolean {
  if (rol === ROL_ADMIN) return true;
  const a = APARTADOS.find(x => x.id === apartado);
  if (!a || a.soloAdmin) return false;
  const p = permisos || {};
  if (accion === 'ver') return !!(p[`${apartado}.ver`] || (a.modificar && p[`${apartado}.modificar`]));
  return !!(a.modificar && p[`${apartado}.modificar`]);
}

/** Limpia una matriz editada: solo claves conocidas, "modificar" marca también "ver", y nada de usuarios */
export function normalizarPermisos(p: Permisos): Permisos {
  const out: Permisos = {};
  for (const a of APARTADOS) {
    if (a.soloAdmin) { out[`${a.id}.ver`] = false; if (a.modificar) out[`${a.id}.modificar`] = false; continue; }
    const mod = !!(a.modificar && p[`${a.id}.modificar`]);
    out[`${a.id}.ver`] = mod || !!p[`${a.id}.ver`];
    if (a.modificar) out[`${a.id}.modificar`] = mod;
  }
  return out;
}

/** Identificador de un rol nuevo a partir de su nombre ("Jefe de obra" → jefe_de_obra), sin repetir */
export function idRol(nombre: string, existentes: string[]): string {
  const base = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'rol';
  const usados = new Set(existentes);
  if (!usados.has(base)) return base;
  for (let i = 2; ; i++) if (!usados.has(`${base}_${i}`)) return `${base}_${i}`;
}
