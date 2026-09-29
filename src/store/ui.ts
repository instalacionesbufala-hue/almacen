/* Estado de interfaz compartido entre pantallas (navegación, filtros del inventario) */
import { useEffect, useState } from 'react';
import { crearStore } from './crear';

export type Vista = 'stock' | 'albaranes' | 'equipos' | 'entregas' | 'dotacion' | 'custodia' | 'scan' | 'movimientos' | 'config';
export const VISTAS: Record<Vista, { label: string; mob: string; icon: string }> = {
  stock: { label: 'Stock General', mob: 'Inventario', icon: 'inventory_2' },
  albaranes: { label: 'Albaranes & Recepción IA', mob: 'Albaranes IA', icon: 'document_scanner' },
  equipos: { label: 'Equipos & Técnicos', mob: 'Cuadrillas', icon: 'badge' },
  entregas: { label: 'Entregas & Firmas', mob: 'Entrega', icon: 'draw' },
  dotacion: { label: 'Herramientas, EPIs & Ropa', mob: 'Dotación', icon: 'construction' },
  custodia: { label: 'Custodia Esmove', mob: 'Custodia', icon: 'handshake' },
  scan: { label: 'Escanear', mob: 'Escanear', icon: 'qr_code_scanner' },
  movimientos: { label: 'Movimientos', mob: 'Movimientos', icon: 'swap_vert' },
  config: { label: 'Configuración & Auditoría', mob: 'Configuración', icon: 'admin_panel_settings' },
};

export interface UI {
  q: string; est: string; pas: string; cat: string; page: number; catTab: string; filtros: boolean;
  /** E-008: all | propia | custodia */
  prop: string;
  /** 'central' o id de una furgoneta */
  almacen: string;
  eqTab: 'equipos' | 'tecnicos';
}
export const ui = crearStore<UI>({ q: '', est: 'all', pas: 'all', cat: 'all', prop: 'all', page: 1, catTab: 'cargadores', filtros: false, almacen: 'central', eqTab: 'equipos' });
export const useUI = ui.use;
export function setUI(p: Partial<UI>) { Object.assign(ui.get(), p); ui.emit(); }

const leerHash = (): Vista => { const h = location.hash.slice(1) as Vista; return h in VISTAS ? h : 'stock'; };
export function useVista(): Vista {
  const [v, setV] = useState<Vista>(leerHash);
  useEffect(() => { const f = () => { setV(leerHash()); window.scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return v;
}
export const ir = (v: Vista) => { if (location.hash.slice(1) !== v) location.hash = v; };

export function useEsEscritorio() {
  const mq = '(min-width:1024px)';
  const [d, setD] = useState(() => matchMedia(mq).matches);
  useEffect(() => { const m = matchMedia(mq), f = () => setD(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return d;
}
