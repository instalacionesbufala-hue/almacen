/* E-012 · Cierres de instalación recibidos del wizard: estado, líneas traducidas, pendientes que resuelve el administrador,
   consumo por equipo y periodo, discrepancias (vehículos en negativo) y recuento de vehículo. */
import { abrirRecalcularCierres } from './Reglas';
import { abrirCorregirCierre } from './Corregir';
import { Contado, lineasContadas } from '../../ui/contado';
import { Fragment, useState } from 'react';
import type { CierreApp, Estado, EstadoCierre, LineaCierre, Unidad } from '../../data/tipos';
import { UNIT } from '../../data/catalogo';
import { conductoresSueltos, datosLinea, filtroRZ1K, mangueraRZ1K, reglaDeResolucion, type Propuesta } from '../../domain/resolucion';
import { consumoPorArticulo, descInstalacion, desdeCierresPorDefecto, discrepancias, lineasDe, noEntregadosPorArticulo, noGestionadoPorPartida, ORIGEN_VERSION, textoDiferencia } from '../../domain/cierres';
import { vehiculoActualDeCierre, vehiculoHistorialDeCierre } from '../../domain/asignaciones';
import { descargarCsv } from '../../domain/csv';
import { fechaHora, hoyISO, num, redondea, toNum } from '../../domain/formato';
import { contenidoDe, contenidoTxt, enVista, tieneContenido, find, lineaCierreTxt, nombreVehiculo, qtyTxt, unidadTxt, unidadesABordo, vista, vistaUnidades } from '../../domain/reglas';
import { ejecutar, useAlmacen } from '../../store/almacen';
import { setUI, ui } from '../../store/ui';
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

/** E-036 · Consumo de un artículo en un periodo: en la unidad en que se gasta, con el formato en pequeño */
const cantConsumo = (E: Estado, x: { sku: string; formatos: number; unidad: string }) => { const p = find(E, x.sku); if (!p) return `${num(x.formatos)} ${unidadTxt(x.unidad as Unidad, x.formatos)}`; const v = vista(p, x.formatos);
  return <><span className="whitespace-nowrap">{v.principal}</span>{v.secundario && <span className="block text-label-sm font-normal text-secondary whitespace-nowrap">{v.secundario}</span>}</>; };
export default function CierresView() {
  const E = useAlmacen(), { gestionarCierres: validar, exportar: puedeExportar } = usePermisos();
  // E-029: por defecto desde la apertura del inventario (o los últimos 30 días), para que no se queden fuera cierres recién llegados del histórico
  // E-037: al llegar desde un extracto, ese cierre abierto (y dentro del periodo) con la línea del artículo resaltada
  const [foco] = useState(() => { const x = ui.get().cierreFoco; if (x) setUI({ cierreFoco: null }); return x || null; });
  const fFoco = foco ? E.cierres.find(c => c.id === foco.id)?.fecha : undefined;
  const [f, setF] = useState(() => { const d = desdeCierresPorDefecto(E), fd = fFoco ? new Date(fFoco).toISOString().slice(0, 10) : d; return { equipo: 'all', desde: fd < d ? fd : d, hasta: hoyISO(), estado: 'all' }; });
  const [abierto, setAbierto] = useState<string | null>(foco?.id ?? null);
  const equipos = [...new Set(E.cierres.map(c => c.equipoWizard).filter(Boolean))].sort();
  // sin useMemo: el estado se modifica en el sitio (misma referencia), y la lista y el consumo se quedarían viejos tras procesar un cierre
  const lista = E.cierres.filter(c => (f.equipo === 'all' || c.equipoWizard === f.equipo) && (f.estado === 'all' || c.estado === f.estado)
    && c.fecha >= Date.parse(f.desde) && c.fecha < Date.parse(f.hasta) + 864e5);
  const consumo = consumoPorArticulo(E, lista), noEntregados = noEntregadosPorArticulo(E, lista), noGestionado = noGestionadoPorPartida(E, lista);
  const sinVehiculo = E.cierres.filter(c => c.estado === 'sin_vehiculo'), sinVehiculoLista = lista.filter(c => c.estado === 'sin_vehiculo').length;
  const [n, mas] = useMas(100, JSON.stringify(f));
  const disc = discrepancias(E);
  const pendientes = E.lineasCierre.filter(l => l.estado === 'pendiente' || l.estado === 'sin_equivalencia').length;
  const exportar = () => descargarCsv(`consumos-cierres-${f.desde}-${f.hasta}.csv`, [['SKU', 'Artículo', 'Cantidad', 'Unidad', 'Formatos', 'Formato', 'Estimado'],
    ...consumo.map(c => { const p = find(E, c.sku), v = p ? enVista(p, c.formatos) : { n: c.unidades, u: c.unidad }; return [c.sku, c.nombre, v.n, v.u, c.formatos, p ? contenidoTxt(p) || UNIT[p.unit] : c.unidad, c.estimada ? 'sí' : '']; }),
    ...noGestionado.map(x => ['', `${x.campo} (material no gestionado en el almacén: no descontado)`, x.cantidad, '', '', ''])]);
  if (!E.cierres.length) return <section className={`${CARD} p-6 flex flex-col gap-2`}><h2 className="text-headline-sm font-semibold">Aún no ha llegado ningún cierre</h2>
    <p className="text-body-md text-secondary">Cuando el wizard de cierres esté conectado (Configuración → Integraciones y la guía, paso 14), cada cierre descontará aquí el material del vehículo de su equipo.</p></section>;
  return (<div className="flex flex-col gap-4">
    <section className={`${CARD} p-4 grid grid-cols-2 lg:grid-cols-5 gap-2 items-end`}>
      <label className="flex flex-col gap-1"><span className={LBL}>Equipo</span><select value={f.equipo} onChange={e => setF({ ...f, equipo: e.target.value })} className={`${INP} h-12`}><option value="all">Todos</option>{equipos.map(x => <option key={x}>{x}</option>)}</select></label>
      <label className="flex flex-col gap-1"><span className={LBL}>Desde</span><input type="date" value={f.desde} onChange={e => setF({ ...f, desde: e.target.value })} className={`${INP} h-12`} /></label>
      <label className="flex flex-col gap-1"><span className={LBL}>Hasta</span><input type="date" value={f.hasta} onChange={e => setF({ ...f, hasta: e.target.value })} className={`${INP} h-12`} /></label>
      <label className="flex flex-col gap-1"><span className={LBL}>Estado</span><select value={f.estado} onChange={e => setF({ ...f, estado: e.target.value })} className={`${INP} h-12`}><option value="all">Todos</option>{Object.entries(ESTADO).map(([k, v]) => <option key={k} value={k}>{v.t}</option>)}</select></label>
      <p className="col-span-2 lg:col-span-1 text-body-sm text-secondary">Mostrando <b>{lista.length}</b> de {E.cierres.length} cierre{E.cierres.length === 1 ? '' : 's'}{pendientes ? <> · <b className="text-amber-800">{pendientes} líneas por resolver</b></> : ''}
        {E.rol === 'admin' && <button onClick={() => abrirRecalcularCierres(f.desde)} className="block text-primary font-semibold h-10">Recalcular cierres desde el {f.desde.split('-').reverse().join('/')}…</button>}</p>
    </section>
    {validar && sinVehiculo.length > 0 && <SinVehiculo cierres={sinVehiculo} />}
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <section className="xl:col-span-2 flex flex-col gap-2">
        {lista.length ? lista.slice(0, n).map(c => <FilaCierre key={c.id} c={c} abierto={abierto === c.id} alternar={() => setAbierto(abierto === c.id ? null : c.id)} puede={validar} foco={foco?.id === c.id ? foco.sku : undefined} />) : <Vacio>No hay cierres con estos filtros.</Vacio>}
        <CargarMas visibles={n} total={lista.length} mas={mas} que="cierres" />
      </section>
      <aside className="flex flex-col gap-4">
        <section className={`${CARD} p-4 flex flex-col gap-2`}>
          <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Consumo del periodo</h2>{puedeExportar && <button onClick={exportar} disabled={!consumo.length} className={`${BTN_S} h-10 px-3 disabled:opacity-40`}><Icon n="file_download" className="ico-18" />CSV</button>}</div>
          {consumo.length ? consumo.map(x => <div key={x.sku} className="flex justify-between gap-2 py-1.5 border-b border-surface-container text-body-sm"><span className="min-w-0 truncate">{x.nombre}{x.estimada && <Tag c="bg-amber-100 text-amber-800 ml-1">estimado</Tag>}</span><b className="text-right">{cantConsumo(E, x)}</b></div>)
            : <p className="text-body-sm text-secondary">Sin consumos en el periodo.</p>}
          {sinVehiculoLista > 0 && <p className="text-body-sm text-amber-800">{sinVehiculoLista} cierre{sinVehiculoLista === 1 ? '' : 's'} sin vehículo: no cuenta{sinVehiculoLista === 1 ? '' : 'n'} hasta procesarlo{sinVehiculoLista === 1 ? '' : 's'}.</p>}
          {noEntregados.length > 0 && <div className="flex flex-col pt-2"><h3 className="font-semibold text-body-md">Instalados no entregados por el almacén</h3>
            <p className="text-body-sm text-secondary mb-1">Cargadores que el equipo ya llevaba: se instalaron, pero no se descuentan.</p>
            {noEntregados.map(x => <div key={x.sku} className="flex justify-between gap-2 py-1.5 border-b border-surface-container text-body-sm"><span className="min-w-0 truncate">{x.nombre}</span><b className="text-right text-violet-800">{cantConsumo(E, x)}</b></div>)}</div>}
          {noGestionado.length > 0 && <div className="flex flex-col pt-2"><h3 className="font-semibold text-body-md">Material no gestionado en el almacén</h3>
            <p className="text-body-sm text-secondary mb-1">Partidas que llevan material que aún no está en el almacén: se cuentan, no se descuentan.</p>
            {noGestionado.map(x => <div key={x.campo} className="flex justify-between gap-2 py-1.5 border-b border-surface-container text-body-sm"><span className="font-mono">{x.campo}</span><b className="whitespace-nowrap">{num(x.cantidad)} · {x.cierres} cierre{x.cierres === 1 ? '' : 's'}</b></div>)}</div>}
        </section>
        <section className={`${CARD} p-4 flex flex-col gap-2`}>
          <h2 className="font-semibold flex items-center gap-2"><Icon n="report" className="text-error" />Discrepancias</h2>
          <p className="text-body-sm text-secondary">Artículos que los cierres dejan en negativo en un vehículo: el equipo gastó algo que no constaba. Se corrige con un recuento del vehículo.</p>
          {disc.length ? disc.map(d => <div key={d.vehiculo + d.sku} className="flex justify-between gap-2 py-1.5 border-b border-surface-container text-body-sm"><span className="min-w-0 truncate">{d.vehiculoObj?.matricula} · {d.producto?.name || d.sku}</span><b className="text-error whitespace-nowrap">{d.producto ? vistaUnidades(d.producto, d.unidades).principal : num(d.unidades)}</b></div>)
            : <p className="text-body-sm text-tertiary">Ningún vehículo en negativo.</p>}
        </section>
      </aside>
    </div>
  </div>);
}

function FilaCierre({ c, abierto, alternar, puede, foco }: { c: CierreApp; abierto: boolean; alternar: () => void; puede: boolean; foco?: string }) {
  const E = useAlmacen(), lineas = lineasDe(E, c.id);
  return (<article className={`${CARD} overflow-hidden`}>
    <button onClick={alternar} className="w-full text-left p-4 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[220px]"><div className="font-semibold">{c.numInst || '—'} · {c.cliente || 'sin cliente'}</div>
        <div className="text-body-sm text-secondary">{fechaHora(c.fecha)} · {c.equipoWizard || 'sin equipo'}{c.vehiculo ? ` · ${nombreVehiculo(E, c.vehiculo).split(' · ').pop()}` : ''}{c.direccion ? ` · ${c.direccion}` : ''}{c.version > 1 ? ` · ${c.version} versiones` : ''}{c.origen === 'holded' ? ' · desde la prefactura' : ''}</div></div>
      <Tag c={ESTADO[c.estado].c}>{ESTADO[c.estado].t}</Tag><Icon n={abierto ? 'expand_less' : 'expand_more'} className="text-secondary" />
    </button>
    {abierto && <div className="px-4 pb-4 flex flex-col gap-2">
      {descInstalacion(c) && <p className="text-body-sm">Instalación: <b>{descInstalacion(c)}</b>{/solar/i.test(descInstalacion(c)) ? <Tag c="bg-amber-100 text-amber-800 ml-1">SOLAR · medidor bidireccional</Tag> : null}</p>}
      {c.hardware && <p className="text-body-sm">Cargador: <b>{c.hardware}</b> (sin n.º de serie: lo registra Esbrain)</p>}
      {c.materialEspecial && <div className={`text-body-sm rounded-lg p-3 flex flex-wrap items-center gap-2 ${c.materialRevisado ? 'bg-surface-container-low' : 'bg-amber-50'}`}>
        <span className="flex-1 min-w-[200px]"><b>Material especial:</b> {c.materialEspecial}{c.materialRevisado ? ' · revisado' : ' · añade a mano lo que corresponda (no se descuenta solo)'}</span>
        {!c.materialRevisado && puede && <button onClick={() => { if (ejecutar({ op: 'revisarMaterialEspecial', args: { id: c.id, nota: '' } })) toast('Marcado como revisado.', 'ok'); }} className={`${BTN_S} h-10 px-3`}>Revisado</button>}</div>}
      {(c.versiones?.length || 0) > 1 && <div className="text-body-sm"><div className={LBL}>Versiones</div>
        {c.versiones!.map(v => <div key={v.n} className="flex flex-wrap gap-x-2 py-0.5"><b>{v.n}.</b><span>{v.origen === 'admin' && v.documento ? v.documento : `${ORIGEN_VERSION[v.origen] || v.origen}${v.documento && v.origen !== 'calendario' ? ` nº ${v.documento}` : ''}`}</span><span className="text-secondary">{fechaHora(v.recibido)}</span>
          <span className={v.diferencia.length ? 'font-semibold' : 'text-secondary'}>{v.n === 1 ? (v.diferencia.length ? textoDiferencia(E, v.diferencia) : 'alta del cierre') : textoDiferencia(E, v.diferencia)}</span></div>)}</div>}
      {c.estado === 'sin_vehiculo' && puede && <AccionesSinVehiculo c={c} />}
      {puede && c.estado !== 'ignorado' && <div className="flex flex-wrap items-center gap-2"><button onClick={() => abrirCorregirCierre(c.id)} className={`${BTN_S} h-11 px-4`}><Icon n="edit_note" className="ico-20" />Corregir cierre</button>
        {c.correccion && <Tag c="bg-primary-fixed text-primary">datos corregidos: {Object.entries(c.correccion).map(([k, v]) => `${k} ${v}`).join(', ')}</Tag>}</div>}
      {!lineas.length ? <p className="text-body-sm text-secondary">{c.despFallido ? 'Desplazamiento fallido: sin consumo.' : 'Sin material declarado.'}</p> :
        <table className="w-full text-body-sm"><thead><tr className={`text-left ${LBL}`}><th className="py-1">Partida</th><th>Artículo</th><th className="text-right">Cantidad</th><th /></tr></thead>
          <tbody>{lineas.map(l => { const p = l.sku ? find(E, l.sku) : undefined; const resolver = puede && (l.estado === 'pendiente' || l.estado === 'sin_equivalencia'); return (<Fragment key={l.id}>
            <tr className={`border-t border-surface-container align-top ${foco && l.sku === foco ? 'bg-amber-50' : ''}`} ref={foco && l.sku === foco ? (el => { el?.scrollIntoView({ block: 'center' }); }) : undefined}>
              <td className="py-1.5 font-mono text-label-sm">{l.campo}{l.formula !== 'directa' && l.formula !== 'unidad' ? ` (${l.formula})` : ''}<div className="text-secondary">{num(l.valor)}</div></td>
              <td className="py-1.5">{p ? p.name : l.estado === 'no_gestionado' || l.estado === 'quitada' ? <span className="text-secondary">—</span> : <span className="text-amber-800">{l.estado === 'pendiente' ? 'Por elegir' : 'Sin equivalencia'}</span>}
                {l.estado === 'no_entregado' && <Tag c="bg-violet-100 text-violet-800 ml-1">no entregado por el almacén: no se descuenta</Tag>}
                {l.estado === 'no_gestionado' && <Tag c="bg-surface-container-high text-secondary ml-1">material no gestionado en el almacén: no descuenta</Tag>}
                {l.manual && <Tag c="bg-primary-fixed text-primary ml-1">{l.estado === 'quitada' ? 'quitada a mano: no descuenta' : 'corregida a mano'}</Tag>}
                {l.estimada && <Tag c="bg-amber-100 text-amber-800 ml-1">estimado</Tag>}{l.estado === 'discrepancia' && <Tag c="bg-error-container text-error ml-1">deja el vehículo en negativo</Tag>}
                {l.nota && <div className="text-label-sm text-secondary">{l.nota}</div>}
                {puede && l.estado === 'resuelta' && (!l.resolucion || l.previo) && <button onClick={() => deshacer(E, l)} className="text-error text-body-sm font-semibold h-10 flex items-center gap-1"><Icon n="undo" className="ico-18" />Deshacer resolución</button>}</td>
              <td className="py-1.5 text-right whitespace-nowrap font-semibold">{p ? lineaCierreTxt(p, l.cantidad) : num(l.cantidad)}</td>
              <td />
            </tr>
            {resolver && <tr><td colSpan={4} className="pb-2"><div className="w-0 min-w-full"><ResolverLinea c={c} l={l} /></div></td></tr>}</Fragment>); })}</tbody></table>}
    </div>}
  </article>);
}

/* ---------- E-030 · Resolver una línea con varios artículos (conductores de la línea) y deshacer ---------- */
const deshacer = (E: ReturnType<typeof useAlmacen>, l: LineaCierre) => {
  const grupo = l.resolucion ? E.lineasCierre.filter(x => x.resolucion === l.resolucion) : [l];
  const lista = grupo.map(x => `· ${num(x.cantidad)} ${find(E, x.sku || '')?.name || x.sku}`).join('\n');
  if (!confirm(`¿Deshacer la resolución de ${l.campo}?\n\n${lista}\n\nLo descontado vuelve a bordo del vehículo (con un ajuste enlazado al cierre) y la línea queda otra vez sin resolver. Queda en la versión del cierre y en la auditoría.`)) return;
  if (ejecutar({ op: 'deshacerResolucion', args: { linea: l.id } })) toast('Resolución deshecha: el material ha vuelto a bordo. Ya puedes resolverla bien.', 'ok');
};
type FilaRes = { id: string; sku: string | null; cantidad: string; etiqueta?: string; falta?: string };
function ResolverLinea({ c, l }: { c: CierreApp; l: LineaCierre }) {
  const E = useAlmacen(), { fase, seccion, tipoLinea } = datosLinea(c);
  const [modo, setModo] = useState<'libre' | 'manguera' | 'conductores'>('libre');
  const [filas, setFilas] = useState<FilaRes[]>(() => [{ id: nuevoId(), sku: null, cantidad: String(l.cantidad) }]);
  const de = (ps: Propuesta[]): FilaRes[] => ps.map(p => ({ id: nuevoId(), sku: p.sku || null, cantidad: String(p.cantidad), etiqueta: p.etiqueta, falta: p.sku ? undefined : p.falta }));
  const cambiar = (i: number, x: Partial<FilaRes>) => setFilas(fs => fs.map((f, j) => j === i ? { ...f, ...x } : f));
  const ok = filas.length > 0 && filas.every(f => f.sku && toNum(f.cantidad) > 0);
  const linea = `${tipoLinea || 'línea'}${seccion ? ` ${String(seccion).replace('.', ',')} mm²` : ''} ${fase === 'trif' ? 'trifásica' : 'monofásica'}`;
  const aplicar = () => {
    const articulos = filas.map(f => ({ id: f.id, sku: f.sku!, cantidad: toNum(f.cantidad) }));
    const regla = modo !== 'libre' ? reglaDeResolucion(E, c, l, articulos) : null;
    if (!ejecutar({ op: 'resolverLineaVarios', args: { linea: l.id, grupo: nuevoId(), articulos } })) return;
    toast(`Línea resuelta con ${articulos.length} artículo${articulos.length === 1 ? '' : 's'}: se descuenta del vehículo.`, 'ok');
    // la misma lógica sirve de regla para las próximas instalaciones iguales, pero solo si el administrador lo confirma
    if (regla && confirm(`¿Guardar como regla para ${linea} → ${modo === 'conductores' ? `conductores sueltos (${articulos.length})` : 'manguera RZ1-K'}?\n\nLas próximas instalaciones iguales se descontarán solas así. Este cierre ya está resuelto y no cambia.`)
      && ejecutar({ op: 'equivalencia', args: { regla } })) toast('Regla guardada (Configuración → Integraciones y equivalencias).', 'ok');
  };
  return (<div className="flex flex-col gap-2 mt-2 rounded-lg bg-surface-container-low p-2">
    {l.campo === 'metrosLinea' && <div className="flex flex-wrap gap-2">
      <button onClick={() => { setModo('manguera'); setFilas(de([mangueraRZ1K(E, seccion, fase, l.cantidad)])); }} className={`${BTN_S} h-11 px-3 text-body-sm ${modo === 'manguera' ? 'ring-2 ring-primary' : ''}`}>Manguera RZ1-K</button>
      <button onClick={() => { setModo('conductores'); setFilas(de(conductoresSueltos(E, seccion, fase, l.cantidad))); }} className={`${BTN_S} h-11 px-3 text-body-sm ${modo === 'conductores' ? 'ring-2 ring-primary' : ''}`}>Conductores sueltos ({fase === 'trif' ? 5 : 3})</button>
      <span className="text-label-sm text-secondary self-center">{linea}, {num(l.cantidad)} m</span>
    </div>}
    {filas.map((f, i) => <div key={f.id} className="flex flex-col gap-1">
      {(f.etiqueta || f.falta) && <div className="text-label-sm">{f.etiqueta && <span className="text-secondary">{f.etiqueta}</span>}{f.falta && !f.sku && <span className="text-error font-semibold">{f.etiqueta ? ' · ' : ''}{f.falta}: elige otro o dalo de alta en Inventario</span>}</div>}
      <div className="flex gap-2 items-start">
        <SelectorArticulo valor={f.sku} onChange={sku => cambiar(i, { sku })} filtro={modo === 'manguera' ? filtroRZ1K(seccion) : undefined} className="flex-1 min-w-0" alto="h-11" />
        <input inputMode="decimal" value={f.cantidad} onChange={x => cambiar(i, { cantidad: x.target.value })} className={`${INP} h-11 !w-20 text-right`} aria-label="Cantidad" />
        <button onClick={() => setFilas(fs => fs.filter((_, j) => j !== i))} className="h-11 w-11 shrink-0 text-secondary" aria-label="Quitar artículo"><Icon n="close" className="ico-20" /></button>
      </div></div>)}
    <div className="flex flex-wrap gap-2">
      <button onClick={() => setFilas(fs => [...fs, { id: nuevoId(), sku: null, cantidad: String(l.cantidad) }])} className={`${BTN_S} h-11 px-3 text-body-sm`}><Icon n="add" className="ico-18" />Añadir artículo</button>
      <button disabled={!ok} onClick={aplicar} className={`${BTN_P} h-11 px-4 flex-1 disabled:opacity-40`}>Aplicar{filas.length > 1 ? ` (${filas.length} artículos)` : ''}</button>
    </div>
  </div>);
}

/* ---------- E-029 · Cierres "Equipo sin vehículo" ---------- */
const confirmarVehiculoActual = (E: ReturnType<typeof useAlmacen>, cierres: CierreApp[]) => {
  const con = cierres.filter(c => vehiculoActualDeCierre(E, c)), sin = cierres.filter(c => !vehiculoActualDeCierre(E, c));
  if (!con.length) { toast(`${sin.map(c => c.equipoWizard || 'sin equipo').filter((x, i, a) => a.indexOf(x) === i).join(', ')}: el equipo no tiene vehículo ahora. Asígnaselo en Equipos.`, 'err'); return; }
  const lista = con.map(c => `· ${c.numInst || '—'} (${c.equipoWizard}) → ${vehiculoActualDeCierre(E, c)!.matricula}`).join('\n');
  if (!confirm(`¿Procesar ${con.length === 1 ? 'este cierre' : `estos ${con.length} cierres`} con el vehículo que su equipo tiene ahora?\n\n${lista}\n\nSe descuenta el material de ese vehículo y queda anotado en la versión del cierre. El historial de asignaciones no cambia.${sin.length ? `\n\n${sin.length} sin vehículo actual se quedan como están.` : ''}`)) return;
  if (ejecutar({ op: 'usarVehiculoActual', args: { ids: con.map(c => c.id) } })) toast(`${con.length === 1 ? 'Cierre procesado' : `${con.length} cierres procesados`} con el vehículo actual.`, 'ok');
};
function SinVehiculo({ cierres }: { cierres: CierreApp[] }) {
  const E = useAlmacen();
  return (<section className={`${CARD} p-4 flex flex-wrap items-center gap-3 border border-amber-300 bg-amber-50`}>
    <Icon n="local_shipping" className="text-amber-800" />
    <div className="flex-1 min-w-[240px] text-body-sm"><b>{cierres.length} cierre{cierres.length === 1 ? '' : 's'} en "Equipo sin vehículo"</b>: no descuenta{cierres.length === 1 ? '' : 'n'} nada hasta procesarlo{cierres.length === 1 ? '' : 's'}.
      <span className="text-secondary"> Si el equipo llevaba otra furgoneta ese día, corrige antes la fecha de inicio en Equipos → Historial.</span></div>
    <button onClick={() => confirmarVehiculoActual(E, cierres)} className={`${BTN_P} h-12 px-4`}><Icon n="done_all" className="ico-20" />Usar el vehículo actual{cierres.length === 1 ? '' : ' en todos'}</button>
  </section>);
}
function AccionesSinVehiculo({ c }: { c: CierreApp }) {
  const E = useAlmacen(), actual = vehiculoActualDeCierre(E, c), historial = vehiculoHistorialDeCierre(E, c);
  return (<div className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3">
    <p className="text-body-sm text-amber-900">{c.equipoWizard ? `El equipo "${c.equipoWizard}" no tenía vehículo asignado el ${fechaHora(c.fecha)}.` : 'El cierre no trae equipo.'} No descuenta nada hasta procesarlo.</p>
    <div className="flex flex-wrap gap-2">
      {actual && <button onClick={() => confirmarVehiculoActual(E, [c])} className={`${BTN_P} h-12 px-4`}><Icon n="local_shipping" className="ico-20" />Usar el vehículo que el equipo tiene ahora ({actual.matricula})</button>}
      <button onClick={() => { if (ejecutar({ op: 'reprocesarCierres', args: { ids: [c.id] } })) toast(historial ? 'Cierre reprocesado.' : 'Sigue sin vehículo: corrige la fecha de inicio en Equipos → Historial.', historial ? 'ok' : 'err'); }} className={`${BTN_S} h-12 px-4`}><Icon n="refresh" className="ico-20" />Reprocesar con el historial</button>
    </div>
    {!actual && <p className="text-body-sm text-secondary">El equipo tampoco tiene vehículo ahora: asígnaselo en Equipos → Vehículos.</p>}
  </div>);
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
    const lineas = lineasContadas(cont, sku => find(E, sku));
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
          <span className="flex-1 min-w-0"><span className="block font-medium truncate">{p.name}</span><span className="text-body-sm text-secondary">Consta: <b className={teorico < 0 ? 'text-error' : ''}>{qtyTxt(p, teorico)}</b></span></span>
          <Contado p={p} vals={cont} setVals={setCont} placeholder={Math.max(0, teorico)} sueltos={tieneContenido(p)} />
          {extra.includes(sku) && !aBordo.includes(sku) && <button onClick={() => { setExtra(e => e.filter(x => x !== sku)); setCont(c => { const n = { ...c }; delete n[sku]; delete n[sku + '|m']; return n; }); }} className={`${BTN_S} h-12 w-12 shrink-0`} aria-label={`Quitar ${p.name} del recuento`}><Icon n="close" className="ico-20" /></button>}
        </div>); })}
    </div>
    <SheetFoot><button onClick={guardar} className={`${BTN_P} h-14 w-full`}><Icon n="fact_check" className="ico-fill" />{E.rol === 'admin' ? 'Aplicar el recuento' : 'Enviar el recuento'}</button></SheetFoot>
  </>);
}
