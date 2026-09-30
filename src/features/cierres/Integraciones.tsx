/* E-012 · Configuración → Integraciones y cierres (administrador): token del Apps Script del wizard, equipos del wizard,
   apertura, kit de fijación por defecto, tabla de equivalencias (propuesta → confirmar), kits y carga del histórico. */
import { useRef, useState } from 'react';
import type { Equivalencia } from '../../data/tipos';
import { articulosTexto, cierresDeCsv, condicionesTexto, normalizarCierre, parseArticulos, parseCondiciones, traducirEnApp } from '../../domain/cierres';
import { fechaHora } from '../../domain/formato';
import { find, nombreVehiculo, vehiculoDeEquipo } from '../../domain/reglas';
import { ejecutar, S, useAlmacen } from '../../store/almacen';
import { modoNube, supabase, urlSupabase } from '../../store/nube/cliente';
import { recargar } from '../../store/nube/sync';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, Campo, Icon, INP, LBL, Tag } from '../../ui/base';

const EQUIPOS_WIZARD = ['Búfala 1', 'Búfala 2', 'Búfala 3'];
const URL_CIERRE = modoNube ? `${urlSupabase}/functions/v1/registrar-cierre` : '';
const URL_SCRIPT = 'https://github.com/instalacionesbufala-hue/almacen/blob/main/docs/apps-script-almacen.gs';
const FORMULA: Record<Equivalencia['formula'], string> = { directa: 'directa', manguitos: 'manguitos floor(m/3)+1', fijaciones: 'fijaciones ceil(m/0,5) × kit', unidad: '1 ud' };

export function Integraciones() {
  const E = useAlmacen(), archivo = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState('');
  const [conf, setConf] = useState({ kit: E.configApp.kitFijacion || 'A', apertura: E.configApp.aperturaCierres ? new Date(E.configApp.aperturaCierres).toISOString().slice(0, 10) : '' });
  const sinConfirmar = E.equivalencias.filter(r => !r.confirmada).length;
  const crearToken = async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc('crear_integracion', { p_nombre: 'Wizard de cierres' });
    if (error) return toast(error.message, 'err');
    setToken((data as { token: string }).token); void recargar();
  };
  const historico = async (f?: File) => {
    if (!f) return;
    const filas = cierresDeCsv(await f.text());
    if (!filas.length) return toast('El CSV no tiene cierres (cabeceras con numInst o esbrainUuid).', 'err');
    if (!confirm(`Se enviarán ${filas.length} cierres. Los anteriores a la apertura se ignoran y los repetidos no descuentan dos veces. ¿Seguir?`)) return;
    let ok = 0;
    for (const raw of filas) { const c = normalizarCierre(raw); if (ejecutar({ op: 'cierreHistorico', args: { cierre: c, lineas: traducirEnApp(S(), c) } })) ok++; }
    toast(`${ok} cierres enviados.`, 'ok', 6000);
  };
  return (<div className="flex flex-col gap-4">
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="flex flex-col gap-2">
        <span className={LBL}>Conexión con el wizard (Apps Script)</span>
        {!modoNube ? <p className="text-body-sm text-secondary">En la demostración no hay servidor: el token se crea en la versión con nube.</p> : <>
          {E.integraciones.map(i => <div key={i.id} className="flex flex-wrap items-center gap-2 text-body-sm bg-surface-container-low rounded-lg p-2">
            <span className="flex-1 min-w-0">{i.nombre} · creado {fechaHora(i.creado)}{i.ultimoUso ? ` · último cierre ${fechaHora(i.ultimoUso)}` : ' · sin uso'}</span>
            {i.revocado ? <Tag c="bg-error-container text-error">Revocado</Tag> : <button onClick={() => { if (confirm('¿Revocar este token? El wizard dejará de poder enviar cierres hasta que pongas uno nuevo.') && ejecutar({ op: 'revocarIntegracion', args: { id: i.id } })) toast('Token revocado.', 'ok'); }} className="text-error font-semibold h-10">Revocar</button>}
          </div>)}
          {token ? <div className="rounded-xl bg-primary-fixed/40 p-3 flex flex-col gap-2">
            <span className={LBL}>Pega esto en las Propiedades del script (se enseña una sola vez)</span>
            <label className="text-body-sm">ALMACEN_URL<input readOnly value={URL_CIERRE} onFocus={e => e.target.select()} className={`${INP} h-11 font-mono text-label-sm`} /></label>
            <label className="text-body-sm">ALMACEN_TOKEN<input readOnly value={token} onFocus={e => e.target.select()} className={`${INP} h-11 font-mono text-label-sm`} /></label>
            <button onClick={() => void navigator.clipboard?.writeText(token).then(() => toast('Token copiado.', 'ok'))} className={`${BTN_S} h-11 px-3 self-start`}><Icon n="content_copy" className="ico-18" />Copiar token</button>
          </div> : <button onClick={() => void crearToken()} className={`${BTN_S} h-12 self-start px-4`}><Icon n="key" className="ico-20" />Crear token para el wizard</button>}
          <p className="text-body-sm text-secondary">El fragmento para pegar en el Apps Script está en <a href={URL_SCRIPT} target="_blank" rel="noopener" className="text-primary underline">docs/apps-script-almacen.gs</a> (guía, paso 14). El token solo sirve para registrar cierres: no lee nada.</p>
        </>}
      </div>
      <div className="flex flex-col gap-2">
        <span className={LBL}>Equipos del wizard</span>
        {EQUIPOS_WIZARD.map(n => { const eq = E.equipos.find(e => e.nombre.trim().toLowerCase() === n.toLowerCase()), v = eq ? vehiculoDeEquipo(E, eq.id) : undefined;
          return <div key={n} className="flex items-center gap-2 text-body-sm"><b className="w-20">{n}</b>{!eq ? <span className="text-amber-800">No hay ningún equipo con ese nombre: créalo en Equipos</span> : v ? <span>→ {nombreVehiculo(E, v)}</span> : <span className="text-amber-800">→ equipo sin vehículo: sus cierres no descontarán</span>}</div>; })}
        <div className="grid grid-cols-2 gap-2 mt-2">
          <Campo label="Cierres desde (apertura)"><input type="date" value={conf.apertura} onChange={e => setConf({ ...conf, apertura: e.target.value })} className={`${INP} h-12`} /></Campo>
          <Campo label="Kit de fijación por defecto"><select value={conf.kit} onChange={e => setConf({ ...conf, kit: e.target.value as 'A' })} className={`${INP} h-12`}><option value="A">A · clip + clavo</option><option value="B">B · clip + tornillo + taco</option><option value="C">C · abrazadera + tirafondo + taco</option></select></Campo>
        </div>
        <button onClick={() => { if (ejecutar({ op: 'configCierres', args: { kit: conf.kit as 'A', apertura: conf.apertura ? Date.parse(conf.apertura) : undefined } })) toast('Guardado.', 'ok'); }} className={`${BTN_S} h-11 self-start px-4`}><Icon n="save" className="ico-18" />Guardar</button>
        <p className="text-body-sm text-secondary">Sin fecha, se ignoran los cierres anteriores al borrado de los datos de ejemplo.</p>
      </div>
    </div>

    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className={LBL}>Equivalencias: partidas del wizard → artículos ({E.equivalencias.length})</span>
        <div className="flex flex-wrap gap-2">
          {!E.equivalencias.length && <button onClick={() => { if (ejecutar({ op: 'cargarPropuesta', args: {} })) toast('Propuesta cargada como borrador: revísala y confírmala.', 'ok', 6000); }} className={`${BTN_P} h-11 px-4`}><Icon n="download" className="ico-18" />Cargar la propuesta</button>}
          {sinConfirmar > 0 && <button onClick={() => { if (confirm(`¿Confirmar ${sinConfirmar} reglas? A partir de ahora descontarán en los cierres.`) && ejecutar({ op: 'confirmarEquivalencias', args: {} })) toast('Equivalencias confirmadas.', 'ok'); }} className={`${BTN_P} h-11 px-4`}><Icon n="task_alt" className="ico-18" />Confirmar {sinConfirmar}</button>}
          <button onClick={() => abrirRegla()} className={`${BTN_S} h-11 px-4`}><Icon n="add" className="ico-18" />Regla</button>
        </div></div>
      {E.equivalencias.length > 0 && <div className="overflow-x-auto rounded-lg ring-1 ring-surface-container-high"><table className="w-full text-body-sm min-w-[640px]">
        <thead className="bg-surface-container-low"><tr className="text-left"><th className="p-2">Partida</th><th className="p-2">Condición</th><th className="p-2">Artículos</th><th className="p-2">Fórmula</th><th className="p-2" /></tr></thead>
        <tbody>{E.equivalencias.map(r => <tr key={r.id} className={`border-t border-surface-container align-top ${r.activa ? '' : 'opacity-50'}`}>
          <td className="p-2 font-mono">{r.campo}{!r.confirmada && <Tag c="bg-amber-100 text-amber-800 ml-1">borrador</Tag>}</td>
          <td className="p-2 font-mono text-label-sm">{condicionesTexto(r.condiciones) || '—'}</td>
          <td className="p-2">{r.formula === 'fijaciones' ? `kit ${r.kit || E.configApp.kitFijacion || 'A'}` : r.articulos.map((a, i) => { const p = a.sku ? find(E, a.sku) : undefined;
            return <div key={i} className={!a.sku || !p ? 'text-amber-800' : ''}>{a.sku ? `${a.sku}${p ? ` · ${p.name}` : ' · no está en el catálogo'}` : `${a.nombre || 'artículo'}: sin dar de alta`}{a.factor !== 1 ? ` ×${a.factor}` : ''}</div>; })}
            {r.nota && <div className="text-label-sm text-secondary">{r.nota}</div>}</td>
          <td className="p-2">{FORMULA[r.formula]}{r.estimada && <Tag c="bg-amber-100 text-amber-800 ml-1">estimado</Tag>}</td>
          <td className="p-2 whitespace-nowrap"><button onClick={() => abrirRegla(r)} className="text-primary font-semibold h-10 px-1">Editar</button>
            <button onClick={() => ejecutar({ op: 'equivalencia', args: { regla: { ...r, activa: !r.activa } } })} className="text-secondary font-semibold h-10 px-1">{r.activa ? 'Desactivar' : 'Activar'}</button></td>
        </tr>)}</tbody></table></div>}
      <p className="text-body-sm text-secondary">Las partidas sin regla (o con un artículo aún no dado de alta) quedan "sin equivalencia" y no descuentan hasta que se definan. El cable de datos con un cargador que no sea V2C ni Policharger, y los cargadores no reconocidos, van a la pestaña Cierres para elegir el artículo.</p>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="flex flex-col gap-2"><span className={LBL}>Kits de fijación (por fijación)</span>
        {(['A', 'B', 'C'] as const).map(k => <KitFila key={k} kit={k} />)}</div>
      <div className="flex flex-col gap-2"><span className={LBL}>Histórico</span>
        <p className="text-body-sm text-secondary">Lo más sencillo es ejecutar <b>cargarHistoricoAlAlmacen()</b> en el Apps Script (guía, paso 14). También puedes exportar la hoja "Registro" a CSV (cabeceras con los nombres de los campos: numInst, esbrainUuid, fechaCierreIso, equipo, hardware, metrosLinea, pvc32…) y cargarla aquí.</p>
        <button onClick={() => archivo.current?.click()} className={`${BTN_S} h-12 self-start px-4`}><Icon n="upload_file" className="ico-20" />Cargar histórico (CSV)</button>
        <input ref={archivo} type="file" accept=".csv,text/csv" className="hidden" onChange={e => { void historico(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
    </div>
  </div>);
}

function KitFila({ kit }: { kit: 'A' | 'B' | 'C' }) {
  const E = useAlmacen();
  const [t, setT] = useState(articulosTexto(E.kits[kit] || []));
  const guardar = () => { try { if (ejecutar({ op: 'kitFijacion', args: { kit, articulos: parseArticulos(t) } })) toast(`Kit ${kit} guardado.`, 'ok'); } catch (e) { toast((e as Error).message, 'err'); } };
  return <div className="flex gap-2 items-center"><b className="w-6">{kit}</b><input value={t} onChange={e => setT(e.target.value)} placeholder="SKU×1, SKU×1, ?clavo×1" className={`${INP} h-11 font-mono text-label-sm`} aria-label={`Kit ${kit}`} />
    <button onClick={guardar} className={`${BTN_S} h-11 px-3`}>Guardar</button></div>;
}

const abrirRegla = (r?: Equivalencia) => openModal(<FormRegla r={r} />);
function FormRegla({ r }: { r?: Equivalencia }) {
  const E = useAlmacen();
  const [f, setF] = useState({ campo: r?.campo || '', formula: r?.formula || 'directa', condiciones: r ? condicionesTexto(r.condiciones) : '', articulos: r ? articulosTexto(r.articulos) : '',
    kit: r?.kit || '', estimada: r?.estimada ?? false, orden: String(r?.orden ?? (Math.max(0, ...E.equivalencias.map(x => x.orden)) + 10)), nota: r?.nota || '' });
  const guardar = () => {
    try {
      const regla: Equivalencia = { id: r?.id || `R${Date.now().toString(36)}`, campo: f.campo.trim(), formula: f.formula as Equivalencia['formula'], condiciones: parseCondiciones(f.condiciones),
        articulos: f.formula === 'fijaciones' ? [] : parseArticulos(f.articulos), kit: f.formula === 'fijaciones' ? (f.kit || null) : null, estimada: f.estimada || f.formula === 'manguitos' || f.formula === 'fijaciones',
        activa: r?.activa ?? true, orden: Number(f.orden) || 100, nota: f.nota.trim(), confirmada: true };
      if (ejecutar({ op: 'equivalencia', args: { regla } })) { closeModal(); toast('Regla guardada.', 'ok'); }
    } catch (e) { toast((e as Error).message, 'err', 6000); }
  };
  return (<>
    <SheetHead title={r ? `Regla de ${r.campo}` : 'Nueva regla'} sub="Dentro de cada partida y fórmula se aplica la primera regla (por orden) que cumpla la condición." />
    <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Campo label="Partida del wizard (o suma: pvc32+acero32)"><input value={f.campo} onChange={e => setF({ ...f, campo: e.target.value })} className={`${INP} h-12 font-mono`} /></Campo>
      <Campo label="Fórmula"><select value={f.formula} onChange={e => setF({ ...f, formula: e.target.value as 'directa' })} className={`${INP} h-12`}>{Object.entries(FORMULA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
      <Campo label="Condición (campo=valor; campo~texto; a|b = uno u otro)" className="sm:col-span-2"><input value={f.condiciones} onChange={e => setF({ ...f, condiciones: e.target.value })} placeholder="tipoLinea=tubo; fase=mono; seccion=6" className={`${INP} h-12 font-mono`} /></Campo>
      {f.formula === 'fijaciones' ? <Campo label="Kit (vacío = el de por defecto)"><select value={f.kit} onChange={e => setF({ ...f, kit: e.target.value })} className={`${INP} h-12`}><option value="">Por defecto</option><option>A</option><option>B</option><option>C</option></select></Campo>
        : <Campo label="Artículos (SKU×unidades por unidad de la partida)" className="sm:col-span-2"><input value={f.articulos} onChange={e => setF({ ...f, articulos: e.target.value })} placeholder="6000650603×1, 6000650604×1" className={`${INP} h-12 font-mono`} /></Campo>}
      <Campo label="Orden"><input value={f.orden} onChange={e => setF({ ...f, orden: e.target.value })} inputMode="numeric" className={`${INP} h-12`} /></Campo>
      <label className="flex items-center gap-2 text-body-md"><input type="checkbox" checked={f.estimada} onChange={e => setF({ ...f, estimada: e.target.checked })} className="w-5 h-5 accent-primary" />Estimada (sale marcada en los informes)</label>
      <Campo label="Nota" className="sm:col-span-2"><input value={f.nota} onChange={e => setF({ ...f, nota: e.target.value })} className={`${INP} h-12`} /></Campo>
    </div>
    <SheetFoot><button onClick={guardar} className={`${BTN_P} h-12 w-full`}><Icon n="save" className="ico-20" />Guardar regla</button></SheetFoot>
  </>);
}
