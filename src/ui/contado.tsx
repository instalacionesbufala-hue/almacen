/* E-031 · Campo "contado" de un recuento: en un formato en metros (rollo de 50 m) se cuentan rollos enteros y metros sueltos
   ("2 rollos y 15 m" = 2,3 rollos); en los demás, una sola cifra. Los valores van en un Record<string, string> por SKU.
   E-036: en los vehículos, también los formatos en unidades ("1 caja y 250 ud"); se puede contar solo en la unidad base
   (0 cajas y 340 m) y debajo se ven las dos cifras ("= 340 m · ≈ 3,4 cajas de 100 m"). */
import type { Producto } from '../data/tipos';
import { deMixto, enMetros, ucDe } from '../domain/formatos';
import { num, toNum } from '../domain/formato';
import { qtyTxt, unidadTxt } from '../domain/reglas';
import { INP } from './base';

const M = (sku: string) => `${sku}|m`;
/** Lo contado de cada artículo, en formatos (solo los que tienen algo escrito) */
export function lineasContadas(vals: Record<string, string>, find: (sku: string) => Producto | undefined) {
  const skus = [...new Set(Object.keys(vals).map(k => k.replace(/\|m$/, '')))];
  return skus.filter(sku => (vals[sku] ?? '').trim() !== '' || (vals[M(sku)] ?? '').trim() !== '').flatMap(sku => {
    const p = find(sku); if (!p) return [];
    const f = (vals[sku] ?? '').trim() === '' ? 0 : toNum(vals[sku]), m = (vals[M(sku)] ?? '').trim() === '' ? 0 : toNum(vals[M(sku)]);
    return [{ sku, contado: (vals[M(sku)] ?? '').trim() !== '' ? deMixto(p, f, m) : f }];
  });
}

export function Contado({ p, vals, setVals, placeholder, ancho = '!w-28', sueltos = enMetros(p) }: { p: Producto; vals: Record<string, string>; setVals: (v: Record<string, string>) => void; placeholder: number; ancho?: string; sueltos?: boolean }) {
  if (!sueltos) return <input value={vals[p.sku] ?? ''} onChange={e => setVals({ ...vals, [p.sku]: e.target.value })} inputMode="decimal" placeholder={num(placeholder)}
    className={`${INP} ${ancho} h-12 text-center font-mono`} aria-label={`Cantidad contada de ${p.name}`} />;
  const total = lineasContadas({ [p.sku]: vals[p.sku] ?? '', [M(p.sku)]: vals[M(p.sku)] ?? '' }, () => p)[0];
  return (<div className="flex flex-col items-end shrink-0"><div className="flex items-center gap-1">
    <input value={vals[p.sku] ?? ''} onChange={e => setVals({ ...vals, [p.sku]: e.target.value })} inputMode="numeric" placeholder={num(Math.floor(Math.max(0, placeholder)))}
      className={`${INP} !w-16 h-12 text-center font-mono`} aria-label={`${unidadTxt(p.unit, 2)} enteros de ${p.name}`} />
    <span className="text-label-sm text-secondary">{unidadTxt(p.unit, 2)} +</span>
    <input value={vals[M(p.sku)] ?? ''} onChange={e => setVals({ ...vals, [M(p.sku)]: e.target.value })} inputMode="decimal" placeholder="0"
      className={`${INP} !w-16 h-12 text-center font-mono`} aria-label={`${ucDe(p) === 'm' ? 'Metros' : 'Unidades'} sueltos de ${p.name}`} />
    <span className="text-label-sm text-secondary">{ucDe(p)}</span>
  </div>{total && <span className="text-label-sm text-secondary">= {qtyTxt(p, total.contado)}</span>}</div>);
}
