import type { ComponentType } from 'react';
import { useVista, type Vista } from './store/ui';
import { ModalHost } from './ui/modal';
import { Toasts } from './ui/toast';
import { VisorHost } from './ui/foto';
import { BarraInferior, CabeceraEscritorio, CabeceraMovil, Sidebar } from './features/shell/Shell';
import StockView from './features/inventario/StockView';
import AlbaranesView from './features/albaranes/AlbaranesView';
import EquiposView from './features/equipos/EquiposView';
import EntregasView from './features/entregas/EntregasView';
import DotacionView from './features/dotacion/DotacionView';
import ScanView from './features/escaner/ScanView';
import MovimientosView from './features/movimientos/MovimientosView';
import ConfigView from './features/config/ConfigView';
import CustodiaView from './features/custodia/CustodiaView';
import Acceso from './features/shell/Acceso';
import { modoNube } from './store/nube/cliente';
import { sesion } from './store/nube/sync';
import { lazy, Suspense, useEffect, useState } from 'react';
import { tokenDeRuta } from './domain/portal';

// E-014: el portal del técnico es una página aparte (sin sesión) que solo se carga si se abre su enlace
const PortalTecnico = lazy(() => import('./features/portal/PortalTecnico'));
function useTokenPortal() {
  const [t, setT] = useState(() => tokenDeRuta(location.hash));
  useEffect(() => { const f = () => setT(tokenDeRuta(location.hash)); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return t;
}

const PANTALLAS: Record<Vista, ComponentType> = {
  stock: StockView, albaranes: AlbaranesView, equipos: EquiposView, entregas: EntregasView,
  dotacion: DotacionView, custodia: CustodiaView, scan: ScanView, movimientos: MovimientosView, config: ConfigView,
};

export default function App() {
  const vista = useVista(), Pantalla = PANTALLAS[vista], s = sesion.use(), portal = useTokenPortal();
  if (portal) return <Suspense fallback={null}><PortalTecnico token={portal} /></Suspense>;
  if (modoNube && s.estado !== 'lista') return <><Acceso /><Toasts /></>;
  return (<>
    <Sidebar vista={vista} />
    <CabeceraEscritorio />
    <CabeceraMovil vista={vista} />
    <main className="lg:pl-72 lg:pt-16 pb-[calc(9rem+env(safe-area-inset-bottom))] lg:pb-10 min-h-screen"><Pantalla key={vista} /></main>
    <BarraInferior vista={vista} />
    <ModalHost />
    <VisorHost />
    <Toasts />
  </>);
}
