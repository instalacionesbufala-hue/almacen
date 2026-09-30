/* E-016 · Configuración → Categorías (administrador): crear, renombrar, icono y color, reordenar y desactivar.
   Una categoría con artículos no se borra: se desactiva moviendo sus artículos a otra. */
import { useState } from 'react';
import { COLORES } from '../../data/catalogo';
import type { Categoria } from '../../data/tipos';
import { ejecutar, useAlmacen } from '../../store/almacen';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, Campo, Icon, INP, Tag } from '../../ui/base';

export function Categorias() {
  const E = useAlmacen();
  const lista = [...E.categorias].sort((a, b) => a.orden - b.orden);
  const mover = (c: Categoria, d: -1 | 1) => {
    const activas = lista, i = activas.findIndex(x => x.id === c.id), j = i + d;
    if (j < 0 || j >= activas.length) return;
    const otra = activas[j];
    ejecutar({ op: 'categoria', args: { cat: { ...c, orden: otra.orden } } });
    ejecutar({ op: 'categoria', args: { cat: { ...otra, orden: c.orden } } });
  };
  return (<div className="flex flex-col gap-2">
    {lista.map((c, i) => { const n = E.products.filter(p => p.cat === c.id).length, col = COLORES[c.color] || COLORES.gris; return (
      <div key={c.id} className={`flex flex-wrap items-center gap-3 rounded-xl p-2 ${c.activa ? 'bg-surface-container-low' : 'opacity-60'}`}>
        <span className={`w-10 h-10 rounded-lg grid place-items-center ${col.tile}`}><Icon n={c.icono} className="ico-20" /></span>
        <span className="flex-1 min-w-[140px]"><b>{c.nombre}</b> <span className="text-body-sm text-secondary">· {n} artículo{n === 1 ? '' : 's'}</span>{!c.activa && <Tag c="ml-1">desactivada</Tag>}</span>
        <button onClick={() => mover(c, -1)} disabled={i === 0} className="w-10 h-10 grid place-items-center rounded-lg hover:bg-surface-container disabled:opacity-30" aria-label="Subir"><Icon n="arrow_upward" className="ico-20" /></button>
        <button onClick={() => mover(c, 1)} disabled={i === lista.length - 1} className="w-10 h-10 grid place-items-center rounded-lg hover:bg-surface-container disabled:opacity-30" aria-label="Bajar"><Icon n="arrow_downward" className="ico-20" /></button>
        <button onClick={() => abrirCategoria(c)} className="text-primary font-semibold h-10 px-2">Editar</button>
        {c.activa ? <button onClick={() => abrirDesactivar(c)} className="text-error font-semibold h-10 px-2">Desactivar</button>
          : <button onClick={() => ejecutar({ op: 'categoria', args: { cat: { ...c, activa: true } } })} className="text-primary font-semibold h-10 px-2">Activar</button>}
      </div>); })}
    <button onClick={() => abrirCategoria()} className={`${BTN_S} h-12 self-start px-4`}><Icon n="add" className="ico-20" />Nueva categoría</button>
  </div>);
}

const abrirCategoria = (c?: Categoria) => openModal(<FormCategoria c={c} />);
function FormCategoria({ c }: { c?: Categoria }) {
  const E = useAlmacen();
  const [f, setF] = useState<Categoria>(c ?? { id: '', nombre: '', icono: 'category', color: 'gris', orden: Math.max(0, ...E.categorias.map(x => x.orden)) + 10, activa: true });
  const guardar = () => {
    const id = (c?.id || f.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30));
    if (!c && E.categorias.some(x => x.id === id)) return toast('Ya hay una categoría con ese nombre.', 'err');
    if (ejecutar({ op: 'categoria', args: { cat: { ...f, id, nombre: f.nombre.trim() } } })) { closeModal(); toast('Categoría guardada.', 'ok'); }
  };
  return (<>
    <SheetHead title={c ? `Editar ${c.nombre}` : 'Nueva categoría'} />
    <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Campo label="Nombre" className="sm:col-span-2"><input autoFocus value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} className={`${INP} h-12`} /></Campo>
      <Campo label="Icono (nombre de Material Symbols)"><div className="flex gap-2 items-center"><input value={f.icono} onChange={e => setF({ ...f, icono: e.target.value.trim() })} className={`${INP} h-12 font-mono`} /><Icon n={f.icono || 'category'} className="text-primary" /></div></Campo>
      <Campo label="Color"><select value={f.color} onChange={e => setF({ ...f, color: e.target.value })} className={`${INP} h-12`}>{Object.entries(COLORES).map(([k, v]) => <option key={k} value={k}>{v.nombre}</option>)}</select></Campo>
      <p className="sm:col-span-2 text-body-sm text-secondary">Ideas de icono: ev_charger, cable, straighten, hardware, electric_bolt, inventory_2, health_and_safety, apparel, construction, solar_power, lightbulb.</p>
    </div>
    <SheetFoot><button onClick={guardar} disabled={!f.nombre.trim()} className={`${BTN_P} h-12 w-full disabled:opacity-40`}><Icon n="save" className="ico-20" />Guardar</button></SheetFoot>
  </>);
}

const abrirDesactivar = (c: Categoria) => openModal(<Desactivar c={c} />);
function Desactivar({ c }: { c: Categoria }) {
  const E = useAlmacen(), n = E.products.filter(p => p.cat === c.id).length;
  const [a, setA] = useState('');
  const ok = () => { if (ejecutar({ op: 'desactivarCategoria', args: { id: c.id, moverA: a || undefined } })) { closeModal(); toast(`${c.nombre} desactivada${n ? `: ${n} artículos movidos` : ''}.`, 'ok'); } };
  return (<>
    <SheetHead title={`Desactivar ${c.nombre}`} sub="Deja de salir en filtros y formularios. No se borra nada." />
    <div className="p-5 flex flex-col gap-3">
      {n ? <Campo label={`Tiene ${n} artículo${n === 1 ? '' : 's'}: ¿a qué categoría pasan?`}><select value={a} onChange={e => setA(e.target.value)} className={`${INP} h-12`}><option value="">Elige la categoría</option>
        {E.categorias.filter(x => x.activa && x.id !== c.id).map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></Campo>
        : <p className="text-body-md">No tiene artículos.</p>}
    </div>
    <SheetFoot><button onClick={ok} disabled={!!n && !a} className={`${BTN_P} h-12 w-full disabled:opacity-40`}>Desactivar</button></SheetFoot>
  </>);
}
