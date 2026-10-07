/* E-036 · Cantidad de un artículo: la principal en la unidad en que se gasta (m o ud) y el formato debajo, en pequeño
   ("−319 m" / "≈ −3,19 cajas de 100 m"). Con "Mostrar en formato", al revés. */
import type { Producto } from '../data/tipos';
import { vista, vistaUnidades } from '../domain/reglas';

type Props = { p: Producto; className?: string; sub?: string } & ({ formatos: number; unidades?: never } | { unidades: number; formatos?: never });
export function Cantidad({ p, formatos, unidades, className = '', sub = 'text-body-sm text-secondary font-normal' }: Props) {
  const v = unidades != null ? vistaUnidades(p, unidades) : vista(p, formatos!);
  return <><div className={className}>{v.principal}</div>{v.secundario && <div className={sub}>{v.secundario}</div>}</>;
}
