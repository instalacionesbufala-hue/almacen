/* Stock general: panel de escritorio, inventario móvil y stock a bordo de un vehículo (E-013: sin precios ni estanterías) */
import { AvisoCoherencia } from './Coherencia';
import { abrirExtracto, ExtractoArticulo } from '../equipos/Extracto';
import { Cantidad } from '../../ui/cantidad';
import type { Estado, Producto } from '../../data/tipos';
import { MARCA, UNIT, catDe, categoriasActivas, idsCategoriasActivas } from '../../data/catalogo';
import { contenidoTxt, critical, esCustodia, find, nombreVehiculo, ORD, enVista, qtyTxt, vista, searchProducts, status, stockDeVehiculo, stockTotal, unidadesABordo } from '../../domain/reglas';
import { esHoy, fechaHora, hace, hoyISO, initials, num, redondea } from '../../domain/formato';
import { descargarCsv } from '../../domain/csv';
import { guardar, S, ultimoGuardado, useAlmacen } from '../../store/almacen';
import { ir, setUI, useEsEscritorio, useUI } from '../../store/ui';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, BTN_T, CARD, INP, Icon, Kpi, LBL, Pill, ST, Tag, TagCustodia, Tile } from '../../ui/base';
import { FotoProducto } from '../../ui/foto';
import { usePermisos } from '../../store/permisos';
import { abrirBorrador, abrirConteo, abrirFicha, abrirFormProducto, abrirMovimiento, pedir, Ubicaciones } from './hojas';
import { anadirACesta } from '../entregas/cesta';
import { iaEtiqueta } from '../albaranes/lector';
import { abrirAltaCamara } from '../altaCamara/AltaCamara';
import { agruparPorCategoria, filasCsvInventario, htmlImprimirInventario, ordenarInventario, siguienteOrden, type ColOrden } from '../../domain/listaInventario';
import { BotonSubir, useProgresivo } from '../../ui/lista';
import { Fragment, useState } from 'react';
import { asignarAEquipo } from '../../domain/entregas';
import { OrdenArticulos, useListaArticulos } from '../../ui/selectorArticulo';
import { chipsFiltros, EST_SIN_MINIMO, filtroDeRecuadro, propDeSocio, SIN_FILTROS, textoEstado, textoPropiedad, type FiltrosInv, type Recuadro } from '../../domain/filtrosInventario';
import { colorSocio, desgloseCustodia, sociosActivos } from '../../domain/socios';

export function exportarStockCsv(E: Estado = S()) {
  descargarCsv(`stock-${hoyISO()}.csv`, [['SKU', 'Nombre', 'Categoría', 'Propiedad', 'Almacén', 'En vehículos', 'Total', 'Unidad', 'Formato', 'Total en formatos', 'Mínimo almacén', 'Estado', 'Proveedor', 'Código proveedor', 'EAN'],
    ...E.products.map(p => { const t = stockTotal(E, p); return [p.sku, p.name, catDe(p.cat).label, esCustodia(p) ? `Custodia ${E.propietarios.find(o => o.id === p.propietario)?.nombre || ''}` : 'Propio',
      enVista(p, p.stock).n, enVista(p, t - p.stock).n, enVista(p, t).n, enVista(p, 1).u, contenidoTxt(p) || UNIT[p.unit], t, p.minimoDefinido === false ? '' : enVista(p, p.min).n, ST[status(p)].t, p.supplier, p.supplierRef || '', p.ean || '']; })]);
}
/** E-019: la lista filtrada completa, tal como se ve (con una columna por vehículo) */
export function exportarListaCsv(E: Estado, lista: Producto[]) { descargarCsv(`inventario-${hoyISO()}.csv`, filasCsvInventario(E, lista)); }
function textoFiltros(E: Estado, u: ReturnType<typeof useUI>) {
  return [u.q && `"${u.q}"`, u.cat !== 'all' && catDe(u.cat).label, u.est !== 'all' && textoEstado(u.est), u.prop !== 'all' && textoPropiedad(E, u.prop),
    u.ubi !== 'all' && (u.ubi === 'almacen' ? 'En el almacén' : nombreVehiculo(E, u.ubi))].filter(Boolean).join(' · ') || 'Todas las referencias';
}
/** Vista limpia para imprimir (sin fotos) en una ventana aparte */
export function imprimirLista(E: Estado, lista: Producto[], filtros: string) {
  const w = open('', '_blank'); if (!w) return toast('El navegador ha bloqueado la ventana de impresión: permite las ventanas emergentes.', 'warn');
  w.document.write(htmlImprimirInventario(E, lista, `Inventario · ${MARCA.nave}`, filtros)); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}
/** Lista del inventario: filtrada, ordenada y (si se pide) agrupada; completa, sin páginas */
function useListaInventario() {
  const E = useAlmacen(), u = useUI();
  const lista = ordenarInventario(searchProducts(E, u.q, u), u.orden);
  return { E, u, lista, grupos: u.agrupar ? agruparPorCategoria(lista) : null, clave: [u.q, u.cat, u.est, u.prop, u.ubi, u.orden.col, u.orden.dir, u.agrupar].join('|') };
}

export function exportarMovimientosCsv(E: Estado = S()) {
  descargarCsv(`movimientos-${hoyISO()}.csv`, [['Fecha', 'Tipo', 'SKU', 'Material', 'Cantidad', 'Unidad', 'Motivo', 'Referencia', 'Vehículo', 'Operario'],
    ...E.movements.map(m => { const p = find(E, m.sku); return [fechaHora(m.ts), m.type, m.sku, p ? p.name : '', m.qty, p ? UNIT[p.unit] : '', m.reason, m.ref, m.vehiculo ? nombreVehiculo(E, m.vehiculo) : '', m.operator]; })]);
}

export default function StockView() {
  const u = useUI(), desk = useEsEscritorio();
  if (u.almacen !== 'central') return <VanView />;
  return <><AvisoCoherencia />{desk ? <StockDesk /> : <StockMob />}</>;
}

function Kpis() {
  const E = useAlmacen();
  const cust = E.products.filter(esCustodia), dc = desgloseCustodia(E), custMal = cust.filter(p => status(p) !== 'green').length, custRojo = cust.filter(p => status(p) === 'red').length;
  const crit = critical(E), sup = new Set(crit.map(p => p.supplier)).size, n = E.products.length || 1;
  const entHoy = E.entregas.filter(e => esHoy(e.ts) && e.estado !== 'anulada'), firm = entHoy.filter(e => (e.estado ?? 'firmada') === 'firmada').length;
  const conCarga = E.vehiculos.filter(v => stockDeVehiculo(E, v.id).length).length, green = E.products.filter(p => status(p) === 'green').length;
  const sinMinimo = E.products.filter(p => p.minimoDefinido === false).length;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
      <Kpi icon="category" iconC="bg-surface-container-low text-primary" badge={<><Icon n="check_circle" className="ico-16" /> {Math.round(green / n * 100)}% OK</>} badgeC="text-tertiary bg-tertiary-fixed/30"
        value={num(E.products.length)} label="Referencias activas" foot={sinMinimo ? 'Sin mínimo definido' : 'Vehículos con material'} footVal={sinMinimo ? `${sinMinimo} por completar` : `${conCarga} de ${E.vehiculos.length}`} footC={sinMinimo ? 'text-amber-800' : undefined} bar={green / n * 100} barC="bg-primary" onClick={() => sinMinimo ? aplicarRecuadro({ k: 'sinmin' }) : aplicarFiltros(SIN_FILTROS)} />
      <Kpi icon="handshake" iconC="bg-violet-100 text-violet-800" badge={custRojo ? `${custRojo} en rojo` : custMal ? `${custMal} bajos` : 'Todo en verde'} badgeC={custRojo ? 'bg-error-container text-error' : custMal ? 'bg-amber-100 text-amber-800' : 'bg-tertiary-fixed/30 text-tertiary'}
        value={num(dc.total)} label={`En custodia · ${cust.length} ref. (almacén + vehículos)`} foot="" footVal="" bar={cust.length ? (cust.length - custMal) / cust.length * 100 : 0} barC="bg-violet-500" onClick={() => aplicarRecuadro({ k: 'custodia' })}
        pie={<div className="flex flex-wrap gap-1.5">{dc.socios.map(s => <button key={s.id} onClick={() => aplicarRecuadro({ k: 'custodia', socio: s.id })} title={`Ver solo lo de ${s.nombre}`} className={`inline-flex items-center gap-1 px-2 h-8 rounded-md font-mono text-label-sm ${colorSocio(s).c}`}>{s.nombre} <b>{num(s.unidades)}</b></button>)}</div>} />
      <Kpi icon="warning" iconC="bg-error-container text-error" badge={crit.length ? 'Urgente' : 'Sin alertas'} badgeC={crit.length ? 'text-error font-semibold bg-error-container' : 'text-tertiary bg-tertiary-fixed/30'}
        value={crit.length} valueC={crit.length ? 'text-error' : undefined} label="Bajo mínimo en el almacén" foot="Reposición pendiente" footVal={`${sup} proveedor${sup === 1 ? '' : 'es'}`} footC="text-error"
        bar={crit.length / n * 400} barC="bg-error" onClick={() => aplicarRecuadro({ k: 'bajo' })} />
      <Kpi icon="assignment_turned_in" iconC="bg-tertiary-fixed/40 text-tertiary" badge={entHoy.length ? `${Math.round(firm / entHoy.length * 100)}% firmadas` : 'Sin entregas hoy'} badgeC="text-tertiary font-semibold bg-tertiary-fixed/30"
        value={`${firm} / ${entHoy.length}`} label="Entregas firmadas hoy" foot="Equipos en ruta" footVal={`${E.equipos.filter(e => e.estado === 'ruta').length} de ${E.equipos.length}`} footC="text-tertiary" bar={entHoy.length ? firm / entHoy.length * 100 : 0} barC="bg-tertiary" onClick={() => ir('entregas')} />
    </div>
  );
}

function StockDesk() {
  const E = useAlmacen(), u = useUI(), perm = usePermisos();
  const { lista, grupos, clave } = useListaInventario();
  const { visibles, centinela } = useProgresivo(lista, clave);
  const enVista = new Set(visibles.map(p => p.sku));
  const catProds = E.products.filter(p => p.cat === u.catTab).sort((a, b) => ORD[status(a)] - ORD[status(b)] || a.name.localeCompare(b.name)).slice(0, 3);
  const ultAlb = E.albaranes[0], ultEnt = [...E.entregas].sort((a, b) => b.ts - a.ts)[0];
  // recuento cíclico semanal: una categoría cada semana (ya no hay pasillos)
  const cats = idsCategoriasActivas().filter(k => E.products.some(p => p.cat === k)), semana = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 6048e5), catAud = cats[semana % Math.max(1, cats.length)] || 'all';
  const sel = 'font-mono text-label-md !w-auto';
  return (
    <div className="px-gutter py-space-lg flex flex-col gap-space-lg max-w-[1600px]">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-space-md">
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center gap-space-xs flex-wrap">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-tertiary-container/15 ${LBL} !text-tertiary`}><span className="w-1.5 h-1.5 rounded-full bg-tertiary-fixed-dim pulso" />Guardado local · {hace(ultimoGuardado)}</span>
            <span className="font-mono text-label-sm text-secondary">| {MARCA.nave} · {E.vehiculos.length} vehículos · {E.movements.length} movimientos</span>
          </div>
          <div className="flex items-baseline gap-space-sm"><h1 className="text-headline-lg font-bold tracking-tight">Depot &amp; Control de Stock</h1><span className="font-mono text-label-md text-primary bg-primary-fixed/40 px-2 py-0.5 rounded">{E.operator}</span></div>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          <button onClick={() => ir('scan')} className={`${BTN_S} px-space-md py-2.5`}><Icon n="barcode_scanner" className="text-secondary ico-20" />Escanear</button>
          {perm.mod('inventario') && <button onClick={() => abrirAltaCamara()} className={`${BTN_P} px-space-md h-14`}><Icon n="add_a_photo" className="ico-20" />Nuevo con la cámara</button>}
          {perm.mod('inventario') && <button onClick={() => perm.editarCatalogo ? abrirFormProducto() : abrirBorrador()} className={`${BTN_S} px-space-md py-2.5`}><Icon n="add_circle" className="ico-20" />{perm.editarCatalogo ? 'Añadir referencia' : 'Nueva referencia (borrador)'}</button>}
        </div>
      </div>
      <Kpis />
      <div className="grid grid-cols-12 gap-space-lg items-start">
        <div className="col-span-12 2xl:col-span-8 flex flex-col gap-space-lg min-w-0">
          <section className={`${CARD} p-space-md flex flex-col gap-space-md`}>
            <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-space-sm">
              <div><h2 className="text-headline-md font-semibold">Categorías estratégicas</h2><p className="text-body-sm text-secondary">Lo más urgente de cada familia: primero lo que está en rojo.</p></div>
              <div className="inline-flex bg-surface-container-low p-1 rounded-lg overflow-x-auto no-scrollbar max-w-full">
                {categoriasActivas().map(([k, c]) => <button key={k} onClick={() => setUI({ catTab: k })} className={`px-3 py-1.5 rounded-md whitespace-nowrap text-body-md font-semibold transition-all ${u.catTab === k ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}>{c.label}</button>)}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
              {catProds.length ? catProds.map(p => { const r = status(p) === 'red'; return (
                <button key={p.sku} onClick={() => abrirFicha(p.sku)} className={`text-left p-space-md rounded-xl ${r ? 'bg-error-container/40' : 'bg-surface-container-low'} hover:shadow-md transition-shadow flex flex-col gap-space-sm`}>
                  <div className="flex justify-between items-start gap-2"><span className="font-mono text-label-sm text-secondary whitespace-nowrap">SKU: {p.sku}</span><Pill p={p} short /></div>
                  <div className="relative"><FotoProducto p={p} size="h-24 w-full" alerta={r} icono="ico-40" />{contenidoTxt(p) && <span className="absolute bottom-2 left-2 font-mono text-label-sm bg-white/85 text-on-surface px-2 py-0.5 rounded">{contenidoTxt(p)}</span>}</div>
                  <div><h3 className="text-headline-sm font-semibold line-clamp-2">{p.name}</h3><p className="text-body-sm text-secondary">{p.supplier}</p></div>
                  <div className="flex justify-between items-end pt-space-sm border-t border-surface-container-high">
                    <div><span className={LBL}>En almacén</span><Cantidad p={p} formatos={p.stock} className={`text-headline-md font-bold ${r ? 'text-error' : ''}`} sub="font-mono text-label-sm text-secondary" /></div>
                    <div className="text-right"><span className={LBL}>{r ? 'Faltan' : 'Mínimo'}</span><div className={`font-mono text-label-md ${r ? 'text-error font-semibold' : 'text-primary'}`}>{vista(p, r ? p.min - p.stock : p.min).principal}</div></div>
                  </div>
                </button>); }) : <p className="text-secondary">Sin productos en esta categoría.</p>}
            </div>
          </section>

          <section id="lista-inventario" className={`${CARD} overflow-hidden scroll-mt-20`}>
            <div className="p-space-md flex flex-wrap items-center gap-space-sm">
              <div className="relative flex-1 min-w-[220px]"><Icon n="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline ico-20" />
                <input value={u.q} onChange={e => setUI({ q: e.target.value, page: 1 })} type="search" placeholder="Filtrar por nombre, SKU, código o proveedor…" className={`${INP} pl-10`} /></div>
              <select value={u.cat} onChange={e => setUI({ cat: e.target.value, page: 1 })} className={`${INP} ${sel}`} aria-label="Categoría"><option value="all">Categoría: todas</option>{categoriasActivas().map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select>
              <select value={u.est} onChange={e => setUI({ est: e.target.value, page: 1 })} className={`${INP} ${sel}`} aria-label="Estado"><option value="all">Estado: todos</option>{(['red', 'amber', 'green'] as const).map(s => <option key={s} value={s}>{ST[s].t}</option>)}<option value={EST_SIN_MINIMO}>Sin mínimo</option></select>
              <select value={u.prop} onChange={e => setUI({ prop: e.target.value, page: 1 })} className={`${INP} ${sel}`} aria-label="Propiedad"><option value="all">Propiedad: todo</option><option value="propia">Material propio</option><option value="custodia">En custodia (todos)</option>{sociosActivos(E).map(o => <option key={o.id} value={propDeSocio(o.id)}>Custodia {o.nombre}</option>)}</select>
              <select value={u.ubi} onChange={e => setUI({ ubi: e.target.value, page: 1 })} className={`${INP} ${sel}`} aria-label="Ubicación"><option value="all">Ubicación: todas</option><option value="almacen">Almacén</option>{E.vehiculos.map(v => <option key={v.id} value={v.id}>{nombreVehiculo(E, v.id)}</option>)}</select>
            </div>
            <div className="px-space-md pb-space-sm flex flex-wrap items-center gap-space-sm">
              <ChipsFiltro />
              <span className="font-mono text-label-sm text-secondary">Mostrando {lista.length} de {E.products.length} referencias</span>
              <label className="inline-flex items-center gap-2 text-body-sm ml-auto cursor-pointer"><input type="checkbox" checked={u.agrupar} onChange={e => setUI({ agrupar: e.target.checked })} className="w-5 h-5 accent-primary" />Agrupar por categoría</label>
              {perm.exportar && <button onClick={() => exportarListaCsv(E, lista)} className={`${BTN_S} h-10 px-3`}><Icon n="file_download" className="ico-20" />Exportar CSV</button>}
              {perm.exportar && <button onClick={() => imprimirLista(E, lista, textoFiltros(E, u))} className={`${BTN_S} h-10 px-3`}><Icon n="print" className="ico-20" />Imprimir lista</button>}
            </div>
            <div className="overflow-auto max-h-[78vh] border-t border-surface-container"><table className="tabla w-full min-w-[860px]">
              <thead className="bg-surface-container-low sticky top-0 z-10 shadow-[0_1px_0_rgba(0,0,0,.06)]"><tr><Th col="sku" u={u}>Referencia / SKU</Th><Th col="nombre" u={u}>Descripción</Th><th>Dónde está</th><Th col="stock" u={u}>Almacén</Th><Th col="estado" u={u}>Estado</Th>{perm.mod('movimientos') && <th className="text-right">Acciones</th>}</tr></thead>
              <tbody>{!lista.length ? <tr><td colSpan={6} className="text-center text-secondary py-10">No hay referencias con esos filtros. <button onClick={limpiarFiltros} className="text-primary font-semibold">Quitar filtros</button></td></tr>
                : grupos ? grupos.map(g => <Fragment key={g.cat}><tr className="bg-surface-container-lowest"><td colSpan={6} className="!py-2 font-semibold text-primary">{g.label} <span className="font-mono text-label-sm text-secondary">· {g.items.length} ref.</span></td></tr>
                  {g.items.filter(p => enVista.has(p.sku)).map(p => <FilaStock key={p.sku} p={p} pedido={!!E.pedidos[p.sku]} />)}</Fragment>)
                  : visibles.map(p => <FilaStock key={p.sku} p={p} pedido={!!E.pedidos[p.sku]} />)}</tbody>
            </table><div ref={centinela} /></div>
          </section>
        </div>

        <div className="col-span-12 2xl:col-span-4 grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-1 gap-space-lg items-start">
          <section className={`${CARD} p-space-md flex flex-col gap-space-md`}>
            <div className="flex items-start justify-between gap-2"><h2 className="text-headline-md font-semibold flex items-center gap-2"><Icon n="auto_awesome" className="text-primary" />Recepción IA &amp; entradas</h2><span className="font-mono text-label-sm px-2 py-0.5 rounded-full bg-primary-fixed text-primary">{iaEtiqueta()}</span></div>
            {ultAlb && <div className="rounded-xl bg-surface-container-low p-space-md flex flex-col gap-2">
              <div className="flex justify-between gap-2"><span className="font-mono text-label-sm text-primary">ALBARÁN #{ultAlb.numero}</span><span className="font-mono text-label-sm text-secondary">{hace(ultAlb.ts)}</span></div>
              <div className="flex items-center gap-3"><span className="w-10 h-10 rounded-lg bg-white grid place-items-center font-bold text-primary">{initials(ultAlb.proveedor)}</span><div><div className="font-semibold">{ultAlb.proveedor}</div><div className="font-mono text-label-sm text-secondary">{ultAlb.lineas} líneas · {num(ultAlb.unidades || 0)} unidades ingresadas</div></div></div>
              <div className="flex justify-between items-center pt-1"><span className="font-mono text-label-sm text-tertiary flex items-center gap-1"><Icon n="verified" className="ico-16" />Confianza {Math.round((ultAlb.confianza || .95) * 100)}%</span><button onClick={() => ir('albaranes')} className="font-mono text-label-sm text-primary">Ver albaranes →</button></div>
            </div>}
            {ultEnt && (() => { const eq = E.equipos.find(x => x.id === ultEnt.equipo), rec = E.tecnicos.find(t => t.id === ultEnt.receptor); return (
              <div className="rounded-xl bg-surface-container-low p-space-md flex flex-col gap-2">
                <div className="flex justify-between gap-2"><span className={LBL}>Última entrega a un vehículo</span><span className="font-mono text-label-sm text-secondary">{hace(ultEnt.ts)}</span></div>
                <div className="flex items-center gap-3"><Icon n="local_shipping" className="text-secondary" /><div><div className="font-semibold">{eq ? eq.nombre : ultEnt.equipo} · {rec?.nombre}</div><div className="font-mono text-label-sm text-secondary">{ultEnt.vehiculo ? nombreVehiculo(E, ultEnt.vehiculo) : ""}</div></div></div>
                <div className="bg-white rounded-lg p-2.5 text-body-sm">{ultEnt.lineas.map(l => { const p = find(E, l.sku); return <div key={l.sku}>{num(l.qty)} {p ? UNIT[p.unit] : ''} {p?.name || l.sku}</div>; })}
                  <div className="font-mono text-label-sm text-tertiary mt-1"><Icon n="draw" className="ico-16" /> Firma registrada · {(ultEnt.hash || '').slice(0, 10)}</div></div>
              </div>); })()}
            <div className="grid grid-cols-2 gap-2">{perm.mod('albaranes') && <button onClick={() => { ir('albaranes'); void import('../albaranes/AlbaranesView').then(m => m.escanearAlbaran()); }} className={`${BTN_P} py-2.5`}><Icon n="photo_camera" className="ico-20" />Escanear albarán</button>}
              {perm.mod('albaranes') && <button onClick={() => ir('albaranes')} className={`${BTN_S} py-2.5`}><Icon n="document_scanner" className="ico-20" />Leer un albarán</button>}</div>
          </section>
          <Barras E={E} />
          <section className="bg-primary-fixed/50 rounded-xl p-space-md flex items-center justify-between gap-space-md">
            <div><h3 className="text-headline-sm font-semibold">Recuento cíclico semanal</h3><p className="text-body-sm text-secondary">{catDe(catAud).label || 'Almacén'} · {E.products.filter(p => p.cat === catAud).length} referencias a recontar</p></div>
            {perm.mod('recuentos') && <button onClick={() => abrirConteo(catAud)} className={`${BTN_S} px-3 py-2 text-body-sm`}>Iniciar conteo</button>}
          </section>
        </div>
      </div>
    </div>
  );
}

const limpiarFiltros = () => setUI({ ...SIN_FILTROS, page: 1 });
/** E-024: un recuadro limpia los demás filtros, aplica el suyo y lleva a la lista */
function aplicarFiltros(f: FiltrosInv) {
  setUI({ ...f, page: 1 });
  requestAnimationFrame(() => document.getElementById('lista-inventario')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
export const aplicarRecuadro = (r: Recuadro) => aplicarFiltros(filtroDeRecuadro(r));
/** Chips de los filtros activos, cada uno con su × para quitarlo */
function ChipsFiltro() {
  const E = useAlmacen(), u = useUI(), chips = chipsFiltros(E, u);
  if (!chips.length) return null;
  return <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtros activos">{chips.map(c =>
    <button key={c.clave} onClick={() => setUI({ ...c.quitar, page: 1 })} className="inline-flex items-center gap-1 h-9 pl-3 pr-2 rounded-full bg-primary-fixed text-primary font-semibold text-body-sm" aria-label={`Quitar filtro ${c.texto}`}>{c.texto}<Icon n="close" className="ico-18" /></button>)}
    {chips.length > 1 && <button onClick={limpiarFiltros} className="h-9 px-2 text-primary text-body-sm font-semibold">Quitar todos</button>}</div>;
}
/** Cabecera que ordena con un toque (otro toque invierte el sentido) */
function Th({ col, u, children }: { col: ColOrden; u: ReturnType<typeof useUI>; children: React.ReactNode }) {
  const activo = u.orden.col === col;
  return <th aria-sort={activo ? (u.orden.dir === 1 ? 'ascending' : 'descending') : 'none'}><button onClick={() => setUI({ orden: siguienteOrden(u.orden, col) })} className={`inline-flex items-center gap-1 uppercase ${activo ? 'text-primary' : ''}`}>{children}<Icon n={activo ? (u.orden.dir === 1 ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'} className="ico-16" /></button></th>;
}

function FilaStock({ p, pedido }: { p: Producto; pedido: boolean }) {
  const r = status(p) === 'red', perm = usePermisos();
  return (
    <tr className={r ? 'bg-error-container/20' : ''}>
      <td><div className="flex items-center gap-2"><Icon n={r ? 'warning' : 'qr_code_2'} className={`${r ? 'text-error' : 'text-secondary'} ico-20`} /><div><div className={`font-mono text-label-md ${r ? 'text-error' : ''} whitespace-nowrap`}>{p.sku}</div>{p.ean && <div className="font-mono text-label-sm text-secondary">EAN {p.ean}</div>}</div></div></td>
      <td className="max-w-[340px]"><button onClick={() => abrirFicha(p.sku)} className="text-left flex items-center gap-3"><Tile p={p} size="w-11 h-11" /><div><div className="font-semibold hover:text-primary">{p.name}</div><div className="text-body-sm text-secondary">{catDe(p.cat).label} · {p.supplier}{contenidoTxt(p) ? ` · ${contenidoTxt(p)}` : ''}</div></div></button><div className="flex flex-wrap gap-1 mt-1"><TagCustodia p={p} />{p.borrador && <Tag c="bg-amber-100 text-amber-800">Borrador</Tag>}{pedido && <Tag c="bg-amber-100 text-amber-800">Pedido en curso</Tag>}</div></td>
      <td className="max-w-[260px]"><Ubicaciones p={p} /></td>
      <td><Cantidad p={p} formatos={p.stock} className={`text-headline-sm font-bold whitespace-nowrap ${r ? 'text-error' : ''}`} sub="font-mono text-label-sm text-secondary whitespace-nowrap" /><div className={`font-mono text-label-sm ${r ? 'text-error' : 'text-secondary'}`}>Mín: {p.minimoDefinido === false ? 'sin definir' : vista(p, p.min).principal}</div></td>
      <td><Pill p={p} /></td>
      {perm.mod('movimientos') && <td className="text-right whitespace-nowrap">
        {perm.mod('movimientos') && <button onClick={() => abrirMovimiento(p.sku, 'entrada')} title="Registrar entrada" className="p-2 rounded-lg text-tertiary hover:bg-tertiary-fixed/30"><Icon n="add_circle" /></button>}
        {perm.mod('movimientos') && <button onClick={() => abrirMovimiento(p.sku, 'salida')} title="Registrar salida" className="p-2 rounded-lg text-primary hover:bg-primary-fixed"><Icon n="remove_circle" /></button>}
        {perm.mod('movimientos') && <button onClick={() => abrirMovimiento(p.sku, 'merma')} title="Registrar merma" className="p-2 rounded-lg text-error hover:bg-error-container"><Icon n="report" /></button>}
      </td>}
    </tr>
  );
}

function Barras({ E }: { E: Estado }) {
  const rows = categoriasActivas().map(([k, c]) => { const ps = E.products.filter(p => p.cat === k); return { k, c, n: ps.length, r: ps.filter(p => status(p) === 'red').length, a: ps.filter(p => status(p) === 'amber').length, g: ps.filter(p => status(p) === 'green').length }; }).filter(x => x.n);
  const max = Math.max(1, ...rows.map(r => r.n));
  return (
    <section className={`${CARD} p-space-md`}>
      <div className="flex justify-between items-start"><h2 className="text-headline-md font-semibold">Referencias por categoría</h2><span className="font-mono text-label-sm text-secondary">semáforo</span></div>
      <div className="flex flex-col gap-2.5 mt-space-md">{rows.map(r =>
        <button key={r.k} onClick={() => aplicarFiltros({ ...SIN_FILTROS, cat: r.k })} className="text-left group">
          <div className="flex justify-between text-body-sm mb-1"><span className="font-medium group-hover:text-primary">{r.c.label}</span><span className="font-mono text-label-sm text-secondary">{r.n} ref.</span></div>
          <div className="flex h-3 rounded-full overflow-hidden bg-surface-container" style={{ width: `${Math.max(18, r.n / max * 100)}%` }}>
            {r.r > 0 && <div className="bg-error" style={{ flex: r.r }} title={`${r.r} en crítico`} />}{r.a > 0 && <div className="bg-amber-400" style={{ flex: r.a }} title={`${r.a} bajo`} />}{r.g > 0 && <div className="bg-tertiary-container" style={{ flex: r.g }} title={`${r.g} correcto`} />}
          </div>
        </button>)}</div>
      <div className="flex gap-space-md mt-space-md font-mono text-label-sm text-secondary"><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-error" />Crítico</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />Bajo</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-tertiary-container" />Correcto</span></div>
    </section>
  );
}

function StockMob() {
  const { E, u, lista, grupos, clave } = useListaInventario(), nCrit = critical(E).length, nSinMin = E.products.filter(p => p.minimoDefinido === false).length;
  const { visibles, centinela } = useProgresivo(lista, clave), perm = usePermisos();
  const enVista = new Set(visibles.map(p => p.sku));
  const chip = (k: string, lbl: string, n: number) =>
    <button key={k} onClick={() => setUI({ cat: u.cat === k ? 'all' : k })} className={`shrink-0 inline-flex items-center gap-2 px-4 h-11 rounded-full font-mono text-label-md uppercase ${u.cat === k ? 'bg-primary text-white' : 'bg-surface-container-lowest text-on-surface shadow-sm'}`}>{lbl}<span className={`px-1.5 rounded ${u.cat === k ? 'bg-white/20' : 'bg-surface-container-high'}`}>{n}</span></button>;
  const hayFiltro = u.est !== 'all' || u.ubi !== 'all' || u.prop !== 'all';
  return (
    <div className="px-4 pt-4 flex flex-col gap-4">
      <div className="flex items-center gap-3 bg-surface-container-low rounded-xl p-3">
        <span className="w-10 h-10 rounded-lg bg-white grid place-items-center text-primary"><Icon n="sensors" /></span>
        <div className="flex-1 min-w-0"><div className="font-semibold flex items-center gap-1.5">{MARCA.nave}<span className="w-2 h-2 rounded-full bg-tertiary-container" /></div><div className="font-mono text-label-sm text-secondary truncate">Guardado {hace(ultimoGuardado)} · {E.operator}</div></div>
        {nSinMin > 0 && <button onClick={() => aplicarRecuadro({ k: 'sinmin' })} className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-amber-100 text-amber-800 font-mono text-label-md" aria-label={`${nSinMin} sin mínimo`}><Icon n="rule" className="ico-18" />{nSinMin}</button>}
        {nCrit > 0 && <button onClick={() => aplicarRecuadro({ k: 'bajo' })} aria-label={`${nCrit} bajo mínimo`} className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-error-container text-error font-mono text-label-md"><Icon n="warning" className="ico-18" />{nCrit}</button>}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1"><Icon n="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
          <input value={u.q} onChange={e => setUI({ q: e.target.value })} type="search" placeholder="Nombre, SKU o código" className="w-full h-14 pl-11 pr-3 rounded-xl bg-surface-container-lowest shadow-sm text-body-lg focus:outline-none focus:ring-2 focus:ring-primary" /></div>
        <button onClick={() => ir('scan')} className="w-14 h-14 rounded-xl bg-primary text-white grid place-items-center shadow-sm" aria-label="Escanear"><Icon n="barcode_scanner" className="ico-28" /></button>
        <button onClick={() => setUI({ filtros: !u.filtros })} className={`w-14 h-14 rounded-xl ${u.filtros || hayFiltro ? 'bg-primary-fixed text-primary' : 'bg-surface-container-low'} grid place-items-center`} aria-label="Filtros"><Icon n="tune" className="ico-28" /></button>
      </div>
      {perm.mod('inventario') && <button onClick={() => abrirAltaCamara()} className={`${BTN_P} h-14 text-body-lg`}><Icon n="add_a_photo" className="ico-28" />Nuevo con la cámara</button>}
      {u.filtros && <div className="grid grid-cols-2 gap-2 bg-surface-container-lowest rounded-xl p-3 shadow-sm">
        <label className="flex flex-col gap-1"><span className={LBL}>Estado</span><select value={u.est} onChange={e => setUI({ est: e.target.value })} className={`${INP} h-12`}>{[['all', 'Todos'], ['red', 'Crítico'], ['amber', 'Bajo'], ['green', 'Correcto'], [EST_SIN_MINIMO, 'Sin mínimo']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <label className="flex flex-col gap-1"><span className={LBL}>Dónde</span><select value={u.ubi} onChange={e => setUI({ ubi: e.target.value })} className={`${INP} h-12`}><option value="all">Todo</option><option value="almacen">Almacén</option>{E.vehiculos.map(v => <option key={v.id} value={v.id}>{nombreVehiculo(E, v.id)}</option>)}</select></label>
        <label className="col-span-2 flex flex-col gap-1"><span className={LBL}>Propiedad</span><select value={u.prop} onChange={e => setUI({ prop: e.target.value })} className={`${INP} h-12`}><option value="all">Todo</option><option value="propia">Material propio</option><option value="custodia">En custodia (todos los socios)</option>{sociosActivos(E).map(o => <option key={o.id} value={propDeSocio(o.id)}>Custodia {o.nombre}</option>)}</select></label>
        <button onClick={limpiarFiltros} className={`col-span-2 ${BTN_T} h-11`}>Quitar filtros</button>
      </div>}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">{chip('all', 'Todos', E.products.length)}{categoriasActivas().map(([k, c]) => chip(k, c.label, E.products.filter(p => p.cat === k).length))}</div>
      <div id="lista-inventario" className="scroll-mt-20"><ChipsFiltro /></div>
      <div className="flex flex-wrap items-center gap-2 font-mono text-label-sm text-secondary"><span>Mostrando {lista.length} de {E.products.length} referencias</span>
        {(hayFiltro || u.q) && <button onClick={limpiarFiltros} className="text-primary h-10">Limpiar</button>}
        <select value={`${u.orden.col}:${u.orden.dir}`} onChange={e => { const [col, dir] = e.target.value.split(':'); setUI({ orden: { col: col as ColOrden, dir: Number(dir) as 1 | -1 } }); }} className="ml-auto h-10 rounded-lg bg-surface-container-lowest shadow-sm px-2 text-body-sm" aria-label="Ordenar">
          <option value="estado:1">Primero lo crítico</option><option value="nombre:1">Descripción A-Z</option><option value="sku:1">Código</option><option value="stock:1">Menos stock</option><option value="stock:-1">Más stock</option></select>
        <label className="inline-flex items-center gap-1.5 h-10 text-body-sm"><input type="checkbox" checked={u.agrupar} onChange={e => setUI({ agrupar: e.target.checked })} className="w-5 h-5 accent-primary" />Agrupar</label></div>
      <div className="flex flex-col gap-4">{lista.length ? grupos ? grupos.map(g => <Fragment key={g.cat}><h2 className="font-semibold text-primary mt-2">{g.label} <span className="font-mono text-label-sm text-secondary">· {g.items.length} ref.</span></h2>
          {g.items.filter(p => enVista.has(p.sku)).map(p => <CardMob key={p.sku} p={p} pedido={!!E.pedidos[p.sku]} />)}</Fragment>)
        : visibles.map(p => <CardMob key={p.sku} p={p} pedido={!!E.pedidos[p.sku]} />)
        : <div className="text-center text-secondary py-12">Nada coincide con “{u.q}”.<br /><button onClick={limpiarFiltros} className="text-primary font-semibold mt-2">Ver todo</button></div>}</div>
      <div ref={centinela} className="pb-4" />
      <BotonSubir />
    </div>
  );
}

function CardMob({ p, pedido }: { p: Producto; pedido: boolean }) {
  const E = useAlmacen(), r = status(p) === 'red', total = stockTotal(E, p), perm = usePermisos();
  return (
    <article className={`bg-surface-container-lowest rounded-2xl shadow-sm p-4 flex flex-col gap-3 ${r ? 'ring-1 ring-error/25' : ''}`}>
      <button onClick={() => abrirFicha(p.sku)} className="flex gap-3 text-left"><Tile p={p} size="w-14 h-14" />
        <div className="min-w-0 flex-1">
          <div className="flex justify-between items-start gap-2"><span className={`font-mono text-label-sm ${r ? 'text-error' : 'text-secondary'} truncate`}>SKU: {p.sku}</span><Pill p={p} short /></div>
          <h3 className="text-[17px] font-semibold leading-snug line-clamp-2 mt-0.5">{p.name}</h3>
          {(esCustodia(p) || p.borrador) && <div className="flex gap-1 mt-1"><TagCustodia p={p} />{p.borrador && <Tag c="bg-amber-100 text-amber-800">Borrador</Tag>}</div>}
          <div className="text-body-sm text-secondary mt-1 truncate">{contenidoTxt(p) || p.packLabel || catDe(p.cat).label}</div>
        </div>
      </button>
      {r && <div className="flex items-center gap-3 bg-error-container/50 rounded-xl p-3"><Icon n="warning" className="text-error" />
        <div className="flex-1 min-w-0"><div className="font-mono text-label-md text-error font-semibold uppercase">{vista(p, p.stock).principal} restante{p.stock === 1 ? '' : 's'} (mín: {vista(p, p.min).principal})</div><div className="text-body-sm text-on-surface-variant">en el almacén</div></div>
        {pedido ? <span className="font-mono text-label-sm text-amber-800 bg-amber-100 px-2 py-1 rounded">PEDIDO</span>
          : (perm.mod('inventario')) && <button onClick={() => pedir(p.sku)} className="shrink-0 inline-flex items-center gap-1 bg-error text-white px-3 h-10 rounded-lg font-mono text-label-md"><Icon n="local_shipping" className="ico-18" />PEDIR</button>}
      </div>}
      <div className="grid grid-cols-3 bg-surface-container-low rounded-xl p-3 text-center">
        <div><div className={LBL}>Almacén</div><Cantidad p={p} formatos={p.stock} className={`text-headline-md font-bold ${r ? 'text-error' : 'text-primary'}`} sub="text-label-sm text-secondary" /></div>
        <div><div className={LBL}>Mínimo</div><Cantidad p={p} formatos={p.min} className="text-headline-md font-bold" sub="text-label-sm text-secondary" /></div>
        <div><div className={LBL}>En vehículos</div><Cantidad p={p} formatos={redondea(total - p.stock)} className="text-headline-md font-bold text-violet-800" sub="text-label-sm text-secondary" /></div>
      </div>
      {perm.mod('movimientos') && <div className="grid grid-cols-[1fr_auto_auto] gap-2">
        {perm.mod('movimientos') && <button onClick={() => abrirMovimiento(p.sku, 'salida')} disabled={p.stock <= 0} className={`${BTN_P} h-14 text-body-lg`}><Icon n="outbox" className="ico-fill" />Registrar salida</button>}
        {perm.mod('entregas') && <button onClick={() => { anadirACesta(p.sku); toast('Añadido a la entrega. Ve a “Entrega” para firmar.', 'ok'); }} className="w-14 h-14 rounded-lg bg-surface-container-low text-primary grid place-items-center" aria-label="Añadir a la entrega"><Icon n="add_shopping_cart" /></button>}
        {perm.mod('movimientos') && <button onClick={() => abrirMovimiento(p.sku, 'entrada')} className="w-14 h-14 rounded-lg bg-surface-container-low text-tertiary grid place-items-center" aria-label="Registrar entrada"><Icon n="move_to_inbox" /></button>}
      </div>}
    </article>
  );
}

function VanView() {
  const E = useAlmacen(), u = useUI(), v = E.vehiculos.find(x => x.id === u.almacen), perm = usePermisos();
  const [todo, setTodo] = useState(false), [abierto, setAbierto] = useState<string | null>(null);
  if (!v) { setTimeout(() => setUI({ almacen: 'central' })); return null; }
  const eq = E.equipos.find(e => e.vehiculo === v.id), vs = stockDeVehiculo(E, v.id);
  return (
    <div className="px-4 lg:px-gutter py-4 lg:py-space-lg flex flex-col gap-space-md max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><span className={LBL}>Stock a bordo · entregado − consumido − devuelto</span><h1 className="text-headline-lg-mobile lg:text-headline-lg font-bold">{v.matricula}{v.modelo ? ` · ${v.modelo}` : ''}</h1>
          <p className="text-secondary">{eq ? `${eq.nombre} · ${eq.tecnicos.map(t => E.tecnicos.find(x => x.id === t)?.nombre).join(' + ') || 'sin técnicos'}` : 'Sin equipo asignado (p. ej. en taller)'}</p></div>
        <div className="flex gap-2"><button onClick={() => setUI({ almacen: 'central' })} className={`${BTN_S} px-4 h-12`}><Icon n="warehouse" className="ico-20" />Volver al almacén</button>
          {eq && (perm.mod('entregas')) && <button onClick={() => asignar(eq.id, [])} className={`${BTN_P} px-4 h-12`}><Icon n="add_shopping_cart" className="ico-20" />Cargar material</button>}</div>
      </div>
      {/* E-025: todo el catálogo, también lo que lleva 0 ud y lo recién creado, para asignarlo con una entrega firmada */}
      <label className="inline-flex items-center gap-3 self-start bg-surface-container-low rounded-xl px-4 h-12 cursor-pointer font-semibold">
        <input type="checkbox" checked={todo} onChange={e => setTodo(e.target.checked)} className="w-5 h-5 accent-primary" />Mostrar todo el catálogo</label>
      {todo ? <CatalogoVehiculo vehiculo={v.id} equipo={eq?.id} />
        : <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{vs.length ? vs.map(x => { const p = find(E, x.sku)!; return (
        <article key={x.sku} className={`${CARD} p-4 flex flex-wrap gap-3 items-center ${x.qty < 0 ? 'ring-1 ring-error/40' : ''} ${abierto === x.sku ? 'md:col-span-2' : ''}`}><Tile p={p} />
          <button onClick={() => setAbierto(abierto === x.sku ? null : x.sku)} className="flex-1 min-w-0 text-left" aria-expanded={abierto === x.sku}><div className="font-mono text-label-sm text-secondary flex items-center gap-1"><Icon n={abierto === x.sku ? 'expand_more' : 'chevron_right'} className="ico-16 text-primary" />{p.sku}</div><div className="font-semibold truncate">{p.name}</div>
            {x.qty < 0 && <div className="text-body-sm text-error">Discrepancia: consta más gastado que entregado</div>}<div className="text-label-sm text-primary">{abierto === x.sku ? 'Ocultar movimientos' : 'Ver movimientos y saldo'}</div></button>
          <div className="text-right"><Cantidad p={p} unidades={x.unidades} className={`text-headline-md font-bold whitespace-nowrap ${x.qty < 0 ? 'text-error' : ''}`} />
            {x.qty >= 1 && (perm.mod('movimientos')) && <button onClick={() => abrirMovimiento(p.sku, 'devolucion', { vehiculo: v.id, qty: Math.floor(x.qty), lock: true, ref: `Devuelto de ${v.matricula}` })} className="font-mono text-label-sm text-primary h-10">Devolver ↩</button>}</div>
          {abierto === x.sku && <div className="w-full border-t border-surface-container pt-3"><ExtractoArticulo vehiculo={v.id} sku={p.sku} /></div>}
        </article>); }) : <div className={`${CARD} p-8 text-center text-secondary md:col-span-2`}>Este vehículo no lleva material del almacén. Activa <b>Mostrar todo el catálogo</b> para asignarle artículos.</div>}</div>}
    </div>
  );
}

/** E-025 · Prepara la entrega para el equipo con esos artículos en la cesta y abre "Nueva entrega" (la firma es la de siempre) */
function asignar(equipo: string, skus: string[]) {
  const E = S(), c = E.cesta;
  if (c.lineas.length && c.equipo && c.equipo !== equipo) {
    const otro = E.equipos.find(x => x.id === c.equipo)?.nombre || c.equipo;
    if (!confirm(`La entrega en curso es para ${otro} (${c.lineas.length} artículo${c.lineas.length === 1 ? '' : 's'}). ¿Vaciarla y empezar una para este equipo?`)) return;
  }
  const r = asignarAEquipo(E, c, equipo, skus);
  guardar();
  if (r.avisos.length) toast(r.avisos.join(' · '), 'warn', 7000);
  else if (skus.length) toast(`${r.anadidos.length} artículo${r.anadidos.length === 1 ? '' : 's'} en la entrega: revisa las cantidades y firma.`, 'ok');
  ir('entregas');
}

function CatalogoVehiculo({ vehiculo, equipo: eqId }: { vehiculo: string; equipo?: string }) {
  const E = useAlmacen(), equipo = usePermisos().mod('entregas') ? eqId : undefined;   // sin permiso de entregas, la lista se ve pero no asigna
  const [q, setQ] = useState(''), [sel, setSel] = useState<string[]>([]);
  const { lista } = useListaArticulos(q);                                  // sin borradores; los archivados no están en el catálogo
  const { visibles, centinela } = useProgresivo(lista, q);
  const alternar = (sku: string) => setSel(x => (x.includes(sku) ? x.filter(y => y !== sku) : [...x, sku]));
  return (<section className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[220px]"><Icon n="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline ico-20" />
        <input value={q} onChange={e => setQ(e.target.value)} type="search" placeholder="Nombre, SKU, EAN o código" className={`${INP} h-12 pl-10`} aria-label="Buscar en el catálogo" /></div>
      <OrdenArticulos agrupar={false} />
    </div>
    {!eqId && <p className="text-body-sm text-amber-800 bg-amber-50 rounded-lg p-3">Este vehículo no tiene equipo: asígnalo a un equipo para entregarle material.</p>}
    {sel.length > 0 && equipo && <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 bg-primary-fixed rounded-xl p-3 shadow-sm">
      <span className="flex-1 font-semibold">{sel.length} seleccionado{sel.length === 1 ? '' : 's'}</span>
      <button onClick={() => setSel([])} className={`${BTN_S} h-11 px-3`}>Quitar selección</button>
      <button onClick={() => asignar(equipo, sel)} className={`${BTN_P} h-11 px-4`}><Icon n="add_shopping_cart" className="ico-20" />Asignar seleccionados</button></div>}
    <p className="font-mono text-label-sm text-secondary">{lista.length} artículos del catálogo · a bordo y sin cargar</p>
    <div className="flex flex-col gap-2">{visibles.map(p => { const ud = unidadesABordo(E, vehiculo, p.sku), q2 = redondea(ud / (p.contenido || 1)), marcado = sel.includes(p.sku); return (
      <div key={p.sku} className={`${CARD} p-3 flex items-center gap-3 ${marcado ? 'ring-2 ring-primary' : ''}`}>
        {equipo && <input type="checkbox" checked={marcado} onChange={() => alternar(p.sku)} className="w-6 h-6 accent-primary shrink-0" aria-label={`Seleccionar ${p.name}`} />}
        <Tile p={p} size="w-11 h-11" />
        <button onClick={() => abrirExtracto(vehiculo, p.sku)} className="w-10 h-11 shrink-0 grid place-items-center text-primary" aria-label={`Movimientos de ${p.name} en este vehículo`} title="Movimientos y saldo"><Icon n="receipt_long" className="ico-20" /></button>
        <button onClick={() => abrirFicha(p.sku)} className="flex-1 min-w-0 text-left"><div className="font-semibold truncate">{p.name}</div>
          <div className="font-mono text-label-sm text-secondary">{p.sku} · almacén {qtyTxt(p, p.stock)}</div></button>
        <div className={`text-right whitespace-nowrap font-semibold ${q2 < 0 ? 'text-error' : q2 === 0 ? 'text-secondary' : ''}`}><Cantidad p={p} unidades={ud} sub="font-mono text-label-sm text-secondary font-normal" /><div className={LBL}>a bordo</div></div>
        {equipo && <button onClick={() => asignar(equipo, [p.sku])} className={`${BTN_S} h-11 px-3 shrink-0`}>Asignar</button>}
      </div>); })}</div>
    <div ref={centinela} />
  </section>);
}
