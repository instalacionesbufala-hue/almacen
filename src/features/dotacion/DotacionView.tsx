/* Dotación: herramientas, EPIs y ropa de trabajo asignados a equipos y técnicos, con incidencias y reposiciones */
import { useState } from 'react';
import type { ClaseDotacion, Herramienta, TipoIncidencia } from '../../data/tipos';
import { avisosDotacion, caducidad, CLASE, ESTADO_HERR, herramienta, INCIDENCIA, incidenciasPosibles } from '../../domain/herramientas';
import { fechaHora, hace, hoyISO, norm, num, toNum, uid } from '../../domain/formato';
import { descargarCsv } from '../../domain/csv';
import { ejecutar, S, useAlmacen } from '../../store/almacen';
import { nuevoId } from '../../store/ops';
import { usePermisos } from '../../store/permisos';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, BTN_T, CARD, Campo, Icon, INP, Kpi, LBL, Tag, Vacio } from '../../ui/base';
import { abrirAltaCamara } from '../altaCamara/AltaCamara';

const quienTxt = (h: Herramienta) => {
  const E = S(), eq = E.equipos.find(e => e.id === h.equipo), t = E.tecnicos.find(x => x.id === h.tecnico);
  return [eq?.nombre, t?.nombre].filter(Boolean).join(' · ') || 'En almacén (sin asignar)';
};

function Caducidad({ h }: { h: Herramienta }) {
  const c = caducidad(h); if (c.estado === 'sin') return null;
  const txt = c.estado === 'vencido' ? `Vencido hace ${-c.dias} d` : c.estado === 'proximo' ? `Vence en ${c.dias} d` : `Revisión ${new Date(h.caduca + 'T00:00:00').toLocaleDateString('es-ES')}`;
  return <Tag c={c.estado === 'ok' ? 'bg-surface-container-high text-secondary' : c.estado === 'proximo' ? 'bg-amber-100 text-amber-800' : 'bg-error-container text-error'}>{txt}</Tag>;
}
const EstadoTag = ({ h }: { h: Herramienta }) => <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-label-sm uppercase whitespace-nowrap ${ESTADO_HERR[h.estado].c}`}><span className="w-1.5 h-1.5 rounded-full bg-current" />{ESTADO_HERR[h.estado].t}</span>;

export default function DotacionView() {
  const E = useAlmacen(), perm = usePermisos();
  const [clase, setClase] = useState<'all' | ClaseDotacion>('all'), [q, setQ] = useState(''), [quien, setQuien] = useState('all'), [soloAvisos, setSoloAvisos] = useState(false);
  const avisos = new Set(avisosDotacion(E).map(h => h.id));
  const toks = norm(q).split(/\s+/).filter(Boolean);
  const lista = E.herramientas.filter(h => (clase === 'all' || h.clase === clase) && (!soloAvisos || avisos.has(h.id))
    && (quien === 'all' || (quien === 'almacen' ? !h.equipo && !h.tecnico : quien.startsWith('T') ? h.tecnico === quien : h.equipo === quien))
    && (!toks.length || toks.every(t => norm([h.nombre, h.marca, h.serie, h.talla, quienTxt(h), CLASE[h.clase].t].join(' ')).includes(t))))
    .sort((a, b) => Number(b.estado !== 'baja') - Number(a.estado !== 'baja') || Number(avisos.has(b.id)) - Number(avisos.has(a.id)) || a.nombre.localeCompare(b.nombre));
  const activos = E.herramientas.filter(h => h.estado !== 'baja');
  const epiVenc = activos.filter(h => ['vencido', 'proximo'].includes(caducidad(h).estado)).length;
  const averias = activos.filter(h => h.estado !== 'operativa').length;
  const exportar = () => descargarCsv(`dotacion-${hoyISO()}.csv`, [['ID', 'Clase', 'Nombre', 'Marca/modelo', 'N.º serie/lote', 'Talla', 'Cantidad', 'Estado', 'Caducidad/revisión', 'Equipo', 'Técnico'],
    ...E.herramientas.map(h => [h.id, CLASE[h.clase].t, h.nombre, h.marca, h.serie, h.talla || '', h.cantidad, ESTADO_HERR[h.estado].t, h.caduca || '', E.equipos.find(e => e.id === h.equipo)?.nombre || '', E.tecnicos.find(t => t.id === h.tecnico)?.nombre || ''])]);
  const tab = (k: 'all' | ClaseDotacion, l: string, icon: string, n: number) =>
    <button key={k} onClick={() => setClase(k)} className={`shrink-0 flex items-center gap-2 px-4 h-11 rounded-lg font-semibold ${clase === k ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant'}`}><Icon n={icon} className="ico-20" />{l}<span className="font-mono text-label-sm px-1.5 rounded bg-surface-container-high">{n}</span></button>;
  return (
    <div className="px-4 lg:px-gutter py-4 lg:py-space-lg flex flex-col gap-4 lg:gap-space-lg max-w-[1600px]">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div><span className={LBL}>Herramientas · EPIs · ropa de trabajo</span><h1 className="text-headline-lg-mobile lg:text-headline-lg font-bold">Dotación de equipos y técnicos</h1></div>
        <div className="flex flex-wrap gap-2">{perm.exportar && <button onClick={exportar} className={`${BTN_S} px-4 h-11`}><Icon n="file_download" className="ico-20" />CSV</button>}{perm.mod('dotacion') && <button onClick={() => abrirAltaCamara({ origen: 'dotacion' })} className={`${BTN_P} px-4 h-14`}><Icon n="add_a_photo" className="ico-20" />Nuevo con la cámara</button>}{perm.gestionarDotacion && <button onClick={() => abrirAltaDotacion(clase === 'all' ? 'herramienta' : clase)} className={`${BTN_S} px-4 h-14`}><Icon n="add_circle" className="ico-20" />Nueva ficha</button>}</div>
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-space-md">
        <Kpi icon="inventory" iconC="bg-surface-container-low text-primary" badge={`${E.herramientas.length - activos.length} de baja`} badgeC="text-secondary bg-surface-container-high" value={activos.length} label="Fichas activas" foot="Asignadas" footVal={`${activos.filter(h => h.equipo || h.tecnico).length}`} bar={activos.filter(h => h.equipo || h.tecnico).length / (activos.length || 1) * 100} barC="bg-primary" onClick={() => setSoloAvisos(false)} />
        <Kpi icon="build" iconC="bg-error-container text-error" badge={averias ? 'Revisar' : 'Todo bien'} badgeC={averias ? 'bg-error-container text-error' : 'bg-tertiary-fixed/30 text-tertiary'} value={averias} valueC={averias ? 'text-error' : undefined} label="Rotas, perdidas o deterioradas" foot="Pendiente de reponer" footVal={`${activos.filter(h => h.estado === 'rota' || h.estado === 'perdida').length}`} footC="text-error" bar={averias / (activos.length || 1) * 100} barC="bg-error" onClick={() => setSoloAvisos(true)} />
        <Kpi icon="health_and_safety" iconC="bg-amber-100 text-amber-800" badge="30 días" badgeC="bg-amber-100 text-amber-800" value={epiVenc} valueC={epiVenc ? 'text-amber-800' : undefined} label="EPIs vencidos o por vencer" foot="EPIs activos" footVal={`${activos.filter(h => h.clase === 'epi').length}`} bar={epiVenc / (activos.filter(h => h.clase === 'epi').length || 1) * 100} barC="bg-amber-400" onClick={() => { setClase('epi'); setSoloAvisos(true); }} />
      </div>
      <div className="flex flex-col lg:flex-row gap-2">
        <div className="inline-flex bg-surface-container-low rounded-xl p-1 overflow-x-auto no-scrollbar">
          {tab('all', 'Todo', 'apps', E.herramientas.length)}{(Object.keys(CLASE) as ClaseDotacion[]).map(k => tab(k, CLASE[k].plural, CLASE[k].icon, E.herramientas.filter(h => h.clase === k).length))}</div>
        <div className="relative flex-1"><Icon n="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline ico-20" /><input value={q} onChange={e => setQ(e.target.value)} type="search" className={`${INP} pl-10 h-12`} placeholder="Nombre, marca, n.º de serie, talla…" /></div>
        <select value={quien} onChange={e => setQuien(e.target.value)} className={`${INP} lg:!w-60 h-12`} aria-label="Asignado a">
          <option value="all">Asignado a: todos</option><option value="almacen">En almacén (sin asignar)</option>
          <optgroup label="Equipos">{E.equipos.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}</optgroup>
          <optgroup label="Técnicos">{E.tecnicos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}</optgroup>
        </select>
        <label className="flex items-center gap-2 px-3 h-12 rounded-lg bg-surface-container-low whitespace-nowrap"><input type="checkbox" checked={soloAvisos} onChange={e => setSoloAvisos(e.target.checked)} className="w-5 h-5 accent-primary" />Solo avisos</label>
      </div>
      {perm.gestionarDotacion && (clase === 'all' || clase === 'herramienta') && <Repuestos />}
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">{lista.length ? lista.map(h => (
        <article key={h.id} className={`${CARD} p-4 flex flex-col gap-3 ${h.estado === 'baja' ? 'opacity-60' : ''} ${avisos.has(h.id) ? 'ring-1 ring-error/25' : ''}`}>
          <button onClick={() => abrirFichaDotacion(h.id)} className="flex gap-3 text-left">
            <span className={`w-12 h-12 shrink-0 rounded-xl grid place-items-center ${h.clase === 'epi' ? 'bg-amber-100 text-amber-800' : h.clase === 'ropa' ? 'bg-secondary-container text-secondary' : 'bg-primary-fixed text-primary'}`}><Icon n={CLASE[h.clase].icon} className="ico-28" /></span>
            <div className="flex-1 min-w-0"><div className="flex justify-between gap-2"><span className="font-mono text-label-sm text-secondary">{CLASE[h.clase].t.toUpperCase()} · {h.id}</span><EstadoTag h={h} /></div>
              <div className="font-semibold leading-snug">{h.nombre}{h.cantidad > 1 ? ` ×${h.cantidad}` : ''}</div>
              <div className="text-body-sm text-secondary truncate">{h.marca}{h.serie && ` · ${h.serie}`}{h.talla && ` · Talla ${h.talla}`}</div></div>
          </button>
          <div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1 text-body-sm"><Icon n="badge" className="ico-18 text-secondary" />{quienTxt(h)}</span><Caducidad h={h} /></div>
          {h.estado !== 'baja' && perm.mod('dotacion') && <div className={`grid gap-2 mt-auto ${perm.gestionarDotacion ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {perm.mod('dotacion') && <button onClick={() => abrirIncidencia(h.id)} className={`${BTN_T} h-12`}><Icon n="report" className="ico-20" />Incidencia</button>}
            {perm.gestionarDotacion && <button onClick={() => abrirAsignar(h.id)} className={`${BTN_S} h-12`}><Icon n="assignment_ind" className="ico-20" />Asignar</button>}</div>}
        </article>)) : <div className={`${CARD} md:col-span-2 2xl:col-span-3`}><Vacio>No hay fichas con esos filtros.</Vacio></div>}</div>
    </div>
  );
}

/* ---------- Ficha con historial ---------- */
export const abrirFichaDotacion = (id: string) => openModal(<FichaDotacion id={id} />);
function FichaDotacion({ id }: { id: string }) {
  const E = useAlmacen(), h = herramienta(E, id), { gestionarDotacion: gestionarFlota, mod } = usePermisos();
  if (!h) return <SheetHead title="Ficha no encontrada" />;
  const datos: [string, string][] = [['Clase', CLASE[h.clase].t], ['Marca / modelo', h.marca || '—'], ['N.º serie / lote', h.serie || '—'], ['Talla', h.talla || '—'], ['Cantidad', num(h.cantidad)], ['Caducidad / revisión', h.caduca ? new Date(h.caduca + 'T00:00:00').toLocaleDateString('es-ES') : '—']];
  return (<>
    <SheetHead title={h.nombre} sub={`${h.id} · ${quienTxt(h)}`} />
    <div className="p-5 flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 items-center"><EstadoTag h={h} /><Caducidad h={h} /></div>
      <div className="grid grid-cols-2 gap-2 text-body-sm">{datos.map(([k, v]) => <div key={k} className="bg-surface-container-low rounded-lg p-2.5"><div className={LBL}>{k}</div><div className="font-medium break-words">{v}</div></div>)}</div>
      <div><div className={`${LBL} mb-2`}>Historial</div>
        <ol className="flex flex-col gap-0">{[...h.historial].reverse().map(i => (
          <li key={i.id} className="flex gap-3 py-2 border-b border-surface-container last:border-0">
            <span className="w-9 h-9 rounded-lg bg-surface-container-low grid place-items-center shrink-0 text-primary"><Icon n={INCIDENCIA[i.tipo].icon} className="ico-20" /></span>
            <div className="flex-1 min-w-0"><div className="font-medium">{INCIDENCIA[i.tipo].t}</div>
              <div className="text-body-sm text-secondary">{i.nota}{i.serieAnterior ? ` · retirada la unidad ${i.serieAnterior}` : ''} · {i.operator}</div></div>
            <span className="font-mono text-label-sm text-secondary shrink-0" title={fechaHora(i.ts)}>{hace(i.ts)}</span>
          </li>))}</ol></div>
    </div>
    {h.estado !== 'baja' && mod('dotacion') && <SheetFoot className="grid grid-cols-2 gap-2">
      <button onClick={() => abrirIncidencia(h.id)} className={`${BTN_T} h-12`}><Icon n="report" className="ico-20" />Registrar incidencia</button>
      {gestionarFlota && <button onClick={() => abrirAsignar(h.id)} className={`${BTN_P} h-12`}><Icon n="assignment_ind" className="ico-20" />Asignar</button>}</SheetFoot>}
  </>);
}

/* ---------- Incidencia: deterioro, rotura, pérdida, reparación, reposición, baja ---------- */
export const abrirIncidencia = (id: string) => openModal(<Incidencia id={id} />);
function Incidencia({ id }: { id: string }) {
  const E = useAlmacen(), h = herramienta(E, id)!, { gestionarDotacion: gestionarFlota } = usePermisos();
  // el almacén registra roturas, pérdidas y deterioro; reparar, reponer y dar de baja es del administrador
  const posibles = incidenciasPosibles(h).filter(t => gestionarFlota || ['deterioro', 'rotura', 'perdida'].includes(t));
  const [tipo, setTipo] = useState<TipoIncidencia>(posibles[0]), [nota, setNota] = useState(''), [serie, setSerie] = useState(''), [caduca, setCaduca] = useState('');
  const guardarInc = () => {
    if (!ejecutar({ op: 'incidencia', args: { id: nuevoId(), dotacion: id, tipo, nota, serieNueva: serie || undefined, caducaNueva: caduca || undefined } })) return;
    closeModal(); toast(`${INCIDENCIA[tipo].t} registrada en ${h.nombre}.`, 'ok');
  };
  return (<>
    <SheetHead title="Registrar incidencia" sub={`${h.nombre} · ${ESTADO_HERR[h.estado].t}`} />
    <div className="p-5 flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{posibles.map(t =>
        <button key={t} onClick={() => setTipo(t)} className={`h-14 rounded-xl flex items-center justify-center gap-2 font-semibold ${tipo === t ? 'bg-primary text-white' : 'bg-surface-container-low'}`}><Icon n={INCIDENCIA[t].icon} className="ico-20" />{INCIDENCIA[t].t}</button>)}</div>
      <Campo label={tipo === 'perdida' ? '¿Dónde y cuándo se perdió?' : tipo === 'reposicion' ? 'Motivo o proveedor' : 'Descripción'}><textarea value={nota} onChange={e => setNota(e.target.value)} rows={3} className={INP} placeholder={tipo === 'rotura' ? 'Portabrocas roto en obra C/ Eros 10' : ''} /></Campo>
      {tipo === 'reposicion' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo label="N.º de serie o lote de la unidad nueva"><input value={serie} onChange={e => setSerie(e.target.value)} className={`${INP} h-12 font-mono`} placeholder={h.serie || 'Opcional'} /></Campo>
        {h.clase === 'epi' && <Campo label="Nueva caducidad / revisión"><input type="date" value={caduca} onChange={e => setCaduca(e.target.value)} className={`${INP} h-12`} /></Campo>}</div>}
      {tipo === 'baja' && <p className="text-body-sm text-error">La ficha queda de baja y deja de estar asignada. Se conserva el historial.</p>}
    </div>
    <SheetFoot><button onClick={guardarInc} className={`${BTN_P} w-full h-14`}><Icon n="check_circle" className="ico-fill" />Registrar {INCIDENCIA[tipo].t.toLowerCase()}</button></SheetFoot>
  </>);
}

/* ---------- Asignar a equipo y/o técnico ---------- */
export const abrirAsignar = (id: string) => openModal(<Asignar id={id} />);
function Asignar({ id }: { id: string }) {
  const E = useAlmacen(), h = herramienta(E, id)!;
  const [eq, setEq] = useState(h.equipo || ''), [tec, setTec] = useState(h.tecnico || '');
  const tecs = eq ? E.tecnicos.filter(t => E.equipos.find(e => e.id === eq)?.tecnicos.includes(t.id)) : E.tecnicos;
  const ok = () => { if (ejecutar({ op: 'asignarDotacion', args: { id: nuevoId(), dotacion: id, equipo: eq || undefined, tecnico: tec || undefined } })) { closeModal(); toast(`${h.nombre}: ${quienTxt(h)}.`, 'ok'); } };
  return (<>
    <SheetHead title="Asignar" sub={h.nombre} />
    <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Campo label="Equipo"><select value={eq} onChange={e => { setEq(e.target.value); setTec(''); }} className={`${INP} h-12`}><option value="">— Ninguno —</option>{E.equipos.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></Campo>
      <Campo label="Técnico (opcional)"><select value={tec} onChange={e => setTec(e.target.value)} className={`${INP} h-12`}><option value="">— Todo el equipo —</option>{tecs.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></Campo>
      <p className="sm:col-span-2 text-body-sm text-secondary">Deja los dos vacíos para devolverla al almacén. Las herramientas suelen ir al equipo; los EPIs y la ropa, a cada técnico.</p>
    </div>
    <SheetFoot><button onClick={ok} className={`${BTN_P} w-full h-14`}><Icon n="assignment_ind" className="ico-fill" />Guardar asignación</button></SheetFoot>
  </>);
}

/* ---------- Alta ---------- */
export const abrirAltaDotacion = (clase: ClaseDotacion = 'herramienta', preset: { equipo?: string; tecnico?: string } = {}) => openModal(<Alta clase0={clase} preset={preset} />);
function Alta({ clase0, preset }: { clase0: ClaseDotacion; preset: { equipo?: string; tecnico?: string } }) {
  const E = useAlmacen();
  const [f, setF] = useState({ clase: clase0, nombre: '', marca: '', modelo: '', serie: '', talla: '', cantidad: '1', caduca: '', valor: '', equipo: preset.equipo || '', tecnico: preset.tecnico || '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const crear = () => {
    if (!f.nombre.trim()) return toast('Indica el nombre.', 'err');
    const cantidad = Math.max(1, Math.round(toNum(f.cantidad) || 1));
    const pref = f.clase === 'epi' ? 'E' : f.clase === 'ropa' ? 'R' : 'H';
    const h: Herramienta = { id: `${pref}${uid('').slice(-5).toUpperCase()}`, clase: f.clase as ClaseDotacion, nombre: f.nombre.trim(), marca: f.marca.trim(), modelo: f.clase === 'herramienta' ? (f.modelo.trim() || f.marca.trim() || undefined) : undefined, serie: f.serie.trim(), talla: f.talla.trim() || undefined, cantidad, caduca: f.caduca || undefined, valor: 0, estado: 'operativa',
      historial: [{ id: uid('I'), ts: Date.now(), tipo: 'alta', nota: 'Alta en la dotación', operator: E.operator }] };
    if (!ejecutar({ op: 'altaDotacion', args: h })) return;
    if (f.equipo || f.tecnico) ejecutar({ op: 'asignarDotacion', args: { id: nuevoId(), dotacion: h.id, equipo: f.equipo || undefined, tecnico: f.tecnico || undefined } });
    closeModal(); toast(`${CLASE[h.clase].t} dada de alta: ${h.nombre}.`, 'ok');
  };
  const tecs = f.equipo ? E.tecnicos.filter(t => E.equipos.find(e => e.id === f.equipo)?.tecnicos.includes(t.id)) : E.tecnicos;
  return (<>
    <SheetHead title="Nueva ficha de dotación" sub="Herramienta, EPI o prenda de trabajo" />
    <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="sm:col-span-2 grid grid-cols-3 bg-surface-container-low rounded-xl p-1">{(Object.keys(CLASE) as ClaseDotacion[]).map(k =>
        <button key={k} onClick={() => setF({ ...f, clase: k })} className={`h-12 rounded-lg font-semibold flex items-center justify-center gap-1.5 ${f.clase === k ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant'}`}><Icon n={CLASE[k].icon} className="ico-20" />{CLASE[k].t}</button>)}</div>
      <Campo label="Nombre *" className="sm:col-span-2"><input autoFocus value={f.nombre} onChange={set('nombre')} className={`${INP} h-12`} placeholder={f.clase === 'epi' ? 'Guantes dieléctricos clase 0' : f.clase === 'ropa' ? 'Pantalón de trabajo' : 'Pinza amperimétrica'} /></Campo>
      <Campo label="Marca / modelo"><input value={f.marca} onChange={set('marca')} className={`${INP} h-12`} /></Campo>
      {f.clase === 'herramienta' && <Campo label="Modelo (para contar repuestos)"><input value={f.modelo} onChange={set('modelo')} placeholder={f.marca || 'Hilti TE 30-A36'} className={`${INP} h-12`} /></Campo>}
      <Campo label="N.º de serie o lote"><input value={f.serie} onChange={set('serie')} className={`${INP} h-12 font-mono`} /></Campo>
      {f.clase !== 'herramienta' && <Campo label="Talla"><input value={f.talla} onChange={set('talla')} className={`${INP} h-12`} placeholder="M, 44, 9…" /></Campo>}
      {f.clase !== 'herramienta' && <Campo label="Cantidad"><input value={f.cantidad} onChange={set('cantidad')} inputMode="numeric" className={`${INP} h-12`} /></Campo>}
      {f.clase === 'epi' && <Campo label="Caducidad / próxima revisión"><input type="date" value={f.caduca} onChange={set('caduca')} className={`${INP} h-12`} /></Campo>}
      <Campo label="Equipo"><select value={f.equipo} onChange={e => setF({ ...f, equipo: e.target.value, tecnico: '' })} className={`${INP} h-12`}><option value="">— En almacén —</option>{E.equipos.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></Campo>
      <Campo label="Técnico"><select value={f.tecnico} onChange={set('tecnico')} className={`${INP} h-12`}><option value="">— Ninguno —</option>{tecs.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></Campo>
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Cancelar</button><button onClick={crear} className={`${BTN_P} h-12 flex-1`}><Icon n="save" className="ico-20" />Dar de alta</button></SheetFoot>
  </>);
}

/* ---------- E-006: herramientas de repuesto (mínimo de unidades operativas y sin asignar por modelo) ---------- */
function Repuestos() {
  const E = useAlmacen(), [abierto, setAbierto] = useState(false);
  const modelos = [...new Set(E.herramientas.filter(h => h.clase === 'herramienta' && h.modelo && h.estado !== 'baja').map(h => h.modelo!))].sort();
  const libres = (m: string) => E.herramientas.filter(h => h.clase === 'herramienta' && h.modelo === m && h.estado === 'operativa' && !h.equipo && !h.tecnico).length;
  const faltan = E.minimosHerramienta.filter(m => libres(m.modelo) < m.minimo);
  return (
    <section className={`${CARD} p-4 flex flex-col gap-2`}>
      <button onClick={() => setAbierto(!abierto)} className="flex items-center justify-between gap-2 text-left">
        <span className="font-semibold flex items-center gap-2"><Icon n="inventory" className="text-primary" />Herramientas de repuesto</span>
        <span className="text-body-sm text-secondary">{faltan.length ? <span className="text-error">{faltan.length} modelo{faltan.length === 1 ? '' : 's'} bajo mínimo</span> : 'Todo cubierto'} · {abierto ? 'Ocultar' : 'Ver'}</span></button>
      {abierto && <div className="flex flex-col">{modelos.map(m => { const def = E.minimosHerramienta.find(x => x.modelo === m); return (
        <div key={m} className="flex flex-wrap items-center gap-2 py-2 border-b border-surface-container">
          <span className="flex-1 min-w-[160px]"><b>{m}</b><span className="text-body-sm text-secondary"> · {libres(m)} libres de repuesto</span></span>
          <label className="flex items-center gap-1 text-body-sm">Mínimo<input type="number" min={0} defaultValue={def?.minimo ?? 0} onBlur={e => { const v = Number(e.target.value) || 0; if (v !== (def?.minimo ?? 0)) ejecutar({ op: 'minimoHerramienta', args: { modelo: m, minimo: v, proveedor: def?.proveedor || '' } }); }} className={`${INP} !w-20 h-10 text-center`} aria-label={`Mínimo de repuesto de ${m}`} /></label>
          <input defaultValue={def?.proveedor || ''} placeholder="Proveedor" onBlur={e => { if (def && e.target.value !== def.proveedor) ejecutar({ op: 'minimoHerramienta', args: { modelo: m, minimo: def.minimo, objetivo: def.objetivo, proveedor: e.target.value } }); }} className={`${INP} !w-44 h-10`} aria-label={`Proveedor de ${m}`} />
        </div>); })}{!modelos.length && <p className="text-body-sm text-secondary">Da de alta herramientas con su modelo para controlar los repuestos.</p>}</div>}
    </section>
  );
}
