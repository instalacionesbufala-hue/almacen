/* E-041 · Devolución de material de una furgoneta al almacén, como una entrega al revés: qué furgoneta, lo que consta a bordo (con
   buscador y escáner; también lo que no consta), cantidades en metros o unidades sueltos, estado de cada línea (bien o defectuoso),
   quién devuelve (técnico del equipo), motivo, obra, firma y albarán DEV- en PDF. */
import { useState } from 'react';
import type { Devolucion } from '../../data/tipos';
import { avisosDevolucion, comprobarDevolucion, MOTIVO_DEVOLUCION, numDevolucion, tecnicosDeVehiculo, type LineaDev } from '../../domain/devoluciones';
import { esCustodia, find, nombreVehiculo, qtyTxt, resolveCode, stockDeVehiculo, unidadesABordo, vistaUnidades } from '../../domain/reglas';
import { ucDe } from '../../domain/formatos';
import { fechaHora, toNum } from '../../domain/formato';
import { ejecutar, S, useAlmacen } from '../../store/almacen';
import { nuevoId } from '../../store/ops';
import { usePermisos } from '../../store/permisos';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { Firma, firmaPNG, type Trazo } from '../../ui/firma';
import { BTN_P, BTN_S, Campo, FirmaImg, Icon, INP, LBL, Tag, Tile } from '../../ui/base';
import { SelectorArticulo } from '../../ui/selectorArticulo';
import { useCamara } from '../escaner/camara';
import { compartirDevolucion, descargarDevolucion } from './devolucionPdf';

export const abrirDevolucion = (vehiculo?: string, sku?: string) => openModal(<NuevaDevolucion vehiculo={vehiculo} sku={sku} />, { ancha: true });
export const abrirVerDevolucion = (id: string) => openModal(<VerDevolucion id={id} />, { ancha: true });
/** Desde Entregas o la barra del móvil: la primera furgoneta que lleva material (se cambia dentro) */
export function iniciarDevolucion() { const E = S(); abrirDevolucion(E.vehiculos.find(v => stockDeVehiculo(E, v.id).some(x => x.qty > 0))?.id || E.vehiculos[0]?.id); }

type Fila = { id: string; sku: string; unidades: string; estado: 'bien' | 'defectuoso'; motivoDefecto: string };
function NuevaDevolucion({ vehiculo: v0, sku }: { vehiculo?: string; sku?: string }) {
  const E = useAlmacen();
  const [vehiculo, setVehiculo] = useState(v0 || E.vehiculos[0]?.id || '');
  const [filas, setFilas] = useState<Fila[]>(() => (sku ? [{ id: nuevoId(), sku, unidades: '', estado: 'bien', motivoDefecto: '' }] : []));
  const tecs = tecnicosDeVehiculo(E, vehiculo);
  const [tecnico, setTecnico] = useState(tecs.length === 1 ? tecs[0].id : '');
  const [d, setD] = useState({ motivo: 'sobrante' as Devolucion['motivo'], motivoTexto: '', obra: '' });
  const [trazos, setTrazos] = useState<Trazo[]>([]), [escaner, setEscaner] = useState(false), [manual, setManual] = useState(''), [hecha, setHecha] = useState<string | null>(null);
  const aBordo = stockDeVehiculo(E, vehiculo).filter(x => x.unidades > 0);
  const anadir = (s: string) => {
    const p = find(E, s); if (!p || p.borrador || p.archivado) return toast('Artículo no encontrado.', 'warn');
    setFilas(fs => { const ya = fs.filter(f => f.sku === s);
      if (ya.length >= 2) return fs;
      return [...fs, { id: nuevoId(), sku: s, unidades: '', estado: ya.some(f => f.estado === 'bien') ? 'defectuoso' : 'bien', motivoDefecto: '' }]; });
  };
  const leer = (c: string) => { const r = resolveCode(S(), c); if (r) anadir(r.p.sku); else toast(`Código desconocido: ${c}`, 'warn'); };
  const lineas: LineaDev[] = filas.map(f => ({ sku: f.sku, unidades: toNum(f.unidades), estado: f.estado, ...(f.estado === 'defectuoso' ? { motivoDefecto: f.motivoDefecto } : {}) }));
  const avisos = avisosDevolucion(E, vehiculo, lineas.filter(l => l.unidades > 0));
  const cambiarVeh = (x: string) => { setVehiculo(x); const t = tecnicosDeVehiculo(E, x); setTecnico(t.length === 1 ? t[0].id : ''); };
  const set = (id: string, cambio: Partial<Fila>) => setFilas(fs => fs.map(f => f.id === id ? { ...f, ...cambio } : f));
  const guardar = () => {
    const datos = { vehiculo, tecnico, ...d, firma: trazos.length ? firmaPNG(trazos) : '', lineas };
    const err = comprobarDevolucion(E, datos); if (err) return toast(err, 'err');
    const id = nuevoId();
    if (ejecutar({ op: 'devolucion', args: { id, datos } })) { setHecha(id); toast('Devolución registrada: el material ya está en el almacén.', 'ok', 6000); }
  };
  if (hecha) return <VerDevolucion id={hecha} recien />;
  return (<>
    <SheetHead title="Devolución de material" sub="Lo que los técnicos traen de vuelta de la furgoneta al almacén, con su firma y albarán." />
    <div className="p-5 flex flex-col gap-4">
      <Campo label="Furgoneta que devuelve"><select value={vehiculo} onChange={e => cambiarVeh(e.target.value)} className={`${INP} h-12`}>
        {E.vehiculos.map(v => <option key={v.id} value={v.id}>{nombreVehiculo(E, v.id)}</option>)}</select></Campo>
      <section className="flex flex-col gap-2"><h3 className="font-semibold">Quién devuelve y firma</h3>
        {tecs.length ? <div className="flex flex-wrap gap-2">{tecs.map(t => <button key={t.id} type="button" onClick={() => setTecnico(t.id)} className={`h-12 px-4 rounded-full font-semibold ${tecnico === t.id ? 'bg-primary text-white' : 'bg-surface-container-low'}`}>{t.nombre}</button>)}</div>
          : <p className="text-body-sm text-amber-800">Esta furgoneta no tiene equipo con técnicos: asígnalos en Equipos y técnicos.</p>}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Qué devuelve</h3>
          <button onClick={() => setEscaner(!escaner)} className={`${BTN_S} h-11 px-3`}><Icon n="qr_code_scanner" className="ico-20" />{escaner ? 'Cerrar escáner' : 'Escanear'}</button></div>
        {escaner && <Escaner onLeer={leer} manual={manual} setManual={setManual} />}
        {aBordo.length > 0 && <div><div className={`${LBL} mb-1`}>Consta a bordo (toca para añadir)</div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">{aBordo.map(x => { const p = find(E, x.sku)!, v = vistaUnidades(p, x.unidades); return (
            <button key={x.sku} type="button" onClick={() => anadir(x.sku)} className="shrink-0 w-36 text-left rounded-xl bg-surface-container-low p-2 flex flex-col gap-1">
              <Tile p={p} size="w-10 h-10" /><span className="text-label-sm font-medium line-clamp-2">{p.name}</span><span className="text-label-sm font-semibold">{v.principal}</span>{v.secundario && <span className="text-[10px] text-secondary">{v.secundario}</span>}</button>); })}</div></div>}
        <SelectorArticulo valor={null} onChange={s => s && anadir(s)} placeholder="Buscar otro artículo (también si no consta a bordo)…" />
        {filas.map(f => { const p = find(E, f.sku)!, u = toNum(f.unidades), hay = unidadesABordo(E, vehiculo, f.sku); return (
          <div key={f.id} className={`rounded-xl p-3 flex flex-col gap-2 ${f.estado === 'defectuoso' ? 'bg-error-container/40' : 'bg-surface-container-low'}`}>
            <div className="flex items-start gap-2"><Tile p={p} size="w-10 h-10" />
              <div className="flex-1 min-w-0"><div className="font-medium truncate">{p.name}</div>
                <div className="font-mono text-label-sm text-secondary">{p.sku} · a bordo {qtyTxt(p, hay / (p.contenido || 1)).split(' · ')[0]}</div></div>
              <button onClick={() => setFilas(fs => fs.filter(x => x.id !== f.id))} className="h-10 w-10 shrink-0 text-secondary" aria-label={`Quitar ${p.name}`}><Icon n="close" className="ico-20" /></button></div>
            <div className="flex flex-wrap items-center gap-2">
              <input value={f.unidades} onChange={e => set(f.id, { unidades: e.target.value })} inputMode="decimal" placeholder="0" className={`${INP} h-12 !w-24 text-center font-mono`} aria-label={`Cantidad de ${p.name} en ${ucDe(p)}`} />
              <span className="text-body-sm">{ucDe(p)}{u > 0 && vistaUnidades(p, u).secundario ? <span className="text-secondary"> · {vistaUnidades(p, u).secundario}</span> : ''}</span>
              <span className="flex-1" />
              <div className="flex rounded-lg overflow-hidden border border-outline-variant" role="group" aria-label="Estado">
                {(['bien', 'defectuoso'] as const).map(s => <button key={s} type="button" onClick={() => set(f.id, { estado: s })} className={`h-11 px-3 text-body-sm font-semibold ${f.estado === s ? (s === 'bien' ? 'bg-tertiary text-white' : 'bg-error text-white') : 'bg-white'}`}>{s === 'bien' ? 'Bien' : 'Defectuoso'}</button>)}</div>
            </div>
            {f.estado === 'defectuoso' && <><input value={f.motivoDefecto} onChange={e => set(f.id, { motivoDefecto: e.target.value })} placeholder="¿Qué le pasa? (p. ej. cubierta dañada)" className={`${INP} h-12`} aria-label="Motivo del defecto" />
              <p className="text-label-sm text-error">No vuelve al stock útil: queda como merma{esCustodia(p) ? ' e incidencia del socio' : ''}.</p></>}
          </div>); })}
        {avisos.map(a => <p key={a} className="text-body-sm text-amber-800">{a}</p>)}
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Campo label="Motivo"><select value={d.motivo} onChange={e => setD({ ...d, motivo: e.target.value as Devolucion['motivo'] })} className={`${INP} h-12`}>
          {Object.entries(MOTIVO_DEVOLUCION).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Campo>
        <Campo label={d.motivo === 'otro' ? 'Explica el motivo *' : 'Detalle (opcional)'}><input value={d.motivoTexto} onChange={e => setD({ ...d, motivoTexto: e.target.value })} className={`${INP} h-12`} /></Campo>
        <Campo label="Obra (n.º de instalación, opcional)"><input value={d.obra} onChange={e => setD({ ...d, obra: e.target.value })} placeholder="E26…" className={`${INP} h-12`} /></Campo>
        <div className="text-body-sm self-end pb-3">Recibe en el almacén: <b>{E.operator}</b></div>
      </section>
      <section className="flex flex-col gap-2"><div className="flex items-center justify-between"><h3 className="font-semibold">Firma de {tecs.find(t => t.id === tecnico)?.nombre || 'quien devuelve'}</h3>
        {trazos.length > 0 && <button onClick={() => setTrazos([])} className="text-primary text-body-sm font-semibold h-10">Borrar</button>}</div>
        <Firma trazos={trazos} onChange={setTrazos} /></section>
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-14 px-5`}>Cancelar</button>
      <button onClick={guardar} className={`${BTN_P} h-14 flex-1`}><Icon n="draw" className="ico-20" />Firmar y registrar la devolución</button></SheetFoot>
  </>);
}

function Escaner({ onLeer, manual, setManual }: { onLeer: (c: string) => void; manual: string; setManual: (v: string) => void }) {
  const { video, estado } = useCamara(true, onLeer, { pausarConModal: false, repetirMs: 1500 });
  return (<div className="flex flex-col gap-2">
    <div className="relative rounded-xl overflow-hidden bg-[#0b1c30] h-48"><video ref={video} playsInline muted className="w-full h-full object-cover" />
      {!estado.on && <p className="absolute inset-0 grid place-items-center text-white/80 text-body-sm text-center p-4">{estado.msg || 'Abriendo la cámara…'}</p>}</div>
    <form onSubmit={e => { e.preventDefault(); if (manual.trim()) { onLeer(manual.trim()); setManual(''); } }} className="flex gap-2">
      <input value={manual} onChange={e => setManual(e.target.value)} className={`${INP} h-12 font-mono`} placeholder="O escribe o pega un código" aria-label="Código manual" />
      <button className={`${BTN_S} h-12 px-4`}>Añadir</button></form>
  </div>);
}

function VerDevolucion({ id, recien = false }: { id: string; recien?: boolean }) {
  const E = useAlmacen(), perm = usePermisos(), d = (E.devoluciones || []).find(x => x.id === id);
  if (!d) return <SheetHead title="Devolución no encontrada" />;
  const tec = E.tecnicos.find(t => t.id === d.tecnico)?.nombre;
  const anular = () => {
    const motivo = prompt(`¿Por qué se anula la devolución ${numDevolucion(d)}? El material vuelve a ${nombreVehiculo(E, d.vehiculo)} con movimientos inversos.`);
    if (motivo === null) return;
    if (!motivo.trim()) return toast('Indica el motivo de la anulación.', 'err');
    if (ejecutar({ op: 'anularDevolucion', args: { id: d.id, motivo } })) toast(`Devolución ${numDevolucion(d)} anulada.`, 'ok', 6000);
  };
  return (<>
    <SheetHead title={`Devolución ${numDevolucion(d)}`} sub={`${nombreVehiculo(E, d.vehiculo)} · ${fechaHora(d.ts)}${recien ? ' · registrada' : ''}`} />
    <div className="p-5 flex flex-col gap-3">
      {d.estado === 'anulada' && <p className="bg-error-container text-error rounded-lg p-3 text-body-sm font-semibold">Anulada{d.anuladaPor ? ` por ${d.anuladaPor}` : ''}{d.anuladaTs ? ` el ${fechaHora(d.anuladaTs)}` : ''}: {d.anulacionMotivo}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-body-sm">
        {([['Devuelve', tec || 'Técnico del equipo'], ['Recibe en el almacén', d.operator], ['Motivo', `${MOTIVO_DEVOLUCION[d.motivo]}${d.motivoTexto ? ` · ${d.motivoTexto}` : ''}`], ['Obra', d.obra || '—']] as const)
          .map(([k, v]) => <div key={k} className="bg-surface-container-low rounded-lg p-2.5"><div className={LBL}>{k}</div><div className="font-medium break-words">{v}</div></div>)}
      </div>
      <div>{d.lineas.map((l, i) => { const p = find(E, l.sku); return <div key={i} className="flex justify-between gap-2 py-1.5 border-b border-surface-container text-body-sm">
        <span className="min-w-0"><span className="block truncate">{l.nombre}</span><span className="font-mono text-label-sm text-secondary">{l.sku}</span>{l.estado === 'defectuoso' && <Tag c="bg-error-container text-error ml-1">defectuoso{l.motivoDefecto ? `: ${l.motivoDefecto}` : ''}</Tag>}</span>
        <b className="text-right">{p ? qtyTxt(p, l.cantidad) : l.unidades}</b></div>; })}</div>
      {d.firma && <div><div className={LBL}>Firma de {tec || 'quien devuelve'}</div><FirmaImg f={d.firma} className="h-24 w-64" /></div>}
      <p className="font-mono text-label-sm text-secondary break-all">Huella: {d.hash || 'se calcula al sincronizar'}</p>
    </div>
    <SheetFoot className="grid grid-cols-2 gap-2">
      <button onClick={() => void compartirDevolucion(d)} className={`${BTN_P} h-12`}><Icon n="share" className="ico-20" />Compartir PDF</button>
      <button onClick={() => void descargarDevolucion(d)} className={`${BTN_S} h-12`}><Icon n="file_download" className="ico-20" />Descargar</button>
      {perm.admin && d.estado === 'firmada' && <button onClick={anular} className={`${BTN_S} h-12 col-span-2 !text-error`}><Icon n="undo" className="ico-20" />Anular la devolución</button>}
    </SheetFoot>
  </>);
}

/** E-041 · En Custodia (y en lo que ve el socio): las devoluciones que llevan material de ese socio, solo sus líneas */
export function DevolucionesSocio({ socio }: { socio: string }) {
  const E = useAlmacen(), nombre = E.propietarios.find(o => o.id === socio)?.nombre || socio;
  const suyo = (sku: string) => { const p = find(E, sku); return !!p && esCustodia(p) && p.propietario === socio; };
  const lista = (E.devoluciones || []).filter(d => d.lineas.some(l => suyo(l.sku))).slice(0, 20);
  if (!lista.length) return null;
  return (<section className="rounded-2xl bg-surface-container-lowest shadow-sm p-4 flex flex-col gap-2"><h2 className="text-headline-sm font-semibold">Devoluciones de furgonetas con material de {nombre}</h2>
    {lista.map(d => { const ls = d.lineas.filter(l => suyo(l.sku)); return <button key={d.id} onClick={() => abrirVerDevolucion(d.id)} className="flex flex-wrap justify-between items-center gap-2 py-2 border-b border-surface-container text-left">
      <span><b className="font-mono">{numDevolucion(d)}</b> · {nombreVehiculo(E, d.vehiculo)} {d.estado === 'anulada' && <Tag c="bg-error-container text-error">anulada</Tag>}</span>
      <span className="text-body-sm text-secondary">{fechaHora(d.ts)} · {ls.map(l => `${l.nombre}${l.estado === 'defectuoso' ? ' (defectuoso)' : ''}`).join(', ')}</span></button>; })}
  </section>);
}
