/* Equipos, vehículos y técnicos (E-013: tres entidades independientes con historial de asignaciones) y auditoría de entregas.
   - El equipo es un nombre ("Búfala 1", como lo envía el wizard); cambia de técnicos y de vehículo con el tiempo.
   - El material a bordo es del VEHÍCULO: si un técnico cambia de equipo no se mueve nada; si un vehículo cambia de equipo, su material va con él. */
import { cantTxt } from '../../domain/formatos';
import { Cantidad } from '../../ui/cantidad';
import { useState } from 'react';
import type { Equipo, EstadoEquipo, Tecnico, Vehiculo } from '../../data/tipos';
import { catDe } from '../../data/catalogo';
import { find, nombreVehiculo, numEntrega, stockDeVehiculo } from '../../domain/reglas';
import { fechaHora, fechaHoraInput, hace, hoyISO, num, uid } from '../../domain/formato';
import { cierresAfectados, claveAsignacion, validarInicioAsignacion } from '../../domain/asignaciones';
import type { Asignacion } from '../../data/tipos';
import { hashEntrega } from '../../domain/hash';
import { descargarCsv } from '../../domain/csv';
import { avisosDotacion, herramientasDe } from '../../domain/herramientas';
import { ejecutar, guardar, useAlmacen } from '../../store/almacen';
import { modoNube } from '../../store/nube/cliente';
import { verificarEntregasServidor } from '../../store/nube/sync';
import { usePermisos } from '../../store/permisos';
import { ir, setUI, useEsEscritorio, useUI } from '../../store/ui';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { Avatar, BTN_P, BTN_S, CARD, Campo, ESTADO_EQ, FirmaImg, Icon, INP, LBL, Vacio } from '../../ui/base';
import { abrirRecibo, abrirTallas } from '../entregas/Hojas';
import { enlacePortal, generarToken, hashToken } from '../../domain/portal';
import { enlaceWhatsApp, normalizarTelefono } from '../../domain/whatsapp';
import CierresView, { abrirRecuentoVehiculo } from '../cierres/CierresView';
import { CargarMas, useMas } from '../../ui/lista';

type Pestaña = 'equipos' | 'vehiculos' | 'tecnicos' | 'historial' | 'cierres';

const usePermisosExportar = () => usePermisos().exportar;

export default function EquiposView() {
  const E = useAlmacen(), u = useUI(), { gestionarFlota } = usePermisos();
  const pest = (['equipos', 'vehiculos', 'tecnicos', 'historial', 'cierres'] as Pestaña[]).includes(u.eqTab as Pestaña) ? u.eqTab as Pestaña : 'equipos';
  const libres = E.tecnicos.filter(t => !E.equipos.some(e => e.tecnicos.includes(t.id)));
  const tab = (k: Pestaña, l: string, n: number | null, i: string) =>
    <button onClick={() => setUI({ eqTab: k })} className={`flex items-center gap-2 px-3 sm:px-4 h-12 rounded-lg font-semibold ${pest === k ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant'}`}><Icon n={i} className="ico-20" /><span className="hidden sm:inline">{l}</span>{n !== null && <span className="font-mono text-label-sm px-1.5 rounded bg-surface-container-high">{n}</span>}</button>;
  return (
    <div className="px-4 lg:px-gutter py-4 lg:py-space-lg flex flex-col gap-4 lg:gap-space-lg max-w-[1600px]">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div><span className={LBL}>Equipos de campo · vehículos · técnicos</span><h1 className="text-headline-lg-mobile lg:text-headline-lg font-bold">Equipos, vehículos y técnicos</h1></div>
        {gestionarFlota && <div className="flex flex-wrap gap-2">
          <button onClick={() => abrirFormEquipo()} className={`${BTN_P} px-4 h-12`}><Icon n="group_add" className="ico-20" />Equipo</button>
          <button onClick={() => abrirFormVehiculo()} className={`${BTN_S} px-4 h-12`}><Icon n="local_shipping" className="ico-20" />Vehículo</button>
          <button onClick={() => abrirFormTecnico()} className={`${BTN_S} px-4 h-12`}><Icon n="person_add" className="ico-20" />Técnico</button></div>}
      </div>
      <section className={`${CARD} p-4 lg:p-space-md flex gap-4 items-start`}><span className="w-11 h-11 rounded-xl bg-primary-fixed text-primary grid place-items-center shrink-0"><Icon n="alt_route" /></span>
        <div className="flex-1"><h2 className="text-headline-sm font-semibold">Composición variable</h2><p className="text-body-md text-secondary">Técnicos, equipos y vehículos van por separado y cada cambio queda en el historial. <b>El material a bordo es del vehículo</b>: si un técnico cambia de equipo no se mueve nada, y si un vehículo pasa a otro equipo, su material va con él. El nombre del equipo debe ser el que envía el wizard de cierres ("Búfala 1").</p></div></section>
      <div className="inline-flex self-start bg-surface-container-low rounded-xl p-1 max-w-full overflow-x-auto no-scrollbar">
        {tab('equipos', 'Equipos', E.equipos.length, 'groups')}{tab('vehiculos', 'Vehículos', E.vehiculos.length, 'local_shipping')}{tab('tecnicos', 'Técnicos', E.tecnicos.length, 'engineering')}{tab('historial', 'Historial', null, 'history')}{tab('cierres', 'Cierres', E.cierres.length, 'assignment_turned_in')}</div>
      {pest === 'equipos' && (E.equipos.length ? <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 lg:gap-space-lg">{E.equipos.map(e => <CardEquipo key={e.id} e={e} />)}</div>
        : <section className={`${CARD} p-6 text-center text-secondary`}>Aún no hay equipos. {gestionarFlota && <button onClick={() => abrirFormEquipo()} className="text-primary font-semibold">Crear el primero</button>}</section>)}
      {pest === 'vehiculos' && <Vehiculos />}
      {pest === 'tecnicos' && <div className={`${CARD} overflow-hidden`}>{E.tecnicos.length ? E.tecnicos.map(t => <FilaTecnico key={t.id} t={t} />) : <Vacio>Aún no hay técnicos.</Vacio>}
        {libres.length > 0 && <p className="p-4 text-body-sm text-amber-800 bg-amber-50">{libres.length} técnico{libres.length === 1 ? '' : 's'} sin equipo: no podrán recibir material de instalación hasta asignarlos.</p>}</div>}
      {pest === 'historial' && <Historial />}
      {pest === 'cierres' && <CierresView />}
      <AuditoriaEntregas />
    </div>
  );
}

function CardEquipo({ e }: { e: Equipo }) {
  const E = useAlmacen(), { gestionarFlota, mod } = usePermisos();
  const v = E.vehiculos.find(x => x.id === e.vehiculo), vs = v ? stockDeVehiculo(E, v.id) : [], ult = E.entregas.filter(x => x.equipo === e.id).sort((a, b) => b.ts - a.ts)[0];
  const dot = herramientasDe(E, { equipo: e.id }), avis = new Set(avisosDotacion(E).map(h => h.id)), dotAvisos = dot.filter(h => avis.has(h.id)).length;
  const fuera = E.tecnicos.filter(t => !e.tecnicos.includes(t.id));
  const cambiarEstado = () => { const ks = Object.keys(ESTADO_EQ) as EstadoEquipo[]; ejecutar({ op: 'estadoEquipo', args: { id: e.id, estado: ks[(ks.indexOf(e.estado) + 1) % ks.length] } }); };
  const cargar = () => { E.cesta.equipo = e.id; E.cesta.receptor = e.tecnicos[0] ?? null; E.cesta.paso = e.tecnicos[0] ? 2 : 1; guardar(); ir('entregas'); };
  const asignarV = (vid: string) => { if (ejecutar({ op: 'asignarVehiculo', args: { vehiculo: vid || e.vehiculo!, equipo: vid ? e.id : undefined } })) toast(vid ? `Vehículo asignado a ${e.nombre}: su material va con él.` : `${e.nombre} queda sin vehículo.`, 'ok'); };
  return (
    <article className={`${CARD} p-4 lg:p-space-md flex flex-col gap-3`}>
      <div className="flex items-start gap-3"><span className="w-12 h-12 rounded-xl bg-surface-container-low text-primary grid place-items-center shrink-0"><Icon n="groups" /></span>
        <div className="flex-1 min-w-0"><div className={LBL}>Equipo</div><div className="text-headline-md font-semibold">{e.nombre}</div></div>
        <button onClick={mod('equipos') ? cambiarEstado : undefined} disabled={!mod('equipos')} title={mod('equipos') ? 'Cambiar estado' : undefined} className={`font-mono text-label-sm px-2.5 py-1 rounded-full whitespace-nowrap ${ESTADO_EQ[e.estado].c}`}>● {ESTADO_EQ[e.estado].t}</button></div>

      <div className="bg-surface-container-low rounded-xl p-3 flex flex-col gap-2"><div className={LBL}>Vehículo</div>
        {v ? <div className="flex items-center gap-3"><Icon n="local_shipping" className="text-primary" /><div className="flex-1 min-w-0"><div className="font-semibold font-mono">{v.matricula}</div><div className="text-body-sm text-secondary truncate">{v.modelo || '—'}</div></div></div>
          : <span className="text-body-sm text-amber-800">Sin vehículo: no puede recibir material de instalación.</span>}
        {gestionarFlota && <select value={e.vehiculo || ''} onChange={x => asignarV(x.target.value)} className={`${INP} h-12`} aria-label={`Vehículo de ${e.nombre}`}>
          <option value="">— Sin vehículo —</option>{E.vehiculos.map(x => <option key={x.id} value={x.id}>{x.matricula}{x.modelo ? ` · ${x.modelo}` : ''}{x.equipo && x.equipo !== e.id ? ` (ahora en ${E.equipos.find(q => q.id === x.equipo)?.nombre})` : ''}</option>)}</select>}</div>

      <div className="bg-surface-container-low rounded-xl p-3 flex flex-col gap-2"><div className={LBL}>Técnicos ({e.tecnicos.length})</div>
        {e.tecnicos.length ? e.tecnicos.map(id => E.tecnicos.find(t => t.id === id)).filter(Boolean).map(t =>
          <div key={t!.id} className="flex items-center gap-3"><Avatar n={t!.nombre} c="bg-white text-primary" /><div className="flex-1 min-w-0"><div className="font-semibold truncate">{t!.nombre}</div><div className="font-mono text-label-sm text-secondary truncate">{t!.codigo ? t!.codigo + ' · ' : ''}{t!.rol}</div></div>
            {gestionarFlota && <button onClick={() => { if (ejecutar({ op: 'asignarTecnico', args: { tecnico: t!.id } })) toast(`${t!.nombre} sale de ${e.nombre}.`, 'ok'); }} className="w-11 h-11 grid place-items-center rounded-lg text-secondary hover:bg-white" aria-label={`Quitar a ${t!.nombre} del equipo`}><Icon n="person_remove" /></button>}</div>)
          : <span className="text-secondary text-body-sm">Sin técnicos asignados</span>}
        {gestionarFlota && fuera.length > 0 && <select value="" onChange={x => { if (x.target.value && ejecutar({ op: 'asignarTecnico', args: { tecnico: x.target.value, equipo: e.id } })) toast('Técnico añadido al equipo (su historial queda guardado).', 'ok'); }} className={`${INP} h-12`} aria-label={`Añadir técnico a ${e.nombre}`}>
          <option value="">+ Añadir técnico…</option>{fuera.map(t => <option key={t.id} value={t.id}>{t.nombre}{E.equipos.find(q => q.tecnicos.includes(t.id)) ? ` (ahora en ${E.equipos.find(q => q.tecnicos.includes(t.id))!.nombre})` : ''}</option>)}</select>}</div>

      {v && <div><div className="flex justify-between mb-2"><span className={LBL}>A bordo de {v.matricula}</span><button onClick={() => { setUI({ almacen: v.id }); ir('stock'); }} className="font-mono text-label-sm text-primary h-8">Ver todo ({vs.length}) →</button></div>
        <div className="grid grid-cols-3 gap-2">{vs.length ? vs.slice(0, 3).map(x => { const p = find(E, x.sku)!; return (
          <div key={x.sku} className="bg-surface-container-low rounded-lg p-2 text-center"><Icon n={catDe(p.cat).icon} className="text-primary ico-20" /><Cantidad p={p} formatos={x.qty} className="font-semibold text-body-sm" sub="text-label-sm text-secondary" /><div className="font-mono text-[9px] text-secondary truncate">{p.name}</div></div>); })
          : <div className="col-span-3 text-body-sm text-secondary bg-surface-container-low rounded-lg p-3 text-center">Sin material a bordo</div>}</div></div>}
      <button onClick={() => ir('dotacion')} className="text-left bg-surface-container-low rounded-xl p-3 flex items-center gap-3 min-h-14"><Icon n="construction" className="text-primary" />
        <div className="flex-1 min-w-0"><div className="font-mono text-label-sm text-secondary">Dotación (herramientas, EPIs, ropa)</div><div className="font-semibold">{dot.length} fichas{dotAvisos ? <span className="text-error"> · {dotAvisos} con aviso</span> : ''}</div></div><Icon n="chevron_right" className="text-primary" /></button>
      {ult && <button onClick={() => abrirRecibo(ult.id)} className="text-left bg-surface-container-low rounded-xl p-3 flex items-center gap-3 min-h-14"><Icon n="draw" className="text-tertiary" />
        <div className="flex-1 min-w-0"><div className="font-mono text-label-sm text-secondary">Última entrega</div><div className="font-semibold">{hace(ult.ts)} (#{numEntrega(ult)})</div></div><Icon n="visibility" className="text-primary" /></button>}
      {mod('entregas') && <button onClick={cargar} className={`${BTN_P} h-14 mt-auto`}><Icon n="inventory" className="ico-20" />Entregar material a {e.nombre}</button>}
      {gestionarFlota && <div className="flex gap-3 justify-end">
        <button onClick={() => abrirFormEquipo(e)} className="text-primary text-body-sm font-semibold h-10">Editar</button>
        <button onClick={() => { if (confirm(`¿Retirar el equipo ${e.nombre}? Su vehículo queda sin equipo y el historial se conserva.`) && ejecutar({ op: 'retirarEquipo', args: { id: e.id } })) toast('Equipo retirado.', 'ok'); }} className="text-error text-body-sm font-semibold h-10">Retirar</button></div>}
    </article>
  );
}

function Vehiculos() {
  const E = useAlmacen(), { gestionarFlota, mod } = usePermisos();
  if (!E.vehiculos.length) return <section className={`${CARD} p-6 text-center text-secondary`}>Aún no hay vehículos. {gestionarFlota && <button onClick={() => abrirFormVehiculo()} className="text-primary font-semibold">Dar de alta el primero</button>}</section>;
  return (
    <div className={`${CARD} overflow-hidden`}>{E.vehiculos.map(v => { const vs = stockDeVehiculo(E, v.id); return (
      <div key={v.id} className="flex flex-wrap items-center gap-3 p-4 border-b border-surface-container">
        <span className="w-11 h-11 rounded-xl bg-surface-container-low text-primary grid place-items-center"><Icon n="local_shipping" /></span>
        <div className="flex-1 min-w-[160px]"><div className="font-semibold font-mono">{v.matricula}</div><div className="text-body-sm text-secondary">{v.modelo || '—'} · {vs.length} referencias a bordo</div></div>
        <button onClick={() => { setUI({ almacen: v.id }); ir('stock'); }} className={`${BTN_S} h-11 px-3 text-body-sm`}><Icon n="inventory_2" className="ico-18" />Ver stock</button>
        <label className="flex items-center gap-2"><span className={LBL}>Equipo</span>
          <select disabled={!gestionarFlota} value={v.equipo || ''} onChange={x => { if (ejecutar({ op: 'asignarVehiculo', args: { vehiculo: v.id, equipo: x.target.value || undefined } })) toast(x.target.value ? 'Vehículo asignado: su material va con él.' : 'Vehículo sin equipo (p. ej. en taller).', 'ok'); }} className={`${INP} !w-auto h-12`}>
            <option value="">— Sin equipo —</option>{E.equipos.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></label>
        {gestionarFlota && <button onClick={() => abrirFormVehiculo(v)} className="text-primary text-body-sm font-semibold h-10">Editar</button>}
        {mod('recuentos') && <button onClick={() => abrirRecuentoVehiculo(v.id)} className="text-primary text-body-sm font-semibold h-10">Recontar</button>}
        {gestionarFlota && <button onClick={() => { if (confirm(`¿Dar de baja el vehículo ${v.matricula}? El historial se conserva.`) && ejecutar({ op: 'bajaVehiculo', args: { id: v.id } })) toast('Vehículo dado de baja.', 'ok'); }} className="text-error text-body-sm font-semibold h-10">Baja</button>}
      </div>); })}</div>
  );
}

function FilaTecnico({ t }: { t: Tecnico }) {
  const E = useAlmacen(), { gestionarFlota } = usePermisos(), e = E.equipos.find(x => x.tecnicos.includes(t.id)), dot = herramientasDe(E, { tecnico: t.id });
  return (
    <div className="flex flex-wrap items-center gap-3 p-4 border-b border-surface-container"><Avatar n={t.nombre} />
      <div className="flex-1 min-w-[180px]"><div className="font-semibold">{t.nombre}{t.codigo && <span className="font-mono text-label-sm text-secondary"> · {t.codigo}</span>}</div>
        <div className="font-mono text-label-sm text-secondary">{t.rol} · {dot.length} en dotación · tallas {t.tallas ? Object.values(t.tallas).filter(Boolean).join('/') || '—' : '—'}</div>
        <div className="text-body-sm text-secondary flex flex-wrap items-center gap-x-3"><span className="flex items-center gap-1"><Icon n="call" className="ico-16" />{t.telefono || 'Sin teléfono'}</span><span className="flex items-center gap-1"><Icon n="mail" className="ico-16" />{t.email || 'Sin correo'}</span></div></div>
      {gestionarFlota && <button onClick={() => abrirFormTecnico(t)} className="text-primary text-body-sm font-semibold h-10">Editar</button>}
      {gestionarFlota && <button onClick={() => abrirTallas(t.id)} className="text-primary text-body-sm font-semibold h-10">Tallas</button>}
      {gestionarFlota && <button onClick={() => abrirPortalAdmin(t.id)} className="text-primary text-body-sm font-semibold h-10">Portal</button>}
      <label className="flex items-center gap-2"><span className={LBL}>Equipo</span>
        <select disabled={!gestionarFlota} value={e?.id || ''} onChange={ev => { if (ejecutar({ op: 'asignarTecnico', args: { tecnico: t.id, equipo: ev.target.value || undefined } })) toast('Asignación actualizada (queda en el historial).', 'ok'); }} className={`${INP} !w-auto h-12`}>
          <option value="">— Sin equipo —</option>{E.equipos.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>
      {gestionarFlota && <button onClick={() => { if (confirm(`¿Dar de baja a ${t.nombre}? Su historial y sus entregas se conservan.`) && ejecutar({ op: 'bajaTecnico', args: { id: t.id } })) toast('Técnico dado de baja.', 'ok'); }} className="text-error text-body-sm font-semibold h-10">Baja</button>}
    </div>
  );
}

function Historial() {
  const E = useAlmacen(), { gestionarFlota } = usePermisos();
  const filas = [...E.asignaciones].sort((a, b) => (b.hasta ?? b.desde) - (a.hasta ?? a.desde));
  const quien = (a: typeof filas[0]) => a.tipo === 'tecnico' ? (E.tecnicos.find(t => t.id === a.sujeto)?.nombre || a.sujeto) : `Vehículo ${E.vehiculos.find(v => v.id === a.sujeto)?.matricula || a.sujeto}`;
  const csv = () => descargarCsv(`asignaciones-${hoyISO()}.csv`, [['Tipo', 'Quién', 'Equipo', 'Desde', 'Hasta'], ...filas.map(a => [a.tipo === 'tecnico' ? 'Técnico' : 'Vehículo', quien(a), E.equipos.find(e => e.id === a.equipo)?.nombre || a.equipo, fechaHora(a.desde), a.hasta ? fechaHora(a.hasta) : 'actual'])]);
  return (
    <section className={`${CARD} p-4 lg:p-space-md flex flex-col gap-1`}>
      <div className="flex justify-between items-center mb-2"><h2 className="text-headline-sm font-semibold">Historial de asignaciones</h2>{usePermisosExportar() && <button onClick={csv} disabled={!filas.length} className={`${BTN_S} h-11 px-3 text-body-sm`}><Icon n="download" className="ico-18" />CSV</button>}</div>
      {filas.length ? filas.map((a, i) => <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 border-t border-surface-container text-body-sm">
        <Icon n={a.tipo === 'tecnico' ? 'engineering' : 'local_shipping'} className="text-secondary ico-20" />
        <span className="flex-1 min-w-[200px]"><b>{quien(a)}</b> en <b>{E.equipos.find(e => e.id === a.equipo)?.nombre || a.equipo}</b></span>
        <span className="font-mono text-label-sm text-secondary">{fechaHora(a.desde)} → {a.hasta ? fechaHora(a.hasta) : <span className="text-tertiary">actual</span>}</span>
        {gestionarFlota && (!modoNube || a.id) && <button onClick={() => abrirInicioAsignacion(a)} className={`${BTN_S} h-10 px-3 text-body-sm`} aria-label="Cambiar la fecha de inicio"><Icon n="edit_calendar" className="ico-18" />Inicio</button>}</div>)
        : <Vacio>Sin asignaciones todavía.</Vacio>}
    </section>
  );
}

/* ---------- E-029 · Corregir la fecha de inicio de una asignación (y desbloquear los cierres que caen en el nuevo tramo) ---------- */
const abrirInicioAsignacion = (a: Asignacion) => openModal(<InicioAsignacion a={a} />);
function InicioAsignacion({ a }: { a: Asignacion }) {
  const E = useAlmacen();
  const [v, setV] = useState(fechaHoraInput(a.desde));
  const [afectados, setAfectados] = useState<string[] | null>(null);
  const ts = v ? new Date(v).getTime() : NaN;
  const error = ts === a.desde ? null : validarInicioAsignacion(E, a, ts);
  const previstos = !error && Number.isFinite(ts) ? cierresAfectados(E, a, ts) : [];
  const quien = a.tipo === 'tecnico' ? (E.tecnicos.find(t => t.id === a.sujeto)?.nombre || a.sujeto) : `Vehículo ${E.vehiculos.find(x => x.id === a.sujeto)?.matricula || a.sujeto}`;
  const equipo = E.equipos.find(e => e.id === a.equipo)?.nombre || a.equipo;
  const guardar = () => {
    if (error || ts === a.desde) return;
    if (!ejecutar({ op: 'editarInicioAsignacion', args: { clave: claveAsignacion(a), id: a.id, tipo: a.tipo, desde: ts } })) return;
    toast('Fecha de inicio guardada (queda en la auditoría).', 'ok');
    if (previstos.length) setAfectados(previstos); else closeModal();
  };
  if (afectados) {
    const cs = E.cierres.filter(c => afectados.includes(c.id));
    return (<>
      <SheetHead title="Cierres que se pueden procesar" sub={`Con la nueva fecha, ${equipo} ya tenía vehículo cuando se hicieron.`} />
      <div className="p-5 flex flex-col gap-1 text-body-sm">{cs.map(c => <div key={c.id} className="flex justify-between gap-2 py-1.5 border-b border-surface-container"><span>{c.numInst || '—'} · {c.cliente || 'sin cliente'}</span><span className="text-secondary">{fechaHora(c.fecha)}</span></div>)}</div>
      <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Ahora no</button>
        <button onClick={() => { if (ejecutar({ op: 'reprocesarCierres', args: { ids: afectados } })) { closeModal(); toast(`${afectados.length === 1 ? 'Cierre reprocesado' : `${afectados.length} cierres reprocesados`}: se ha descontado su material.`, 'ok'); } }} className={`${BTN_P} h-12 flex-1`}><Icon n="refresh" className="ico-20" />Reprocesar {afectados.length === 1 ? 'el cierre afectado' : `los ${afectados.length} cierres afectados`}</button></SheetFoot>
    </>);
  }
  return (<>
    <SheetHead title="Cambiar la fecha de inicio" sub={`${quien} en ${equipo}${a.hasta ? ` · hasta ${fechaHora(a.hasta)}` : ' · asignación actual'}`} />
    <div className="p-5 flex flex-col gap-3">
      <Campo label="Desde"><input type="datetime-local" value={v} max={fechaHoraInput(Date.now())} onChange={x => setV(x.target.value)} className={`${INP} h-12`} /></Campo>
      <p className="text-body-sm text-secondary">Para cuando la asignación se registró más tarde de lo que empezó de verdad (p. ej., se dio de alta por la noche, pero la furgoneta ya llevaba todo el día con el equipo). No mueve material; el cambio queda en la auditoría.</p>
      {error && <p className="text-body-sm text-error font-semibold">{error}</p>}
      {previstos.length > 0 && <p className="text-body-sm text-amber-900 bg-amber-50 rounded-lg p-3">Con esta fecha, <b>{previstos.length} cierre{previstos.length === 1 ? '' : 's'} "sin vehículo"</b> de {equipo} se podrá{previstos.length === 1 ? '' : 'n'} procesar: al guardar te lo ofrezco.</p>}
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Cancelar</button><button disabled={!!error || ts === a.desde || !Number.isFinite(ts)} onClick={guardar} className={`${BTN_P} h-12 flex-1 disabled:opacity-40`}><Icon n="save" className="ico-20" />Guardar fecha</button></SheetFoot>
  </>);
}

export function AuditoriaEntregas() {
  const E = useAlmacen(), desk = useEsEscritorio();
  const es = E.entregas.filter(e => (e.estado ?? 'firmada') === 'firmada').sort((a, b) => b.ts - a.ts);
  const [n, mas] = useMas(100);
  const resumen = (e: typeof es[0]) => e.lineas.map(l => { const p = find(E, l.sku); return p ? `${cantTxt(p, l.qty)} ${p.name.split(' ').slice(0, 3).join(' ')}` : `${num(l.qty)} ${l.sku}`; }).join(', ');
  const verificar = async () => {
    let bad: string[] = [], total = E.entregas.length;
    if (modoNube) { const r = await verificarEntregasServidor(); if (!r) return; total = r.length; bad = r.filter(x => !x.ok).map(x => x.numero); }
    else for (const x of E.entregas) if ((await hashEntrega(x)) !== x.hash) bad.push(numEntrega(x));
    bad.length ? toast(`${bad.length} entrega(s) no coinciden con su huella: ${bad.join(', ')}.`, 'err', 8000) : toast(`Las ${total} entregas coinciden con su huella SHA-256.`, 'ok');
  };
  const csv = () => descargarCsv(`entregas-${hoyISO()}.csv`, [['Entrega', 'Fecha', 'Equipo', 'Vehículo', 'Receptor', 'DNI', 'SKU', 'Material', 'Cantidad', 'Unidad', 'Huella SHA-256'],
    ...E.entregas.flatMap(x => x.lineas.map(l => { const eq = E.equipos.find(q => q.id === x.equipo), r = E.tecnicos.find(t => t.id === x.receptor), p = find(E, l.sku); return [numEntrega(x), fechaHora(x.ts), eq?.nombre || x.equipo, x.vehiculo ? E.vehiculos.find(v => v.id === x.vehiculo)?.matricula || x.vehiculo : '', r?.nombre || '', x.dni || r?.dni || '', l.sku, p?.name || '', l.qty, p?.unit || '', x.hash]; }))]);
  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className="p-space-md flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="w-11 h-11 rounded-xl bg-tertiary-fixed text-on-tertiary-fixed grid place-items-center"><Icon n="verified_user" /></span>
        <div><h2 className="text-headline-md font-semibold">Auditoría de entregas y firmas</h2><p className="font-mono text-label-sm text-secondary">Almacén → vehículo del equipo · huella SHA-256</p></div></div>
        <div className="flex gap-2"><button onClick={verificar} className={`${BTN_S} px-3 h-11 text-body-sm`}><Icon n="fact_check" className="ico-18" />Verificar huellas</button>{usePermisosExportar() && <button onClick={csv} className={`${BTN_S} px-3 h-11 text-body-sm`}><Icon n="download" className="ico-18" />CSV</button>}</div></div>
      {desk ? <div className="overflow-x-auto"><table className="tabla w-full min-w-[900px]"><thead className="bg-surface-container-low"><tr><th>Referencia / fecha</th><th>Equipo / vehículo</th><th>Receptor</th><th>Resumen de material</th><th>Firma capturada</th><th className="text-right">Doc.</th></tr></thead>
        <tbody>{es.length ? es.slice(0, n).map(e => { const eq = E.equipos.find(x => x.id === e.equipo), r = E.tecnicos.find(t => t.id === e.receptor); return (
          <tr key={e.id}><td><div className="font-mono text-label-md text-primary">#{numEntrega(e)}</div><div className="font-mono text-label-sm text-secondary">{hace(e.ts)}</div></td>
            <td><div className="flex items-center gap-2"><Icon n="local_shipping" className="text-secondary ico-20" /><div><div>{eq ? eq.nombre : e.equipo}</div><div className="font-mono text-label-sm text-secondary">{e.vehiculo ? nombreVehiculo(E, e.vehiculo).split(' · ').pop() : '—'}</div></div></div></td>
            <td><div className="flex items-center gap-2"><Avatar n={r?.nombre || '?'} /><span>{r?.nombre || '—'}</span></div></td>
            <td className="max-w-[320px] text-body-sm">{resumen(e)}</td>
            <td><div className="flex items-center gap-2"><span className="bg-surface-container-low rounded-lg px-1"><FirmaImg f={e.firma} /></span><span className="font-mono text-label-sm text-tertiary">✓ {(e.hash || '').slice(0, 8)}</span></div></td>
            <td className="text-right"><button onClick={() => abrirRecibo(e.id)} className="p-2 rounded-lg text-primary hover:bg-primary-fixed" aria-label="Ver albarán de entrega"><Icon n="picture_as_pdf" /></button></td></tr>); })
          : <tr><td colSpan={6}><Vacio>Sin entregas registradas.</Vacio></td></tr>}</tbody></table><CargarMas visibles={n} total={es.length} mas={mas} que="entregas" /></div>
        : <div className="px-4 pb-2">{es.length ? es.slice(0, n).map(e => { const eq = E.equipos.find(x => x.id === e.equipo), r = E.tecnicos.find(t => t.id === e.receptor); return (
          <button key={e.id} onClick={() => abrirRecibo(e.id)} className="w-full text-left flex items-center gap-3 py-3 border-t border-surface-container"><span className="bg-surface-container-low rounded-lg"><FirmaImg f={e.firma} className="h-10 w-20" /></span>
            <div className="flex-1 min-w-0"><div className="font-mono text-label-md text-primary">#{numEntrega(e)}</div><div className="text-body-sm truncate">{eq?.nombre} · {r?.nombre}</div><div className="text-body-sm text-secondary truncate">{resumen(e)}</div></div>
            <span className="font-mono text-label-sm text-secondary shrink-0">{hace(e.ts)}</span></button>); }) : <Vacio>Sin entregas.</Vacio>}<CargarMas visibles={n} total={es.length} mas={mas} que="entregas" /></div>}
    </section>
  );
}

/* ---------- Formularios (administrador) ---------- */
export const abrirFormEquipo = (e?: Equipo) => openModal(<FormEquipo e={e} />);
function FormEquipo({ e }: { e?: Equipo }) {
  const E = useAlmacen();
  const [f, setF] = useState({ nombre: e?.nombre || `Búfala ${E.equipos.length + 1}`, estado: (e?.estado || 'depot') as EstadoEquipo, vehiculo: e?.vehiculo || '' });
  const [tecs, setTecs] = useState<string[]>(e?.tecnicos || []);
  const guardarEq = () => {
    if (!f.nombre.trim()) return toast('Indica el nombre del equipo.', 'err');
    let id = e?.id; if (!id) { let n = E.equipos.length + 1; do { id = 'F' + String(n++).padStart(2, '0'); } while (E.equipos.some(x => x.id === id)); }
    if (!ejecutar({ op: 'equipo', args: { id: id!, nombre: f.nombre.trim(), estado: f.estado } })) return;
    for (const t of tecs.filter(t => !e?.tecnicos.includes(t))) ejecutar({ op: 'asignarTecnico', args: { tecnico: t, equipo: id } });
    for (const t of (e?.tecnicos || []).filter(t => !tecs.includes(t))) ejecutar({ op: 'asignarTecnico', args: { tecnico: t } });
    if ((f.vehiculo || undefined) !== (e?.vehiculo || undefined)) ejecutar({ op: 'asignarVehiculo', args: f.vehiculo ? { vehiculo: f.vehiculo, equipo: id } : { vehiculo: e!.vehiculo! } });
    closeModal(); toast(`${f.nombre} guardado.`, 'ok');
  };
  return (<>
    <SheetHead title={e ? `Editar ${e.nombre}` : 'Crear equipo'} sub="El nombre debe coincidir con el que envía el wizard de cierres." />
    <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Campo label="Nombre del equipo *"><input value={f.nombre} onChange={x => setF({ ...f, nombre: x.target.value })} className={`${INP} h-12`} placeholder="Búfala 4" /></Campo>
      <Campo label="Estado"><select value={f.estado} onChange={x => setF({ ...f, estado: x.target.value as EstadoEquipo })} className={`${INP} h-12`}>{Object.entries(ESTADO_EQ).map(([k, v]) => <option key={k} value={k}>{v.t}</option>)}</select></Campo>
      <Campo label="Vehículo" className="sm:col-span-2"><select value={f.vehiculo} onChange={x => setF({ ...f, vehiculo: x.target.value })} className={`${INP} h-12`}>
        <option value="">— Sin vehículo —</option>{E.vehiculos.map(v => <option key={v.id} value={v.id}>{v.matricula}{v.modelo ? ` · ${v.modelo}` : ''}{v.equipo && v.equipo !== e?.id ? ` (ahora en ${E.equipos.find(q => q.id === v.equipo)?.nombre})` : ''}</option>)}</select></Campo>
      <div className="sm:col-span-2"><span className={LBL}>Técnicos (salen de su equipo actual; queda en el historial)</span>
        <div className="flex flex-wrap gap-2 mt-1">{E.tecnicos.map(t => <label key={t.id} className="flex items-center gap-2 px-3 h-12 rounded-lg bg-surface-container-low">
          <input type="checkbox" checked={tecs.includes(t.id)} onChange={x => setTecs(x.target.checked ? [...tecs, t.id] : tecs.filter(y => y !== t.id))} className="w-5 h-5 accent-primary" />{t.nombre}</label>)}
          {!E.tecnicos.length && <span className="text-body-sm text-secondary">Aún no hay técnicos: añádelos después.</span>}</div></div>
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Cancelar</button><button onClick={guardarEq} className={`${BTN_P} h-12 flex-1`}><Icon n="save" className="ico-20" />Guardar equipo</button></SheetFoot>
  </>);
}

export const abrirFormVehiculo = (v?: Vehiculo) => openModal(<FormVehiculo v={v} />);
function FormVehiculo({ v }: { v?: Vehiculo }) {
  const E = useAlmacen();
  const [f, setF] = useState({ matricula: v?.matricula || '', modelo: v?.modelo || '', equipo: v?.equipo || '' });
  const guardarV = () => {
    const id = v?.id || uid('V');
    if (!ejecutar({ op: 'vehiculo', args: { id, matricula: f.matricula, modelo: f.modelo } })) return;
    if ((f.equipo || undefined) !== (v?.equipo || undefined)) ejecutar({ op: 'asignarVehiculo', args: { vehiculo: id, equipo: f.equipo || undefined } });
    closeModal(); toast('Vehículo guardado.', 'ok');
  };
  return (<>
    <SheetHead title={v ? `Editar ${v.matricula}` : 'Nuevo vehículo'} sub="Un equipo lleva un vehículo; el material a bordo es del vehículo." />
    <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Campo label="Matrícula *"><input autoFocus value={f.matricula} onChange={x => setF({ ...f, matricula: x.target.value })} className={`${INP} h-12 font-mono uppercase`} placeholder="0000-XXX" /></Campo>
      <Campo label="Modelo"><input value={f.modelo} onChange={x => setF({ ...f, modelo: x.target.value })} className={`${INP} h-12`} placeholder="Furgoneta" /></Campo>
      <Campo label="Equipo" className="sm:col-span-2"><select value={f.equipo} onChange={x => setF({ ...f, equipo: x.target.value })} className={`${INP} h-12`}><option value="">— Sin equipo (p. ej. en taller) —</option>{E.equipos.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></Campo>
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Cancelar</button><button onClick={guardarV} className={`${BTN_P} h-12 flex-1`}><Icon n="save" className="ico-20" />Guardar vehículo</button></SheetFoot>
  </>);
}

/* ---------- E-014 · Enlace personal del portal del técnico (solo el administrador) ---------- */
export const abrirPortalAdmin = (tecnico: string) => openModal(<PortalAdmin tecnico={tecnico} />);
function PortalAdmin({ tecnico }: { tecnico: string }) {
  const E = useAlmacen(), t = E.tecnicos.find(x => x.id === tecnico);
  const [nuevo, setNuevo] = useState<string | null>(null);
  if (!t) return <SheetHead title="Técnico no encontrado" />;
  const activos = E.portalEnlaces.filter(x => x.tecnico === t.id && !x.revocado), ultimo = [...activos].sort((a, b) => b.creado - a.creado)[0];
  const revocar = () => {
    if (!confirm(`¿Revocar todos los enlaces de ${t.nombre}? Dejarán de funcionar al momento; sus entregas no se tocan.`)) return;
    if (ejecutar({ op: 'revocarPortal', args: { tecnico: t.id } })) { setNuevo(null); toast('Enlaces revocados.', 'ok'); }
  };
  const generar = async () => {
    const token = generarToken(), hash = await hashToken(token);
    if (activos.length && !ejecutar({ op: 'revocarPortal', args: { tecnico: t.id } })) return;
    if (ejecutar({ op: 'enlacePortal', args: { tecnico: t.id, hash } })) setNuevo(enlacePortal(token));
  };
  const wa = nuevo ? enlaceWhatsApp(t.telefono, `Hola ${t.nombre.split(' ')[0]}: este es tu enlace personal del almacén para ver tus entregas y lo que lleva tu vehículo. No lo compartas: ${nuevo}`) : null;
  return (<>
    <SheetHead title={`Portal de ${t.nombre}`} sub="Página de solo lectura con sus entregas firmadas y el material de su vehículo. Se entra con un enlace personal, sin contraseña." />
    <div className="p-5 flex flex-col gap-3">
      <p className="text-body-md">{activos.length ? <>Tiene <b>{activos.length}</b> enlace{activos.length === 1 ? '' : 's'} activo{activos.length === 1 ? '' : 's'} (cada entrega enviada por WhatsApp lleva uno). Último: {fechaHora(ultimo.creado)}, por {ultimo.creadoPor}.</> : 'No tiene ningún enlace activo.'}</p>
      <p className="text-body-sm text-secondary">Del enlace solo se guarda una huella: nadie puede recuperarlo. Si lo pierde o el móvil cambia de manos, revócalos todos y genera uno nuevo.</p>
      {nuevo && <div className="rounded-xl bg-primary-fixed/40 p-3 flex flex-col gap-2">
        <span className={LBL}>Enlace nuevo (cópialo ahora: no se vuelve a mostrar)</span>
        <input readOnly value={nuevo} onFocus={x => x.target.select()} className={`${INP} h-12 font-mono text-label-sm`} aria-label="Enlace del portal" />
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void navigator.clipboard?.writeText(nuevo).then(() => toast('Enlace copiado.', 'ok'))} className={`${BTN_S} h-12 px-4`}><Icon n="content_copy" className="ico-20" />Copiar</button>
          {wa ? <a href={wa} target="_blank" rel="noopener" className="h-12 px-4 rounded-xl bg-[#128c3e] text-white font-semibold inline-flex items-center gap-2"><Icon n="chat" className="ico-fill" />Enviar por WhatsApp</a>
            : <span className="text-body-sm text-secondary self-center">Sin teléfono en su ficha: cópialo y envíaselo.</span>}
        </div></div>}
    </div>
    <SheetFoot className="grid grid-cols-2 gap-2">
      <button onClick={revocar} disabled={!activos.length} className={`${BTN_S} h-14 text-error disabled:opacity-40`}><Icon n="link_off" className="ico-20" />Revocar todos</button>
      <button onClick={() => void generar()} className={`${BTN_P} h-14`}><Icon n="add_link" className="ico-20" />{activos.length ? 'Revocar y generar nuevo' : 'Generar enlace'}</button></SheetFoot>
  </>);
}

export const abrirFormTecnico = (t?: Tecnico) => openModal(<FormTecnico t={t} />);
function FormTecnico({ t }: { t?: Tecnico }) {
  const E = useAlmacen();
  const [f, setF] = useState({ nombre: t?.nombre || '', codigo: t?.codigo || '', rol: t?.rol || 'Técnico electricista', telefono: t?.telefono || '', email: t?.email || '', dni: '', equipo: E.equipos.find(e => t && e.tecnicos.includes(t.id))?.id || '' });
  const guardarT = () => {
    if (!f.nombre.trim()) return toast('Indica el nombre.', 'err');
    const d = f.dni.replace(/\W/g, '').toUpperCase();
    // el DNI completo nunca sale del navegador: solo se guarda enmascarado
    const dni = d ? (d.length >= 5 ? `***${d.slice(-5, -1)}-${d.slice(-1)}` : d) : (t?.dni || '—');
    const id = t?.id || uid('T');
    if (!ejecutar({ op: 'tecnico', args: { id, nombre: f.nombre.trim(), rol: f.rol.trim() || 'Técnico', dni, email: f.email.trim(), codigo: f.codigo, telefono: f.telefono.trim() ? normalizarTelefono(f.telefono) ?? f.telefono.trim() : '' } })) return;
    const antes = E.equipos.find(e => e.tecnicos.includes(id))?.id || '';
    if (f.equipo !== antes) ejecutar({ op: 'asignarTecnico', args: { tecnico: id, equipo: f.equipo || undefined } });
    closeModal(); setUI({ eqTab: 'tecnicos' }); toast(t ? 'Técnico actualizado.' : 'Técnico añadido.', 'ok');
  };
  return (<>
    <SheetHead title={t ? `Editar a ${t.nombre}` : 'Nuevo técnico'} sub="Datos personales: se guardan solo en tu base de datos, nunca en el repositorio. Del DNI solo los 4 últimos dígitos y la letra." />
    <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Campo label="Nombre y apellidos *" className="sm:col-span-2"><input autoFocus value={f.nombre} onChange={x => setF({ ...f, nombre: x.target.value })} className={`${INP} h-12`} /></Campo>
      <Campo label="Código de empleado"><input value={f.codigo} onChange={x => setF({ ...f, codigo: x.target.value })} className={`${INP} h-12 font-mono uppercase`} placeholder="E01" /></Campo>
      <Campo label="Categoría"><input value={f.rol} onChange={x => setF({ ...f, rol: x.target.value })} className={`${INP} h-12`} /></Campo>
      <Campo label="Teléfono"><input value={f.telefono} onChange={x => setF({ ...f, telefono: x.target.value })} type="tel" inputMode="tel" className={`${INP} h-12`} placeholder="+34 600 000 000" /></Campo>
      <Campo label="Correo (le llega la copia de sus entregas)"><input value={f.email} onChange={x => setF({ ...f, email: x.target.value })} type="email" inputMode="email" className={`${INP} h-12`} placeholder="nombre@empresa.es" /></Campo>
      <Campo label={t ? `DNI (actual ${t.dni}; vacío = no cambiar)` : 'DNI (se enmascara)'}><input value={f.dni} onChange={x => setF({ ...f, dni: x.target.value })} className={`${INP} h-12`} /></Campo>
      <Campo label="Equipo"><select value={f.equipo} onChange={x => setF({ ...f, equipo: x.target.value })} className={`${INP} h-12`}><option value="">— Sin equipo —</option>{E.equipos.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></Campo>
    </div>
    <SheetFoot><button onClick={guardarT} className={`${BTN_P} h-12 w-full`}><Icon n="person_add" className="ico-20" />{t ? 'Guardar cambios' : 'Añadir técnico'}</button></SheetFoot>
  </>);
}
