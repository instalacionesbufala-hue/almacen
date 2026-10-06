/* Permisos en la interfaz (E-004, E-027). El servidor los vuelve a comprobar siempre: ocultar un botón no basta.
   En modo demostración (sin nube) se actúa como administrador. El administrador puede "probar como" otro rol. */
import { almacen, useAlmacen } from './almacen';
import { gestiona, puede, rolDe, rolEfectivo, rolSimulado, simularRol, socioEfectivo, soloLectura, type Accion } from '../domain/permisos';

export function usePermisos() {
  const E = useAlmacen(), probando = rolSimulado();
  const ver = (a: string) => puede(E, a, 'ver'), mod = (a: string) => puede(E, a, 'modificar');
  return {
    /** el administrador de verdad (probando otro rol, no) */
    admin: E.rol === 'admin' && !probando,
    /** crear referencias completas, editarlas y borrarlas; el almacén solo crea borradores */
    editarCatalogo: gestiona(E, 'inventario'),
    /** alta y baja de equipos, técnicos y vehículos */
    gestionarFlota: gestiona(E, 'equipos'),
    /** alta, asignación y repuestos de la dotación */
    gestionarDotacion: gestiona(E, 'dotacion'),
    /** resolver y reprocesar cierres */
    gestionarCierres: gestiona(E, 'cierres'),
    /** ajustes directos y validación de pendientes */
    validar: gestiona(E, 'bandeja'),
    /** categorías, socios, equivalencias, avisos e integraciones */
    configurar: gestiona(E, 'configuracion'),
    /** E-027: CSV, PDF de informes y listas */
    exportar: ver('exportar'),
    ver, mod, puede: (a: string, x: Accion = 'ver') => puede(E, a, x),
    /** ningún "Modificar": se ocultan todos los botones de acción */
    soloLectura: soloLectura(E),
    rol: rolDe(E, rolEfectivo(E)), probando,
    /** E-034: socio cuyo material se ve (usuario de socio o probando como él) */
    socio: socioEfectivo(E) ? (E.propietarios.find(o => o.id === socioEfectivo(E))?.nombre || socioEfectivo(E)) : null,
  };
}

/** "Probar como este rol": la app se ve como la vería ese usuario, sin poder modificar nada */
export function probarComo(id: string | null, socio: { propietario: string; nombre: string } | null = null) { simularRol(id, socio); almacen.emit(); }
