/* E-037 · Extracto de un artículo en una furgoneta: todos sus movimientos con el saldo acumulado, resumen, filtros, CSV y la
   comprobación "saldo calculado = stock mostrado". En la nube lo calcula extracto_vehiculo() (paginado); en local, extractoLocal(). */
import { useEffect, useState } from 'react';
import type { Producto } from '../../data/tipos';
import { extractoLocal, TIPO_EXTRACTO, type Extracto, type FiltroTipo, type FilaExtracto } from '../../domain/extracto';
import { fechaHora, num, redondea } from '../../domain/formato';
import { find, nombreVehiculo, unidadTxt, vistaUnidades } from '../../domain/reglas';
import { socioEfectivo } from '../../domain/permisos';
import { ucDe } from '../../domain/formatos';
import { descargarCsv } from '../../domain/csv';
import { ORIGEN_VERSION } from '../../domain/cierres';
import { modoNube, supabase } from '../../store/nube/cliente';
import { useAlmacen } from '../../store/almacen';
import { irACierre } from '../../store/ui';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { BTN_S, Icon, INP, LBL } from '../../ui/base';
import { abrirRecibo } from '../entregas/Hojas';

const PAGINA = 200;
const aISO = (d: string, fin = false) => (d ? new Date(d + (fin ? 'T23:59:59.999' : 'T00:00:00')).getTime() : null);

export const abrirExtracto = (vehiculo: string, sku: string) => openModal(<ModalExtracto vehiculo={vehiculo} sku={sku} />, { ancha: true });
function ModalExtracto({ vehiculo, sku }: { vehiculo: string; sku: string }) {
  const E = useAlmacen(), p = find(E, sku);
  return (<>
    <SheetHead title={p?.name || sku} sub={`${sku} · ${nombreVehiculo(E, vehiculo)} · todos sus movimientos con el saldo`} />
    <div className="p-5"><ExtractoArticulo vehiculo={vehiculo} sku={sku} /></div>
    <SheetFoot><button onClick={closeModal} className={`${BTN_S} h-12 w-full`}>Cerrar</button></SheetFoot>
  </>);
}

function useExtracto(vehiculo: string, sku: string, f: { desde: string; hasta: string; tipo: FiltroTipo }, n: number) {
  const E = useAlmacen(), socio = !!socioEfectivo(E);
  const [nube, setNube] = useState<{ clave: string; e: Extracto | null; error?: string }>({ clave: '', e: null });
  const clave = JSON.stringify([vehiculo, sku, f, n, E.movements.length]);
  useEffect(() => {
    if (!modoNube || !supabase) return;
    let vivo = true;
    void supabase.rpc('extracto_vehiculo', { p_vehiculo: vehiculo, p_sku: sku, p_desde: f.desde ? new Date(aISO(f.desde)!).toISOString() : null,
      p_hasta: f.hasta ? new Date(aISO(f.hasta, true)!).toISOString() : null, p_tipo: f.tipo || null, p_limite: n, p_offset: 0 }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) return setNube({ clave, e: null, error: error.message });
      const d = data as Extracto & { filas: (FilaExtracto & { ts: string | number })[] };
      setNube({ clave, e: { ...d, filas: d.filas.map(x => ({ ...x, ts: typeof x.ts === 'string' ? Date.parse(x.ts) : x.ts })) } });
    });
    return () => { vivo = false; };
  }, [clave]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (modoNube) return nube.clave === clave ? nube : { clave, e: null };
  return { clave, e: extractoLocal(E, vehiculo, sku, { desde: aISO(f.desde), hasta: aISO(f.hasta, true), tipo: f.tipo, limite: n }, socio) };
}

export function ExtractoArticulo({ vehiculo, sku }: { vehiculo: string; sku: string }) {
  const E = useAlmacen(), p = find(E, sku) as Producto | undefined;
  const apertura = E.configApp.aperturaCierres ? new Date(E.configApp.aperturaCierres).toISOString().slice(0, 10) : '';
  const [f, setF] = useState<{ desde: string; hasta: string; tipo: FiltroTipo }>({ desde: apertura, hasta: '', tipo: '' });
  const [n, setN] = useState(PAGINA);
  const { e, error } = useExtracto(vehiculo, sku, f, n) as { e: Extracto | null; error?: string };
  if (!p) return null;
  const q = (u: number) => vistaUnidades(p, u);
  const exportar = () => e && descargarCsv(`extracto-${sku}-${nombreVehiculo(E, vehiculo).split(' · ').pop()}.csv`, [['Fecha', 'Tipo', 'Referencia', 'Motivo', `Cantidad (${ucDe(p)})`, 'Saldo', 'Quién'],
    ...e.filas.map(x => [fechaHora(x.ts), TIPO_EXTRACTO[x.tipo], refTxt(x), x.motivo, x.unidades, x.saldo, x.quien])]);
  return (<div className="flex flex-col gap-3">
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
      <label className="flex flex-col gap-1"><span className={LBL}>Desde</span><input type="date" value={f.desde} onChange={x => setF({ ...f, desde: x.target.value })} className={`${INP} h-11`} /></label>
      <label className="flex flex-col gap-1"><span className={LBL}>Hasta</span><input type="date" value={f.hasta} onChange={x => setF({ ...f, hasta: x.target.value })} className={`${INP} h-11`} /></label>
      <label className="flex flex-col gap-1"><span className={LBL}>Qué</span><select value={f.tipo} onChange={x => setF({ ...f, tipo: x.target.value as FiltroTipo })} className={`${INP} h-11`}>
        <option value="">Todo</option><option value="entregas">Solo entregas</option><option value="cierres">Solo cierres</option><option value="ajustes">Solo ajustes y recuentos</option></select></label>
      <button onClick={exportar} disabled={!e?.filas.length} className={`${BTN_S} h-11 px-3 disabled:opacity-40`}><Icon n="file_download" className="ico-18" />CSV</button>
    </div>
    {error ? <p className="text-error text-body-sm">{error}</p> : !e ? <p className="text-secondary text-body-sm">Cargando el extracto…</p> : <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-body-sm">
        {([['Entregado', e.resumen.entregado], ['Consumido por cierres', e.resumen.consumido], ['Ajustes y recuentos', e.resumen.ajustes], ['Saldo', e.saldoFinal]] as const).map(([t, u]) =>
          <div key={t} className="bg-surface-container-low rounded-lg p-2"><div className={LBL}>{t}</div><div className="font-semibold">{q(u).principal}</div>{q(u).secundario && <div className="text-label-sm text-secondary">{q(u).secundario}</div>}</div>)}
      </div>
      {e.resumen.otros !== 0 && <p className="text-body-sm text-secondary">Devoluciones, retiradas y otros: {q(e.resumen.otros).principal}.</p>}
      <div className="overflow-x-auto"><table className="w-full text-body-sm min-w-[560px]">
        <thead><tr className={`text-left ${LBL}`}><th className="py-1">Fecha</th><th>Tipo y referencia</th><th className="text-right">Cantidad</th><th className="text-right">Saldo</th><th className="pl-2">Quién</th></tr></thead>
        <tbody>
          {f.desde && <tr className="border-t border-surface-container text-secondary"><td className="py-1.5" colSpan={3}>Saldo anterior al {f.desde.split('-').reverse().join('/')}</td><td className="text-right font-semibold whitespace-nowrap">{q(e.saldoInicial).principal}</td><td /></tr>}
          {e.filas.map(x => <tr key={x.id} className="border-t border-surface-container align-top">
            <td className="py-1.5 whitespace-nowrap pr-2">{fechaHora(x.ts)}</td>
            <td className="pr-2"><b>{TIPO_EXTRACTO[x.tipo]}</b> <Referencia x={x} sku={sku} />
              {x.pieza && <div className="text-label-sm text-secondary">Por pieza entera: {num(x.pieza.real)} {ucDe(p)} → {num(x.pieza.consumo)} {ucDe(p)} ({num(redondea(x.pieza.consumo / (p.contenido || 1)))} {unidadTxt(p.unit, x.pieza.consumo / (p.contenido || 1))})</div>}
              {x.recuento && <div className="text-label-sm text-secondary">Constaba {q(x.recuento.constaba).principal} · contado {q(x.recuento.contado).principal} · diferencia {q(x.unidades).principal}</div>}
              {x.tipo !== 'entrega' && x.tipo !== 'cierre' && x.motivo && <div className="text-label-sm text-secondary">{x.motivo}</div>}</td>
            <td className={`text-right whitespace-nowrap font-semibold ${x.unidades < 0 ? 'text-error' : 'text-tertiary'}`}>{x.unidades > 0 ? '+' : ''}{q(x.unidades).principal}</td>
            <td className="text-right whitespace-nowrap font-semibold">{q(x.saldo).principal}</td>
            <td className="pl-2 text-secondary">{x.quien}</td></tr>)}
        </tbody></table></div>
      {e.filas.length < e.total && <button onClick={() => setN(n + PAGINA)} className={`${BTN_S} h-11 px-4 self-start`}>Ver más ({e.filas.length} de {e.total})</button>}
      {!e.total && <p className="text-secondary text-body-sm">Sin movimientos en este periodo.</p>}
      <Comprobacion e={e} p={p} />
    </>}
  </div>);
}

function Comprobacion({ e, p }: { e: Extracto; p: Producto }) {
  const d = redondea(e.stock - e.saldoCalculado), q = (u: number) => vistaUnidades(p, u).principal;
  return d === 0
    ? <p className="text-body-sm bg-tertiary-fixed/30 rounded-lg p-3">Saldo calculado: <b>{q(e.saldoCalculado)}</b> · Stock mostrado: <b>{q(e.stock)}</b> <span className="text-tertiary font-semibold">✓</span></p>
    : <p className="text-body-sm bg-error-container text-error rounded-lg p-3 font-semibold">Saldo calculado: {q(e.saldoCalculado)} · Stock mostrado: {q(e.stock)} · Diferencia de {q(d)}: revisar (también sale en la comprobación de Inventario).</p>;
}

const refTxt = (x: FilaExtracto) => x.entrega ? `${x.entrega.numero}${x.entrega.firmo ? ` · firmó ${x.entrega.firmo}` : ''}`
  : x.cierre ? `${x.cierre.numInst}${x.cierre.version ? ` · v${x.cierre.version}` : ''}${x.cierre.origen ? ` · ${ORIGEN_VERSION[x.cierre.origen as keyof typeof ORIGEN_VERSION] || x.cierre.origen}` : ''}${x.cierre.cliente ? ` · ${x.cierre.cliente}` : ''}` : x.referencia;

function Referencia({ x, sku }: { x: FilaExtracto; sku: string }) {
  if (x.entrega) return <button onClick={() => { closeModal(); abrirRecibo(x.entrega!.id); }} className="text-primary underline text-left">{refTxt(x)}</button>;
  if (x.cierre) return <><button onClick={() => { closeModal(); irACierre(x.cierre!.id, sku); }} className="text-primary underline text-left">{refTxt(x)}</button>
    {x.cierre.documento && <div className="text-label-sm text-secondary">{x.cierre.documento}</div>}</>;
  return <span className="text-secondary">{x.referencia}</span>;
}
