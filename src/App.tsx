import type { ComponentType } from 'react';
import { useVista, type Vista } from './store/ui';
import { ModalHost } from './ui/modal';
import { Toasts } from './ui/toast';
import { BarraInferior, CabeceraEscritorio, CabeceraMovil, Sidebar } from './features/shell/Shell';
import StockView from './features/inventario/StockView';
import AlbaranesView from './features/albaranes/AlbaranesView';
import EquiposView from './features/equipos/EquiposView';
import EntregasView from './features/entregas/EntregasView';
import DotacionView from './features/dotacion/DotacionView';
import ScanView from './features/escaner/ScanView';
import MovimientosView from './features/movimientos/MovimientosView';
import ConfigView from './features/config/ConfigView';

const PANTALLAS: Record<Vista, ComponentType> = {
  stock: StockView, albaranes: AlbaranesView, equipos: EquiposView, entregas: EntregasView,
  dotacion: DotacionView, scan: ScanView, movimientos: MovimientosView, config: ConfigView,
};

export default function App() {
  const vista = useVista(), Pantalla = PANTALLAS[vista];
  return (<>
    <Sidebar vista={vista} />
    <CabeceraEscritorio />
    <CabeceraMovil vista={vista} />
    <main className="lg:pl-72 lg:pt-16 pb-28 lg:pb-10 min-h-screen"><Pantalla key={vista} /></main>
    <BarraInferior vista={vista} />
    <ModalHost />
    <Toasts />
  </>);
}
