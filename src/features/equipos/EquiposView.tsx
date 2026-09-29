/* Equipos (cuadrillas con furgoneta), técnicos y auditoría de entregas firmadas */
import { useState } from 'react';
import type { Equipo, EstadoEquipo } from '../../data/tipos';
import { CATS, UNIT } from '../../data/catalogo';
import { find, vanStock } from '../../domain/reglas';
import { fechaHora, hace, hoyISO, num, uid } from '../../domain/formato';
import { hashEntrega } from '../../domain/hash';
import { descargarCsv } from '../../domain/csv';
import { avisosDotacion, herramientasDe } from '../../domain/herramientas';
import { guardar, S, useAlmacen } from '../../store/almacen';
import { ir, setUI, useEsEscritorio, useUI } from '../../store/ui';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { Avatar, BTN_P, BTN_S, BTN_T, CARD, Campo, ESTADO_EQ, FirmaImg, Icon, INP, LBL, Vacio } from '../../ui/base';
import { abrirRecibo } from '../entregas/EntregasView';

export default function EquiposView() {
  const E = useAlmacen(), u = useUI();
  const enRuta = E.equipos.filter(e => e.estado === 'ruta').length;
  const libres = E.tecnicos.filter(t => !E.equipos.some(e => e.tecnicos.includes(t.id)));
  const tab = (k: 'equipos' | 'tecnicos', l: string, n: number, i: string) =>
    <button onClick={() => setUI({ eqTab: k })} className={`flex items-center gap-2 px-4 h-11 rounded-lg font-semibold ${u.eqTab === k ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant'}`}><Icon n={i} className="ico-20" />{l}<span className="font-mono text-label-sm px-1.5 rounded bg-surface-container-high">{n}</span></button>;
  return (
    <div className="px-4 lg:px-gutter py-4 lg:py-space-lg flex flex-col gap-4 lg:gap-space-lg max-w-[1600px]">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div><span className={LBL}>Logística &amp; flota / gestión de equipos</span><h1 className="text-headline-lg-mobile lg:text-headline-lg font-bold">Equipos de instalación &amp; despacho móvil</h1></div>
        <div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container-high font-mono text-label-sm"><span className="w-2 h-2 rounded-full bg-tertiary-container" />{enRuta} en ruta · {E.tecnicos.length} operarios</span>
          <button onClick={() => abrirFormEquipo()} className={`${BTN_P} px-4 h-11`}><Icon n="group_add" className="ico-20" />Crear equipo</button><button onClick={abrirFormTecnico} className={`${BTN_S} px-4 h-11`}><Icon n="person_add" className="ico-20" />Técnico</button></div>
      </div>
      <section className={`${CARD} p-4 lg:p-space-md flex gap-4 items-start`}><span className="w-11 h-11 rounded-xl bg-primary-fixed text-primary grid place-items-center shrink-0"><Icon n="alt_route" /></span>
        <div className="flex-1"><h2 className="text-headline-sm font-semibold">Operación flexible</h2><p className="text-body-md text-secondary">Cuadrillas en pareja (2 técnicos, 1 furgoneta) o técnicos individuales. El stock a bordo de cada furgoneta se calcula con lo entregado y firmado menos lo devuelto. Cada equipo tiene además su dotación de herramientas, EPIs y ropa.</p></div></section>
      <div className="inline-flex self-start bg-surface-container-low rounded-xl p-1">{tab('equipos', 'Equipos', E.equipos.length, 'local_shipping')}{tab('tecnicos', 'Técnicos', E.tecnicos.length, 'engineering')}</div>
      {u.eqTab === 'equipos'
        ? <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 lg:gap-space-lg">{E.equipos.map(e => <CardEquipo key={e.id} e={e} />)}</div>
        : <div className={`${CARD} overflow-hidden`}>{E.tecnicos.map(t => { const e = E.equipos.find(x => x.tecnicos.includes(t.id)), dot = herramientasDe(E, { tecnico: t.id }); return (
          <div key={t.id} className="flex flex-wrap items-center gap-3 p-4 border-b border-surface-container"><Avatar n={t.nombre} />
            <div className="flex-1 min-w-[160px]"><div className="font-semibold">{t.nombre}</div><div className="font-mono text-label-sm text-secondary">{t.rol} · DNI {t.dni} · {dot.length} en dotación</div></div>
            <label className="flex items-center gap-2"><span className={LBL}>Equipo</span>
              <select value={e?.id || ''} onChange={ev => { E.equipos.forEach(x => { x.tecnicos = x.tecnicos.filter(y => y !== t.id); }); if (ev.target.value) E.equipos.find(x => x.id === ev.target.value)!.tecnicos.push(t.id); guardar(); toast('Asignación actualizada.', 'ok'); }} className={`${INP} !w-auto h-11`}>
                <option value="">— Sin equipo —</option>{E.equipos.map(x => <option key={x.id} value={x.id}>{x.nombre} ({x.matricula})</option>)}</select></label>
          </div>); })}
          {libres.length > 0 && <p className="p-4 text-body-sm text-amber-800 bg-amber-50">{libres.length} técnico{libres.length === 1 ? '' : 's'} sin equipo: no podrán recibir entregas hasta asignarlos.</p>}</div>}
      <AuditoriaEntregas />
    </div>
  );
}

function CardEquipo({ e }: { e: Equipo }) {
  const E = useAlmacen();
  const vs = vanStock(E, e.id), ult = E.entregas.filter(x => x.equipo === e.id).sort((a, b) => b.ts - a.ts)[0];
  const top = [...vs].sort((a, b) => b.qty * (find(E, b.sku)?.price || 0) - a.qty * (find(E, a.sku)?.price || 0)).slice(0, 3);
  const dot = herramientasDe(E, { equipo: e.id }), avis = new Set(avisosDotacion(E).map(h => h.id)), dotAvisos = dot.filter(h => avis.has(h.id)).length;
  const cambiarEstado = () => { const ks = Object.keys(ESTADO_EQ) as EstadoEquipo[]; e.estado = ks[(ks.indexOf(e.estado) + 1) % ks.length]; guardar(); };
  const verVan = () => { setUI({ almacen: e.id }); ir('stock'); };
  const cargar = () => { E.cesta.equipo = e.id; guardar(); ir('entregas'); };
  return (
    <article className={`${CARD} p-4 lg:p-space-md flex flex-col gap-3`}>
      <div className="flex items-start gap-3"><span className="w-12 h-12 rounded-xl bg-surface-container-low text-primary grid place-items-center shrink-0"><Icon n={e.tecnicos.length > 1 ? 'airport_shuttle' : 'directions_car'} /></span>
        <div className="flex-1 min-w-0"><div className={LBL}>{e.nombre} · {e.flota}</div><div className="text-headline-md font-semibold font-mono">{e.matricula}</div></div>
        <button onClick={cambiarEstado} title="Cambiar estado" className={`font-mono text-label-sm px-2.5 py-1 rounded-full whitespace-nowrap ${ESTADO_EQ[e.estado].c}`}>● {ESTADO_EQ[e.estado].t}</button></div>
      <div className="bg-surface-container-low rounded-xl p-3 flex flex-col gap-2"><div className={LBL}>Personal operativo ({e.tecnicos.length} técnico{e.tecnicos.length === 1 ? '' : 's'})</div>
        {e.tecnicos.length ? e.tecnicos.map(id => E.tecnicos.find(t => t.id === id)).filter(Boolean).map(t =>
          <div key={t!.id} className="flex items-center gap-3"><Avatar n={t!.nombre} c="bg-white text-primary" /><div className="flex-1 min-w-0"><div className="font-semibold truncate">{t!.nombre}</div><div className="font-mono text-label-sm text-secondary truncate">{t!.rol}</div></div><Icon n="verified" className="text-tertiary ico-20" /></div>)
          : <span className="text-secondary text-body-sm">Sin técnicos asignados</span>}</div>
      <div><div className="flex justify-between mb-2"><span className={LBL}>Stock a bordo</span><button onClick={verVan} className="font-mono text-label-sm text-primary">Ver todo ({vs.length}) →</button></div>
        <div className="grid grid-cols-3 gap-2">{top.length ? top.map(x => { const p = find(E, x.sku)!; return (
          <div key={x.sku} className="bg-surface-container-low rounded-lg p-2 text-center"><Icon n={CATS[p.cat].icon} className="text-primary ico-20" /><div className="font-semibold">{num(x.qty)} {UNIT[p.unit]}</div><div className="font-mono text-[9px] text-secondary truncate">{p.name}</div></div>); })
          : <div className="col-span-3 text-body-sm text-secondary bg-surface-container-low rounded-lg p-3 text-center">Sin material cargado</div>}</div></div>
      <button onClick={() => ir('dotacion')} className="text-left bg-surface-container-low rounded-xl p-3 flex items-center gap-3"><Icon n="construction" className="text-primary" />
        <div className="flex-1 min-w-0"><div className="font-mono text-label-sm text-secondary">Dotación (herramientas, EPIs, ropa)</div><div className="font-semibold">{dot.length} fichas{dotAvisos ? <span className="text-error"> · {dotAvisos} con aviso</span> : ''}</div></div><Icon n="chevron_right" className="text-primary" /></button>
      {ult && <button onClick={() => abrirRecibo(ult.id)} className="text-left bg-surface-container-low rounded-xl p-3 flex items-center gap-3"><Icon n="draw" className="text-tertiary" />
        <div className="flex-1 min-w-0"><div className="font-mono text-label-sm text-secondary">Última entrega firmada</div><div className="font-semibold">{hace(ult.ts)} (#{ult.id})</div></div><Icon n="visibility" className="text-primary" /></button>}
      <div className="mt-auto flex flex-col gap-2">
        {e.tecnicos.length > 1 ? <button onClick={() => abrirFormEquipo(e)} className={`${BTN_T} h-11`}><Icon n="call_split" className="ico-20" />Desdoblar en técnicos (1+1)</button>
          : <button onClick={() => abrirEmparejar(e.id)} className={`${BTN_T} h-11`}><Icon n="call_merge" className="ico-20" />Formar pareja</button>}
        <button onClick={cargar} className={`${BTN_P} h-12`}><Icon n="inventory" className="ico-20" />{e.estado === 'depot' ? 'Asignar material para la ruta de hoy' : 'Gestionar carga de furgoneta'}</button>
      </div>
    </article>
  );
}

export function AuditoriaEntregas() {
  const E = useAlmacen(), desk = useEsEscritorio();
  const es = [...E.entregas].sort((a, b) => b.ts - a.ts);
  const resumen = (e: typeof es[0]) => e.lineas.map(l => { const p = find(E, l.sku); return `${num(l.qty)}${p?.unit === 'm' ? ' m' : '×'} ${(p?.name || l.sku).split(' ').slice(0, 3).join(' ')}`; }).join(', ');
  const verificar = async () => { const bad: string[] = []; for (const x of E.entregas) if ((await hashEntrega(x)) !== x.hash) bad.push(x.id); bad.length ? toast(`${bad.length} entrega(s) no coinciden con su huella: ${bad.join(', ')}.`, 'err', 8000) : toast(`Las ${E.entregas.length} entregas coinciden con su huella SHA-256.`, 'ok'); };
  const csv = () => descargarCsv(`entregas-${hoyISO()}.csv`, [['Entrega', 'Fecha', 'Equipo', 'Vehículo', 'Receptor', 'DNI', 'SKU', 'Material', 'Cantidad', 'N.º serie', 'Huella SHA-256'],
    ...E.entregas.flatMap(x => x.lineas.map(l => { const eq = E.equipos.find(q => q.id === x.equipo), r = E.tecnicos.find(t => t.id === x.receptor), p = find(E, l.sku); return [x.id, fechaHora(x.ts), eq?.nombre || x.equipo, eq?.matricula || '', r?.nombre || '', x.dni || r?.dni || '', l.sku, p?.name || '', l.qty, (l.serials || []).join(' '), x.hash]; }))]);
  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className="p-space-md flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="w-11 h-11 rounded-xl bg-tertiary-fixed text-on-tertiary-fixed grid place-items-center"><Icon n="verified_user" /></span>
        <div><h2 className="text-headline-md font-semibold">Auditoría de entregas y firmas</h2><p className="font-mono text-label-sm text-secondary">Custodia de material del almacén a furgoneta · huella SHA-256</p></div></div>
        <div className="flex gap-2"><button onClick={verificar} className={`${BTN_S} px-3 h-10 text-body-sm`}><Icon n="fact_check" className="ico-18" />Verificar huellas</button><button onClick={csv} className={`${BTN_S} px-3 h-10 text-body-sm`}><Icon n="download" className="ico-18" />CSV</button></div></div>
      {desk ? <div className="overflow-x-auto"><table className="tabla w-full min-w-[900px]"><thead className="bg-surface-container-low"><tr><th>Referencia / fecha</th><th>Equipo / vehículo</th><th>Receptor</th><th>Resumen de material</th><th>Firma capturada</th><th className="text-right">Doc.</th></tr></thead>
        <tbody>{es.length ? es.map(e => { const eq = E.equipos.find(x => x.id === e.equipo), r = E.tecnicos.find(t => t.id === e.receptor); return (
          <tr key={e.id}><td><div className="font-mono text-label-md text-primary">#{e.id}</div><div className="font-mono text-label-sm text-secondary">{hace(e.ts)}</div></td>
            <td><div className="flex items-center gap-2"><Icon n="airport_shuttle" className="text-secondary ico-20" /><div><div>{eq ? eq.flota : e.equipo}</div><div className="font-mono text-label-sm text-secondary">{eq?.matricula}</div></div></div></td>
            <td><div className="flex items-center gap-2"><Avatar n={r?.nombre || '?'} /><span>{r?.nombre || '—'}</span></div></td>
            <td className="max-w-[320px] text-body-sm">{resumen(e)}</td>
            <td><div className="flex items-center gap-2"><span className="bg-surface-container-low rounded-lg px-1"><FirmaImg f={e.firma} /></span><span className="font-mono text-label-sm text-tertiary">✓ {(e.hash || '').slice(0, 8)}</span></div></td>
            <td className="text-right"><button onClick={() => abrirRecibo(e.id)} className="p-2 rounded-lg text-primary hover:bg-primary-fixed" aria-label="Ver albarán de entrega"><Icon n="picture_as_pdf" /></button></td></tr>); })
          : <tr><td colSpan={6}><Vacio>Sin entregas registradas.</Vacio></td></tr>}</tbody></table></div>
        : <div className="px-4 pb-2">{es.length ? es.map(e => { const eq = E.equipos.find(x => x.id === e.equipo), r = E.tecnicos.find(t => t.id === e.receptor); return (
          <button key={e.id} onClick={() => abrirRecibo(e.id)} className="w-full text-left flex items-center gap-3 py-3 border-t border-surface-container"><span className="bg-surface-container-low rounded-lg"><FirmaImg f={e.firma} className="h-10 w-20" /></span>
            <div className="flex-1 min-w-0"><div className="font-mono text-label-md text-primary">#{e.id}</div><div className="text-body-sm truncate">{eq?.flota} · {r?.nombre}</div><div className="text-body-sm text-secondary truncate">{resumen(e)}</div></div>
            <span className="font-mono text-label-sm text-secondary shrink-0">{hace(e.ts)}</span></button>); }) : <Vacio>Sin entregas.</Vacio>}</div>}
    </section>
  );
}

/* ---------- Crear equipo / desdoblar ---------- */
export const abrirFormEquipo = (desdoblar?: Equipo) => openModal(<FormEquipo desdoblar={desdoblar} />);
function FormEquipo({ desdoblar }: { desdoblar?: Equipo }) {
  const E = useAlmacen(), segundo = desdoblar ? E.tecnicos.find(t => t.id === desdoblar.tecnicos[1]) : undefined;
  const [f, setF] = useState({ nombre: desdoblar ? `${desdoblar.nombre} B` : '', flota: desdoblar ? `Vehículo ${segundo?.nombre.split(' ')[0] || ''}` : `Furgoneta ${String(E.equipos.length + 1).padStart(2, '0')}`, matricula: '', estado: (desdoblar?.estado || 'depot') as EstadoEquipo });
  const [tecs, setTecs] = useState<string[]>([]);
  const guardarEq = () => {
    const matricula = f.matricula.trim().toUpperCase(); if (!matricula) return toast('Indica la matrícula del vehículo.', 'err');
    const miembros = desdoblar ? [desdoblar.tecnicos[1]] : tecs; if (!miembros.length) return toast('Asigna al menos un técnico.', 'err');
    let n = E.equipos.length + 1, id: string; do { id = 'F' + String(n++).padStart(2, '0'); } while (E.equipos.some(e => e.id === id));
    E.equipos.forEach(e => { e.tecnicos = e.tecnicos.filter(t => !miembros.includes(t)); });
    E.equipos.push({ id, nombre: f.nombre.trim() || `Equipo ${id}`, flota: f.flota.trim() || `Vehículo ${id}`, matricula, estado: f.estado, tecnicos: miembros });
    guardar(); closeModal(); toast(`${f.nombre || id} creado con ${miembros.length} técnico${miembros.length === 1 ? '' : 's'}.`, 'ok');
  };
  return (<>
    <SheetHead title={desdoblar ? 'Desdoblar equipo' : 'Crear equipo'} sub={desdoblar ? `${segundo?.nombre} sale con su propio vehículo.` : 'Cuadrilla con su vehículo'} />
    <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Campo label="Nombre del equipo"><input value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} className={`${INP} h-12`} placeholder="Equipo Delta" /></Campo>
      <Campo label="Vehículo"><input value={f.flota} onChange={e => setF({ ...f, flota: e.target.value })} className={`${INP} h-12`} /></Campo>
      <Campo label="Matrícula *"><input value={f.matricula} onChange={e => setF({ ...f, matricula: e.target.value })} className={`${INP} h-12 font-mono uppercase`} placeholder="0000-XXX" /></Campo>
      <Campo label="Estado"><select value={f.estado} onChange={e => setF({ ...f, estado: e.target.value as EstadoEquipo })} className={`${INP} h-12`}>{Object.entries(ESTADO_EQ).map(([k, v]) => <option key={k} value={k}>{v.t}</option>)}</select></Campo>
      {!desdoblar && <div className="sm:col-span-2"><span className={LBL}>Técnicos (se retiran de su equipo actual)</span>
        <div className="flex flex-wrap gap-2 mt-1">{E.tecnicos.map(t => <label key={t.id} className="flex items-center gap-2 px-3 h-11 rounded-lg bg-surface-container-low">
          <input type="checkbox" checked={tecs.includes(t.id)} onChange={e => setTecs(e.target.checked ? [...tecs, t.id] : tecs.filter(x => x !== t.id))} className="w-5 h-5 accent-primary" />{t.nombre}</label>)}</div></div>}
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Cancelar</button><button onClick={guardarEq} className={`${BTN_P} h-12 flex-1`}><Icon n="save" className="ico-20" />Guardar equipo</button></SheetFoot>
  </>);
}

function abrirEmparejar(id: string) {
  const E = S(), eq = E.equipos.find(e => e.id === id)!, otros = E.equipos.filter(x => x.id !== id && x.tecnicos.length === 1);
  if (!otros.length) return toast('No hay otro técnico individual con quien emparejar.', 'warn');
  const nombre = (tid?: string) => E.tecnicos.find(t => t.id === tid)?.nombre || '';
  const unir = (destino: Equipo) => {
    if (vanStock(E, eq.id).length) { closeModal(); return toast(`${eq.flota} aún lleva material a bordo: devuélvelo antes de retirar el vehículo.`, 'warn', 7000); }
    destino.tecnicos.push(...eq.tecnicos); E.equipos = E.equipos.filter(x => x !== eq);
    E.herramientas.forEach(h => { if (h.equipo === eq.id) h.equipo = destino.id; });
    guardar(); closeModal(); toast(`Pareja formada en ${destino.nombre}. Su dotación pasa a ese equipo.`, 'ok');
  };
  openModal(<>
    <SheetHead title="Formar pareja" sub={`${nombre(eq.tecnicos[0])} se une a otro técnico individual. El vehículo de ${eq.nombre} queda libre.`} />
    <div className="p-4 flex flex-col gap-2">{otros.map(o => <button key={o.id} onClick={() => unir(o)} className="flex items-center gap-3 p-3 rounded-xl bg-surface-container-low text-left"><Avatar n={nombre(o.tecnicos[0])} /><span className="flex-1"><b>{nombre(o.tecnicos[0])}</b><br /><span className="text-body-sm text-secondary">{o.nombre} · {o.matricula}</span></span><Icon n="chevron_right" /></button>)}</div>
  </>);
}

/* ---------- Nuevo técnico ---------- */
const abrirFormTecnico = () => openModal(<FormTecnico />);
function FormTecnico() {
  const [f, setF] = useState({ nombre: '', rol: 'Técnico electricista', dni: '' });
  const crear = () => {
    if (!f.nombre.trim()) return toast('Indica el nombre.', 'err');
    const d = f.dni.replace(/\W/g, '').toUpperCase();
    S().tecnicos.push({ id: uid('T'), nombre: f.nombre.trim(), rol: f.rol.trim() || 'Técnico', dni: d.length >= 5 ? `***${d.slice(-5, -1)}-${d.slice(-1)}` : (d || '—') });
    guardar(); closeModal(); setUI({ eqTab: 'tecnicos' }); toast('Técnico añadido. Asígnale un equipo.', 'ok');
  };
  return (<>
    <SheetHead title="Nuevo técnico" sub="Solo se guardan los 4 últimos dígitos y la letra del DNI." />
    <div className="p-5 grid grid-cols-1 gap-3">
      <Campo label="Nombre y apellidos *"><input autoFocus value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} className={`${INP} h-12`} /></Campo>
      <Campo label="Puesto"><input value={f.rol} onChange={e => setF({ ...f, rol: e.target.value })} className={`${INP} h-12`} /></Campo>
      <Campo label="DNI (se enmascara)"><input value={f.dni} onChange={e => setF({ ...f, dni: e.target.value })} className={`${INP} h-12`} /></Campo>
    </div>
    <SheetFoot><button onClick={crear} className={`${BTN_P} h-12 w-full`}><Icon n="person_add" className="ico-20" />Añadir técnico</button></SheetFoot>
  </>);
}
