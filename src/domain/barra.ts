/* E-040 · Barra inferior del móvil personalizable por usuario (hasta 5 accesos, uno puede ser el botón central destacado).
   Solo se ofrecen y se muestran los accesos que el rol puede ver (E-027 y E-034): si el rol pierde un permiso, el acceso
   desaparece de su barra. El menú lateral del escritorio no depende de esto. */
import type { Estado } from '../data/tipos';
import { gestiona, puede, socioEfectivo, vistaPermitida } from './permisos';

export type IdAcceso = 'inventario' | 'escanear' | 'entrega' | 'equipos' | 'retirada' | 'albaranes' | 'escanear_albaran' | 'movimientos' | 'custodia'
  | 'cierres' | 'recuento' | 'dotacion' | 'avisos' | 'camara' | 'mas';
export interface Acceso { id: IdAcceso; label: string; corto: string; icon: string; /** vista a la que lleva (las acciones se resuelven en la interfaz) */ vista?: string }
export interface ConfigBarra { accesos: IdAcceso[]; central: IdAcceso | null }
type E = Pick<Estado, 'rol' | 'roles' | 'socio'>;

export const ACCESOS: (Acceso & { permitido: (e: E) => boolean })[] = [
  { id: 'inventario', label: 'Inventario', corto: 'Inventario', icon: 'inventory_2', vista: 'stock', permitido: e => vistaPermitida(e, 'stock') },
  { id: 'escanear', label: 'Escanear', corto: 'Escanear', icon: 'qr_code_scanner', vista: 'scan', permitido: e => vistaPermitida(e, 'scan') },
  { id: 'entrega', label: 'Entrega', corto: 'Entrega', icon: 'assignment_turned_in', vista: 'entregas', permitido: e => vistaPermitida(e, 'entregas') },
  { id: 'equipos', label: 'Equipos y técnicos', corto: 'Cuadrillas', icon: 'local_shipping', vista: 'equipos', permitido: e => vistaPermitida(e, 'equipos') },
  { id: 'retirada', label: 'Retirada por socio', corto: 'Retirada', icon: 'handshake', permitido: e => !socioEfectivo(e) && gestiona(e, 'movimientos') },
  { id: 'albaranes', label: 'Albaranes', corto: 'Albaranes', icon: 'document_scanner', vista: 'albaranes', permitido: e => vistaPermitida(e, 'albaranes') },
  { id: 'escanear_albaran', label: 'Escanear albarán', corto: 'Albarán', icon: 'photo_camera', permitido: e => !socioEfectivo(e) && gestiona(e, 'albaranes') },
  { id: 'movimientos', label: 'Movimientos', corto: 'Movimientos', icon: 'swap_vert', vista: 'movimientos', permitido: e => vistaPermitida(e, 'movimientos') },
  { id: 'custodia', label: 'Custodia de socios', corto: 'Custodia', icon: 'handshake', vista: 'custodia', permitido: e => vistaPermitida(e, 'custodia') },
  { id: 'cierres', label: 'Cierres', corto: 'Cierres', icon: 'task_alt', vista: 'equipos', permitido: e => vistaPermitida(e, 'equipos') && puede(e, 'cierres', 'ver') },
  { id: 'recuento', label: 'Recuento de furgoneta', corto: 'Recuento', icon: 'fact_check', permitido: e => !socioEfectivo(e) && puede(e, 'cierres', 'ver') && puede(e, 'equipos', 'ver') },
  { id: 'dotacion', label: 'Herramientas, EPIs y ropa', corto: 'Dotación', icon: 'construction', vista: 'dotacion', permitido: e => vistaPermitida(e, 'dotacion') },
  { id: 'avisos', label: 'Avisos y bandeja', corto: 'Avisos', icon: 'notifications', permitido: e => !socioEfectivo(e) },
  { id: 'camara', label: 'Nuevo con la cámara', corto: 'Nuevo', icon: 'add_a_photo', permitido: e => !socioEfectivo(e) && gestiona(e, 'inventario') },
  { id: 'mas', label: 'Más (menú completo)', corto: 'Más', icon: 'menu', permitido: () => true },
];
export const MAX_ACCESOS = 5;
/** La barra de siempre */
export const BARRA_DEFECTO: ConfigBarra = { accesos: ['inventario', 'escanear', 'entrega', 'equipos'], central: 'escanear' };
export const accesoDe = (id: string) => ACCESOS.find(a => a.id === id);

/** Los accesos que este rol puede poner en su barra */
export const accesosDisponibles = (e: E) => ACCESOS.filter(a => a.permitido(e));

/** Normaliza una configuración (del servidor o del dispositivo): ids conocidos, sin repetir, como mucho 5 */
export function normalizarBarra(c: unknown): ConfigBarra | null {
  const x = c as Partial<ConfigBarra> | null;
  if (!x || !Array.isArray(x.accesos)) return null;
  const accesos = [...new Set(x.accesos.filter(id => !!accesoDe(id)))].slice(0, MAX_ACCESOS) as IdAcceso[];
  if (!accesos.length) return null;
  return { accesos, central: x.central && accesos.includes(x.central) ? x.central : null };
}

/** La barra que se ve: la del usuario (o la de siempre), sin lo que su rol no puede ver */
export function barraEfectiva(e: E, c: ConfigBarra | null | undefined): ConfigBarra {
  const filtra = (b: ConfigBarra) => { const accesos = b.accesos.filter(id => accesoDe(id)?.permitido(e)); return { accesos, central: b.central && accesos.includes(b.central) ? b.central : null }; };
  const propia = c ? filtra(c) : null;
  return propia?.accesos.length ? propia : filtra(BARRA_DEFECTO);
}
