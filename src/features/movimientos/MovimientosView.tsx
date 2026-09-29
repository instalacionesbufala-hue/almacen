/* Registro de movimientos: entradas, salidas y mermas con fecha, cantidad, motivo y operario */
import { useState } from 'react';
import type { TipoMov } from '../../data/tipos';
import { UNIT } from '../../data/catalogo';
import { find } from '../../domain/reglas';
import { fechaHora, norm, num } from '../../domain/formato';
import { useAlmacen } from '../../store/almacen';
import { useEsEscritorio } from '../../store/ui';
import { BTN_P, BTN_S, BTN_T, CARD, Icon, INP, LBL, TIPO, Vacio } from '../../ui/base';
import { abrirFicha, abrirSelector, MovRow } from '../inventario/hojas';
import { exportarMovimientosCsv } from '../inventario/StockView';

export default function MovimientosView() {
  const E = useAlmacen(), desk = useEsEscritorio();
  const [tipo, setTipo] = useState<'all' | TipoMov>('all'), [q, setQ] = useState(''), [rango, setRango] = useState('all');
  const ahora = Date.now(), lim = ({ hoy: new Date().setHours(0, 0, 0, 0), '7': ahora - 7 * 864e5, '30': ahora - 30 * 864e5, all: 0 } as Record<string, number>)[rango];
  const toks = norm(q).split(/\s+/).filter(Boolean);
  const lista = E.movements.filter(m => (tipo === 'all' || m.type === tipo) && m.ts >= lim
    && (!toks.length || toks.every(t => norm([m.sku, find(E, m.sku)?.name, m.reason, m.ref, m.operator, (m.serials || []).join(' '), E.equipos.find(e => e.id === m.equipo)?.flota].join(' ')).includes(t))));
  const tot = (t: TipoMov) => lista.filter(m => m.type === t).length;
  const chip = (k: 'all' | TipoMov, l: string) => <button key={k} onClick={() => setTipo(k)} className={`shrink-0 px-4 h-11 rounded-full font-semibold text-body-sm ${tipo === k ? 'bg-primary text-white' : 'bg-surface-container-lowest shadow-sm'}`}>{l}</button>;
  return (
    <div className="px-4 lg:px-gutter py-4 lg:py-space-lg flex flex-col gap-4 max-w-[1400px]">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div><span className={LBL}>Trazabilidad completa</span><h1 className="text-headline-lg-mobile lg:text-headline-lg font-bold">Registro de movimientos</h1><p className="text-secondary">{tot('entrada')} entradas · {tot('salida')} salidas · {tot('merma')} mermas en la selección</p></div>
        <div className="grid grid-cols-3 lg:flex gap-2">
          <button onClick={() => abrirSelector('entrada')} className={`${BTN_T} h-12 px-4 !text-tertiary`}><Icon n="move_to_inbox" className="ico-20" />Entrada</button>
          <button onClick={() => abrirSelector('salida')} className={`${BTN_P} h-12 px-4`}><Icon n="outbox" className="ico-20" />Salida</button>
          <button onClick={() => abrirSelector('merma')} className={`${BTN_T} h-12 px-4 !text-error`}><Icon n="report" className="ico-20" />Merma</button>
        </div>
      </div>
      <div className="flex flex-col lg:flex-row gap-2">
        <div className="relative flex-1"><Icon n="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline ico-20" /><input value={q} onChange={e => setQ(e.target.value)} type="search" className={`${INP} pl-10 h-12`} placeholder="Material, obra, operario, n.º de serie…" /></div>
        <select value={rango} onChange={e => setRango(e.target.value)} className={`${INP} lg:!w-44 h-12`}>{[['hoy', 'Hoy'], ['7', 'Últimos 7 días'], ['30', 'Últimos 30 días'], ['all', 'Todo']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
        <button onClick={() => exportarMovimientosCsv(E)} className={`${BTN_S} h-12 px-4`}><Icon n="file_download" className="ico-20" />CSV</button>
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar">{chip('all', 'Todos')}{chip('entrada', 'Entradas')}{chip('salida', 'Salidas')}{chip('merma', 'Mermas')}</div>
      {desk ? <section className={`${CARD} overflow-x-auto`}><table className="tabla w-full min-w-[900px]"><thead className="bg-surface-container-low"><tr><th>Fecha</th><th>Tipo</th><th>Material</th><th className="text-right">Cantidad</th><th>Motivo</th><th>Referencia</th><th>Operario</th></tr></thead>
        <tbody>{lista.length ? lista.slice(0, 200).map(m => { const p = find(E, m.sku), t = TIPO[m.type]; return (
          <tr key={m.id}><td className="font-mono text-label-sm whitespace-nowrap">{fechaHora(m.ts)}</td>
            <td><span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full font-mono text-label-sm ${t.c}`}><Icon n={t.icon} className="ico-16" />{t.t}</span></td>
            <td><button onClick={() => abrirFicha(m.sku)} className="text-left"><div className="font-medium hover:text-primary">{p ? p.name : m.sku}</div><div className="font-mono text-label-sm text-secondary">{m.sku}{m.serials?.length ? ` · S/N ${m.serials.join(', ')}` : ''}</div></button></td>
            <td className={`text-right font-semibold whitespace-nowrap ${m.type === 'entrada' ? 'text-tertiary' : m.type === 'merma' ? 'text-error' : ''}`}>{t.sign}{num(m.qty)} {p ? UNIT[p.unit] : ''}</td>
            <td>{m.reason}</td><td className="text-body-sm">{m.ref}{m.equipo ? ` · ${E.equipos.find(e => e.id === m.equipo)?.flota || m.equipo}` : ''}</td><td>{m.operator}</td></tr>); })
          : <tr><td colSpan={7}><Vacio>Sin movimientos en la selección.</Vacio></td></tr>}</tbody></table></section>
        : <section className={`${CARD} px-4`}>{lista.length ? lista.slice(0, 120).map(m => <MovRow key={m.id} m={m} />) : <Vacio>Sin movimientos en la selección.</Vacio>}</section>}
    </div>
  );
}
