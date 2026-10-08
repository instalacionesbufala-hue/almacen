/* E-040 · Barra inferior del móvil personalizable (solo móvil y tableta: lg:hidden; el menú lateral del escritorio no cambia).
   Mantener pulsada la barra (o Configuración / menú → "Barra inferior del móvil") abre el editor: hasta 5 accesos, ordenados
   arrastrando, uno como botón central destacado, vista previa y "Restablecer". Se guarda en el perfil del usuario. */
import { useRef, useState } from 'react';
import { accesoDe, accesosDisponibles, barraEfectiva, MAX_ACCESOS, type ConfigBarra, type IdAcceso } from '../../domain/barra';
import { nombreVehiculo } from '../../domain/reglas';
import { useAlmacen } from '../../store/almacen';
import { guardarBarra, useBarraGuardada } from '../../store/barra';
import { ir, setUI, ui, useUI, type Vista } from '../../store/ui';
import { modoNube } from '../../store/nube/cliente';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, Icon } from '../../ui/base';

/** Qué hace cada acceso que no es una pantalla */
function accionDe(id: IdAcceso) {
  switch (id) {
    case 'devolucion': void import('../entregas/Devolucion').then(m => m.iniciarDevolucion()); break;
    case 'retirada': void import('../custodia/Retirada').then(m => m.iniciarRetirada()); break;
    case 'escanear_albaran': ir('albaranes'); void import('../albaranes/AlbaranesView').then(m => m.escanearAlbaran()); break;
    case 'cierres': setUI({ eqTab: 'cierres' }); ir('equipos'); break;
    case 'recuento': abrirElegirVehiculo(); break;
    case 'avisos': void import('./Pendientes').then(m => m.abrirPendientes()); break;
    case 'camara': void import('../altaCamara/AltaCamara').then(m => m.abrirAltaCamara()); break;
    case 'mas': void import('../inventario/hojas').then(m => m.abrirMenu()); break;
    default: { const v = accesoDe(id)?.vista; if (v) { if (id === 'equipos' && ui.get().eqTab === 'cierres') setUI({ eqTab: 'equipos' }); ir(v as Vista); } }
  }
}
const abrirElegirVehiculo = () => openModal(<ElegirVehiculo />);
function ElegirVehiculo() {
  const E = useAlmacen();
  return (<><SheetHead title="Recuento de furgoneta" sub="¿Qué furgoneta vas a contar?" />
    <div className="p-3 flex flex-col gap-1">{E.vehiculos.map(v => <button key={v.id} onClick={() => { closeModal(); void import('../cierres/CierresView').then(m => m.abrirRecuentoVehiculo(v.id)); }}
      className="flex items-center gap-3 px-4 h-14 rounded-xl hover:bg-surface-container-low text-left"><Icon n="local_shipping" className="text-primary" />{nombreVehiculo(E, v.id)}</button>)}</div></>);
}

function Boton({ id, central, activa, onClick }: { id: IdAcceso; central: boolean; activa: boolean; onClick?: () => void }) {
  const a = accesoDe(id)!;
  if (central) return <button type="button" onClick={onClick} className={`flex flex-col items-center -mt-6 pb-2 ${activa ? 'text-primary' : 'text-on-surface-variant'}`}>
    <span className="w-16 h-16 rounded-2xl bg-primary text-white grid place-items-center shadow-lg shadow-primary/30"><Icon n={a.icon} className="ico-32" /></span><span className="text-[12px] font-semibold mt-1 truncate max-w-full">{a.corto}</span></button>;
  return <button type="button" onClick={onClick} className={`flex flex-col items-center justify-center gap-1 py-2 min-h-[64px] min-w-0 ${activa ? 'text-primary' : 'text-on-surface-variant'}`}>
    <Icon n={a.icon} className={activa ? 'ico-fill' : ''} /><span className={`text-[12px] truncate max-w-full ${activa ? 'font-semibold' : ''}`}>{a.corto}</span></button>;
}
const COLS = ['grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4', 'grid-cols-5'];

/** Las filas de la barra (también la vista previa del editor) */
function Fila({ b, vista, onClick }: { b: ConfigBarra; vista?: Vista; onClick?: (id: IdAcceso) => void }) {
  const u = useUI();
  const activa = (id: IdAcceso) => { const v = accesoDe(id)?.vista; return !!v && v === vista && (id === 'cierres' ? u.eqTab === 'cierres' : !(id === 'equipos' && u.eqTab === 'cierres')); };
  return <div className={`grid ${COLS[b.accesos.length - 1]} items-end px-2`}>{b.accesos.map(id => <Boton key={id} id={id} central={b.central === id} activa={activa(id)} onClick={onClick ? () => onClick(id) : undefined} />)}</div>;
}

export function BarraInferior({ vista }: { vista: Vista }) {
  const E = useAlmacen(), b = barraEfectiva(E, useBarraGuardada());
  const t = useRef<ReturnType<typeof setTimeout>>(undefined), larga = useRef(false);
  const empezar = () => { larga.current = false; clearTimeout(t.current); t.current = setTimeout(() => { larga.current = true; navigator.vibrate?.(30); abrirEditorBarra(); }, 650); };
  const parar = () => clearTimeout(t.current);
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-surface-container-lowest/95 backdrop-blur-md shadow-[0_-2px_12px_rgba(11,28,48,0.06)] safe-bottom select-none"
      onPointerDown={empezar} onPointerUp={parar} onPointerLeave={parar} onPointerCancel={parar} onContextMenu={e => { e.preventDefault(); parar(); if (!larga.current) abrirEditorBarra(); }}
      aria-label="Barra inferior (mantén pulsado para cambiarla)">
      <Fila b={b} vista={vista} onClick={id => { if (larga.current) { larga.current = false; return; } accionDe(id); }} />
    </nav>
  );
}

export const abrirEditorBarra = () => openModal(<EditorBarra />, { ancha: true });
function EditorBarra() {
  const E = useAlmacen(), guardada = useBarraGuardada();
  const [b, setB] = useState<ConfigBarra>(() => barraEfectiva(E, guardada));
  const disponibles = accesosDisponibles(E), libres = disponibles.filter(a => !b.accesos.includes(a.id));
  const filas = useRef<(HTMLLIElement | null)[]>([]), [arrastra, setArrastra] = useState<number | null>(null);
  const mover = (de: number, a: number) => setB(x => { if (a < 0 || a >= x.accesos.length || de === a) return x; const l = [...x.accesos]; const [y] = l.splice(de, 1); l.splice(a, 0, y); return { ...x, accesos: l }; });
  const alMover = (e: React.PointerEvent) => {
    if (arrastra === null) return;
    const i = filas.current.findIndex(el => { if (!el) return false; const r = el.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom; });
    if (i >= 0 && i !== arrastra) { mover(arrastra, i); setArrastra(i); }
  };
  const quitar = (id: IdAcceso) => setB(x => ({ accesos: x.accesos.filter(y => y !== id), central: x.central === id ? null : x.central }));
  const guardar = async () => {
    if (!b.accesos.length) return toast('Elige al menos un acceso.', 'warn');
    const ok = await guardarBarra(b); closeModal();
    toast(ok ? 'Barra guardada: la tendrás igual en cualquier móvil con tu usuario.' : 'Sin conexión: la barra queda en este móvil y se guardará en tu usuario al volver a conectar.', ok ? 'ok' : 'warn', 6000);
  };
  const restablecer = async () => { const ok = await guardarBarra(null); closeModal(); toast(ok ? 'Barra restablecida: la de siempre.' : 'Restablecida en este móvil; se guardará al volver a conectar.', ok ? 'ok' : 'warn'); };
  return (<>
    <SheetHead title="Barra inferior del móvil" sub={`Hasta ${MAX_ACCESOS} accesos. Arrástralos para ordenarlos y marca con ★ el botón central destacado. El menú del ordenador no cambia.`} />
    <div className="p-5 flex flex-col gap-4">
      <div><div className="font-mono text-label-sm uppercase tracking-wider text-secondary mb-1">Vista previa</div>
        <div className="rounded-xl bg-surface-container-lowest shadow-[0_-2px_12px_rgba(11,28,48,0.10)] pt-6 pointer-events-none">{b.accesos.length ? <Fila b={b} /> : <p className="text-center text-secondary p-4">Sin accesos</p>}</div></div>
      <section className="flex flex-col gap-1"><h3 className="font-semibold">En la barra ({b.accesos.length} de {MAX_ACCESOS})</h3>
        <ul className="flex flex-col gap-1" onPointerMove={alMover} onPointerUp={() => setArrastra(null)} onPointerCancel={() => setArrastra(null)}>
          {b.accesos.map((id, i) => { const a = accesoDe(id)!; return <li key={id} ref={el => { filas.current[i] = el; }} className={`flex items-center gap-2 rounded-xl px-2 h-14 ${arrastra === i ? 'bg-primary-fixed' : 'bg-surface-container-low'}`}>
            <button type="button" onPointerDown={e => { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); setArrastra(i); }} className="w-10 h-12 grid place-items-center text-secondary touch-none cursor-grab" aria-label={`Arrastrar ${a.label}`}><Icon n="drag_indicator" /></button>
            <Icon n={a.icon} className="text-primary" /><span className="flex-1 min-w-0 truncate">{a.label}</span>
            <button type="button" onClick={() => setB(x => ({ ...x, central: x.central === id ? null : id }))} className={`w-10 h-12 grid place-items-center ${b.central === id ? 'text-amber-600' : 'text-outline'}`} aria-label={`Botón central: ${a.label}`} aria-pressed={b.central === id}><Icon n="star" className={b.central === id ? 'ico-fill' : ''} /></button>
            <button type="button" onClick={() => mover(i, i - 1)} disabled={i === 0} className="w-9 h-12 grid place-items-center disabled:opacity-30" aria-label="Subir"><Icon n="arrow_upward" className="ico-20" /></button>
            <button type="button" onClick={() => mover(i, i + 1)} disabled={i === b.accesos.length - 1} className="w-9 h-12 grid place-items-center disabled:opacity-30" aria-label="Bajar"><Icon n="arrow_downward" className="ico-20" /></button>
            <button type="button" onClick={() => quitar(id)} className="w-10 h-12 grid place-items-center text-error" aria-label={`Quitar ${a.label}`}><Icon n="remove_circle" /></button></li>; })}
        </ul></section>
      <section className="flex flex-col gap-1"><h3 className="font-semibold">Disponibles</h3>
        {libres.map(a => <button key={a.id} type="button" disabled={b.accesos.length >= MAX_ACCESOS} onClick={() => setB(x => ({ ...x, accesos: [...x.accesos, a.id] }))}
          className="flex items-center gap-3 px-3 h-12 rounded-xl hover:bg-surface-container-low text-left disabled:opacity-40"><Icon n={a.icon} className="text-primary" /><span className="flex-1">{a.label}</span><Icon n="add_circle" className="text-primary" /></button>)}
        {!libres.length && <p className="text-body-sm text-secondary">Ya están todos los que tu rol puede usar.</p>}
        {b.accesos.length >= MAX_ACCESOS && libres.length > 0 && <p className="text-body-sm text-secondary">La barra está llena: quita uno para añadir otro. Si te faltan, pon «Más», que abre el menú completo.</p>}
      </section>
      {!modoNube && <p className="text-body-sm text-secondary">Demostración: la barra se guarda en este navegador.</p>}
    </div>
    <SheetFoot className="flex gap-2">
      <button onClick={() => void restablecer()} className={`${BTN_S} h-12 px-4`}><Icon n="restart_alt" className="ico-20" />Restablecer</button>
      <button onClick={() => void guardar()} className={`${BTN_P} h-12 flex-1`}><Icon n="save" className="ico-20" />Guardar</button>
    </SheetFoot>
  </>);
}
