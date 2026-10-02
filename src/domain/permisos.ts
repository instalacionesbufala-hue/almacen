/* E-027 · Permisos en la app: qué puede ver y modificar el usuario según su rol (la base de datos lo vuelve a comprobar siempre).
   El administrador puede "probar como" otro rol: la app se ve como la vería ese usuario y no se puede modificar nada. */
import type { Estado, RolApp } from '../data/tipos';
import { APARTADOS, permite, PERMISOS_ALMACEN, PERMISOS_LECTURA, ROL_ADMIN, type Accion } from '../../supabase/functions/_compartido/permisos';

export { APARTADOS, type Accion } from '../../supabase/functions/_compartido/permisos';

/** Roles de sistema (los mismos que crea la migración de E-027): en la demostración, y si aún no han llegado de la nube */
export const ROLES_SISTEMA: RolApp[] = [
  { id: 'admin', nombre: 'Administrador', descripcion: 'Todo, también usuarios, roles y configuración.', sistema: true, permisos: {} },
  { id: 'almacen', nombre: 'Almacén', descripcion: 'Lo del día a día del almacén: movimientos, entregas, recuentos, albaranes y borradores de artículos.', sistema: true, permisos: PERMISOS_ALMACEN },
  { id: 'lectura', nombre: 'Solo lectura', descripcion: 'Para dirección: ve inventario, movimientos, albaranes, entregas, equipos, cierres, custodia y avisos, y exporta. No modifica nada.', sistema: true, permisos: PERMISOS_LECTURA },
];
export const rolesDe = (E: Pick<Estado, 'roles'>): RolApp[] => (E.roles?.length ? E.roles : ROLES_SISTEMA);
export const rolDe = (E: Pick<Estado, 'roles'>, id: string): RolApp | undefined => rolesDe(E).find(r => r.id === id);

/** Rol con el que se ve la app: el del usuario o, si el administrador está probando, el que prueba */
let simulado: string | null = null;
export const rolSimulado = () => simulado;
export function simularRol(id: string | null) { simulado = id; }
export const rolEfectivo = (E: Pick<Estado, 'rol'>) => simulado ?? E.rol;

export function puede(E: Pick<Estado, 'rol' | 'roles'>, apartado: string, accion: Accion = 'ver'): boolean {
  if (simulado && accion === 'modificar') return false;                        // probando: nunca se modifica
  const id = rolEfectivo(E);
  return permite(id, rolDe(E, id)?.permisos, apartado, accion);
}
/** Lo que en ese apartado es del administrador: el administrador, o un rol propio (no de sistema) con "Modificar" */
export function gestiona(E: Pick<Estado, 'rol' | 'roles'>, apartado: string): boolean {
  if (simulado) return false;
  const id = rolEfectivo(E);
  if (id === ROL_ADMIN) return true;
  const r = rolDe(E, id);
  return !!r && !r.sistema && apartado !== 'usuarios' && permite(id, r.permisos, apartado, 'modificar');
}
export const soloLectura = (E: Pick<Estado, 'rol' | 'roles'>) => !!simulado || !APARTADOS.some(a => a.modificar && puede(E, a.id, 'modificar'));

/** Apartado de cada operación de la app (lo que se comprueba antes de hacerla) */
const OPS: Record<string, string> = {
  movimiento: 'movimientos', ajuste: 'movimientos', proponerAjuste: 'movimientos',
  asociarCodigo: 'inventario', quitarCodigo: 'inventario', producto: 'inventario', pedido: 'inventario', importarCatalogo: 'inventario', fusionar: 'inventario',
  cambiarCodigo: 'inventario', proponerCambio: 'inventario', resolverPropuesta: 'inventario', borrador: 'inventario', borradorArticulo: 'inventario',
  borrarProducto: 'inventario', archivarProducto: 'inventario', restaurarProducto: 'inventario', deshacerFusion: 'inventario', minimos: 'inventario',
  cambiarPropiedad: 'inventario', foto: 'inventario', quitarFoto: 'inventario',
  albaran: 'albaranes', reasignarLinea: 'albaranes',
  prepararEntrega: 'entregas', confirmarEntrega: 'entregas', anularEntrega: 'entregas', reenviarCopia: 'entregas', copiaEntrega: 'entregas',
  equipo: 'equipos', vehiculo: 'equipos', asignarVehiculo: 'equipos', bajaTecnico: 'equipos', bajaVehiculo: 'equipos', estadoEquipo: 'equipos', retirarEquipo: 'equipos',
  tecnico: 'equipos', asignarTecnico: 'equipos', emailTecnico: 'equipos', telefonoTecnico: 'equipos', enlacePortal: 'equipos', revocarPortal: 'equipos',
  recuento: 'recuentos', recuentoVehiculo: 'recuentos',
  altaDotacion: 'dotacion', asignarDotacion: 'dotacion', incidencia: 'dotacion', minimoHerramienta: 'dotacion', pedidoHerramienta: 'dotacion', tallas: 'dotacion',
  acta: 'custodia', envio: 'custodia',
  recalcularCierre: 'cierres', revisarMaterialEspecial: 'cierres', resolverLinea: 'cierres', reprocesarCierre: 'cierres', cierreHistorico: 'cierres',
  validarPendiente: 'bandeja', mermaVista: 'bandeja',
  categoria: 'configuracion', desactivarCategoria: 'configuracion', borrarEquivalencia: 'configuracion', configAvisos: 'configuracion', propietario: 'configuracion',
  equivalencia: 'configuracion', cargarPropuesta: 'configuracion', confirmarEquivalencias: 'configuracion', kitFijacion: 'configuracion', configCierres: 'configuracion',
  perfil: 'usuarios', revocarIntegracion: 'usuarios', guardarRol: 'usuarios', borrarRol: 'usuarios', limpiarDemo: 'usuarios',
};
export const apartadoDeOp = (op: string) => OPS[op] || 'configuracion';

/** null si se puede hacer; si no, el motivo (en lenguaje normal) */
export function motivoSinPermiso(E: Pick<Estado, 'rol' | 'roles'>, op: string): string | null {
  if (simulado) return `Estás probando la app como «${rolDe(E, simulado)?.nombre || simulado}»: no se modifica nada. Pulsa «Dejar de probar» arriba.`;
  const a = apartadoDeOp(op);
  if (a === 'usuarios' ? rolEfectivo(E) === ROL_ADMIN : puede(E, a, 'modificar')) return null;
  const ap = APARTADOS.find(x => x.id === a);
  return `Tu rol (${rolDe(E, rolEfectivo(E))?.nombre || E.rol}) no permite modificar: ${ap?.nombre || a}.`;
}

/** Qué apartado hay que poder ver para entrar en cada pantalla (Configuración siempre: enseña solo lo que el rol permite) */
const VISTAS: Record<string, string | null> = { stock: 'inventario', albaranes: 'albaranes', equipos: 'equipos', entregas: 'entregas', dotacion: 'dotacion', custodia: 'custodia', scan: 'inventario', movimientos: 'movimientos', config: null };
export const vistaPermitida = (E: Pick<Estado, 'rol' | 'roles'>, vista: string) => { const a = VISTAS[vista]; return a === undefined || a === null || puede(E, a, 'ver'); };
