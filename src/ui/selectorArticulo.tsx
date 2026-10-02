/* E-024 · Selector de artículos común: buscador (nombre, SKU, EAN y códigos alternativos), foto en miniatura,
   orden A-Z por defecto o "por referencia" (la app lo recuerda) y agrupado por categoría si se quiere.
   Se abre en línea (empuja el contenido, no flota), así no se corta dentro de las hojas ni en el móvil. */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { Producto } from '../data/tipos';
import { find, qtyTxt } from '../domain/reglas';
import { articulosParaSelector, gruposParaSelector, type OrdenSelector } from '../domain/selector';
import { useAlmacen } from '../store/almacen';
import { crearStore } from '../store/crear';
import { Icon, INP, Tile } from './base';

const LS = 'almacen-selector-articulos';
interface Pref { orden: OrdenSelector; agrupar: boolean }
const leer = (): Pref => { try { const x = JSON.parse(localStorage.getItem(LS) || '{}'); return { orden: x.orden === 'sku' ? 'sku' : 'nombre', agrupar: !!x.agrupar }; } catch { return { orden: 'nombre', agrupar: false }; } };
const pref = crearStore<Pref>(leer());
export const usePrefSelector = pref.use;
export function setPrefSelector(p: Partial<Pref>) {
  pref.set({ ...pref.get(), ...p });
  try { localStorage.setItem(LS, JSON.stringify(pref.get())); } catch { /* sin almacenamiento: vale para esta sesión */ }
}

/** Conmutador "A-Z / Por referencia" (y "Agrupar") para las listas de artículos que ya tienen su propio buscador */
export function OrdenArticulos({ agrupar = true }: { agrupar?: boolean }) {
  const p = usePrefSelector();
  const b = (o: OrdenSelector, t: string) => <button type="button" onClick={() => setPrefSelector({ orden: o })} aria-pressed={p.orden === o} className={`h-9 px-3 rounded-md text-body-sm font-semibold ${p.orden === o ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant'}`}>{t}</button>;
  return <div className="flex flex-wrap items-center gap-2">
    <div className="inline-flex bg-surface-container-low p-1 rounded-lg" role="group" aria-label="Orden de la lista">{b('nombre', 'A-Z')}{b('sku', 'Por referencia')}</div>
    {agrupar && <label className="inline-flex items-center gap-1.5 h-9 text-body-sm cursor-pointer"><input type="checkbox" checked={p.agrupar} onChange={e => setPrefSelector({ agrupar: e.target.checked })} className="w-5 h-5 accent-primary" />Por categoría</label>}
  </div>;
}

/** Lista ordenada (y agrupada si se pide) para pintar: [cabecera de grupo | artículo] */
export function useListaArticulos(q: string, o: { filtro?: (p: Producto) => boolean; borradores?: boolean; max?: number } = {}) {
  const E = useAlmacen(), p = usePrefSelector();
  return useMemo(() => {
    const todos = articulosParaSelector(E, q, { orden: p.orden, filtro: o.filtro, borradores: o.borradores });
    const lista = o.max ? todos.slice(0, o.max) : todos;
    return { lista, total: todos.length, grupos: p.agrupar ? gruposParaSelector(lista) : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [E, q, p.orden, p.agrupar, o.filtro, o.borradores, o.max]);
}

export function SelectorArticulo({ valor, onChange, filtro, vacio, placeholder = 'Elige el artículo…', ariaLabel = 'Artículo', borradores, className = '', alto = 'h-12' }: {
  valor: string | null; onChange: (sku: string | null) => void;
  /** Qué artículos se ofrecen (p. ej. todos menos el propio) */ filtro?: (p: Producto) => boolean;
  /** Si se da, se puede dejar sin artículo con este texto ("— Sin correspondencia —") */ vacio?: string;
  placeholder?: string; ariaLabel?: string; borradores?: boolean; className?: string; alto?: string;
}) {
  const E = useAlmacen();
  const [abierto, setAbierto] = useState(false), [q, setQ] = useState('');
  const raiz = useRef<HTMLDivElement>(null);
  const { lista, total, grupos } = useListaArticulos(q, { filtro, borradores, max: 200 });
  const p = valor ? find(E, valor) : undefined;
  const elegir = (sku: string | null) => { onChange(sku); setAbierto(false); setQ(''); };
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false); };
    addEventListener('pointerdown', fuera); return () => removeEventListener('pointerdown', fuera);
  }, [abierto]);
  const fila = (x: Producto) => <button type="button" key={x.sku} role="option" aria-selected={x.sku === valor} onClick={() => elegir(x.sku)}
    className={`w-full flex items-center gap-2 p-2 min-h-12 text-left hover:bg-surface-container-low ${x.sku === valor ? 'bg-primary-fixed/40' : ''}`}>
    <Tile p={x} size="w-9 h-9" /><span className="min-w-0 flex-1"><span className="block truncate">{x.name}</span><span className="font-mono text-label-sm text-secondary">{x.sku} · {qtyTxt(x, x.stock)}</span></span></button>;
  return (<div ref={raiz} className={`min-w-0 ${className}`} onKeyDown={e => { if (e.key === 'Escape') setAbierto(false); }}>
    <button type="button" onClick={() => setAbierto(a => !a)} aria-expanded={abierto} aria-label={ariaLabel} className={`${INP} ${alto} flex items-center gap-2 text-left w-full`}>
      {p ? <><Tile p={p} size="w-8 h-8" /><span className="truncate flex-1">{p.name} <span className="font-mono text-label-sm text-secondary">· {p.sku}</span></span></>
        : valor ? <span className="text-error truncate flex-1">{valor}: no está en el catálogo</span>
        : <span className="text-secondary truncate flex-1">{vacio || placeholder}</span>}
      <Icon n={abierto ? 'expand_less' : 'expand_more'} className="ico-20 text-secondary shrink-0" /></button>
    {abierto && <div className="mt-1 bg-surface-container-lowest rounded-xl shadow-lg ring-1 ring-surface-container-high flex flex-col">
      <div className="p-2 flex flex-col gap-2 border-b border-surface-container">
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} type="search" placeholder="Busca por nombre, SKU, EAN o código" className={`${INP} h-11`} aria-label="Buscar artículo" />
        <OrdenArticulos />
      </div>
      <div role="listbox" aria-label={ariaLabel} className="max-h-80 overflow-auto overscroll-contain">
        {vacio && <button type="button" onClick={() => elegir(null)} className="w-full p-2 min-h-11 text-left text-secondary hover:bg-surface-container-low">{vacio}</button>}
        {grupos ? grupos.map(g => <Fragment key={g.cat}><div className="sticky top-0 bg-surface-container-low px-2 py-1 font-mono text-label-sm text-primary">{g.label} · {g.items.length}</div>{g.items.map(fila)}</Fragment>) : lista.map(fila)}
        {!lista.length && <p className="p-3 text-body-sm text-secondary">Nada con ese texto.</p>}
        {total > lista.length && <p className="p-2 font-mono text-label-sm text-secondary">Mostrando {lista.length} de {total}: escribe para afinar.</p>}
      </div>
    </div>}
  </div>);
}
