/* Stock general: panel de escritorio, inventario móvil y stock a bordo de un vehículo (E-013: sin precios ni estanterías) */
import type { Estado, Producto } from '../../data/tipos';
import { CATS, MARCA, UNIT } from '../../data/catalogo';
import { contenidoTxt, critical, esCustodia, find, nombreVehiculo, ORD, qtyTxt, searchProducts, status, stockDeVehiculo, stockTotal } from '../../domain/reglas';
import { esHoy, fechaHora, hace, hoyISO, initials, num, redondea } from '../../domain/formato';
import { descargarCsv } from '../../domain/csv';
import { S, ultimoGuardado, useAlmacen } from '../../store/almacen';
import { ir, setUI, useEsEscritorio, useUI } from '../../store/ui';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, BTN_T, CARD, INP, Icon, Kpi, LBL, Pill, ST, Tag, TagCustodia, Tile } from '../../ui/base';
import { FotoProducto } from '../../ui/foto';
import { usePermisos } from '../../store/permisos';
import { abrirBorrador, abrirConteo, abrirFicha, abrirFormProducto, abrirMovimiento, pedir, Ubicaciones } from './hojas';
import { anadirACesta } from '../entregas/cesta';
import { iaEtiqueta } from '../albaranes/lector';
import { abrirAltaCamara } from '../altaCamara/AltaCamara';

export function exportarStockCsv(E: Estado = S()) {
  descargarCsv(`stock-${hoyISO()}.csv`, [['SKU', 'Nombre', 'Categoría', 'Propiedad', 'Almacén', 'En vehículos', 'Total', 'Unidad', 'Contenido', 'Mínimo almacén', 'Estado', 'Proveedor', 'Código proveedor', 'EAN'],
    ...E.products.map(p => { const t = stockTotal(E, p); return [p.sku, p.name, CATS[p.cat].label, esCustodia(p) ? `Custodia ${E.propietarios.find(o => o.id === p.propietario)?.nombre || ''}` : 'Propio',
      p.stock, redondea(t - p.stock), t, UNIT[p.unit], p.contenido || 1, p.minimoDefinido === false ? '' : p.min, ST[status(p)].t, p.supplier, p.supplierRef || '', p.ean || '']; })]);
}
export function exportarMovimientosCsv(E: Estado = S()) {
  descargarCsv(`movimientos-${hoyISO()}.csv`, [['Fecha', 'Tipo', 'SKU', 'Material', 'Cantidad', 'Unidad', 'Motivo', 'Referencia', 'Vehículo', 'Operario'],
    ...E.movements.map(m => { const p = find(E, m.sku); return [fechaHora(m.ts), m.type, m.sku, p ? p.name : '', m.qty, p ? UNIT[p.unit] : '', m.reason, m.ref, m.vehiculo ? nombreVehiculo(E, m.vehiculo) : '', m.operator]; })]);
}

export default function StockView() {
  const u = useUI(), desk = useEsEscritorio();
  if (u.almacen !== 'central') return <VanView />;
  return desk ? <StockDesk /> : <StockMob />;
}

function Kpis() {
  const E = useAlmacen();
  const cust = E.products.filter(esCustodia), custMal = cust.filter(p => status(p) !== 'green').length, custRojo = cust.filter(p => status(p) === 'red').length;
  const crit = critical(E), sup = new Set(crit.map(p => p.supplier)).size, n = E.products.length || 1;
  const entHoy = E.entregas.filter(e => esHoy(e.ts) && e.estado !== 'anulada'), firm = entHoy.filter(e => (e.estado ?? 'firmada') === 'firmada').length;
  const conCarga = E.vehiculos.filter(v => stockDeVehiculo(E, v.id).length).length, green = E.products.filter(p => status(p) === 'green').length;
  const sinMinimo = E.products.filter(p => p.minimoDefinido === false).length;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
      <Kpi icon="category" iconC="bg-surface-container-low text-primary" badge={<><Icon n="check_circle" className="ico-16" /> {Math.round(green / n * 100)}% OK</>} badgeC="text-tertiary bg-tertiary-fixed/30"
        value={num(E.products.length)} label="Referencias activas" foot={sinMinimo ? 'Sin mínimo definido' : 'Vehículos con material'} footVal={sinMinimo ? `${sinMinimo} por completar` : `${conCarga} de ${E.vehiculos.length}`} footC={sinMinimo ? 'text-amber-800' : undefined} bar={green / n * 100} barC="bg-primary" onClick={() => setUI({ est: 'all', page: 1 })} />
      <Kpi icon="handshake" iconC="bg-violet-100 text-violet-800" badge={custRojo ? `${custRojo} en rojo` : custMal ? `${custMal} bajos` : 'Todo en verde'} badgeC={custRojo ? 'bg-error-container text-error' : custMal ? 'bg-amber-100 text-amber-800' : 'bg-tertiary-fixed/30 text-tertiary'}
        value={num(cust.reduce((a, p) => a + stockTotal(E, p), 0))} label="En custodia de Esmove" foot="Referencias" footVal={`${cust.length} · almacén + vehículos`} footC="text-violet-800" bar={cust.length ? (cust.length - custMal) / cust.length * 100 : 0} barC="bg-violet-500" onClick={() => setUI({ prop: 'custodia', page: 1 })} />
      <Kpi icon="warning" iconC="bg-error-container text-error" badge={crit.length ? 'Urgente' : 'Sin alertas'} badgeC={crit.length ? 'text-error font-semibold bg-error-container' : 'text-tertiary bg-tertiary-fixed/30'}
        value={crit.length} valueC={crit.length ? 'text-error' : undefined} label="Bajo mínimo en el almacén" foot="Reposición pendiente" footVal={`${sup} proveedor${sup === 1 ? '' : 'es'}`} footC="text-error"
        bar={crit.length / n * 400} barC="bg-error" onClick={() => setUI({ est: 'red', page: 1 })} />
      <Kpi icon="assignment_turned_in" iconC="bg-tertiary-fixed/40 text-tertiary" badge={entHoy.length ? `${Math.round(firm / entHoy.length * 100)}% firmadas` : 'Sin entregas hoy'} badgeC="text-tertiary font-semibold bg-tertiary-fixed/30"
        value={`${firm} / ${entHoy.length}`} label="Entregas firmadas hoy" foot="Equipos en ruta" footVal={`${E.equipos.filter(e => e.estado === 'ruta').length} de ${E.equipos.length}`} footC="text-tertiary" bar={entHoy.length ? firm / entHoy.length * 100 : 0} barC="bg-tertiary" onClick={() => ir('entregas')} />
    </div>
  );
}

function StockDesk() {
  const E = useAlmacen(), u = useUI(), perm = usePermisos();
  const lista = searchProducts(E, u.q, u), PER = 8, pages = Math.max(1, Math.ceil(lista.length / PER)), page = Math.min(u.page, pages);
  const pag = lista.slice((page - 1) * PER, page * PER);
  const catProds = E.products.filter(p => p.cat === u.catTab).sort((a, b) => ORD[status(a)] - ORD[status(b)] || a.name.localeCompare(b.name)).slice(0, 3);
  const ultAlb = E.albaranes[0], ultEnt = [...E.entregas].sort((a, b) => b.ts - a.ts)[0];
  // recuento cíclico semanal: una categoría cada semana (ya no hay pasillos)
  const cats = Object.keys(CATS).filter(k => E.products.some(p => p.cat === k)), semana = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 6048e5), catAud = cats[semana % Math.max(1, cats.length)] || 'all';
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
          {perm.configurar && <button onClick={() => exportarStockCsv()} className={`${BTN_S} px-space-md py-2.5`}><Icon n="file_download" className="text-secondary ico-20" />Exportar CSV</button>}
          <button onClick={() => abrirAltaCamara()} className={`${BTN_P} px-space-md h-14`}><Icon n="add_a_photo" className="ico-20" />Nuevo con la cámara</button>
          <button onClick={() => perm.editarCatalogo ? abrirFormProducto() : abrirBorrador()} className={`${BTN_S} px-space-md py-2.5`}><Icon n="add_circle" className="ico-20" />{perm.editarCatalogo ? 'Añadir referencia' : 'Nueva referencia (borrador)'}</button>
        </div>
      </div>
      <Kpis />
      <div className="grid grid-cols-12 gap-space-lg items-start">
        <div className="col-span-12 2xl:col-span-8 flex flex-col gap-space-lg min-w-0">
          <section className={`${CARD} p-space-md flex flex-col gap-space-md`}>
            <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-space-sm">
              <div><h2 className="text-headline-md font-semibold">Categorías estratégicas</h2><p className="text-body-sm text-secondary">Lo más urgente de cada familia: primero lo que está en rojo.</p></div>
              <div className="inline-flex bg-surface-container-low p-1 rounded-lg overflow-x-auto no-scrollbar max-w-full">
                {Object.entries(CATS).map(([k, c]) => <button key={k} onClick={() => setUI({ catTab: k })} className={`px-3 py-1.5 rounded-md whitespace-nowrap text-body-md font-semibold transition-all ${u.catTab === k ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}>{c.label}</button>)}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
              {catProds.length ? catProds.map(p => { const r = status(p) === 'red'; return (
                <button key={p.sku} onClick={() => abrirFicha(p.sku)} className={`text-left p-space-md rounded-xl ${r ? 'bg-error-container/40' : 'bg-surface-container-low'} hover:shadow-md transition-shadow flex flex-col gap-space-sm`}>
                  <div className="flex justify-between items-start gap-2"><span className="font-mono text-label-sm text-secondary break-all">SKU: {p.sku}</span><Pill p={p} short /></div>
                  <div className="relative"><FotoProducto p={p} size="h-24 w-full" alerta={r} icono="ico-40" />{contenidoTxt(p) && <span className="absolute bottom-2 left-2 font-mono text-label-sm bg-white/85 text-on-surface px-2 py-0.5 rounded">{contenidoTxt(p)}</span>}</div>
                  <div><h3 className="text-headline-sm font-semibold line-clamp-2">{p.name}</h3><p className="text-body-sm text-secondary">{p.supplier}</p></div>
                  <div className="flex justify-between items-end pt-space-sm border-t border-surface-container-high">
                    <div><span className={LBL}>En almacén</span><div className={`text-headline-md font-bold ${r ? 'text-error' : ''}`}>{qtyTxt(p, p.stock)}</div></div>
                    <div className="text-right"><span className={LBL}>{r ? 'Faltan' : 'Mínimo'}</span><div className={`font-mono text-label-md ${r ? 'text-error font-semibold' : 'text-primary'}`}>{qtyTxt(p, r ? p.min - p.stock : p.min)}</div></div>
                  </div>
                </button>); }) : <p className="text-secondary">Sin productos en esta categoría.</p>}
            </div>
          </section>

          <section className={`${CARD} overflow-hidden`}>
            <div className="p-space-md flex flex-wrap items-center gap-space-sm">
              <div className="relative flex-1 min-w-[220px]"><Icon n="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline ico-20" />
                <input value={u.q} onChange={e => setUI({ q: e.target.value, page: 1 })} type="search" placeholder="Filtrar por nombre, SKU, código o proveedor…" className={`${INP} pl-10`} /></div>
              <select value={u.cat} onChange={e => setUI({ cat: e.target.value, page: 1 })} className={`${INP} ${sel}`} aria-label="Categoría"><option value="all">Categoría: todas</option>{Object.entries(CATS).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select>
              <select value={u.est} onChange={e => setUI({ est: e.target.value, page: 1 })} className={`${INP} ${sel}`} aria-label="Estado"><option value="all">Estado: todos</option>{(['red', 'amber', 'green'] as const).map(s => <option key={s} value={s}>{ST[s].t}</option>)}</select>
              <select value={u.prop} onChange={e => setUI({ prop: e.target.value, page: 1 })} className={`${INP} ${sel}`} aria-label="Propiedad"><option value="all">Propiedad: todo</option><option value="propia">Material propio</option><option value="custodia">En custodia</option></select>
              <select value={u.ubi} onChange={e => setUI({ ubi: e.target.value, page: 1 })} className={`${INP} ${sel}`} aria-label="Ubicación"><option value="all">Ubicación: todas</option><option value="almacen">Almacén</option>{E.vehiculos.map(v => <option key={v.id} value={v.id}>{nombreVehiculo(E, v.id)}</option>)}</select>
              <span className="font-mono text-label-sm text-secondary ml-auto">Mostrando {pag.length} de {lista.length} referencias</span>
            </div>
            <div className="overflow-x-auto"><table className="tabla w-full min-w-[860px]">
              <thead className="bg-surface-container-low"><tr><th>Referencia / SKU</th><th>Descripción</th><th>Dónde está</th><th>Almacén</th><th>Estado</th><th className="text-right">Acciones</th></tr></thead>
              <tbody>{pag.length ? pag.map(p => <FilaStock key={p.sku} p={p} pedido={!!E.pedidos[p.sku]} />)
                : <tr><td colSpan={6} className="text-center text-secondary py-10">No hay referencias con esos filtros. <button onClick={limpiarFiltros} className="text-primary font-semibold">Quitar filtros</button></td></tr>}</tbody>
            </table></div>
            <div className="p-space-md flex items-center justify-between border-t border-surface-container">
              <span className="font-mono text-label-sm text-secondary">Página {page} de {pages}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setUI({ page: page - 1 })} disabled={page <= 1} className="px-3 py-1 rounded font-mono text-label-sm bg-surface-container-low disabled:opacity-40">Anterior</button>
                {Array.from({ length: pages }, (_, i) => <button key={i} onClick={() => setUI({ page: i + 1 })} className={`w-8 h-7 rounded font-mono text-label-sm ${page === i + 1 ? 'bg-primary text-white' : 'bg-surface-container-low'}`}>{i + 1}</button>)}
                <button onClick={() => setUI({ page: page + 1 })} disabled={page >= pages} className="px-3 py-1 rounded font-mono text-label-sm bg-surface-container-low disabled:opacity-40">Siguiente</button>
              </div>
            </div>
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
            <button onClick={() => ir('albaranes')} className={`${BTN_P} py-2.5`}><Icon n="document_scanner" className="ico-20" />Leer un albarán</button>
          </section>
          <Barras E={E} />
          <section className="bg-primary-fixed/50 rounded-xl p-space-md flex items-center justify-between gap-space-md">
            <div><h3 className="text-headline-sm font-semibold">Recuento cíclico semanal</h3><p className="text-body-sm text-secondary">{CATS[catAud as keyof typeof CATS]?.label || 'Almacén'} · {E.products.filter(p => p.cat === catAud).length} referencias a recontar</p></div>
            <button onClick={() => abrirConteo(catAud)} className={`${BTN_S} px-3 py-2 text-body-sm`}>Iniciar conteo</button>
          </section>
        </div>
      </div>
    </div>
  );
}

const limpiarFiltros = () => setUI({ q: '', est: 'all', ubi: 'all', cat: 'all', prop: 'all', page: 1 });

function FilaStock({ p, pedido }: { p: Producto; pedido: boolean }) {
  const r = status(p) === 'red';
  return (
    <tr className={r ? 'bg-error-container/20' : ''}>
      <td><div className="flex items-center gap-2"><Icon n={r ? 'warning' : 'qr_code_2'} className={`${r ? 'text-error' : 'text-secondary'} ico-20`} /><div><div className={`font-mono text-label-md ${r ? 'text-error' : ''} break-all`}>{p.sku}</div>{p.ean && <div className="font-mono text-label-sm text-secondary">EAN {p.ean}</div>}</div></div></td>
      <td className="max-w-[340px]"><button onClick={() => abrirFicha(p.sku)} className="text-left flex items-center gap-3"><Tile p={p} size="w-11 h-11" /><div><div className="font-semibold hover:text-primary">{p.name}</div><div className="text-body-sm text-secondary">{CATS[p.cat].label} · {p.supplier}{contenidoTxt(p) ? ` · ${contenidoTxt(p)}` : ''}</div></div></button><div className="flex flex-wrap gap-1 mt-1"><TagCustodia p={p} />{p.borrador && <Tag c="bg-amber-100 text-amber-800">Borrador</Tag>}{pedido && <Tag c="bg-amber-100 text-amber-800">Pedido en curso</Tag>}</div></td>
      <td className="max-w-[260px]"><Ubicaciones p={p} /></td>
      <td><div className={`text-headline-sm font-bold ${r ? 'text-error' : ''}`}>{qtyTxt(p, p.stock)}</div><div className={`font-mono text-label-sm ${r ? 'text-error' : 'text-secondary'}`}>Mín: {p.minimoDefinido === false ? 'sin definir' : num(p.min)}</div></td>
      <td><Pill p={p} /></td>
      <td className="text-right whitespace-nowrap">
        <button onClick={() => abrirMovimiento(p.sku, 'entrada')} title="Registrar entrada" className="p-2 rounded-lg text-tertiary hover:bg-tertiary-fixed/30"><Icon n="add_circle" /></button>
        <button onClick={() => abrirMovimiento(p.sku, 'salida')} title="Registrar salida" className="p-2 rounded-lg text-primary hover:bg-primary-fixed"><Icon n="remove_circle" /></button>
        <button onClick={() => abrirMovimiento(p.sku, 'merma')} title="Registrar merma" className="p-2 rounded-lg text-error hover:bg-error-container"><Icon n="report" /></button>
      </td>
    </tr>
  );
}

function Barras({ E }: { E: Estado }) {
  const rows = Object.entries(CATS).map(([k, c]) => { const ps = E.products.filter(p => p.cat === k); return { k, c, n: ps.length, r: ps.filter(p => status(p) === 'red').length, a: ps.filter(p => status(p) === 'amber').length, g: ps.filter(p => status(p) === 'green').length }; }).filter(x => x.n);
  const max = Math.max(1, ...rows.map(r => r.n));
  return (
    <section className={`${CARD} p-space-md`}>
      <div className="flex justify-between items-start"><h2 className="text-headline-md font-semibold">Referencias por categoría</h2><span className="font-mono text-label-sm text-secondary">semáforo</span></div>
      <div className="flex flex-col gap-2.5 mt-space-md">{rows.map(r =>
        <button key={r.k} onClick={() => setUI({ cat: r.k, page: 1 })} className="text-left group">
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
  const E = useAlmacen(), u = useUI();
  const lista = searchProducts(E, u.q, u), nCrit = critical(E).length;
  const chip = (k: string, lbl: string, n: number) =>
    <button key={k} onClick={() => setUI({ cat: u.cat === k ? 'all' : k })} className={`shrink-0 inline-flex items-center gap-2 px-4 h-11 rounded-full font-mono text-label-md uppercase ${u.cat === k ? 'bg-primary text-white' : 'bg-surface-container-lowest text-on-surface shadow-sm'}`}>{lbl}<span className={`px-1.5 rounded ${u.cat === k ? 'bg-white/20' : 'bg-surface-container-high'}`}>{n}</span></button>;
  const hayFiltro = u.est !== 'all' || u.ubi !== 'all' || u.prop !== 'all';
  return (
    <div className="px-4 pt-4 flex flex-col gap-4">
      <div className="flex items-center gap-3 bg-surface-container-low rounded-xl p-3">
        <span className="w-10 h-10 rounded-lg bg-white grid place-items-center text-primary"><Icon n="sensors" /></span>
        <div className="flex-1 min-w-0"><div className="font-semibold flex items-center gap-1.5">{MARCA.nave}<span className="w-2 h-2 rounded-full bg-tertiary-container" /></div><div className="font-mono text-label-sm text-secondary truncate">Guardado {hace(ultimoGuardado)} · {E.operator}</div></div>
        {nCrit > 0 && <button onClick={() => setUI({ est: 'red' })} className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-error-container text-error font-mono text-label-md"><Icon n="warning" className="ico-18" />{nCrit}</button>}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1"><Icon n="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
          <input value={u.q} onChange={e => setUI({ q: e.target.value })} type="search" placeholder="Nombre, SKU o código" className="w-full h-14 pl-11 pr-3 rounded-xl bg-surface-container-lowest shadow-sm text-body-lg focus:outline-none focus:ring-2 focus:ring-primary" /></div>
        <button onClick={() => ir('scan')} className="w-14 h-14 rounded-xl bg-primary text-white grid place-items-center shadow-sm" aria-label="Escanear"><Icon n="barcode_scanner" className="ico-28" /></button>
        <button onClick={() => setUI({ filtros: !u.filtros })} className={`w-14 h-14 rounded-xl ${u.filtros || hayFiltro ? 'bg-primary-fixed text-primary' : 'bg-surface-container-low'} grid place-items-center`} aria-label="Filtros"><Icon n="tune" className="ico-28" /></button>
      </div>
      <button onClick={() => abrirAltaCamara()} className={`${BTN_P} h-14 text-body-lg`}><Icon n="add_a_photo" className="ico-28" />Nuevo con la cámara</button>
      {u.filtros && <div className="grid grid-cols-2 gap-2 bg-surface-container-lowest rounded-xl p-3 shadow-sm">
        <label className="flex flex-col gap-1"><span className={LBL}>Estado</span><select value={u.est} onChange={e => setUI({ est: e.target.value })} className={`${INP} h-12`}>{[['all', 'Todos'], ['red', 'Crítico'], ['amber', 'Bajo'], ['green', 'Correcto']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <label className="flex flex-col gap-1"><span className={LBL}>Dónde</span><select value={u.ubi} onChange={e => setUI({ ubi: e.target.value })} className={`${INP} h-12`}><option value="all">Todo</option><option value="almacen">Almacén</option>{E.vehiculos.map(v => <option key={v.id} value={v.id}>{nombreVehiculo(E, v.id)}</option>)}</select></label>
        <label className="col-span-2 flex flex-col gap-1"><span className={LBL}>Propiedad</span><select value={u.prop} onChange={e => setUI({ prop: e.target.value })} className={`${INP} h-12`}><option value="all">Todo</option><option value="propia">Material propio</option><option value="custodia">En custodia de Esmove</option></select></label>
        <button onClick={limpiarFiltros} className={`col-span-2 ${BTN_T} h-11`}>Quitar filtros</button>
      </div>}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">{chip('all', 'Todos', E.products.length)}{Object.entries(CATS).map(([k, c]) => chip(k, c.label, E.products.filter(p => p.cat === k).length))}</div>
      {(hayFiltro || u.q) && <div className="flex items-center justify-between font-mono text-label-sm text-secondary"><span>{lista.length} resultado{lista.length === 1 ? '' : 's'}{u.est !== 'all' && ` · ${ST[u.est as 'red'].t}`}{u.ubi !== 'all' && ` · ${u.ubi === 'almacen' ? 'Almacén' : nombreVehiculo(E, u.ubi)}`}</span><button onClick={limpiarFiltros} className="text-primary">Limpiar</button></div>}
      <div className="flex flex-col gap-4">{lista.length ? lista.map(p => <CardMob key={p.sku} p={p} pedido={!!E.pedidos[p.sku]} />)
        : <div className="text-center text-secondary py-12">Nada coincide con “{u.q}”.<br /><button onClick={limpiarFiltros} className="text-primary font-semibold mt-2">Ver todo</button></div>}</div>
    </div>
  );
}

function CardMob({ p, pedido }: { p: Producto; pedido: boolean }) {
  const E = useAlmacen(), r = status(p) === 'red', total = stockTotal(E, p);
  return (
    <article className={`bg-surface-container-lowest rounded-2xl shadow-sm p-4 flex flex-col gap-3 ${r ? 'ring-1 ring-error/25' : ''}`}>
      <button onClick={() => abrirFicha(p.sku)} className="flex gap-3 text-left"><Tile p={p} size="w-14 h-14" />
        <div className="min-w-0 flex-1">
          <div className="flex justify-between items-start gap-2"><span className={`font-mono text-label-sm ${r ? 'text-error' : 'text-secondary'} truncate`}>SKU: {p.sku}</span><Pill p={p} short /></div>
          <h3 className="text-[17px] font-semibold leading-snug line-clamp-2 mt-0.5">{p.name}</h3>
          {(esCustodia(p) || p.borrador) && <div className="flex gap-1 mt-1"><TagCustodia p={p} />{p.borrador && <Tag c="bg-amber-100 text-amber-800">Borrador</Tag>}</div>}
          <div className="text-body-sm text-secondary mt-1 truncate">{contenidoTxt(p) || p.packLabel || CATS[p.cat].label}</div>
        </div>
      </button>
      {r && <div className="flex items-center gap-3 bg-error-container/50 rounded-xl p-3"><Icon n="warning" className="text-error" />
        <div className="flex-1 min-w-0"><div className="font-mono text-label-md text-error font-semibold uppercase">{qtyTxt(p, p.stock)} restante{p.stock === 1 ? '' : 's'} (mín: {num(p.min)})</div><div className="text-body-sm text-on-surface-variant">en el almacén</div></div>
        {pedido ? <span className="font-mono text-label-sm text-amber-800 bg-amber-100 px-2 py-1 rounded">PEDIDO</span>
          : <button onClick={() => pedir(p.sku)} className="shrink-0 inline-flex items-center gap-1 bg-error text-white px-3 h-10 rounded-lg font-mono text-label-md"><Icon n="local_shipping" className="ico-18" />PEDIR</button>}
      </div>}
      <div className="grid grid-cols-3 bg-surface-container-low rounded-xl p-3 text-center">
        <div><div className={LBL}>Almacén</div><div className={`text-headline-md font-bold ${r ? 'text-error' : 'text-primary'}`}>{num(p.stock)} <span className="text-body-sm font-normal text-secondary">{UNIT[p.unit]}</span></div></div>
        <div><div className={LBL}>Mínimo</div><div className="text-headline-md font-bold">{num(p.min)} <span className="text-body-sm font-normal text-secondary">{UNIT[p.unit]}</span></div></div>
        <div><div className={LBL}>En vehículos</div><div className="text-headline-md font-bold text-violet-800">{num(redondea(total - p.stock))}</div></div>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-2">
        <button onClick={() => abrirMovimiento(p.sku, 'salida')} disabled={p.stock <= 0} className={`${BTN_P} h-14 text-body-lg`}><Icon n="outbox" className="ico-fill" />Registrar salida</button>
        <button onClick={() => { anadirACesta(p.sku); toast('Añadido a la entrega. Ve a “Entrega” para firmar.', 'ok'); }} className="w-14 h-14 rounded-lg bg-surface-container-low text-primary grid place-items-center" aria-label="Añadir a la entrega"><Icon n="add_shopping_cart" /></button>
        <button onClick={() => abrirMovimiento(p.sku, 'entrada')} className="w-14 h-14 rounded-lg bg-surface-container-low text-tertiary grid place-items-center" aria-label="Registrar entrada"><Icon n="move_to_inbox" /></button>
      </div>
    </article>
  );
}

function VanView() {
  const E = useAlmacen(), u = useUI(), v = E.vehiculos.find(x => x.id === u.almacen);
  if (!v) { setTimeout(() => setUI({ almacen: 'central' })); return null; }
  const eq = E.equipos.find(e => e.vehiculo === v.id), vs = stockDeVehiculo(E, v.id);
  return (
    <div className="px-4 lg:px-gutter py-4 lg:py-space-lg flex flex-col gap-space-md max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><span className={LBL}>Stock a bordo · entregado − consumido − devuelto</span><h1 className="text-headline-lg-mobile lg:text-headline-lg font-bold">{v.matricula}{v.modelo ? ` · ${v.modelo}` : ''}</h1>
          <p className="text-secondary">{eq ? `${eq.nombre} · ${eq.tecnicos.map(t => E.tecnicos.find(x => x.id === t)?.nombre).join(' + ') || 'sin técnicos'}` : 'Sin equipo asignado (p. ej. en taller)'}</p></div>
        <div className="flex gap-2"><button onClick={() => setUI({ almacen: 'central' })} className={`${BTN_S} px-4 h-12`}><Icon n="warehouse" className="ico-20" />Volver al almacén</button>
          {eq && <button onClick={() => { E.cesta.equipo = eq.id; E.cesta.receptor = eq.tecnicos[0] ?? null; E.cesta.paso = eq.tecnicos[0] ? 2 : 1; ir('entregas'); }} className={`${BTN_P} px-4 h-12`}><Icon n="add_shopping_cart" className="ico-20" />Cargar material</button>}</div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{vs.length ? vs.map(x => { const p = find(E, x.sku)!; return (
        <article key={x.sku} className={`${CARD} p-4 flex gap-3 items-center ${x.qty < 0 ? 'ring-1 ring-error/40' : ''}`}><Tile p={p} />
          <div className="flex-1 min-w-0"><div className="font-mono text-label-sm text-secondary">{p.sku}</div><div className="font-semibold truncate">{p.name}</div>
            {contenidoTxt(p) && <div className="font-mono text-label-sm text-secondary">{num(x.unidades)} ud sueltas</div>}{x.qty < 0 && <div className="text-body-sm text-error">Discrepancia: consta más gastado que entregado</div>}</div>
          <div className="text-right"><div className={`text-headline-md font-bold ${x.qty < 0 ? 'text-error' : ''}`}>{qtyTxt(p, x.qty)}</div>
            {x.qty >= 1 && <button onClick={() => abrirMovimiento(p.sku, 'devolucion', { vehiculo: v.id, qty: Math.floor(x.qty), lock: true, ref: `Devuelto de ${v.matricula}` })} className="font-mono text-label-sm text-primary h-10">Devolver ↩</button>}</div>
        </article>); }) : <div className={`${CARD} p-8 text-center text-secondary md:col-span-2`}>Este vehículo no lleva material del almacén.</div>}</div>
    </div>
  );
}
