/* Permisos en la interfaz (E-004). El servidor los vuelve a comprobar siempre: ocultar un botón no basta.
   En modo demostración (sin nube) se actúa como administrador. */
import { useAlmacen } from './almacen';

export function usePermisos() {
  const E = useAlmacen(), admin = E.rol === 'admin';
  return {
    admin,
    /** precios, valor del inventario y costes */
    verCostes: admin,
    /** crear referencias completas, editarlas y borrarlas; el almacén solo crea borradores */
    editarCatalogo: admin,
    /** alta y baja de equipos, técnicos y dotación */
    gestionarFlota: admin,
    /** ajustes directos y validación de pendientes */
    validar: admin,
    /** usuarios, importar, exportar y restaurar */
    configurar: admin,
  };
}
