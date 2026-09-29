/* Componentes y clases visuales del diseño Stitch */
import type { ReactNode } from 'react';
import type { EstadoEquipo, Producto, Semaforo, TipoMov } from '../data/tipos';
import { status } from '../domain/reglas';
import { initials } from '../domain/formato';
import { FotoProducto } from './foto';

export const CARD = 'bg-surface-container-lowest rounded-xl shadow-sm';
const BTN = 'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
export const BTN_BASE = BTN;
export const BTN_P = `${BTN} bg-primary hover:bg-primary-container text-on-primary shadow-sm`;
export const BTN_S = `${BTN} bg-surface-container-lowest hover:bg-surface-container text-on-surface shadow-sm ring-1 ring-surface-container-high`;
export const BTN_T = `${BTN} bg-surface-container-low hover:bg-surface-container-high text-primary`;
export const LBL = 'font-mono text-label-sm uppercase tracking-wider text-secondary';
export const INP = 'w-full bg-surface-container-low rounded-lg px-3 py-2.5 text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary';

export const Icon = ({ n, className = '' }: { n: string; className?: string }) =>
  <span className={`material-symbols-outlined ${className}`} aria-hidden="true">{n}</span>;

export const ST: Record<Semaforo, { t: string; s: string; c: string }> = {
  red: { t: 'Stock crítico', s: 'Crítico', c: 'bg-error-container text-error' },
  amber: { t: 'Stock bajo', s: 'Bajo', c: 'bg-amber-100 text-amber-800' },
  green: { t: 'En stock', s: 'En stock', c: 'bg-tertiary-fixed/30 text-tertiary' },
};
export const TIPO: Record<TipoMov, { t: string; icon: string; c: string; sign: string }> = {
  entrada: { t: 'Entrada', icon: 'south_west', c: 'bg-tertiary-fixed/30 text-tertiary', sign: '+' },
  salida: { t: 'Salida', icon: 'north_east', c: 'bg-primary-fixed text-primary', sign: '−' },
  merma: { t: 'Merma', icon: 'report', c: 'bg-error-container text-error', sign: '−' },
  ajuste: { t: 'Ajuste', icon: 'tune', c: 'bg-amber-100 text-amber-800', sign: '±' },
};
/** Signo e importe de un movimiento para mostrarlo (el ajuste lleva su propio signo) */
export const signoMov = (type: TipoMov, qty: number) => type === 'ajuste' ? (qty > 0 ? '+' : '−') : TIPO[type].sign;
export const ESTADO_EQ: Record<EstadoEquipo, { t: string; c: string }> = {
  ruta: { t: 'En ruta', c: 'bg-tertiary-fixed text-on-tertiary-fixed' },
  depot: { t: 'En depot (carga)', c: 'bg-primary-fixed text-primary' },
  taller: { t: 'En taller', c: 'bg-amber-100 text-amber-800' },
};

export function Pill({ p, short }: { p: Pick<Producto, 'stock' | 'min'>; short?: boolean }) {
  const s = status(p);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-label-sm uppercase whitespace-nowrap ${ST[s].c}`}>
      <span className={`w-1.5 h-1.5 rounded-full bg-current ${s === 'red' ? 'pulso' : ''}`} />{short ? ST[s].s : ST[s].t}
    </span>
  );
}

/** Miniatura del artículo: su foto (E-009) o, si no tiene, el icono de la categoría */
export const Tile = ({ p, size = 'w-12 h-12' }: { p: Producto; size?: string }) => <FotoProducto p={p} size={size} alerta={status(p) === 'red'} />;

/** E-008: etiqueta visible del material que no es nuestro */
export const TagCustodia = ({ p, nombre = 'Esmove' }: { p: Pick<Producto, 'propiedad'>; nombre?: string }) =>
  p.propiedad === 'custodia' ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-label-sm bg-violet-100 text-violet-800 whitespace-nowrap"><span className="material-symbols-outlined ico-16" aria-hidden="true">handshake</span>Custodia {nombre}</span> : null;

export const Tag = ({ children, c = 'bg-surface-container-high text-secondary' }: { children: ReactNode; c?: string }) =>
  <span className={`inline-flex items-center px-2 py-0.5 rounded font-mono text-label-sm ${c}`}>{children}</span>;

export const Avatar = ({ n, c = 'bg-primary-fixed text-primary' }: { n: string; c?: string }) =>
  <span className={`w-9 h-9 shrink-0 rounded-full grid place-items-center font-mono text-label-md font-semibold ${c}`}>{initials(n)}</span>;

export function FirmaImg({ f, className = 'h-10 w-28' }: { f: string; className?: string }) {
  if (f && f.startsWith('data:')) return <img src={f} alt="Firma" className={`${className} object-contain`} />;
  return <svg viewBox="0 0 128 50" className={className} aria-label="Firma"><path d={f || ''} fill="none" stroke="#0037b0" strokeWidth="2.4" strokeLinecap="round" /></svg>;
}

export function Kpi(k: { icon: string; iconC: string; badge: ReactNode; badgeC: string; value: ReactNode; valueC?: string; label: string; foot: string; footVal: string; footC?: string; bar: number; barC: string; onClick?: () => void }) {
  return (
    <button onClick={k.onClick} className={`text-left p-space-md ${CARD} hover:shadow-md transition-shadow`}>
      <div className="flex justify-between items-start mb-space-sm">
        <div className={`p-2 rounded-lg ${k.iconC}`}><Icon n={k.icon} /></div>
        <span className={`inline-flex items-center gap-1 font-mono text-label-sm px-2 py-0.5 rounded-full ${k.badgeC}`}>{k.badge}</span>
      </div>
      <div className={`text-headline-xl-mobile xl:text-headline-xl font-bold tracking-tight ${k.valueC || 'text-on-surface'}`}>{k.value}</div>
      <div className="text-body-md text-secondary font-medium">{k.label}</div>
      <div className="mt-space-sm flex items-center justify-between gap-2"><span className="font-mono text-label-sm text-secondary">{k.foot}</span><span className={`font-mono text-label-sm font-semibold ${k.footC || 'text-on-surface'}`}>{k.footVal}</span></div>
      <div className="w-full bg-surface-container-high h-1 rounded-full mt-1.5 overflow-hidden"><div className={`${k.barC} h-full rounded-full`} style={{ width: `${Math.max(0, Math.min(100, k.bar))}%` }} /></div>
    </button>
  );
}

/** Campo con etiqueta en estilo Stitch */
export const Campo = ({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) =>
  <label className={`flex flex-col gap-1 ${className}`}><span className={LBL}>{label}</span>{children}</label>;

export const Vacio = ({ children }: { children: ReactNode }) => <p className="text-secondary text-center py-8">{children}</p>;
