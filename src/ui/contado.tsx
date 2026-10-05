/* E-031 · Campo "contado" de un recuento: en un formato en metros (rollo de 50 m) se cuentan rollos enteros y metros sueltos
   ("2 rollos y 15 m" = 2,3 rollos); en los demás, una sola cifra. Los valores van en un Record<string, string> por SKU. */
import type { Producto } from '../data/tipos';
import { deMixto, enMetros } from '../domain/formatos';
import { num, toNum } from '../domain/formato';
import { unidadTxt } from '../domain/reglas';
import { INP } from './base';

const M = (sku: string) => `${sku}|m`;
/** Lo contado de cada artículo, en formatos (solo los que tienen algo escrito) */
export function lineasContadas(vals: Record<string, string>, find: (sku: string) => Producto | undefined) {
  const skus = [...new Set(Object.keys(vals).map(k => k.replace(/\|m$/, '')))];
  return skus.filter(sku => (vals[sku] ?? '').trim() !== '' || (vals[M(sku)] ?? '').trim() !== '').flatMap(sku => {
    const p = find(sku); if (!p) return [];
    const f = (vals[sku] ?? '').trim() === '' ? 0 : toNum(vals[sku]), m = (vals[M(sku)] ?? '').trim() === '' ? 0 : toNum(vals[M(sku)]);
    return [{ sku, contado: enMetros(p) ? deMixto(p, f, m) : f }];
  });
}

export function Contado({ p, vals, setVals, placeholder, ancho = '!w-28' }: { p: Producto; vals: Record<string, string>; setVals: (v: Record<string, string>) => void; placeholder: number; ancho?: string }) {
  if (!enMetros(p)) return <input value={vals[p.sku] ?? ''} onChange={e => setVals({ ...vals, [p.sku]: e.target.value })} inputMode="decimal" placeholder={num(placeholder)}
    className={`${INP} ${ancho} h-12 text-center font-mono`} aria-label={`Cantidad contada de ${p.name}`} />;
  return (<div className="flex items-center gap-1 shrink-0">
    <input value={vals[p.sku] ?? ''} onChange={e => setVals({ ...vals, [p.sku]: e.target.value })} inputMode="numeric" placeholder={num(Math.floor(Math.max(0, placeholder)))}
      className={`${INP} !w-16 h-12 text-center font-mono`} aria-label={`${unidadTxt(p.unit, 2)} enteros de ${p.name}`} />
    <span className="text-label-sm text-secondary">{unidadTxt(p.unit, 2)} +</span>
    <input value={vals[M(p.sku)] ?? ''} onChange={e => setVals({ ...vals, [M(p.sku)]: e.target.value })} inputMode="decimal" placeholder="0"
      className={`${INP} !w-16 h-12 text-center font-mono`} aria-label={`Metros sueltos de ${p.name}`} />
    <span className="text-label-sm text-secondary">m</span>
  </div>);
}
