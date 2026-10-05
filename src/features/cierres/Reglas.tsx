/* E-016 · Editor de equivalencias en la app: condiciones por filas (campo, operador, valor), artículos con buscador y foto,
   fórmula, kits de fijación, "Probar" (qué descontaría, sin aplicar nada) y "Recalcular cierres desde…". */
import { useState } from 'react';
import type { ArticuloRegla, Equivalencia, Unidad } from '../../data/tipos';
import { CAMPOS_MATERIAL, normalizarCierre, reglasVigentes, traducirCierre, type LineaTraducida } from '../../domain/cierres';
import { fechaHora, hoyISO, num, redondea, toNum } from '../../domain/formato';
import { contenidoDe, find, unidadTxt } from '../../domain/reglas';
import { ejecutar, S, useAlmacen } from '../../store/almacen';
import { modoNube, supabase } from '../../store/nube/cliente';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, Campo, Icon, INP, LBL, Tag } from '../../ui/base';
import { SelectorArticulo } from '../../ui/selectorArticulo';

export const FORMULAS: Record<Equivalencia['formula'], string> = { directa: 'Directa (valor × factor)', manguitos: 'Manguitos floor(m/3)+1', fijaciones: 'Fijaciones ceil(m/0,5) × kit', unidad: '1 ud (cargador)' };
/** Campos del cierre que suelen usarse en las condiciones (se puede escribir cualquier otro) */
const CAMPOS_COND = ['hardware', 'tipoLinea', 'fase', 'seccion', 'cableDatos', 'equipo', 'tipoInst'];
const VALORES: Record<string, string[]> = { tipoLinea: ['tubo', 'manguera'], fase: ['mono', 'trif'], seccion: ['6', '10', '16', '25'], cableDatos: ['UTP', 'FTP'] };

/* ---------- Lista de artículos de una regla o de un kit ---------- */
export function ArticulosEditor({ valor, onChange, etiquetaFactor = 'Cantidad' }: { valor: ArticuloRegla[]; onChange: (v: ArticuloRegla[]) => void; etiquetaFactor?: string }) {
  const set = (i: number, x: Partial<ArticuloRegla>) => onChange(valor.map((a, k) => (k === i ? { ...a, ...x } : a)));
  return (<div className="flex flex-col gap-2">
    {valor.map((a, i) => <div key={i} className="flex gap-2 items-start">
      {a.sku === null ? <input value={a.nombre || ''} onChange={e => set(i, { nombre: e.target.value })} placeholder="Artículo aún sin dar de alta (p. ej. clavo)" className={`${INP} h-12 flex-1`} />
        : <SelectorArticulo valor={a.sku || null} onChange={sku => set(i, { sku: sku || '' })} className="flex-1" />}
      <input value={String(a.factor)} onChange={e => set(i, { factor: toNum(e.target.value) || 0 })} inputMode="decimal" aria-label={etiquetaFactor} title={etiquetaFactor} className={`${INP} h-12 !w-20 text-right`} />
      <button type="button" onClick={() => onChange(valor.filter((_, k) => k !== i))} className="w-10 h-10 grid place-items-center text-secondary" aria-label="Quitar"><Icon n="close" className="ico-20" /></button>
    </div>)}
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => onChange([...valor, { sku: '', factor: 1 }])} className={`${BTN_S} h-10 px-3`}><Icon n="add" className="ico-18" />Artículo</button>
      <button type="button" onClick={() => onChange([...valor, { sku: null, factor: 1, nombre: '' }])} className={`${BTN_S} h-10 px-3`}><Icon n="add" className="ico-18" />Sin dar de alta</button>
    </div>
  </div>);
}

/* ---------- Condiciones por filas ---------- */
type FilaCond = { campo: string; op: '=' | '~'; valor: string };
const aFilas = (c: Equivalencia['condiciones']): FilaCond[] => Object.entries(c || {}).map(([k, v]) => ({ campo: k.replace(/~$/, ''), op: k.endsWith('~') ? '~' : '=', valor: (Array.isArray(v) ? v : [v]).join(' | ') }));
const deFilas = (f: FilaCond[]): Equivalencia['condiciones'] => Object.fromEntries(f.filter(x => x.campo.trim() && x.valor.trim()).map(x => {
  const vals = x.valor.split('|').map(v => v.trim()).filter(Boolean);
  return [x.op === '~' ? x.campo.trim() + '~' : x.campo.trim(), vals.length === 1 ? vals[0] : vals];
}));
function CondicionesEditor({ filas, onChange }: { filas: FilaCond[]; onChange: (f: FilaCond[]) => void }) {
  const set = (i: number, x: Partial<FilaCond>) => onChange(filas.map((a, k) => (k === i ? { ...a, ...x } : a)));
  return (<div className="flex flex-col gap-2">
    {!filas.length && <p className="text-body-sm text-secondary">Sin condiciones: se aplica a cualquier cierre.</p>}
    {filas.map((f, i) => <div key={i} className="grid grid-cols-[1fr_130px_1fr_auto] gap-2 items-center">
      <input list="campos-cierre" value={f.campo} onChange={e => set(i, { campo: e.target.value })} placeholder="campo" className={`${INP} h-12 font-mono`} aria-label="Campo del cierre" />
      <select value={f.op} onChange={e => set(i, { op: e.target.value as '=' | '~' })} className={`${INP} h-12`} aria-label="Operador"><option value="=">es igual a</option><option value="~">contiene</option></select>
      <input list={`valores-${f.campo}`} value={f.valor} onChange={e => set(i, { valor: e.target.value })} placeholder={f.op === '~' ? 'trydan&22 | v2c' : 'tubo'} className={`${INP} h-12 font-mono`} aria-label="Valor" />
      <button type="button" onClick={() => onChange(filas.filter((_, k) => k !== i))} className="w-10 h-10 grid place-items-center text-secondary" aria-label="Quitar condición"><Icon n="close" className="ico-20" /></button>
      <datalist id={`valores-${f.campo}`}>{(VALORES[f.campo] || []).map(v => <option key={v} value={v} />)}</datalist>
    </div>)}
    <datalist id="campos-cierre">{CAMPOS_COND.map(c => <option key={c} value={c} />)}</datalist>
    <button type="button" onClick={() => onChange([...filas, { campo: 'hardware', op: '~', valor: '' }])} className={`${BTN_S} h-10 px-3 self-start`}><Icon n="add" className="ico-18" />Condición</button>
    <p className="text-label-sm text-secondary">Varios valores separados por | (uno u otro). En "contiene", a&b = contiene los dos. Mayúsculas y acentos no cuentan.</p>
  </div>);
}

/* ---------- Formulario de una regla ---------- */
export const abrirRegla = (r?: Equivalencia, duplicar = false) => openModal(<FormRegla r={r} duplicar={duplicar} />, { ancha: true });
function FormRegla({ r, duplicar }: { r?: Equivalencia; duplicar: boolean }) {
  const E = useAlmacen();
  const [f, setF] = useState({ campo: r?.campo || '', formula: r?.formula || 'directa' as Equivalencia['formula'], articulos: r?.articulos || [], kit: r?.kit || '',
    estimada: r?.estimada ?? false, sinDescuento: (r?.sinDescuento || '') as '' | 'servicio' | 'no_gestionado', orden: String(duplicar ? (r?.orden ?? 0) + 1 : r?.orden ?? (Math.max(0, ...E.equivalencias.map(x => x.orden)) + 10)), nota: r?.nota || '' });
  const [conds, setConds] = useState<FilaCond[]>(aFilas(r?.condiciones || {}));
  const [versiones, setVersiones] = useState<{ ts: string; operario: string; version: Equivalencia }[] | null>(null);
  const guardar = () => {
    if (!f.campo.trim()) return toast('Indica la partida del wizard.', 'err');
    if (!f.sinDescuento && f.formula !== 'fijaciones' && f.articulos.some(a => a.sku === '')) return toast('Elige el artículo de cada línea (o quítala).', 'err');
    const regla: Equivalencia = { id: r && !duplicar ? r.id : `R${Date.now().toString(36)}`, campo: f.campo.trim(), formula: f.formula, condiciones: deFilas(conds),
      articulos: f.formula === 'fijaciones' || f.sinDescuento ? [] : f.articulos, kit: f.formula === 'fijaciones' && !f.sinDescuento ? (f.kit || null) : null, sinDescuento: f.sinDescuento || null,
      estimada: f.estimada || f.formula === 'manguitos' || f.formula === 'fijaciones', activa: r?.activa ?? true, orden: Number(f.orden) || 100, nota: f.nota.trim(),
      confirmada: r && !duplicar ? r.confirmada : false };
    if (ejecutar({ op: 'equivalencia', args: { regla } })) { closeModal(); toast(duplicar ? 'Regla duplicada como borrador.' : r?.confirmada ? 'Regla guardada (la versión anterior queda en el historial).' : 'Regla guardada.', 'ok'); }
  };
  const verVersiones = async () => {
    if (!supabase || !r) return setVersiones([]);
    const { data } = await supabase.from('equivalencias_historial').select('ts, operario, version').eq('regla_id', r.id).order('ts', { ascending: false });
    setVersiones((data || []) as never);
  };
  return (<>
    <SheetHead title={duplicar ? 'Duplicar regla' : r ? `Regla de ${r.campo}` : 'Nueva regla'} sub="Dentro de cada partida y fórmula se aplica la primera regla (por orden) que cumpla las condiciones." />
    <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="flex flex-col gap-3">
        <Campo label="Partida del wizard (o suma: pvc32+acero32; hardware para el cargador)"><input list="partidas" value={f.campo} onChange={e => setF({ ...f, campo: e.target.value })} className={`${INP} h-12 font-mono`} />
          <datalist id="partidas">{[...CAMPOS_MATERIAL, 'hardware', 'pvc32+acero32'].map(c => <option key={c} value={c} />)}</datalist></Campo>
        <Campo label="Fórmula"><select value={f.formula} onChange={e => setF({ ...f, formula: e.target.value as Equivalencia['formula'] })} className={`${INP} h-12`}>{Object.entries(FORMULAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
        <div><div className={`${LBL} mb-1`}>Condiciones</div><CondicionesEditor filas={conds} onChange={setConds} /></div>
      </div>
      <div className="flex flex-col gap-3">
        <Campo label="Qué descuenta"><select value={f.sinDescuento} onChange={e => setF({ ...f, sinDescuento: e.target.value as '' | 'servicio' | 'no_gestionado' })} className={`${INP} h-12`}>
          <option value="">Artículos del almacén</option><option value="servicio">No descuenta material (servicio: solo mano de obra)</option><option value="no_gestionado">Material no gestionado en el almacén (se cuenta, no descuenta)</option></select></Campo>
        {f.sinDescuento === 'servicio' && <p className="text-body-sm text-secondary">La partida no deja línea en el cierre ni queda pendiente.</p>}
        {f.sinDescuento === 'no_gestionado' && <p className="text-body-sm text-secondary">La partida lleva material que aún no está en el almacén: queda en el cierre y en los informes con su cantidad, sin descontar nada ni quedar pendiente. Cuando lo des de alta, cambia aquí a "Artículos del almacén" (los cierres anteriores no cambian salvo con "Recalcular cierres desde…").</p>}
        {f.sinDescuento ? null : f.formula === 'fijaciones' ? <Campo label="Kit de fijación (vacío = el de por defecto)"><select value={f.kit} onChange={e => setF({ ...f, kit: e.target.value })} className={`${INP} h-12`}><option value="">Por defecto ({E.configApp.kitFijacion || 'A'})</option><option>A</option><option>B</option><option>C</option></select></Campo>
          : <div><div className={`${LBL} mb-1`}>Artículos (cantidad en unidades del artículo por unidad de la partida: 1 m → 1 m)</div><ArticulosEditor valor={f.articulos} onChange={a => setF({ ...f, articulos: a })} /></div>}
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Orden"><input value={f.orden} onChange={e => setF({ ...f, orden: e.target.value })} inputMode="numeric" className={`${INP} h-12`} /></Campo>
          <label className="flex items-center gap-2 text-body-md mt-5"><input type="checkbox" checked={f.estimada} onChange={e => setF({ ...f, estimada: e.target.checked })} className="w-5 h-5 accent-primary" />Estimada</label>
        </div>
        <Campo label="Nota"><input value={f.nota} onChange={e => setF({ ...f, nota: e.target.value })} className={`${INP} h-12`} /></Campo>
        {r?.confirmada && !duplicar && modoNube && <div>{versiones === null ? <button onClick={() => void verVersiones()} className="text-primary text-body-sm font-semibold h-10">Ver versiones anteriores</button>
          : versiones.length ? versiones.map((v, i) => <div key={i} className="text-body-sm text-secondary border-b border-surface-container py-1">{fechaHora(Date.parse(v.ts))} · {v.operario}: {v.version.articulos?.map(a => `${a.sku ?? a.nombre}×${a.factor}`).join(', ') || v.version.formula}</div>)
            : <p className="text-body-sm text-secondary">Sin versiones anteriores.</p>}</div>}
      </div>
    </div>
    <SheetFoot><button onClick={guardar} className={`${BTN_P} h-12 w-full`}><Icon n="save" className="ico-20" />{duplicar ? 'Crear la copia (borrador)' : 'Guardar regla'}</button></SheetFoot>
  </>);
}

/* ---------- Probar: qué descontaría un cierre con las reglas actuales, sin aplicar nada ---------- */
async function datosDeCierre(id: string): Promise<Record<string, unknown> | null> {
  const local = S().cierres.find(c => c.id === id)?.datos; if (local) return local;
  if (!supabase) return null;
  const { data } = await supabase.from('cierres').select('datos').eq('id', id).single();
  return (data?.datos as Record<string, unknown>) ?? null;
}
const EJEMPLO = { numInst: 'PRUEBA', equipo: 'Búfala 1', hardware: 'V2C Trydan 7,4 kW', tipoLinea: 'tubo', fase: 'mono', seccion: '6', metrosLinea: 15, metrosUtp: 12, rj45: 2, pvc32: 4, corr32: 6, canaleta: 3, bornasMono: 1 };
export const abrirProbar = () => openModal(<Probar />, { ancha: true });
function Probar() {
  const E = useAlmacen();
  const [texto, setTexto] = useState(JSON.stringify(EJEMPLO, null, 1));
  const [borradores, setBorradores] = useState(true);
  const [res, setRes] = useState<LineaTraducida[] | null>(null);
  const probar = (datos?: Record<string, unknown>) => {
    let raw: Record<string, unknown>;
    try { raw = datos ?? JSON.parse(texto); } catch { return toast('El cierre de ejemplo no es JSON válido.', 'err'); }
    if (datos) setTexto(JSON.stringify(Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== '' && v !== 0 && v != null)), null, 1));
    const reglas = borradores ? E.equivalencias.filter(r => r.activa) : reglasVigentes(E);
    setRes(traducirCierre(normalizarCierre({ fechaCierreIso: new Date().toISOString(), ...raw }), reglas, E.kits, E.configApp.kitFijacion || 'A', new Set(E.products.map(p => p.sku))));
  };
  return (<>
    <SheetHead title="Probar las reglas" sub="Muestra qué descontaría un cierre. No aplica nada." />
    <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="flex flex-col gap-2">
        {E.cierres.length > 0 && <select defaultValue="" onChange={e => { if (e.target.value) void datosDeCierre(e.target.value).then(d => d ? probar(d) : toast('No se han podido leer los datos de ese cierre.', 'err')); }} className={`${INP} h-12`}>
          <option value="">Usar un cierre ya recibido…</option>{E.cierres.slice(0, 50).map(c => <option key={c.id} value={c.id}>{fechaHora(c.fecha)} · {c.numInst} · {c.equipoWizard}</option>)}</select>}
        <span className={LBL}>Cierre de ejemplo (campos del wizard)</span>
        <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={14} className={`${INP} font-mono text-label-sm`} aria-label="Cierre de ejemplo" />
        <label className="flex items-center gap-2 text-body-sm"><input type="checkbox" checked={borradores} onChange={e => setBorradores(e.target.checked)} className="w-5 h-5 accent-primary" />Incluir las reglas en borrador</label>
        <button onClick={() => probar()} className={`${BTN_P} h-12`}><Icon n="science" className="ico-20" />Probar</button>
      </div>
      <div className="flex flex-col gap-1">
        <span className={LBL}>Resultado</span>
        {!res ? <p className="text-body-sm text-secondary">Pulsa Probar.</p> : !res.length ? <p className="text-body-sm text-secondary">No descontaría nada (¿desplazamiento fallido o sin material?).</p>
          : res.map((l, i) => { const p = l.sku ? find(E, l.sku) : undefined; return <div key={i} className="flex justify-between gap-2 py-1.5 border-b border-surface-container text-body-sm">
            <span className="min-w-0"><span className="font-mono text-label-sm text-secondary">{l.campo}{l.formula !== 'directa' ? ` · ${l.formula}` : ''}</span><br />
              {p ? p.name : <span className={l.estado === 'pendiente' ? 'text-amber-800' : 'text-error'}>{l.estado === 'pendiente' ? 'Por elegir' : 'Sin equivalencia'}</span>}{l.estimada && <Tag c="bg-amber-100 text-amber-800 ml-1">estimado</Tag>}
              {l.nota && <span className="block text-label-sm text-secondary">{l.nota}</span>}</span>
            <b className="whitespace-nowrap">{p ? `${num(redondea(l.cantidad / contenidoDe(p)))} ${unidadTxt(p.unit as Unidad, l.cantidad / contenidoDe(p))}` : num(l.cantidad)}</b></div>; })}
      </div>
    </div>
  </>);
}

/* ---------- Recalcular los cierres desde una fecha con las reglas actuales ---------- */
export function Recalcular() {
  const E = useAlmacen();
  const [desde, setDesde] = useState(hoyISO()), [enCurso, setEnCurso] = useState(false);
  const recalcular = async () => {
    const lista = E.cierres.filter(c => c.fecha >= Date.parse(desde) && c.estado !== 'ignorado');
    if (!lista.length) return toast('No hay cierres desde esa fecha.', 'warn');
    if (!confirm(`¿Recalcular ${lista.length} cierres con las reglas confirmadas actuales? Solo se aplica la diferencia, con ajustes "Corrección de cierre".`)) return;
    setEnCurso(true);
    let n = 0;
    try {
      for (const c of lista) {
        const d = await datosDeCierre(c.id); if (!d) continue;
        const cierre = normalizarCierre(d);
        const lineas = traducirCierre(cierre, reglasVigentes(S()), S().kits, S().configApp.kitFijacion || 'A', new Set(S().products.filter(p => !p.borrador).map(p => p.sku)));
        if (ejecutar({ op: 'recalcularCierre', args: { id: c.id, lineas } })) n++;
      }
    } finally { setEnCurso(false); }
    toast(`${n} cierres recalculados.`, 'ok');
  };
  return (<div className="flex flex-wrap items-end gap-2">
    <Campo label="Recalcular cierres desde"><input type="date" value={desde} onChange={e => setDesde(e.target.value)} className={`${INP} h-12`} /></Campo>
    <button onClick={() => void recalcular()} disabled={enCurso} className={`${BTN_S} h-12 px-4`}><Icon n="restart_alt" className="ico-20" />{enCurso ? 'Recalculando…' : 'Recalcular'}</button>
    <p className="text-body-sm text-secondary w-full">Los cierres ya aplicados no cambian al editar una regla, salvo que lo pidas aquí. Las líneas que resolviste a mano se conservan.</p>
  </div>);
}
