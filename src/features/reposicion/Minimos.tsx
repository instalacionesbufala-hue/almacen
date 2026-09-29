/* E-006 · Mínimos y objetivos (solo administrador): uno a uno o en bloque, por ejemplo "todas las fijaciones del pasillo P03" */
import { useMemo, useState } from 'react';
import { CATS, UNIT } from '../../data/catalogo';
import { aisles, pedidoSugerido, searchProducts } from '../../domain/reglas';
import { num, toNum } from '../../domain/formato';
import { ejecutar, useAlmacen } from '../../store/almacen';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, Campo, Icon, INP, LBL, Pill } from '../../ui/base';

export const abrirMinimos = () => openModal(<Minimos />, { ancha: true });
function Minimos() {
  const E = useAlmacen();
  const [f, setF] = useState({ cat: 'all', pas: 'all', prop: 'all', q: '' });
  const [cambios, setCambios] = useState<Record<string, { minimo?: string; objetivo?: string; proveedor?: string }>>({});
  const [bloque, setBloque] = useState({ minimo: '', objetivo: '', proveedor: '' });
  const lista = useMemo(() => searchProducts(E, f.q, f).sort((a, b) => a.loc.localeCompare(b.loc)), [E, f]);
  const set = (sku: string, k: 'minimo' | 'objetivo' | 'proveedor', v: string) => setCambios({ ...cambios, [sku]: { ...cambios[sku], [k]: v } });
  const aplicarBloque = () => {
    const nuevo = { ...cambios };
    for (const p of lista) nuevo[p.sku] = { ...nuevo[p.sku], ...(bloque.minimo !== '' ? { minimo: bloque.minimo } : {}), ...(bloque.objetivo !== '' ? { objetivo: bloque.objetivo } : {}), ...(bloque.proveedor !== '' ? { proveedor: bloque.proveedor } : {}) };
    setCambios(nuevo); toast(`Aplicado a ${lista.length} referencias. Revisa y pulsa Guardar.`, 'ok');
  };
  const guardar = () => {
    const lote = Object.entries(cambios).map(([sku, c]) => { const p = E.products.find(x => x.sku === sku)!;
      return { sku, minimo: c.minimo !== undefined ? toNum(c.minimo) : p.min, ...(c.objetivo !== undefined ? { objetivo: c.objetivo.trim() === '' ? null : toNum(c.objetivo) } : {}), ...(c.proveedor !== undefined ? { proveedorHabitual: c.proveedor } : {}) }; });
    if (!lote.length) return closeModal();
    if (ejecutar({ op: 'minimos', args: { cambios: lote } })) { closeModal(); toast(`Mínimos guardados en ${lote.length} referencia${lote.length === 1 ? '' : 's'}. Si alguna queda bajo el nuevo mínimo, se crea su aviso.`, 'ok', 6000); }
  };
  return (<>
    <SheetHead title="Mínimos y objetivos" sub="El aviso salta al bajar del mínimo; se pide hasta el objetivo (por defecto 2 × mínimo), redondeado al formato de compra." />
    <div className="p-5 flex flex-col gap-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <input value={f.q} onChange={e => setF({ ...f, q: e.target.value })} placeholder="Buscar" className={`${INP} h-11`} aria-label="Buscar" />
        <select value={f.cat} onChange={e => setF({ ...f, cat: e.target.value })} className={`${INP} h-11`} aria-label="Categoría"><option value="all">Todas las categorías</option>{Object.entries(CATS).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select>
        <select value={f.pas} onChange={e => setF({ ...f, pas: e.target.value })} className={`${INP} h-11`} aria-label="Pasillo"><option value="all">Todos los pasillos</option>{aisles(E).map(a => <option key={a} value={a}>Pasillo {a.replace('P', '')}</option>)}</select>
        <select value={f.prop} onChange={e => setF({ ...f, prop: e.target.value })} className={`${INP} h-11`} aria-label="Propiedad"><option value="all">Propio y custodia</option><option value="propia">Material propio</option><option value="custodia">En custodia</option></select>
      </div>
      <div className="rounded-xl bg-primary-fixed/40 p-3 flex flex-wrap items-end gap-2">
        <span className={`${LBL} w-full`}>En bloque para las {lista.length} referencias filtradas</span>
        <Campo label="Mínimo"><input value={bloque.minimo} onChange={e => setBloque({ ...bloque, minimo: e.target.value })} inputMode="decimal" className={`${INP} h-11 !w-28`} /></Campo>
        <Campo label="Objetivo"><input value={bloque.objetivo} onChange={e => setBloque({ ...bloque, objetivo: e.target.value })} inputMode="decimal" className={`${INP} h-11 !w-28`} /></Campo>
        <Campo label="Proveedor habitual"><input value={bloque.proveedor} onChange={e => setBloque({ ...bloque, proveedor: e.target.value })} className={`${INP} h-11 !w-48`} /></Campo>
        <button onClick={aplicarBloque} className={`${BTN_S} h-11 px-4`}>Aplicar a todas</button>
      </div>
      <div className="overflow-x-auto"><table className="tabla w-full min-w-[720px]"><thead><tr><th>Referencia</th><th>Stock</th><th>Mínimo</th><th>Objetivo</th><th>Proveedor habitual</th><th>Pediría</th></tr></thead>
        <tbody>{lista.map(p => { const c = cambios[p.sku] || {}; const min = c.minimo !== undefined ? toNum(c.minimo) : p.min, obj = c.objetivo !== undefined ? (c.objetivo === '' ? undefined : toNum(c.objetivo)) : p.objetivo;
          return <tr key={p.sku}><td><div className="font-medium">{p.name}</div><div className="font-mono text-label-sm text-secondary">{p.sku} · {p.loc}</div></td>
            <td className="whitespace-nowrap">{num(p.stock)} {UNIT[p.unit]} <Pill p={{ stock: p.stock, min }} short /></td>
            <td><input value={c.minimo ?? String(p.min)} onChange={e => set(p.sku, 'minimo', e.target.value)} inputMode="decimal" className={`${INP} h-10 !w-24 text-center font-mono`} aria-label={`Mínimo de ${p.name}`} /></td>
            <td><input value={c.objetivo ?? (p.objetivo != null ? String(p.objetivo) : '')} onChange={e => set(p.sku, 'objetivo', e.target.value)} placeholder={num(min * 2)} inputMode="decimal" className={`${INP} h-10 !w-24 text-center font-mono`} aria-label={`Objetivo de ${p.name}`} /></td>
            <td><input value={c.proveedor ?? (p.proveedorHabitual || '')} onChange={e => set(p.sku, 'proveedor', e.target.value)} placeholder={p.supplier} className={`${INP} h-10`} aria-label={`Proveedor habitual de ${p.name}`} /></td>
            <td className="font-mono text-label-md whitespace-nowrap">{p.stock < min ? `${num(pedidoSugerido({ ...p, min, objetivo: obj }))} ${UNIT[p.unit]}` : '—'}</td></tr>; })}</tbody></table></div>
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Cancelar</button><button onClick={guardar} className={`${BTN_P} h-12 flex-1`}><Icon n="save" className="ico-20" />Guardar {Object.keys(cambios).length || ''} cambio{Object.keys(cambios).length === 1 ? '' : 's'}</button></SheetFoot>
  </>);
}
