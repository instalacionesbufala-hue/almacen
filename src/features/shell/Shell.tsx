/* Marco de la app: barra lateral y cabecera (escritorio), cabecera y barra inferior (móvil) */
import { useEffect, useRef, useState } from 'react';
import { MARCA } from '../../data/catalogo';
import { critical } from '../../domain/reglas';
import { avisosDotacion } from '../../domain/herramientas';
import { useAlmacen } from '../../store/almacen';
import { ir, setUI, useEsEscritorio, useUI, VISTAS, type Vista } from '../../store/ui';
import { Avatar, BTN_P, Icon } from '../../ui/base';
import { abrirMenu, abrirPerfil } from '../inventario/hojas';
import { abrirReposicion, useContadorAvisos } from '../reposicion/Reposicion';
import { procesarArchivos } from '../albaranes/AlbaranesView';
import { IndicadorSync } from './Sincronizacion';
import { BotonPendientes } from './Pendientes';
import { modoNube } from '../../store/nube/cliente';
import { vistaPermitida } from '../../domain/permisos';
import { usePermisos } from '../../store/permisos';
import { EtiquetaRol } from './Rol';

function nuevoAlbaran() {
  ir('albaranes');
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*,application/pdf'; i.multiple = true;
  i.onchange = () => procesarArchivos(i.files); i.click();
}

function SelectorAlmacen({ ancho }: { ancho: string }) {
  const E = useAlmacen(), u = useUI(), desk = useEsEscritorio();
  return (
    <label className="flex items-center gap-1 bg-surface-container-low rounded-lg px-2.5 py-1.5 shrink-0"><Icon n="warehouse" className="text-primary ico-20" />
      <select value={u.almacen} onChange={e => { setUI({ almacen: e.target.value }); ir('stock'); }} aria-label="Almacén" className={`bg-transparent font-mono text-label-md focus:outline-none cursor-pointer ${ancho}`}>
        <option value="central">{desk ? 'Almacén Central' : 'NAVE'}</option>
        {E.vehiculos.map(v => <option key={v.id} value={v.id}>{E.equipos.find(e => e.vehiculo === v.id)?.nombre || 'Sin equipo'} · {v.matricula}</option>)}
      </select></label>
  );
}

export function Sidebar({ vista }: { vista: Vista }) {
  const E = useAlmacen(), nCrit = critical(E).length, nDot = avisosDotacion(E).length, nCust = E.products.filter(p => p.propiedad === 'custodia' && p.stock < p.min).length;
  const item = (v: Vista, badge = 0) => {
    const on = vista === v;
    return <a key={v} href={`#${v}`} className={`flex items-center gap-space-sm px-space-md py-2.5 rounded-lg transition-colors ${on ? 'bg-primary-container text-on-primary font-semibold' : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'}`}>
      <Icon n={VISTAS[v].icon} className={on ? 'ico-fill' : ''} /><span className="text-body-md">{VISTAS[v].label}</span>
      {badge > 0 && <span className={`ml-auto font-mono text-label-sm px-1.5 rounded ${on ? 'bg-white/20' : 'bg-error-container text-error'}`}>{badge}</span>}</a>;
  };
  const LBLS = 'font-mono text-label-sm uppercase tracking-wider text-outline px-space-xs';
  return (
    <aside className="hidden lg:flex fixed left-0 top-0 h-full w-72 bg-surface-container-lowest z-40 flex-col justify-between shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      <div className="flex flex-col overflow-y-auto no-scrollbar">
        <div className="h-16 px-space-md flex items-center gap-space-sm">
          <div className="w-9 h-9 rounded-lg bg-primary-container text-white grid place-items-center"><Icon n="bolt" className="ico-fill" /></div>
          <div className="flex flex-col"><span className="text-headline-sm font-semibold tracking-tight leading-none">{MARCA.nombre}</span><span className="font-mono text-label-sm uppercase tracking-wider text-secondary mt-1">{MARCA.sub}</span></div>
        </div>
        <div className="px-space-md pt-space-md pb-space-xs"><span className={LBLS}>Operaciones</span></div>
        <nav className="flex flex-col gap-space-xs px-space-sm">{([['stock', nCrit], ['albaranes', 0], ['equipos', 0], ['entregas', 0], ['dotacion', nDot], ['custodia', nCust], ['scan', 0], ['movimientos', 0]] as [Vista, number][]).filter(([v]) => vistaPermitida(E, v)).map(([v, n]) => item(v, n))}</nav>
        <div className="px-space-md pt-space-lg pb-space-xs"><span className={LBLS}>Sistema</span></div>
        <nav className="flex flex-col gap-space-xs px-space-sm">{item('config')}</nav>
      </div>
      <div className="p-space-md bg-surface-container-low m-space-sm rounded-xl flex items-center justify-between">
        <div className="flex items-center gap-space-sm"><span className="h-2.5 w-2.5 rounded-full bg-tertiary-container pulso" />
          <div className="flex flex-col"><span className="font-mono text-label-md">{MARCA.nave}</span><span className="font-mono text-label-sm text-secondary">{E.equipos.length} equipos · {E.vehiculos.length} vehículos</span></div></div>
        <Icon n="ev_station" className="text-secondary" />
      </div>
    </aside>
  );
}

export function CabeceraEscritorio() {
  const E = useAlmacen(), u = useUI(), busc = useRef<HTMLInputElement>(null), perm = usePermisos();
  const nAvisos = useContadorAvisos();
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); busc.current?.focus(); } };
    addEventListener('keydown', f); return () => removeEventListener('keydown', f);
  }, []);
  return (
    <header className="hidden lg:flex fixed top-0 left-72 right-0 h-16 bg-surface-container-lowest/90 backdrop-blur-md z-30 px-gutter items-center justify-between gap-space-md shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-space-md flex-1 max-w-3xl">
        <div className="relative flex-1"><Icon n="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline ico-20" />
          <input ref={busc} value={u.q} onChange={e => { setUI({ q: e.target.value, page: 1, almacen: 'central' }); ir('stock'); }} type="search" autoComplete="off"
            className="w-full pl-10 pr-14 py-2 bg-surface-container-low rounded-lg text-body-sm placeholder:text-on-surface-variant focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary" placeholder="Buscar referencia, SKU, EAN, n.º de serie o ubicación…" />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-label-sm text-outline bg-surface-container-highest px-1.5 py-0.5 rounded">Ctrl K</span></div>
        <SelectorAlmacen ancho="max-w-[190px]" />
      </div>
      <div className="flex items-center gap-space-md">
        <EtiquetaRol />
        {perm.mod('albaranes') && <button onClick={nuevoAlbaran} className={`${BTN_P} px-space-md py-2`}><Icon n="auto_awesome" className="ico-20" /><span>Nuevo Albarán IA</span></button>}
        <IndicadorSync />
        <BotonPendientes />
        <button onClick={abrirReposicion} className="relative p-2 rounded-lg text-on-surface-variant hover:bg-surface-container-high" aria-label="Reposición: avisos de stock"><Icon n="notifications" />
          {nAvisos > 0 && <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-error text-white font-mono text-[10px] leading-4">{nAvisos}</span>}</button>
        <button onClick={abrirPerfil} className="flex items-center gap-space-sm pl-space-xs text-left rounded-lg hover:bg-surface-container-low pr-2 py-1"><Avatar n={E.operator} c="bg-inverse-surface text-white" />
          <span className="hidden xl:flex flex-col"><span className="text-headline-sm font-semibold leading-tight">{E.operator}</span><span className="font-mono text-label-sm text-secondary">{modoNube ? 'Sesión iniciada' : 'Operario activo'}</span></span></button>
      </div>
    </header>
  );
}

export function CabeceraMovil({ vista }: { vista: Vista }) {
  const E = useAlmacen(), nAvisos = useContadorAvisos() + avisosDotacion(E).length;
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => { const f = () => setOnline(navigator.onLine); addEventListener('online', f); addEventListener('offline', f); return () => { removeEventListener('online', f); removeEventListener('offline', f); }; }, []);
  return (
    <header className="lg:hidden sticky top-0 z-30 bg-surface-container-lowest/95 backdrop-blur-md shadow-[0_1px_8px_rgba(0,0,0,0.05)] safe-top">
      <div className="flex items-center justify-between gap-2 px-4 h-16">
        <a href="#stock" className="flex items-center gap-2 min-w-0"><span className="w-9 h-9 rounded-lg bg-primary-container text-white grid place-items-center shrink-0"><Icon n="bolt" className="ico-fill" /></span>
          <span className="flex flex-col leading-none min-w-0"><span className="font-bold text-primary text-[15px] truncate">{MARCA.nombre.replace('Almacén ', '')}</span><span className="font-mono text-[8px] tracking-widest uppercase text-secondary mt-0.5">{MARCA.sub}</span></span></a>
        <div className="flex flex-col items-center shrink-0">{modoNube ? <IndicadorSync compacto /> : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary-fixed/40 text-tertiary font-mono text-label-sm"><span className="w-1.5 h-1.5 rounded-full bg-tertiary pulso" />{online ? 'ONLINE' : 'OFFLINE'}</span>}<span className="font-mono text-label-sm text-secondary truncate max-w-[90px]">{VISTAS[vista].mob}</span></div>
        <BotonPendientes />
        <EtiquetaRol compacta />
        <SelectorAlmacen ancho="max-w-[72px]" />
        <button onClick={abrirMenu} className="relative shrink-0" aria-label="Menú"><Avatar n={E.operator} c="bg-inverse-surface text-white" />{nAvisos > 0 && <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-error ring-2 ring-white" />}</button>
      </div>
    </header>
  );
}

export function BarraInferior({ vista }: { vista: Vista }) {
  const E = useAlmacen();
  const b = (v: Vista, lbl: string, icon: string) => { const on = vista === v; return <a href={`#${v}`} className={`flex flex-col items-center justify-center gap-1 py-2 min-h-[64px] ${on ? 'text-primary' : 'text-on-surface-variant'}`}><Icon n={icon} className={on ? 'ico-fill' : ''} /><span className={`text-[12px] ${on ? 'font-semibold' : ''}`}>{lbl}</span></a>; };
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-surface-container-lowest/95 backdrop-blur-md shadow-[0_-2px_12px_rgba(11,28,48,0.06)] safe-bottom">
      <div className="grid grid-cols-4 items-end px-2">
        {b('stock', 'Inventario', 'inventory_2')}
        {/* E-027: lo que el rol no ve, no sale (el hueco se queda para que el botón central siga en medio) */}
        <a href="#scan" className={`flex flex-col items-center -mt-6 pb-2 ${vista === 'scan' ? 'text-primary' : 'text-on-surface-variant'}`}><span className="w-16 h-16 rounded-2xl bg-primary text-white grid place-items-center shadow-lg shadow-primary/30"><Icon n="qr_code_scanner" className="ico-32" /></span><span className="text-[12px] font-semibold mt-1">Escanear</span></a>
        {vistaPermitida(E, 'entregas') ? b('entregas', 'Entrega', 'assignment_turned_in') : <span />}
        {vistaPermitida(E, 'equipos') ? b('equipos', 'Cuadrillas', 'local_shipping') : <span />}
      </div>
    </nav>
  );
}
