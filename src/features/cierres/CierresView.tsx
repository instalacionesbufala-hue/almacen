/* E-012 · Cierres de instalación recibidos del wizard: estado, líneas traducidas, pendientes que resuelve el administrador,
   consumo por equipo y periodo, discrepancias (vehículos en negativo) y recuento de vehículo. */
import { useMemo, useState } from 'react';
import type { CierreApp, EstadoCierre, Unidad } from '../../data/tipos';
import { consumoPorArticulo, discrepancias, lineasDe, ORIGEN_VERSION, textoDiferencia } from '../../domain/cierres';
import { descargarCsv } from '../../domain/csv';
import { fechaHora, hoyISO, num, redondea, toNum } from '../../domain/formato';
import { contenidoDe, find, nombreVehiculo, unidadTxt, unidadesABordo } from '../../domain/reglas';
import { ejecutar, useAlmacen } from '../../store/almacen';
import { nuevoId } from '../../store/ops';
import { usePermisos } from '../../store/permisos';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, CARD, Icon, INP, LBL, Tag, Vacio } from '../../ui/base';
import { OrdenArticulos, SelectorArticulo, usePrefSelector } from '../../ui/selectorArticulo';
import { ordenarArticulos } from '../../domain/selector';
import { CargarMas, useMas } from '../../ui/lista';

const ESTADO: Record<EstadoCierre, { t: string; c: string }> = {
  aplicado: { t: 'Aplicado', c: 'bg-tertiary-fixed/40 text-tertiary' }, parcial: { t: 'Parcial', c: 'bg-amber-100 text-amber-800' },
  discrepancia: { t: 'Discrepancia', c: 'bg-error-container text-error' }, fallido: { t: 'Desplazamiento fallido', c: 'bg-surface-container-high text-secondary' },
  ignorado: { t: 'Anterior a la apertura', c: 'bg-surface-container-high text-secondary' }, sin_vehiculo: { t: 'Equipo sin vehículo', c: 'bg-amber-100 text-amber-800' },
};
const cant = (u: number, unidad: string, contenido: number) => `${num(redondea(u / contenido))} ${unidadTxt(unidad as Unidad, u / contenido)}${contenido > 1 ? ` (${num(u)} ud)` : ''}`;
const inicioMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };

export default function CierresView() {
  const E = useAlmacen(), { validar } = usePermisos();
  const [f, setF] = useState({ equipo: 'all', desde: inicioMes(), hasta: hoyISO(), estado: 'all' });
  const [abierto, setAbierto] = useState<string | null>(null);
  const equipos = [...new Set(E.cierres.map(c => c.equipoWizard).filter(Boolean))].sort();
  const lista = useMemo(() => E.cierres.filter(c => (f.equipo === 'all' || c.equipoWizard === f.equipo) && (f.estado === 'all' || c.estado === f.estado)
    && c.fecha >= Date.parse(f.desde) && c.fecha < Date.parse(f.hasta) + 864e5), [E.cierres, f]);
  const consumo = useMemo(() => consumoPorArticulo(E, lista), [E, lista]);
  const [n, mas] = useMas(100, JSON.stringify(f));
  const disc = discrepancias(E);
  const pendientes = E.lineasCierre.filter(l => l.estado === 'pendiente' || l.estado === 'sin_equivalencia').length;
  const exportar = () => descargarCsv(`consumos-cierres-${f.desde}-${f.hasta}.csv`, [['SKU', 'Artículo', 'Unidades', 'Formatos', 'Unidad', 'Estimado'],
    ...consumo.map(c => [c.sku, c.nombre, c.unidades, c.formatos, c.unidad, c.estimada ? 'sí' : ''])]);
  if (!E.cierres.length) return <section className={`${CARD} p-6 flex flex-col gap-2`}><h2 className="text-headline-sm font-semibold">Aún no ha llegado ningún cierre</h2>
    <p className="text-body-md text-secondary">Cuando el wizard de cierres esté conectado (Configuración → Integraciones y la guía, paso 14), cada cierre descontará aquí el material del vehículo de su equipo.</p></section>;
  return (<div className="flex flex-col gap-4">
    <section className={`${CARD} p-4 grid grid-cols-2 lg:grid-cols-5 gap-2 items-end`}>
      <label className="flex flex-col gap-1"><span className={LBL}>Equipo</span><select value={f.equipo} onChange={e => setF({ ...f, equipo: e.target.value })} className={`${INP} h-12`}><option value="all">Todos</option>{equipos.map(x => <option key={x}>{x}</option>)}</select></label>
      <label className="flex flex-col gap-1"><span className={LBL}>Desde</span><input type="date" value={f.desde} onChange={e => setF({ ...f, desde: e.target.value })} className={`${INP} h-12`} /></label>
      <label className="flex flex-col gap-1"><span className={LBL}>Hasta</span><input type="date" value={f.hasta} onChange={e => setF({ ...f, hasta: e.target.value })} className={`${INP} h-12`} /></label>
      <label className="flex flex-col gap-1"><span className={LBL}>Estado</span><select value={f.estado} onChange={e => setF({ ...f, estado: e.target.value })} className={`${INP} h-12`}><option value="all">Todos</option>{Object.entries(ESTADO).map(([k, v]) => <option key={k} value={k}>{v.t}</option>)}</select></label>
      <p className="col-span-2 lg:col-span-1 text-body-sm text-secondary">{lista.length} cierre{lista.length === 1 ? '' : 's'}{pendientes ? <> · <b className="text-amber-800">{pendientes} líneas por resolver</b></> : ''}</p>
    </section>
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <section className="xl:col-span-2 flex flex-col gap-2">
        {lista.length ? lista.slice(0, n).map(c => <FilaCierre key={c.id} c={c} abierto={abierto === c.id} alternar={() => setAbierto(abierto === c.id ? null : c.id)} puede={validar} />) : <Vacio>No hay cierres con estos filtros.</Vacio>}
        <CargarMas visibles={n} total={lista.length} mas={mas} que="cierres" />
      </section>
      <aside className="flex flex-col gap-4">
        <section className={`${CARD} p-4 flex flex-col gap-2`}>
          <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Consumo del periodo</h2><button onClick={exportar} disabled={!consumo.length} className={`${BTN_S} h-10 px-3 disabled:opacity-40`}><Icon n="file_download" className="ico-18" />CSV</button></div>
          {consumo.length ? consumo.map(x => <div key={x.sku} className="flex justify-between gap-2 py-1.5 border-b border-surface-container text-body-sm"><span className="min-w-0 truncate">{x.nombre}{x.estimada && <Tag c="bg-amber-100 text-amber-800 ml-1">estimado</Tag>}</span><b className="whitespace-nowrap">{num(x.formatos)} {unidadTxt(x.unidad as Unidad, x.formatos)}</b></div>)
            : <p className="text-body-sm text-secondary">Sin consumos en el periodo.</p>}
        </section>
        <section className={`${CARD} p-4 flex flex-col gap-2`}>
          <h2 className="font-semibold flex items-center gap-2"><Icon n="report" className="text-error" />Discrepancias</h2>
          <p className="text-body-sm text-secondary">Artículos que los cierres dejan en negativo en un vehículo: el equipo gastó algo que no constaba. Se corrige con un recuento del vehículo.</p>
          {disc.length ? disc.map(d => <div key={d.vehiculo + d.sku} className="flex justify-between gap-2 py-1.5 border-b border-surface-container text-body-sm"><span className="min-w-0 truncate">{d.vehiculoObj?.matricula} · {d.producto?.name || d.sku}</span><b className="text-error whitespace-nowrap">{d.producto ? cant(d.unidades, d.producto.unit, contenidoDe(d.producto)) : num(d.unidades)}</b></div>)
            : <p className="text-body-sm text-tertiary">Ningún vehículo en negativo.</p>}
        </section>
      </aside>
    </div>
  </div>);
}

function FilaCierre({ c, abierto, alternar, puede }: { c: CierreApp; abierto: boolean; alternar: () => void; puede: boolean }) {
  const E = useAlmacen(), lineas = lineasDe(E, c.id);
  const [elegido, setElegido] = useState<Record<string, string>>({});
  return (<article className={`${CARD} overflow-hidden`}>
    <button onClick={alternar} className="w-full text-left p-4 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[220px]"><div className="font-semibold">{c.numInst || '—'} · {c.cliente || 'sin cliente'}</div>
        <div className="text-body-sm text-secondary">{fechaHora(c.fecha)} · {c.equipoWizard || 'sin equipo'}{c.vehiculo ? ` · ${nombreVehiculo(E, c.vehiculo).split(' · ').pop()}` : ''}{c.direccion ? ` · ${c.direccion}` : ''}{c.version > 1 ? ` · ${c.version} versiones` : ''}{c.origen === 'holded' ? ' · desde la prefactura' : ''}</div></div>
      <Tag c={ESTADO[c.estado].c}>{ESTADO[c.estado].t}</Tag><Icon n={abierto ? 'expand_less' : 'expand_more'} className="text-secondary" />
    </button>
    {abierto && <div className="px-4 pb-4 flex flex-col gap-2">
      {c.hardware && <p className="text-body-sm">Cargador: <b>{c.hardware}</b> (sin n.º de serie: lo registra Esbrain)</p>}
      {c.materialEspecial && <div className={`text-body-sm rounded-lg p-3 flex flex-wrap items-center gap-2 ${c.materialRevisado ? 'bg-surface-container-low' : 'bg-amber-50'}`}>
        <span className="flex-1 min-w-[200px]"><b>Material especial:</b> {c.materialEspecial}{c.materialRevisado ? ' · revisado' : ' · añade a mano lo que corresponda (no se descuenta solo)'}</span>
        {!c.materialRevisado && puede && <button onClick={() => { if (ejecutar({ op: 'revisarMaterialEspecial', args: { id: c.id, nota: '' } })) toast('Marcado como revisado.', 'ok'); }} className={`${BTN_S} h-10 px-3`}>Revisado</button>}</div>}
      {(c.versiones?.length || 0) > 1 && <div className="text-body-sm"><div className={LBL}>Versiones</div>
        {c.versiones!.map(v => <div key={v.n} className="flex flex-wrap gap-x-2 py-0.5"><b>{v.n}.</b><span>{ORIGEN_VERSION[v.origen] || v.origen}{v.documento ? ` nº ${v.documento}` : ''}</span><span className="text-secondary">{fechaHora(v.recibido)}</span>
          <span className={v.diferencia.length ? 'font-semibold' : 'text-secondary'}>{v.n === 1 ? (v.diferencia.length ? textoDiferencia(E, v.diferencia) : 'alta del cierre') : textoDiferencia(E, v.diferencia)}</span></div>)}</div>}
      {c.estado === 'sin_vehiculo' && puede && <button onClick={() => { if (ejecutar({ op: 'reprocesarCierre', args: { id: c.id } })) toast('Cierre reprocesado.', 'ok'); }} className={`${BTN_S} h-12 self-start px-4`}><Icon n="refresh" className="ico-20" />Reprocesar (tras asignar el vehículo al equipo)</button>}
      {!lineas.length ? <p className="text-body-sm text-secondary">{c.despFallido ? 'Desplazamiento fallido: sin consumo.' : 'Sin material declarado.'}</p> :
        <table className="w-full text-body-sm"><thead><tr className={`text-left ${LBL}`}><th className="py-1">Partida</th><th>Artículo</th><th className="text-right">Cantidad</th><th /></tr></thead>
          <tbody>{lineas.map(l => { const p = l.sku ? find(E, l.sku) : undefined; const resolver = puede && (l.estado === 'pendiente' || l.estado === 'sin_equivalencia'); return (
            <tr key={l.id} className="border-t border-surface-container align-top">
              <td className="py-1.5 font-mono text-label-sm">{l.campo}{l.formula !== 'directa' && l.formula !== 'unidad' ? ` (${l.formula})` : ''}<div className="text-secondary">{num(l.valor)}</div></td>
              <td className="py-1.5">{p ? p.name : <span className="text-amber-800">{l.estado === 'pendiente' ? 'Por elegir' : 'Sin equivalencia'}</span>}
                {l.estado === 'no_entregado' && <Tag c="bg-violet-100 text-violet-800 ml-1">no entregado por el almacén: no se descuenta</Tag>}
                {l.estimada && <Tag c="bg-amber-100 text-amber-800 ml-1">estimado</Tag>}{l.estado === 'discrepancia' && <Tag c="bg-error-container text-error ml-1">deja el vehículo en negativo</Tag>}
                {l.nota && <div className="text-label-sm text-secondary">{l.nota}</div>}
                {resolver && <div className="flex gap-2 mt-1 items-start"><SelectorArticulo valor={elegido[l.id] || null} onChange={sku => setElegido({ ...elegido, [l.id]: sku || '' })} className="flex-1" alto="h-11" />
                  <button disabled={!elegido[l.id]} onClick={() => { if (ejecutar({ op: 'resolverLinea', args: { linea: l.id, sku: elegido[l.id] } })) toast('Línea resuelta: se descuenta del vehículo.', 'ok'); }} className={`${BTN_P} h-11 px-3 disabled:opacity-40`}>Aplicar</button></div>}</td>
              <td className="py-1.5 text-right whitespace-nowrap font-semibold">{p ? cant(l.cantidad, p.unit, contenidoDe(p)) : num(l.cantidad)}</td>
              <td />
            </tr>); })}</tbody></table>}
    </div>}
  </article>);
}

/* ---------- Recuento de un vehículo ---------- */
export const abrirRecuentoVehiculo = (vehiculo: string) => openModal(<RecuentoVehiculo vehiculo={vehiculo} />, { ancha: true });
function RecuentoVehiculo({ vehiculo }: { vehiculo: string }) {
  const E = useAlmacen(), v = E.vehiculos.find(x => x.id === vehiculo);
  // Chat (02/10): el recuento debe poder incluir TODO lo que lleva la furgoneta, no solo lo que la app sabe que lleva
  // (al empezar, las furgonetas tienen material que nunca se entregó desde la app).
  const aBordo = E.aBordo.filter(b => b.vehiculo === vehiculo && b.unidades !== 0).map(b => b.sku);
  const [extra, setExtra] = useState<string[]>([]);
  const [cont, setCont] = useState<Record<string, string>>({});
  // E-025: mismo orden que los selectores de artículos (A-Z o por referencia, el que tenga elegido el usuario)
  const orden = usePrefSelector().orden;
  const skus = ordenarArticulos([...new Set([...aBordo, ...extra])].map(sku => find(E, sku)).filter((p): p is NonNullable<typeof p> => !!p), orden).map(p => p.sku);
  const anadir = (lista: string[]) => { const n = lista.filter(x => !skus.includes(x)); if (n.length) setExtra(e => [...e, ...n]); return n.length; };
  const deCierres = () => {
    const set = new Set<string>();
    E.equivalencias.filter(r => r.activa).forEach(r => {
      r.articulos.forEach(a => { if (a.sku) set.add(a.sku); });
      if (r.formula === 'fijaciones') Object.values(E.kits || {}).flat().forEach(a => { if (a.sku) set.add(a.sku); });
    });
    E.products.filter(p => p.propiedad === 'custodia' && !p.borrador).forEach(p => set.add(p.sku));   // cargadores y medidores
    return [...set].filter(sku => { const p = find(E, sku); return p && !p.borrador; });
  };
  if (!v) return <SheetHead title="Vehículo no encontrado" />;
  const guardar = () => {
    const lineas = Object.entries(cont).filter(([, x]) => x.trim() !== '').map(([sku, x]) => ({ sku, contado: toNum(x) }));
    if (!lineas.length) return toast('Escribe lo que has contado de al menos un artículo.', 'warn');
    if (lineas.some(l => !(l.contado >= 0))) return toast('Revisa las cantidades: solo números de 0 en adelante (medio sobre: 0,5).', 'warn');
    if (ejecutar({ op: 'recuentoVehiculo', args: { id: nuevoId(), vehiculo, lineas } })) {
      closeModal(); toast(E.rol === 'admin' ? 'Recuento aplicado: el stock del vehículo queda ajustado.' : 'Recuento registrado: el administrador validará las diferencias.', 'ok', 6000);
    }
  };
  return (<>
    <SheetHead title={`Recuento de ${v.matricula}`} sub="Cuenta lo que hay a bordo, en su formato (un sobre empezado: 0,5). Puedes añadir cualquier artículo aunque no conste en la furgoneta. Lo que dejes en blanco no se toca." />
    <div className="p-5 flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <button onClick={() => { const n = anadir(deCierres()); toast(n ? `Añadidos ${n} artículos que descuentan los cierres.` : 'Ya están todos en la lista.', 'ok'); }} className={`${BTN_S} h-12 px-4`}>
          <Icon n="playlist_add" className="ico-20" />Añadir lo que descuentan los cierres</button>
        <SelectorArticulo valor={null} onChange={sku => { if (sku) anadir([sku]); }} filtro={x => !skus.includes(x.sku)} placeholder="Añadir otro artículo…" ariaLabel="Añadir un artículo al recuento" className="flex-1" />
      </div>
      {skus.length > 1 && <OrdenArticulos agrupar={false} />}
      {!skus.length && <Vacio>No consta material a bordo. Añade lo que lleva la furgoneta con los botones de arriba.</Vacio>}
      {skus.map(sku => { const p = find(E, sku)!, teorico = redondea(unidadesABordo(E, vehiculo, sku) / contenidoDe(p)); return (
        <div key={sku} className="flex items-center gap-3 py-2 border-b border-surface-container">
          <span className="flex-1 min-w-0"><span className="block font-medium truncate">{p.name}</span><span className="text-body-sm text-secondary">Consta: <b className={teorico < 0 ? 'text-error' : ''}>{num(teorico)} {unidadTxt(p.unit, teorico)}</b></span></span>
          <input value={cont[sku] ?? ''} onChange={e => setCont({ ...cont, [sku]: e.target.value })} inputMode="decimal" placeholder={num(Math.max(0, teorico))} className={`${INP} h-12 !w-28 text-right`} aria-label={`Contado de ${p.name}`} />
          {extra.includes(sku) && !aBordo.includes(sku) && <button onClick={() => { setExtra(e => e.filter(x => x !== sku)); setCont(c => { const n = { ...c }; delete n[sku]; return n; }); }} className={`${BTN_S} h-12 w-12 shrink-0`} aria-label={`Quitar ${p.name} del recuento`}><Icon n="close" className="ico-20" /></button>}
        </div>); })}
    </div>
    <SheetFoot><button onClick={guardar} className={`${BTN_P} h-14 w-full`}><Icon n="fact_check" className="ico-fill" />{E.rol === 'admin' ? 'Aplicar el recuento' : 'Enviar el recuento'}</button></SheetFoot>
  </>);
}
