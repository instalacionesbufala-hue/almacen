/* Stock general: panel de escritorio, inventario móvil y stock a bordo de furgoneta */
import type { Estado, Producto } from '../../data/tipos';
import { CATS, MARCA, UNIT } from '../../data/catalogo';
import { aisle, aisles, critical, esCustodia, find, invValue, locTxt, ORD, qtyTxt, searchProducts, status, valorProducto, vanStock } from '../../domain/reglas';
import { esHoy, eur, fechaHora, hace, hoyISO, initials, num } from '../../domain/formato';
import { descargarCsv } from '../../domain/csv';
import { S, ultimoGuardado, useAlmacen } from '../../store/almacen';
import { ir, setUI, useEsEscritorio, useUI } from '../../store/ui';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, BTN_T, CARD, INP, Icon, Kpi, LBL, Pill, ST, Tag, TagCustodia, Tile } from '../../ui/base';
import { usePermisos } from '../../store/permisos';
import { abrirBorrador, abrirConteo, abrirFicha, abrirFormProducto, abrirMovimiento, pedir } from './hojas';
import { anadirACesta } from '../entregas/cesta';
import { iaEtiqueta } from '../albaranes/lector';

export function exportarStockCsv(E: Estado = S()) {
  descargarCsv(`stock-${hoyISO()}.csv`, [['SKU', 'Nombre', 'Categoría', 'Propiedad', 'Stock', 'Unidad', 'Mínimo', 'Estado', 'Ubicación', 'Proveedor', 'Código proveedor', 'Precio coste', 'Valor', 'EAN', 'N.º serie'],
    ...E.products.map(p => [p.sku, p.name, CATS[p.cat].label, esCustodia(p) ? `Custodia ${E.propietarios.find(o => o.id === p.propietario)?.nombre || ''}` : 'Propio', p.stock, UNIT[p.unit], p.min, ST[status(p)].t, p.loc, p.supplier, p.supplierRef || '',
      esCustodia(p) || E.rol !== 'admin' ? '' : p.price, esCustodia(p) || E.rol !== 'admin' ? '' : Math.round(valorProducto(p) * 100) / 100, p.ean || '', (p.serials || []).join(' ')])]);
}
export function exportarMovimientosCsv(E: Estado = S()) {
  descargarCsv(`movimientos-${hoyISO()}.csv`, [['Fecha', 'Tipo', 'SKU', 'Material', 'Cantidad', 'Unidad', 'Motivo', 'Referencia', 'Equipo', 'Operario', 'N.º serie'],
    ...E.movements.map(m => { const p = find(E, m.sku); return [fechaHora(m.ts), m.type, m.sku, p ? p.name : '', m.qty, p ? UNIT[p.unit] : '', m.reason, m.ref, m.equipo || '', m.operator, (m.serials || []).join(' ')]; })]);
}

export default function StockView() {
  const u = useUI(), desk = useEsEscritorio();
  if (u.almacen !== 'central') return <VanView />;
  return desk ? <StockDesk /> : <StockMob />;
}

function Kpis() {
  const E = useAlmacen(), { verCostes } = usePermisos();
  const val = invValue(E), cust = E.products.filter(esCustodia), custMal = cust.filter(p => status(p) !== 'green').length, custRojo = cust.filter(p => status(p) === 'red').length;
  const aparamenta = E.products.filter(p => p.cat === 'aparamenta' && !esCustodia(p)).reduce((a, p) => a + valorProducto(p), 0);
  const crit = critical(E), sup = new Set(crit.map(p => p.supplier)).size, n = E.products.length || 1;
  const entHoy = E.entregas.filter(e => esHoy(e.ts) && e.estado !== 'anulada'), firm = entHoy.filter(e => (e.estado ?? 'firmada') === 'firmada').length;
  const enRuta = E.equipos.filter(e => e.estado === 'ruta').length, green = E.products.filter(p => status(p) === 'green').length;
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-space-md ${verCostes ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
      <Kpi icon="category" iconC="bg-surface-container-low text-primary" badge={<><Icon n="check_circle" className="ico-16" /> {Math.round(green / n * 100)}% OK</>} badgeC="text-tertiary bg-tertiary-fixed/30"
        value={num(E.products.length)} label="Referencias activas" foot="Pasillos en uso" footVal={`${aisles(E).length} pasillos`} bar={green / n * 100} barC="bg-primary" onClick={() => setUI({ est: 'all', page: 1 })} />
      {verCostes && <Kpi icon="payments" iconC="bg-surface-container-low text-primary" badge="Solo material propio" badgeC="text-secondary bg-surface-container-high" value={eur(val)} label="Valor del inventario propio"
        foot="Aparamenta" footVal={`${eur(aparamenta)} (${Math.round(aparamenta / (val || 1) * 100)}%)`} footC="text-primary" bar={aparamenta / (val || 1) * 100} barC="bg-primary-container" />}
      <Kpi icon="handshake" iconC="bg-violet-100 text-violet-800" badge={custRojo ? `${custRojo} en rojo` : custMal ? `${custMal} bajos` : 'Todo en verde'} badgeC={custRojo ? 'bg-error-container text-error' : custMal ? 'bg-amber-100 text-amber-800' : 'bg-tertiary-fixed/30 text-tertiary'}
        value={num(cust.reduce((a, p) => a + p.stock, 0))} label="En custodia de Esmove (ud)" foot="Referencias" footVal={`${cust.length} · sin precio`} footC="text-violet-800" bar={cust.length ? (cust.length - custMal) / cust.length * 100 : 0} barC="bg-violet-500" onClick={() => setUI({ prop: 'custodia', page: 1 })} />
      <Kpi icon="warning" iconC="bg-error-container text-error" badge={crit.length ? 'Urgente' : 'Sin alertas'} badgeC={crit.length ? 'text-error font-semibold bg-error-container' : 'text-tertiary bg-tertiary-fixed/30'}
        value={crit.length} valueC={crit.length ? 'text-error' : undefined} label="Productos en stock crítico" foot="Reposición pendiente" footVal={`${sup} proveedor${sup === 1 ? '' : 'es'}`} footC="text-error"
        bar={crit.length / n * 400} barC="bg-error" onClick={() => setUI({ est: 'red', page: 1 })} />
      <Kpi icon="assignment_turned_in" iconC="bg-tertiary-fixed/40 text-tertiary" badge={entHoy.length ? `${Math.round(firm / entHoy.length * 100)}% firmadas` : 'Sin entregas hoy'} badgeC="text-tertiary font-semibold bg-tertiary-fixed/30"
        value={`${firm} / ${entHoy.length}`} label="Entregas firmadas hoy" foot="Furgonetas en ruta" footVal={`${enRuta} de ${E.equipos.length}`} footC="text-tertiary" bar={entHoy.length ? firm / entHoy.length * 100 : 0} barC="bg-tertiary" onClick={() => ir('entregas')} />
    </div>
  );
}

function StockDesk() {
  const E = useAlmacen(), u = useUI(), perm = usePermisos();
  const lista = searchProducts(E, u.q, u), PER = 8, pages = Math.max(1, Math.ceil(lista.length / PER)), page = Math.min(u.page, pages);
  const pag = lista.slice((page - 1) * PER, page * PER);
  const catProds = E.products.filter(p => p.cat === u.catTab).sort((a, b) => ORD[status(a)] - ORD[status(b)] || b.stock * b.price - a.stock * a.price).slice(0, 3);
  const ultAlb = E.albaranes[0], ultEnt = [...E.entregas].sort((a, b) => b.ts - a.ts)[0];
  const ais = aisles(E), semana = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 6048e5), pasAud = ais[semana % ais.length] || 'P01';
  const sel = 'font-mono text-label-md !w-auto';
  return (
    <div className="px-gutter py-space-lg flex flex-col gap-space-lg max-w-[1600px]">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-space-md">
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center gap-space-xs flex-wrap">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-tertiary-container/15 ${LBL} !text-tertiary`}><span className="w-1.5 h-1.5 rounded-full bg-tertiary-fixed-dim pulso" />Guardado local · {hace(ultimoGuardado)}</span>
            <span className="font-mono text-label-sm text-secondary">| {MARCA.nave} · {ais.length} pasillos · {E.movements.length} movimientos</span>
          </div>
          <div className="flex items-baseline gap-space-sm"><h1 className="text-headline-lg font-bold tracking-tight">Depot &amp; Control de Stock</h1><span className="font-mono text-label-md text-primary bg-primary-fixed/40 px-2 py-0.5 rounded">{E.operator}</span></div>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          <button onClick={() => ir('scan')} className={`${BTN_S} px-space-md py-2.5`}><Icon n="barcode_scanner" className="text-secondary ico-20" />Escanear</button>
          {perm.configurar && <button onClick={() => exportarStockCsv()} className={`${BTN_S} px-space-md py-2.5`}><Icon n="file_download" className="text-secondary ico-20" />Exportar CSV</button>}
          <button onClick={() => perm.editarCatalogo ? abrirFormProducto() : abrirBorrador()} className={`${BTN_P} px-space-md py-2.5`}><Icon n="add_circle" className="ico-20" />{perm.editarCatalogo ? 'Añadir referencia' : 'Nueva referencia (borrador)'}</button>
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
                  <div className={`h-24 rounded-lg ${r ? 'bg-error-container text-error' : CATS[p.cat].tile} grid place-items-center relative`}><Icon n={CATS[p.cat].icon} className="ico-40" /><span className="absolute bottom-2 left-2 font-mono text-label-sm bg-white/85 text-on-surface px-2 py-0.5 rounded">{p.packLabel}</span></div>
                  <div><h3 className="text-headline-sm font-semibold line-clamp-2">{p.name}</h3><p className="text-body-sm text-secondary">{p.supplier} · {p.loc}</p></div>
                  <div className="flex justify-between items-end pt-space-sm border-t border-surface-container-high">
                    <div><span className={LBL}>Stock real</span><div className={`text-headline-md font-bold ${r ? 'text-error' : ''}`}>{num(p.stock)} <span className="text-body-sm font-normal text-secondary">{UNIT[p.unit]}</span></div></div>
                    <div className="text-right"><span className={LBL}>{r ? 'Faltan' : 'Mínimo'}</span><div className={`font-mono text-label-md ${r ? 'text-error font-semibold' : 'text-primary'}`}>{qtyTxt(p, r ? p.min - p.stock : p.min)}</div></div>
                  </div>
                </button>); }) : <p className="text-secondary">Sin productos en esta categoría.</p>}
            </div>
          </section>

          <section className={`${CARD} overflow-hidden`}>
            <div className="p-space-md flex flex-wrap items-center gap-space-sm">
              <div className="relative flex-1 min-w-[220px]"><Icon n="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline ico-20" />
                <input value={u.q} onChange={e => setUI({ q: e.target.value, page: 1 })} type="search" placeholder="Filtrar por nombre, SKU, proveedor, pasillo…" className={`${INP} pl-10`} /></div>
              <select value={u.cat} onChange={e => setUI({ cat: e.target.value, page: 1 })} className={`${INP} ${sel}`} aria-label="Categoría"><option value="all">Categoría: todas</option>{Object.entries(CATS).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select>
              <select value={u.est} onChange={e => setUI({ est: e.target.value, page: 1 })} className={`${INP} ${sel}`} aria-label="Estado"><option value="all">Estado: todos</option>{(['red', 'amber', 'green'] as const).map(s => <option key={s} value={s}>{ST[s].t}</option>)}</select>
              <select value={u.prop} onChange={e => setUI({ prop: e.target.value, page: 1 })} className={`${INP} ${sel}`} aria-label="Propiedad"><option value="all">Propiedad: todo</option><option value="propia">Material propio</option><option value="custodia">En custodia</option></select>
              <select value={u.pas} onChange={e => setUI({ pas: e.target.value, page: 1 })} className={`${INP} ${sel}`} aria-label="Pasillo"><option value="all">Pasillo: todos</option>{ais.map(a => <option key={a} value={a}>Pasillo {a.replace('P', '')}</option>)}</select>
              <span className="font-mono text-label-sm text-secondary ml-auto">Mostrando {pag.length} de {lista.length} referencias</span>
            </div>
            <div className="overflow-x-auto"><table className="tabla w-full min-w-[860px]">
              <thead className="bg-surface-container-low"><tr><th>Referencia / SKU</th><th>Descripción</th><th>Ubicación física</th><th>Disponible</th><th>Estado</th><th className="text-right">Acciones</th></tr></thead>
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
                <div className="flex justify-between gap-2"><span className={LBL}>Última salida a furgoneta</span><span className="font-mono text-label-sm text-secondary">{hace(ultEnt.ts)}</span></div>
                <div className="flex items-center gap-3"><Icon n="local_shipping" className="text-secondary" /><div><div className="font-semibold">{eq ? eq.nombre : ultEnt.equipo} · {rec?.nombre}</div><div className="font-mono text-label-sm text-secondary">{eq && `${eq.flota} · ${eq.matricula}`}</div></div></div>
                <div className="bg-white rounded-lg p-2.5 text-body-sm">{ultEnt.lineas.map(l => { const p = find(E, l.sku); return <div key={l.sku}>{num(l.qty)} {p ? UNIT[p.unit] : ''} {p?.name || l.sku}</div>; })}
                  <div className="font-mono text-label-sm text-tertiary mt-1"><Icon n="draw" className="ico-16" /> Firma registrada · {(ultEnt.hash || '').slice(0, 10)}</div></div>
              </div>); })()}
            <button onClick={() => ir('albaranes')} className={`${BTN_P} py-2.5`}><Icon n="document_scanner" className="ico-20" />Leer un albarán</button>
          </section>
          {perm.verCostes && <Donut E={E} />}
          <Barras E={E} />
          <section className="bg-primary-fixed/50 rounded-xl p-space-md flex items-center justify-between gap-space-md">
            <div><h3 className="text-headline-sm font-semibold">Auditoría cíclica semanal</h3><p className="text-body-sm text-secondary">Pasillo {pasAud.replace('P', '')} · {E.products.filter(p => aisle(p.loc) === pasAud).length} referencias a recontar</p></div>
            <button onClick={() => abrirConteo(pasAud)} className={`${BTN_S} px-3 py-2 text-body-sm`}>Iniciar conteo</button>
          </section>
        </div>
      </div>
    </div>
  );
}

const limpiarFiltros = () => setUI({ q: '', est: 'all', pas: 'all', cat: 'all', prop: 'all', page: 1 });

function FilaStock({ p, pedido }: { p: Producto; pedido: boolean }) {
  const r = status(p) === 'red';
  return (
    <tr className={r ? 'bg-error-container/20' : ''}>
      <td><div className="flex items-center gap-2"><Icon n={r ? 'warning' : 'qr_code_2'} className={`${r ? 'text-error' : 'text-secondary'} ico-20`} /><div><div className={`font-mono text-label-md ${r ? 'text-error' : ''} break-all`}>{p.sku}</div>{p.ean && <div className="font-mono text-label-sm text-secondary">EAN {p.ean}</div>}</div></div></td>
      <td className="max-w-[300px]"><button onClick={() => abrirFicha(p.sku)} className="text-left"><div className="font-semibold hover:text-primary">{p.name}</div><div className="text-body-sm text-secondary">{CATS[p.cat].label} · {p.supplier}{p.serialized ? ` · ${(p.serials || []).length} n.º serie` : ''}</div></button><div className="flex flex-wrap gap-1 mt-1"><TagCustodia p={p} />{p.borrador && <Tag c="bg-amber-100 text-amber-800">Borrador</Tag>}{pedido && <Tag c="bg-amber-100 text-amber-800">Pedido en curso</Tag>}</div></td>
      <td><div className="inline-flex items-center gap-1.5 bg-surface-container-low px-2 py-1 rounded font-mono text-label-md text-primary"><Icon n="shelves" className="ico-18" />{p.loc}</div><div className="font-mono text-label-sm text-secondary mt-1">{locTxt(p.loc)}</div></td>
      <td><div className={`text-headline-sm font-bold ${r ? 'text-error' : ''}`}>{num(p.stock)} <span className="text-body-sm font-normal text-secondary">{UNIT[p.unit]}</span></div><div className={`font-mono text-label-sm ${r ? 'text-error' : 'text-secondary'}`}>Mín: {num(p.min)}</div></td>
      <td><Pill p={p} /></td>
      <td className="text-right whitespace-nowrap">
        <button onClick={() => abrirMovimiento(p.sku, 'entrada')} title="Registrar entrada" className="p-2 rounded-lg text-tertiary hover:bg-tertiary-fixed/30"><Icon n="add_circle" /></button>
        <button onClick={() => abrirMovimiento(p.sku, 'salida')} title="Registrar salida" className="p-2 rounded-lg text-primary hover:bg-primary-fixed"><Icon n="remove_circle" /></button>
        <button onClick={() => abrirMovimiento(p.sku, 'merma')} title="Registrar merma" className="p-2 rounded-lg text-error hover:bg-error-container"><Icon n="report" /></button>
      </td>
    </tr>
  );
}

function Donut({ E }: { E: Estado }) {
  const tot = invValue(E) || 1; let acc = 0;
  const seg = Object.entries(CATS).map(([k, c]) => ({ k, c, v: E.products.filter(p => p.cat === k).reduce((a, p) => a + valorProducto(p), 0) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  const R = 52, C = 2 * Math.PI * R;
  return (
    <section className={`${CARD} p-space-md`}>
      <div className="flex justify-between items-start"><h2 className="text-headline-md font-semibold">Distribución del valor</h2><span className="font-mono text-label-sm text-secondary">por categoría</span></div>
      <div className="flex items-center gap-space-md mt-space-sm">
        <svg viewBox="0 0 140 140" className="w-36 h-36 shrink-0" role="img" aria-label="Valor del inventario por categoría">
          <circle r={R} cx="70" cy="70" fill="none" stroke="#e5eeff" strokeWidth="16" />
          {seg.map(s => { const len = s.v / tot * C, off = acc; acc += len; return <circle key={s.k} r={R} cx="70" cy="70" fill="none" stroke={s.c.color} strokeWidth="16" strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 70 70)" />; })}
          <text x="70" y="68" textAnchor="middle" fontSize="17" fontWeight="700" fill="#0b1c30">{eur(tot).replace(/\s?€/, '')}€</text>
          <text x="70" y="84" textAnchor="middle" fontSize="8" fontFamily="JetBrains Mono" fill="#565e74">VALOR TOTAL</text>
        </svg>
        <ul className="flex-1 flex flex-col gap-1.5 min-w-0">{seg.map(s => <li key={s.k} className="flex items-center gap-2 text-body-sm"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.c.color }} /><span className="truncate flex-1">{s.c.label}</span><span className="font-mono text-label-sm font-semibold">{Math.round(s.v / tot * 100)}%</span></li>)}</ul>
      </div>
    </section>
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
  const hayFiltro = u.est !== 'all' || u.pas !== 'all' || u.prop !== 'all';
  return (
    <div className="px-4 pt-4 flex flex-col gap-4">
      <div className="flex items-center gap-3 bg-surface-container-low rounded-xl p-3">
        <span className="w-10 h-10 rounded-lg bg-white grid place-items-center text-primary"><Icon n="sensors" /></span>
        <div className="flex-1 min-w-0"><div className="font-semibold flex items-center gap-1.5">{MARCA.nave}<span className="w-2 h-2 rounded-full bg-tertiary-container" /></div><div className="font-mono text-label-sm text-secondary truncate">Guardado {hace(ultimoGuardado)} · {E.operator}</div></div>
        {nCrit > 0 && <button onClick={() => setUI({ est: 'red' })} className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-error-container text-error font-mono text-label-md"><Icon n="warning" className="ico-18" />{nCrit}</button>}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1"><Icon n="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
          <input value={u.q} onChange={e => setUI({ q: e.target.value })} type="search" placeholder="Ref, SKU, EAN o estantería" className="w-full h-14 pl-11 pr-3 rounded-xl bg-surface-container-lowest shadow-sm text-body-lg focus:outline-none focus:ring-2 focus:ring-primary" /></div>
        <button onClick={() => ir('scan')} className="w-14 h-14 rounded-xl bg-primary text-white grid place-items-center shadow-sm" aria-label="Escanear"><Icon n="barcode_scanner" className="ico-28" /></button>
        <button onClick={() => setUI({ filtros: !u.filtros })} className={`w-14 h-14 rounded-xl ${u.filtros || hayFiltro ? 'bg-primary-fixed text-primary' : 'bg-surface-container-low'} grid place-items-center`} aria-label="Filtros"><Icon n="tune" className="ico-28" /></button>
      </div>
      {u.filtros && <div className="grid grid-cols-2 gap-2 bg-surface-container-lowest rounded-xl p-3 shadow-sm">
        <label className="flex flex-col gap-1"><span className={LBL}>Estado</span><select value={u.est} onChange={e => setUI({ est: e.target.value })} className={`${INP} h-12`}>{[['all', 'Todos'], ['red', 'Crítico'], ['amber', 'Bajo'], ['green', 'Correcto']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <label className="flex flex-col gap-1"><span className={LBL}>Pasillo</span><select value={u.pas} onChange={e => setUI({ pas: e.target.value })} className={`${INP} h-12`}><option value="all">Todos</option>{aisles(E).map(a => <option key={a} value={a}>Pasillo {a.replace('P', '')}</option>)}</select></label>
        <label className="col-span-2 flex flex-col gap-1"><span className={LBL}>Propiedad</span><select value={u.prop} onChange={e => setUI({ prop: e.target.value })} className={`${INP} h-12`}><option value="all">Todo</option><option value="propia">Material propio</option><option value="custodia">En custodia de Esmove</option></select></label>
        <button onClick={limpiarFiltros} className={`col-span-2 ${BTN_T} h-11`}>Quitar filtros</button>
      </div>}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">{chip('all', 'Todos', E.products.length)}{Object.entries(CATS).map(([k, c]) => chip(k, c.label, E.products.filter(p => p.cat === k).length))}</div>
      {(hayFiltro || u.q) && <div className="flex items-center justify-between font-mono text-label-sm text-secondary"><span>{lista.length} resultado{lista.length === 1 ? '' : 's'}{u.est !== 'all' && ` · ${ST[u.est as 'red'].t}`}{u.pas !== 'all' && ` · Pasillo ${u.pas.replace('P', '')}`}</span><button onClick={limpiarFiltros} className="text-primary">Limpiar</button></div>}
      <div className="flex flex-col gap-4">{lista.length ? lista.map(p => <CardMob key={p.sku} p={p} pedido={!!E.pedidos[p.sku]} />)
        : <div className="text-center text-secondary py-12">Nada coincide con “{u.q}”.<br /><button onClick={limpiarFiltros} className="text-primary font-semibold mt-2">Ver todo</button></div>}</div>
    </div>
  );
}

function CardMob({ p, pedido }: { p: Producto; pedido: boolean }) {
  const r = status(p) === 'red', { verCostes } = usePermisos();
  return (
    <article className={`bg-surface-container-lowest rounded-2xl shadow-sm p-4 flex flex-col gap-3 ${r ? 'ring-1 ring-error/25' : ''}`}>
      <button onClick={() => abrirFicha(p.sku)} className="flex gap-3 text-left"><Tile p={p} size="w-14 h-14" />
        <div className="min-w-0 flex-1">
          <div className="flex justify-between items-start gap-2"><span className={`font-mono text-label-sm ${r ? 'text-error' : 'text-secondary'} truncate`}>SKU: {p.sku}</span><Pill p={p} short /></div>
          <h3 className="text-[17px] font-semibold leading-snug line-clamp-2 mt-0.5">{p.name}</h3>
          {(esCustodia(p) || p.borrador) && <div className="flex gap-1 mt-1"><TagCustodia p={p} />{p.borrador && <Tag c="bg-amber-100 text-amber-800">Borrador</Tag>}</div>}
          <div className="flex items-center gap-1.5 text-body-sm text-secondary mt-1"><Icon n="location_on" className="ico-16 text-primary" /><span className="font-mono text-label-md text-on-surface">{p.loc}</span><span>·</span><span className="truncate">{p.packLabel || CATS[p.cat].label}</span></div>
        </div>
      </button>
      {r && <div className="flex items-center gap-3 bg-error-container/50 rounded-xl p-3"><Icon n="warning" className="text-error" />
        <div className="flex-1 min-w-0"><div className="font-mono text-label-md text-error font-semibold uppercase">{qtyTxt(p, p.stock)} restante{p.stock === 1 ? '' : 's'} (mín: {num(p.min)})</div><div className="text-body-sm text-on-surface-variant">{locTxt(p.loc)}</div></div>
        {pedido ? <span className="font-mono text-label-sm text-amber-800 bg-amber-100 px-2 py-1 rounded">PEDIDO</span>
          : <button onClick={() => pedir(p.sku)} className="shrink-0 inline-flex items-center gap-1 bg-error text-white px-3 h-10 rounded-lg font-mono text-label-md"><Icon n="local_shipping" className="ico-18" />PEDIR</button>}
      </div>}
      <div className="grid grid-cols-3 bg-surface-container-low rounded-xl p-3 text-center">
        <div><div className={LBL}>Disponible</div><div className={`text-headline-md font-bold ${r ? 'text-error' : 'text-primary'}`}>{num(p.stock)} <span className="text-body-sm font-normal text-secondary">{UNIT[p.unit]}</span></div></div>
        <div><div className={LBL}>Mínimo</div><div className="text-headline-md font-bold">{num(p.min)} <span className="text-body-sm font-normal text-secondary">{UNIT[p.unit]}</span></div></div>
        <div><div className={LBL}>{p.serialized ? 'N.º serie' : esCustodia(p) || !verCostes ? 'Formato' : 'Valor'}</div><div className="text-headline-md font-bold text-secondary">{p.serialized ? (p.serials || []).length : <span className="text-body-lg">{esCustodia(p) || !verCostes ? (p.pack > 1 ? num(p.pack) : '—') : eur(valorProducto(p))}</span>}</div></div>
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
  const E = useAlmacen(), u = useUI(), eq = E.equipos.find(e => e.id === u.almacen);
  if (!eq) { setTimeout(() => setUI({ almacen: 'central' })); return null; }
  const vs = vanStock(E, eq.id), val = vs.reduce((a, x) => { const p = find(E, x.sku); return a + (p && !esCustodia(p) ? x.qty * p.price : 0); }, 0), { verCostes } = usePermisos();
  return (
    <div className="px-4 lg:px-gutter py-4 lg:py-space-lg flex flex-col gap-space-md max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><span className={LBL}>Stock a bordo · entregado − devuelto</span><h1 className="text-headline-lg-mobile lg:text-headline-lg font-bold">{eq.flota} · {eq.matricula}</h1><p className="text-secondary">{eq.nombre} · {eq.tecnicos.map(t => E.tecnicos.find(x => x.id === t)?.nombre).join(' + ')}{verCostes ? ` · valor propio ${eur(val)}` : ''}</p></div>
        <div className="flex gap-2"><button onClick={() => setUI({ almacen: 'central' })} className={`${BTN_S} px-4 h-11`}><Icon n="warehouse" className="ico-20" />Volver al almacén</button>
          <button onClick={() => { E.cesta.equipo = eq.id; ir('entregas'); }} className={`${BTN_P} px-4 h-11`}><Icon n="add_shopping_cart" className="ico-20" />Cargar material</button></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{vs.length ? vs.map(x => { const p = find(E, x.sku)!; return (
        <article key={x.sku} className={`${CARD} p-4 flex gap-3 items-center`}><Tile p={p} />
          <div className="flex-1 min-w-0"><div className="font-mono text-label-sm text-secondary">{p.sku}</div><div className="font-semibold truncate">{p.name}</div>{x.serials.length > 0 && <div className="font-mono text-label-sm text-primary truncate">S/N: {x.serials.join(', ')}</div>}</div>
          <div className="text-right"><div className="text-headline-md font-bold">{num(x.qty)} <span className="text-body-sm text-secondary font-normal">{UNIT[p.unit]}</span></div>
            <button onClick={() => abrirMovimiento(p.sku, 'entrada', { reason: 'Devolución de obra', equipo: eq.id, max: x.qty, qty: p.serialized ? 0 : x.qty, snTxt: x.serials.join('\n'), lock: true, ref: `Devuelto por ${eq.flota}` })} className="font-mono text-label-sm text-primary">Devolver ↩</button></div>
        </article>); }) : <div className={`${CARD} p-8 text-center text-secondary md:col-span-2`}>Esta furgoneta no lleva material entregado desde el almacén.</div>}</div>
    </div>
  );
}
