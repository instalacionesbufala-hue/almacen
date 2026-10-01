/* Hojas (modales) del inventario: ficha, movimiento, alta/edición, recuento, selector, avisos.
   E-013: sin precios, sin números de serie y sin pasillo/estantería; el material está en el almacén o en un vehículo. */
import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import type { Movimiento, Producto, TipoMov } from '../../data/tipos';
import { OFICINA, REASONS, UNIDADES, UNIT, catDe, categoriasActivas } from '../../data/catalogo';
import { contenidoDe, contenidoTxt, critical, find, formatoEntero, nombreVehiculo, pedidoSugerido, qrContenido, qtyTxt, searchProducts, status, ubicaciones, unidadesABordo, unidadTxt } from '../../domain/reglas';
import { hace, num, redondea, toNum } from '../../domain/formato';
import { ejecutar, guardar, mover, operarioSeleccionable, S, useAlmacen } from '../../store/almacen';
import { salir, sesion } from '../../store/nube/sync';
import { ir, VISTAS, type Vista, useVista } from '../../store/ui';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { Avatar, BTN_P, BTN_S, BTN_T, Campo, Icon, INP, LBL, Pill, Tag, TagCustodia, Tile, TIPO, Vacio } from '../../ui/base';
import { usePermisos } from '../../store/permisos';
import { EditorFoto } from '../../ui/foto';
import { nuevoId } from '../../store/ops';
import type { CatId } from '../../data/tipos';
import { comprobarFusion, diferencias } from '../../domain/fichas';
import { avisoStockInicial, previsionAjuste } from '../../domain/ajuste';
import { motivoSkuNoValido, skuPropuesto, skuValido } from '../../domain/codigos';
import { CodigosFicha } from './codigos';

/* ---------- Fila de movimiento ---------- */
export function MovRow({ m }: { m: Movimiento }) {
  const E = S(), p = find(E, m.sku), t = TIPO[m.type];
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-surface-container last:border-0">
      <span className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${t.c}`}><Icon n={t.icon} className="ico-20" /></span>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{p ? p.name : m.sku}</div>
        <div className="text-body-sm text-secondary truncate">{m.reason}{m.ref && ` · ${m.ref}`}{m.vehiculo ? ` · ${nombreVehiculo(E, m.vehiculo)}` : ''} · {m.operator}</div>
      </div>
      <div className="text-right shrink-0">
        <div className={`font-semibold ${m.type === 'entrada' || m.type === 'devolucion' ? 'text-tertiary' : m.type === 'merma' ? 'text-error' : ''}`}>{t.sign}{p ? qtyTxt(p, m.qty) : num(m.qty)}</div>
        <div className="font-mono text-label-sm text-secondary">{hace(m.ts)}</div>
      </div>
    </div>
  );
}

/* ---------- QR (BUF:<SKU>) ---------- */
export function QR({ texto, className = 'w-24 h-24' }: { texto: string; className?: string }) {
  const svg = useMemo(() => { const q = qrcode(0, 'M'); q.addData(texto); q.make(); return q.createSvgTag({ cellSize: 3, margin: 2, scalable: true }); }, [texto]);
  return <div className={`${className} bg-white rounded-lg`} dangerouslySetInnerHTML={{ __html: svg }} />;
}
function imprimirEtiqueta(p: Producto) {
  const q = qrcode(0, 'M'); q.addData(qrContenido(p.sku)); q.make();
  const w = window.open('', '_blank', 'width=420,height=520');
  if (!w) return toast('El navegador ha bloqueado la ventana de impresión.', 'warn');
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Etiqueta ${esc(p.sku)}</title><body style="font-family:system-ui;text-align:center;padding:24px"><div style="width:220px;margin:auto">${q.createSvgTag({ cellSize: 6, margin: 2, scalable: true })}</div><h2 style="margin:8px 0 2px;font-size:18px">${esc(p.sku)}</h2><div>${esc(p.name)}</div><div style="font:600 16px monospace;margin-top:8px">${esc(contenidoTxt(p) || UNIT[p.unit])}</div><script>setTimeout(()=>print(),300)<\/script>`);
  w.document.close();
}

/** Dónde está: almacén y cada vehículo (E-013) */
export function Ubicaciones({ p }: { p: Producto }) {
  const E = useAlmacen(), u = ubicaciones(E, p);
  return <div className="flex flex-wrap gap-1.5">{u.map(x => <span key={x.vehiculo || 'almacen'} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-body-sm ${x.vehiculo ? (x.qty < 0 ? 'bg-error-container text-error' : 'bg-violet-50 text-violet-900') : 'bg-surface-container-low'}`}>
    <Icon n={x.vehiculo ? 'local_shipping' : 'warehouse'} className="ico-16" />{x.donde} <b>{qtyTxt(p, x.qty)}</b></span>)}</div>;
}

/* ---------- Ficha ---------- */
export const abrirFicha = (sku: string) => openModal(<Ficha sku={sku} />);
function Ficha({ sku }: { sku: string }) {
  const E = useAlmacen(), p = find(E, sku), perm = usePermisos();
  if (!p) return <SheetHead title="Referencia no encontrada" />;
  const movs = E.movements.filter(m => m.sku === sku).slice(0, 8);
  const datos: [string, string][] = [['SKU', p.sku], ['EAN', p.ean || '—'], ['Ref. proveedor', p.supplierRef || '—'], ['Formato', contenidoTxt(p) || (p.unit === 'm' ? 'metros' : 'unidades')], ['Proveedor', p.supplier || '—'], ['Descripción', p.packLabel || '—'], ...(p.notas ? [['Notas', p.notas] as [string, string]] : [])];
  return (<>
    <SheetHead title={p.name} sub={`${catDe(p.cat).label} · ${p.supplier}`} />
    <div className="p-5 flex flex-col gap-4">
      <EditorFoto p={p} />
      <div className="flex items-center gap-3">
        <div className="flex-1"><div className={`text-headline-lg font-bold ${status(p) === 'red' ? 'text-error' : ''}`}>{qtyTxt(p, p.stock)} <span className="text-body-md font-normal text-secondary">en el almacén</span></div>
          <div className="text-body-sm text-secondary">Mínimo en almacén {p.minimoDefinido === false ? <b className="text-amber-800">sin definir</b> : qtyTxt(p, p.min)}</div>
          <div className="flex gap-1 mt-1"><TagCustodia p={p} nombre={E.propietarios.find(o => o.id === p.propietario)?.nombre} />{p.borrador && <Tag c="bg-amber-100 text-amber-800">Borrador: falta completarla</Tag>}</div></div>
        <Pill p={p} /></div>
      <div><div className={`${LBL} mb-1`}>Dónde está</div><Ubicaciones p={p} /></div>
      <div className="grid grid-cols-2 gap-2 text-body-sm">{datos.map(([k, v]) => <div key={k} className="bg-surface-container-low rounded-lg p-2.5"><div className={LBL}>{k}</div><div className="font-medium break-words">{v}</div></div>)}</div>
      <div className="flex items-center gap-4 bg-surface-container-low rounded-xl p-3">
        <QR texto={qrContenido(p.sku)} className="w-24 h-24 shrink-0" />
        <div className="text-body-sm text-secondary">Etiqueta QR (<span className="font-mono">{qrContenido(p.sku)}</span>): el escáner la reconoce al instante.<br />
          <button onClick={() => imprimirEtiqueta(p)} className="text-primary font-semibold mt-1 h-10">Imprimir etiqueta</button></div>
      </div>
      {!p.borrador && <CodigosFicha sku={sku} />}
      <div><div className={`${LBL} mb-1`}>Últimos movimientos</div>{movs.length ? movs.map(m => <MovRow key={m.id} m={m} />) : <p className="text-secondary text-body-sm">Sin movimientos todavía.</p>}</div>
    </div>
    <SheetFoot className={`grid gap-2 ${perm.editarCatalogo || !p.borrador ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}>
      <button onClick={() => abrirMovimiento(sku, 'entrada')} className={`${BTN_T} h-14 !text-tertiary`}><Icon n="add" className="ico-20" />Entrada</button>
      <button onClick={() => abrirMovimiento(sku, 'salida')} className={`${BTN_P} h-14`}><Icon n="remove" className="ico-20" />Salida</button>
      {perm.editarCatalogo ? <button onClick={() => abrirFormProducto(sku)} className={`${BTN_S} h-14`}><Icon n="edit" className="ico-20" />{p.borrador ? 'Completar' : 'Editar'}</button>
        : !p.borrador && <button onClick={() => abrirFormProducto(sku, {}, undefined, { modo: 'propuesta' })} className={`${BTN_S} h-14 col-span-2`}><Icon n="edit_note" className="ico-20" />Proponer un cambio de la ficha</button>}
    </SheetFoot>
    {!p.borrador && <div className="px-4 pb-2 flex flex-wrap gap-x-5"><button onClick={() => abrirAjuste(sku)} className="text-amber-800 text-body-sm font-semibold h-10">{E.rol === 'admin' ? 'Ajuste de inventario…' : 'Proponer ajuste de inventario…'}</button>
      {perm.editarCatalogo && <button onClick={() => abrirFusionar(sku)} className="text-primary text-body-sm font-semibold h-10">Fusionar en otro artículo (era el mismo)…</button>}</div>}
    {perm.editarCatalogo && p.stock === 0 && !E.movements.some(m => m.sku === sku) && <div className="px-4 pb-4"><button onClick={() => { if (confirm(`¿Borrar la referencia ${sku}? No tiene stock ni historial.`) && ejecutar({ op: 'borrarProducto', args: { sku } })) { closeModal(); toast('Referencia borrada.', 'ok'); } }} className="text-error text-body-sm font-semibold">Borrar esta referencia</button></div>}
  </>);
}

/* ---------- E-016 · Fusionar A en B (administrador) ---------- */
export const abrirFusionar = (sku: string) => openModal(<Fusionar sku={sku} />);
function Fusionar({ sku }: { sku: string }) {
  const E = useAlmacen(), a = find(E, sku);
  const [destino, setDestino] = useState(''), [motivo, setMotivo] = useState('');
  if (!a) return <SheetHead title="Referencia no encontrada" />;
  let vista = '', error = '';
  if (destino) { try { const r = comprobarFusion(E, sku, destino); vista = `${qtyTxt(a, a.stock)} de ${a.name} pasan a ${r.b.name} como ${qtyTxt(r.b, r.qb)}${E.aBordo.some(x => x.sku === sku && x.unidades) ? ', y lo que llevan los vehículos también' : ''}.`; } catch (e) { error = (e as Error).message; } }
  const fusionar = () => {
    if (!destino || error) return;
    if (!confirm(`¿Fusionar ${a.sku} en ${destino}? ${a.sku} quedará archivado; su historial se conserva.`)) return;
    if (ejecutar({ op: 'fusionar', args: { origen: sku, destino, motivo: motivo.trim() } })) { closeModal(); toast(`${a.sku} fusionado en ${destino}.`, 'ok'); }
  };
  return (<>
    <SheetHead title={`Fusionar ${a.sku}`} sub="Para cuando dos fichas eran el mismo artículo. El stock y lo de los vehículos pasan con ajustes enlazados; nada se borra." />
    <div className="p-5 flex flex-col gap-3">
      <Campo label="En qué artículo se fusiona"><select value={destino} onChange={e => setDestino(e.target.value)} className={`${INP} h-12`}><option value="">Elige el artículo</option>
        {E.products.filter(x => x.sku !== sku && !x.borrador).map(x => <option key={x.sku} value={x.sku}>{x.sku} · {x.name}</option>)}</select></Campo>
      <Campo label="Motivo (queda en el historial)"><input value={motivo} onChange={e => setMotivo(e.target.value)} className={`${INP} h-12`} placeholder="Se dio de alta dos veces" /></Campo>
      {vista && <p className="text-body-md bg-primary-fixed/40 rounded-lg p-3">{vista}</p>}
      {error && <p className="text-body-md bg-error-container text-error rounded-lg p-3">{error}</p>}
    </div>
    <SheetFoot><button onClick={fusionar} disabled={!destino || !!error} className={`${BTN_P} h-12 w-full disabled:opacity-40`}><Icon n="merge" className="ico-20" />Fusionar</button></SheetFoot>
  </>);
}

/* ---------- Movimiento: entrada / salida / merma (almacén o vehículo) / devolución (vehículo → almacén) ---------- */
interface MovOpts { reason?: string; ref?: string; qty?: number; vehiculo?: string; lock?: boolean }
export const abrirMovimiento = (sku: string, type: TipoMov, opts: MovOpts = {}) => openModal(<HojaMovimiento sku={sku} type0={type} opts={opts} />);
function HojaMovimiento({ sku, type0, opts }: { sku: string; type0: TipoMov; opts: MovOpts }) {
  const E = useAlmacen(), p = find(E, sku)!;
  const [type, setType] = useState<TipoMov>(type0);
  const [qty, setQty] = useState<string>(String(opts.qty ?? 1));
  const [reason, setReason] = useState(opts.reason || REASONS[type0][0]);
  const [ref, setRef] = useState(opts.ref || '');
  const conMaterial = E.vehiculos.filter(v => unidadesABordo(E, v.id, p.sku) > 0);
  const [veh, setVeh] = useState<string>(opts.vehiculo ?? (type0 === 'devolucion' ? conMaterial[0]?.id ?? '' : type0 === 'traspaso' ? E.vehiculos[0]?.id ?? '' : ''));
  const enVehiculo = type === 'devolucion' || (type === 'merma' && !!veh);
  const q = toNum(qty) || 0;
  const abordo = veh ? redondea(unidadesABordo(E, veh, p.sku) / contenidoDe(p)) : 0;
  const disponible = enVehiculo ? abordo : p.stock;
  const entero = !enVehiculo || type === 'devolucion' ? formatoEntero(p) : false;
  const malEntero = entero && q !== Math.trunc(q);
  const bad = (type !== 'entrada' && q > disponible) || malEntero || ((type === 'devolucion' || type === 'traspaso') && !veh);
  const after = type === 'entrada' || type === 'devolucion' ? p.stock + q : enVehiculo ? p.stock : p.stock - q;
  const steps = p.unit === 'm' ? [1, 10, 50, 100] : [1, 5, 10];
  const paso = (d: number) => { let n = Math.max(0, redondea((toNum(qty) || 0) + d)); if (type !== 'entrada' && n > disponible) n = disponible; setQty(String(n)); };
  const cambiaTipo = (t: TipoMov) => { setType(t); setReason(REASONS[t][0]); if (t === 'devolucion' && !veh) setVeh(conMaterial[0]?.id || ''); if (t === 'traspaso' && !veh) setVeh(E.vehiculos[0]?.id || ''); if (t === 'entrada' || t === 'salida') setVeh(''); };
  const confirmar = () => {
    const r = mover({ sku, type, qty: q, reason, ref: ref.trim(), vehiculo: enVehiculo || type === 'traspaso' ? veh : undefined });
    if (r) { closeModal(); toast(`${type === 'traspaso' ? 'Carga del vehículo' : TIPO[type].t} registrada: ${qtyTxt(p, q)} de ${p.name}. Almacén: ${qtyTxt(p, p.stock)}.`, 'ok'); }
  };
  const tipos: TipoMov[] = ['entrada', 'salida', 'traspaso', 'devolucion', 'merma'];   // E-013: carga y devolución de vehículos
  return (<>
    <SheetHead title={type === 'traspaso' ? 'Cargar material en un vehículo' : `${TIPO[type].t} de material`} sub={p.name} />
    <div className="p-5 flex flex-col gap-4">
      {!opts.lock && <div className="grid grid-cols-3 sm:grid-cols-5 bg-surface-container-low rounded-xl p-1">{tipos.map(t =>
        <button key={t} onClick={() => cambiaTipo(t)} disabled={(t === 'devolucion' && !conMaterial.length) || (t === 'traspaso' && !E.vehiculos.length)} className={`h-12 rounded-lg font-semibold text-body-sm disabled:opacity-40 ${type === t ? 'bg-white shadow-sm ' + (t === 'entrada' || t === 'devolucion' ? 'text-tertiary' : t === 'merma' ? 'text-error' : 'text-primary') : 'text-on-surface-variant'}`}>{TIPO[t].t}</button>)}
        <button onClick={() => abrirAjuste(sku)} className="h-12 rounded-lg font-semibold text-body-sm text-amber-800 col-span-3 sm:col-span-5">{E.rol === 'admin' ? 'Ajuste de inventario' : 'Proponer ajuste'}</button></div>}
      <div className="flex items-center gap-3 bg-surface-container-low rounded-xl p-3"><Tile p={p} />
        <div className="flex-1 min-w-0"><div className="font-mono text-label-sm text-secondary">{p.sku}{contenidoTxt(p) ? ` · ${contenidoTxt(p)}` : ''}</div><div className="text-body-sm">Almacén <b>{qtyTxt(p, p.stock)}</b> · mín. {qtyTxt(p, p.min)}</div></div></div>
      {(type === 'devolucion' || type === 'merma' || type === 'traspaso') && <Campo label={type === 'devolucion' ? 'Vehículo que devuelve' : type === 'traspaso' ? 'Vehículo que se carga' : 'Dónde se ha perdido o roto'}>
        <select value={veh} onChange={e => setVeh(e.target.value)} className={`${INP} h-14`}>
          {type === 'merma' && <option value="">Almacén</option>}
          {(type === 'devolucion' ? conMaterial : E.vehiculos).map(v => <option key={v.id} value={v.id}>{nombreVehiculo(E, v.id)} (lleva {qtyTxt(p, redondea(unidadesABordo(E, v.id, p.sku) / contenidoDe(p)))})</option>)}
        </select></Campo>}
      <div><div className={`${LBL} mb-2`}>Cantidad ({unidadTxt(p.unit, 2)}{contenidoTxt(p) ? ` de ${num(contenidoDe(p))} ud` : ''})</div>
        <div className="flex items-center bg-white ring-1 ring-surface-container-high rounded-xl">
          <button onClick={() => paso(-1)} className="w-14 h-14 grid place-items-center text-primary" aria-label="Menos"><Icon n="remove" className="ico-28" /></button>
          <input value={qty} onChange={e => setQty(e.target.value)} inputMode="decimal" className="flex-1 min-w-0 text-center text-headline-lg font-bold bg-transparent focus:outline-none" aria-label="Cantidad" />
          <button onClick={() => paso(1)} className="w-14 h-14 grid place-items-center text-primary" aria-label="Más"><Icon n="add" className="ico-28" /></button></div>
        <div className="grid grid-cols-4 gap-2 mt-2">{steps.map(s => <button key={s} onClick={() => paso(s)} className="h-11 rounded-lg bg-primary-fixed/60 text-primary font-semibold">+{num(s)}</button>)}</div></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo label="Motivo"><select value={reason} onChange={e => setReason(e.target.value)} className={`${INP} h-12`}>{REASONS[type].map(r => <option key={r}>{r}</option>)}</select></Campo>
        <Campo label={type === 'entrada' ? 'Albarán / origen' : 'Obra / referencia'}><input value={ref} onChange={e => setRef(e.target.value)} className={`${INP} h-12`} placeholder={type === 'entrada' ? 'Alb. 2.824.560' : 'C/ Recogidas 12, Granada'} /></Campo>
      </div>
      <div className={`flex items-center justify-between rounded-xl p-3 ${bad ? 'bg-error-container text-error' : 'bg-surface-container-low'}`}>
        <span className="text-body-sm">{malEntero ? `En el almacén se mueven ${unidadTxt(p.unit, 2)} enteros` : type === 'devolucion' && !veh ? 'Ningún vehículo lleva este artículo' : type === 'traspaso' && !veh ? 'No hay vehículos dados de alta'
          : bad ? `No hay tanto: ${enVehiculo ? 'el vehículo lleva' : 'en el almacén quedan'} ${qtyTxt(p, disponible)}`
            : enVehiculo && type === 'merma' ? <>El vehículo pasará de <b>{qtyTxt(p, abordo)}</b> a <b>{qtyTxt(p, redondea(abordo - q))}</b></>
              : <>Almacén: de <b>{qtyTxt(p, p.stock)}</b> a <b>{qtyTxt(p, Math.max(0, after))}</b></>}</span>
        {!bad && !(enVehiculo && type === 'merma') && <Pill p={{ stock: after, min: p.min }} short />}
      </div>
      {type === 'merma' && <p className="text-body-sm text-secondary bg-surface-container-low rounded-lg p-3">La merma se aplica al momento y se avisa al administrador (quién, qué, cuánto y por qué).</p>}
      {p.propiedad === 'custodia' && type === 'salida' && <p className="text-body-sm text-violet-800 bg-violet-50 rounded-lg p-3">Material en custodia: indica la obra o instalación de destino (Esmove quiere saber dónde está cada equipo).</p>}
      <p className="text-body-sm text-secondary">Se registra a nombre de <b>{E.operator}</b> con fecha y hora.</p>
    </div>
    <SheetFoot><button onClick={confirmar} disabled={!(q > 0) || bad} className={`${BTN_P} w-full h-14 text-body-lg`}><Icon n="check_circle" className="ico-fill" />{type === 'traspaso' ? 'Cargar' : `Confirmar ${TIPO[type].t.toLowerCase()} de`} {q > 0 ? qtyTxt(p, q) : '…'}{type === 'traspaso' ? ' en el vehículo' : ''}</button></SheetFoot>
  </>);
}

/* ---------- E-018 · Ajuste de inventario: solo el administrador; el almacén lo propone a la bandeja ---------- */
export const abrirAjuste = (sku: string) => openModal(<HojaAjuste sku={sku} />);
function HojaAjuste({ sku }: { sku: string }) {
  const E = useAlmacen(), p = find(E, sku)!, admin = E.rol === 'admin';
  const [signo, setSigno] = useState<1 | -1>(-1), [qty, setQty] = useState(''), [motivo, setMotivo] = useState(''), [veh, setVeh] = useState('');
  const q = redondea(signo * (toNum(qty) || 0));
  let prev: { de: number; a: number } | null = null, error = '';
  if (q) { try { prev = previsionAjuste(E, { sku, qty: q, motivo: motivo || '·', vehiculo: veh || undefined }); } catch (e) { error = (e as Error).message; } }
  const listo = !!prev && !!motivo.trim();
  const confirmar = () => {
    if (!listo) return;
    const args = { id: nuevoId(), sku, qty: q, motivo: motivo.trim(), vehiculo: veh || undefined };
    if (admin) {
      if (!confirm(`¿Ajustar ${p.name}? ${veh ? nombreVehiculo(E, veh) : 'Almacén'}: de ${qtyTxt(p, prev!.de)} a ${qtyTxt(p, prev!.a)}.`)) return;
      if (ejecutar({ op: 'ajuste', args })) { closeModal(); toast(`Ajuste registrado: ${p.name} pasa de ${qtyTxt(p, prev!.de)} a ${qtyTxt(p, prev!.a)}.`, 'ok', 6000); }
    } else if (ejecutar({ op: 'proponerAjuste', args })) { closeModal(); toast('Ajuste propuesto: el administrador lo revisará en su bandeja.', 'ok'); }
  };
  return (<>
    <SheetHead title={admin ? 'Ajuste de inventario' : 'Proponer ajuste de inventario'} sub={p.name} />
    <div className="p-5 flex flex-col gap-4">
      <p className="text-body-sm text-secondary bg-amber-50 rounded-lg p-3">Para corregir un error de stock (algo contado dos veces, un alta duplicada…). No cuenta como merma, ni como salida a obra, ni como consumo.{admin ? '' : ' Lo aplica el administrador desde su bandeja.'}</p>
      <div className="flex items-center gap-3 bg-surface-container-low rounded-xl p-3"><Tile p={p} />
        <div className="flex-1 min-w-0"><div className="font-mono text-label-sm text-secondary">{p.sku}{contenidoTxt(p) ? ` · ${contenidoTxt(p)}` : ''}</div><div className="text-body-sm">Almacén <b>{qtyTxt(p, p.stock)}</b></div></div></div>
      <Campo label="Dónde"><select value={veh} onChange={e => setVeh(e.target.value)} className={`${INP} h-14`}><option value="">Almacén</option>
        {E.vehiculos.map(v => <option key={v.id} value={v.id}>{nombreVehiculo(E, v.id)} (lleva {qtyTxt(p, redondea(unidadesABordo(E, v.id, p.sku) / contenidoDe(p)))})</option>)}</select></Campo>
      <div><div className={`${LBL} mb-2`}>Cantidad ({unidadTxt(p.unit, 2)})</div>
        <div className="flex gap-2">
          <div className="grid grid-cols-2 bg-surface-container-low rounded-xl p-1 shrink-0">
            <button onClick={() => setSigno(-1)} className={`h-12 w-14 rounded-lg font-bold text-headline-sm ${signo < 0 ? 'bg-white shadow-sm text-error' : 'text-on-surface-variant'}`} aria-label="Restar">−</button>
            <button onClick={() => setSigno(1)} className={`h-12 w-14 rounded-lg font-bold text-headline-sm ${signo > 0 ? 'bg-white shadow-sm text-tertiary' : 'text-on-surface-variant'}`} aria-label="Sumar">+</button></div>
          <input value={qty} onChange={e => setQty(e.target.value.replace('-', ''))} inputMode="decimal" className={`${INP} h-14 flex-1 text-center text-headline-sm font-bold`} placeholder="0" aria-label="Cantidad del ajuste" /></div></div>
      <Campo label="Motivo (obligatorio, queda en el historial)"><input value={motivo} onChange={e => setMotivo(e.target.value)} className={`${INP} h-12`} placeholder="Alta duplicada al corregir un albarán" /></Campo>
      <div className={`rounded-xl p-3 text-body-md ${error ? 'bg-error-container text-error' : 'bg-surface-container-low'}`}>
        {error ? error : prev ? <>{veh ? nombreVehiculo(E, veh) : 'Almacén'}: de <b>{qtyTxt(p, prev.de)}</b> a <b>{qtyTxt(p, prev.a)}</b></> : 'Indica la cantidad que se suma o se resta.'}</div>
      <p className="text-body-sm text-secondary">Se registra a nombre de <b>{E.operator}</b> con fecha y hora{admin ? ', y queda en la auditoría' : ''}.</p>
    </div>
    <SheetFoot><button onClick={confirmar} disabled={!listo} className={`${BTN_P} w-full h-14 text-body-lg disabled:opacity-40`}><Icon n="tune" />{admin ? 'Confirmar ajuste' : 'Proponer ajuste'}{prev ? ` (${q > 0 ? '+' : '−'}${qtyTxt(p, Math.abs(q))})` : ''}</button></SheetFoot>
  </>);
}

/* ---------- Selector de producto ---------- */
export const abrirSelector = (type: TipoMov) => openModal(<Selector type={type} />);
function Selector({ type }: { type: TipoMov }) {
  const E = useAlmacen(); const [q, setQ] = useState('');
  const lista = searchProducts(E, q).slice(0, 30);
  return (<>
    <SheetHead title={`${TIPO[type].t}: elige el material`} />
    <div className="p-5 flex flex-col gap-3">
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} type="search" className={`${INP} h-12`} placeholder="Busca por nombre, SKU o código" />
      <div className="flex flex-col">{lista.length ? lista.map(p =>
        <button key={p.sku} onClick={() => abrirMovimiento(p.sku, type)} className="flex items-center gap-3 py-2.5 border-b border-surface-container text-left min-h-14"><Tile p={p} size="w-10 h-10" />
          <div className="flex-1 min-w-0"><div className="font-medium truncate">{p.name}</div><div className="font-mono text-label-sm text-secondary">{p.sku} · almacén {qtyTxt(p, p.stock)}</div></div><Pill p={p} short /></button>) : <Vacio>Sin resultados.</Vacio>}</div>
    </div>
  </>);
}

/* ---------- Alta / edición de referencia: los mismos campos que el CSV del catálogo ---------- */
type FormProd = { sku: string; ean: string; name: string; cat: Producto['cat']; unit: Producto['unit']; contenido: string; packLabel: string; stock: string; min: string; supplier: string; supplierRef: string;
  objetivo: string; proveedorHabitual: string; modelo: string; talla: string; propiedad: 'propia' | 'custodia'; propietario: string; notas: string };
/** E-016: modo "propuesta" (el almacén propone cambios, no los aplica) y "revisar" (el administrador aplica una propuesta) */
export const abrirFormProducto = (sku?: string, preset: Partial<Producto> = {}, onCreado?: (sku: string) => void, o: { modo?: 'propuesta' | 'revisar'; propuesta?: string } = {}) =>
  openModal(<FormProducto sku={sku} preset={preset} onCreado={onCreado} modo={o.modo} propuesta={o.propuesta} />);
function FormProducto({ sku, preset, onCreado, modo, propuesta }: { sku?: string; preset: Partial<Producto>; onCreado?: (sku: string) => void; modo?: 'propuesta' | 'revisar'; propuesta?: string }) {
  const p = sku ? find(S(), sku) : undefined;
  const base: Partial<Producto> = p ? { ...p, ...preset } : { cat: 'fijaciones', unit: 'ud', contenido: 1, min: 0, ...preset };
  const [f, setF] = useState<FormProd>({
    sku: base.sku || '', ean: base.ean || '', name: base.name || '', cat: base.cat || 'fijaciones', unit: base.unit || 'ud', contenido: String(base.contenido ?? 1), packLabel: base.packLabel || '',
    stock: String(p?.borrador ? p.stockPropuesto ?? 0 : 0), min: base.minimoDefinido === false ? '' : String(base.min ?? ''), supplier: base.supplier || '', supplierRef: base.supplierRef || '',
    objetivo: base.objetivo != null ? String(base.objetivo) : '', proveedorHabitual: base.proveedorHabitual || '', modelo: base.modelo || '', talla: base.talla || '',
    propiedad: base.propiedad || 'propia', propietario: base.propietario || S().propietarios[0]?.id || '', notas: base.notas || '',
  });
  const set = (k: keyof FormProd) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const conContenido = f.unit !== 'm' && f.unit !== 'ud';
  const guardarProd = () => {
    const E = S(), code = f.sku.trim().toUpperCase(), name = f.name.trim();
    if (!code || !name) return toast('El SKU y el nombre son obligatorios.', 'err');
    if ((!p || code !== p.sku) && find(E, code)) return toast(`Ya existe una referencia con el SKU ${code}.`, 'err');
    if (!p || code !== p.sku) { const malo = motivoSkuNoValido(code); if (malo) return toast(malo, 'err', 7000); }
    const n = { contenido: conContenido ? toNum(f.contenido) : 1, min: f.min.trim() === '' ? 0 : toNum(f.min), stock: toNum(f.stock) || 0 };
    if (!(n.contenido > 0)) return toast('Indica cuántas unidades trae cada formato (bote de 1000 → 1000).', 'err');
    if (!(n.min >= 0) || !(n.stock >= 0)) return toast('Revisa los números: no pueden ser negativos.', 'err');
    if (f.unit !== 'm' && n.stock !== Math.trunc(n.stock)) return toast(`El stock inicial va en ${unidadTxt(f.unit, 2)} enteros.`, 'err');
    if (!p) { const aviso = avisoStockInicial(E, code, n.stock); if (aviso && !confirm(aviso)) return; }
    const custodia = f.propiedad === 'custodia';
    const obj: Producto = { sku: code, name, cat: f.cat, unit: f.unit, contenido: n.contenido, packLabel: f.packLabel.trim() || undefined, stock: p?.stock ?? 0, min: n.min, minimoDefinido: f.min.trim() !== '',
      supplier: f.supplier.trim(), ean: f.ean.trim() || undefined, supplierRef: f.supplierRef.trim() || undefined,
      objetivo: f.objetivo.trim() === '' ? undefined : toNum(f.objetivo), proveedorHabitual: f.proveedorHabitual.trim() || undefined, modelo: f.modelo.trim() || undefined, talla: f.talla.trim() || undefined,
      propiedad: f.propiedad, propietario: custodia ? f.propietario : undefined, foto: p?.foto, fotoMini: p?.fotoMini, fotoOrigen: p?.fotoOrigen, notas: f.notas.trim() || undefined };
    // E-016: el almacén no edita fichas: propone los cambios y el administrador los aplica desde su bandeja
    if (modo === 'propuesta' && p) {
      const cambios = Object.fromEntries(diferencias(p, { ...obj, sku: p.sku }).map(d => [d.campo, d.despues]));
      if (!Object.keys(cambios).length) return toast('No has cambiado nada.', 'warn');
      if (ejecutar({ op: 'proponerCambio', args: { id: nuevoId(), sku: p.sku, cambios } })) { closeModal(); toast('Propuesta enviada: el administrador la revisará.', 'ok'); }
      return;
    }
    // cambiar el código: ficha nueva con el código nuevo y la antigua fusionada en ella (el historial no se toca)
    if (p && code !== p.sku) {
      if (!confirm(`¿Cambiar el código de ${p.sku} a ${code}? El historial y las entregas firmadas conservan el código antiguo; buscarlo llevará al nuevo.`)) return;
      if (!ejecutar({ op: 'cambiarCodigo', args: { sku: p.sku, nuevo: code } })) return;
      // E-021: si el código antiguo no era válido (la URL de un QR…), queda como código alternativo: escanearlo abre el artículo
      if (!skuValido(p.sku)) ejecutar({ op: 'asociarCodigo', args: { codigo: p.sku, sku: code, tipo: /^HTTP/i.test(p.sku) ? 'QR' : 'otro' } });
    }
    if (!ejecutar({ op: 'producto', args: { producto: obj, nuevo: !p, stockInicial: p && !p.borrador ? 0 : n.stock } })) return;
    if (modo === 'revisar' && propuesta) ejecutar({ op: 'resolverPropuesta', args: { id: propuesta, aplicada: true } });
    toast(p?.borrador ? `Borrador aprobado: ${code} ya se puede mover${n.stock > 0 ? ` y entran ${n.stock} ${unidadTxt(f.unit, n.stock)} en el almacén` : ''}.` : p ? 'Referencia actualizada.' : `Referencia ${code} creada.`, 'ok', 6000);
    if (!p) onCreado?.(code);
    closeModal();
  };
  const inp = (k: keyof FormProd, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) =>
    <Campo label={label}><input value={String(f[k])} onChange={set(k)} className={`${INP} h-12`} {...extra} /></Campo>;
  return (<>
    <SheetHead title={modo === 'propuesta' ? 'Proponer un cambio' : modo === 'revisar' ? 'Revisar el cambio propuesto' : p?.borrador ? 'Completar y aprobar borrador' : p ? 'Editar referencia' : 'Nueva referencia'} sub={p?.borrador ? `${p.sku}${p.propuestoPor ? ` · propuesto por ${p.propuestoPor}` : ''}` : p ? p.sku : 'Alta en el catálogo del almacén'} />
    <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
      {inp('sku', p ? 'SKU / ID * (cambiarlo conserva el historial)' : 'SKU / ID *', p ? { readOnly: modo === 'propuesta' || !!p.borrador } : { autoFocus: true })}
      {inp('ean', 'EAN / código de barras', { inputMode: 'numeric' })}
      <div className="sm:col-span-2">{inp('name', 'Nombre *')}</div>
      <Campo label="Categoría"><select value={f.cat} onChange={set('cat')} className={`${INP} h-12`}>{categoriasActivas().map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select></Campo>
      <Campo label="Se vende y se entrega por"><select value={f.unit} onChange={set('unit')} className={`${INP} h-12`}>{UNIDADES.map(u => <option key={u} value={u}>{u === 'm' ? 'Metros' : u === 'ud' ? 'Unidades' : unidadTxt(u, 2).replace(/^./, c => c.toUpperCase())}</option>)}</select></Campo>
      {conContenido && inp('contenido', `Unidades por ${UNIT[f.unit]} (bote de 1000 → 1000)`, { inputMode: 'numeric' })}
      {(!p || p.borrador) && inp('stock', `Stock inicial en el almacén (${unidadTxt(f.unit, 2)})${p?.borrador ? ' · contado por el almacén' : ''}`, { inputMode: 'decimal' })}
      {inp('min', 'Mínimo en el almacén (vacío = completar después)', { inputMode: 'decimal' })}
      {inp('supplier', 'Proveedor')}
      {inp('supplierRef', 'Código del proveedor')}
      <Campo label="Propiedad"><select value={f.propiedad} onChange={set('propiedad')} className={`${INP} h-12`}><option value="propia">Material propio</option><option value="custodia">En custodia (no es nuestro)</option></select></Campo>
      {f.propiedad === 'custodia' && <Campo label="Propietario"><select value={f.propietario} onChange={set('propietario')} className={`${INP} h-12`}>{S().propietarios.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></Campo>}
      {inp('packLabel', 'Descripción corta (opcional: "Monofásico · 40 A")')}
      {inp('objetivo', 'Objetivo de reposición (vacío = 2 × mínimo)', { inputMode: 'decimal' })}
      {inp('proveedorHabitual', 'Proveedor habitual (a quién se pide)')}
      {(f.cat === 'ropa' || f.cat === 'epis') && <>{inp('modelo', 'Modelo (agrupa las tallas)')}{inp('talla', 'Talla')}</>}
      <div className="sm:col-span-2">{inp('notas', 'Notas (dónde está, observaciones…)')}</div>
      {p && !p.borrador && <p className="sm:col-span-2 text-body-sm text-secondary">El stock no se edita aquí: se corrige con un ajuste (con motivo), con un recuento o, si vino mal de un albarán, con "Reasignar línea" en el albarán.</p>}
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Cancelar</button><button onClick={guardarProd} className={`${BTN_P} h-12 flex-1`}><Icon n="save" className="ico-20" />{modo === 'propuesta' ? 'Enviar la propuesta' : modo === 'revisar' ? 'Aplicar el cambio' : p?.borrador ? 'Aprobar' : p ? 'Guardar cambios' : 'Crear referencia'}</button></SheetFoot>
  </>);
}

/* ---------- Borrador de referencia (almacén): solo el código escaneado; el administrador completa el resto ---------- */
export const abrirBorrador = (codigo = '', onCreado?: (sku: string) => void) => openModal(<Borrador codigo={codigo} onCreado={onCreado} />);
function Borrador({ codigo, onCreado }: { codigo: string; onCreado?: (sku: string) => void }) {
  const esEan = /^\d{8,14}$/.test(codigo);
  const [f, setF] = useState({ sku: esEan || !codigo ? '' : skuPropuesto(S(), codigo), ean: esEan ? codigo : '', nombre: '', cat: 'aparamenta' as CatId });
  const crear = () => {
    if (!ejecutar({ op: 'borrador', args: f })) return;
    const sku = (f.sku || 'BORR-' + f.ean).toUpperCase();
    closeModal(); toast(`Borrador ${sku} creado. El administrador completará la unidad y el mínimo antes de poder moverlo.`, 'ok', 7000); onCreado?.(sku);
  };
  return (<>
    <SheetHead title="Nueva referencia (borrador)" sub="Solo el código y un nombre. El administrador la completa." />
    <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Campo label="Código / SKU"><input value={f.sku} onChange={e => setF({ ...f, sku: e.target.value })} className={`${INP} h-12 font-mono`} /></Campo>
      <Campo label="EAN (código de barras)"><input value={f.ean} onChange={e => setF({ ...f, ean: e.target.value })} inputMode="numeric" className={`${INP} h-12 font-mono`} /></Campo>
      <Campo label="Nombre" className="sm:col-span-2"><input autoFocus value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} className={`${INP} h-12`} placeholder="Lo que pone en la caja" /></Campo>
      <Campo label="Categoría" className="sm:col-span-2"><select value={f.cat} onChange={e => setF({ ...f, cat: e.target.value as CatId })} className={`${INP} h-12`}>{categoriasActivas().map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select></Campo>
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Cancelar</button><button onClick={crear} className={`${BTN_P} h-12 flex-1`}><Icon n="save" className="ico-20" />Crear borrador</button></SheetFoot>
  </>);
}

/* ---------- Recuento del almacén por categoría (E-013: ya no hay pasillos) ---------- */
export const abrirConteo = (cat: string) => openModal(<Conteo cat={cat} />);
function Conteo({ cat }: { cat: string }) {
  const E = useAlmacen(); const [vals, setVals] = useState<Record<string, string>>({});
  const ps = E.products.filter(p => !p.borrador && (cat === 'all' || p.cat === cat)).sort((a, b) => a.name.localeCompare(b.name));
  const nombre = cat === 'all' ? 'todo el almacén' : catDe(cat).label;
  const { validar } = usePermisos();
  const confirmar = () => {
    const lineas = Object.entries(vals).filter(([, v]) => v.trim() !== '').map(([sku, v]) => ({ sku, contado: toNum(v) }));
    if (lineas.some(l => !(l.contado >= 0))) return toast('Revisa las cantidades: no pueden ser negativas.', 'err');
    const mal = lineas.find(l => { const p = find(E, l.sku)!; return formatoEntero(p) && l.contado !== Math.trunc(l.contado); });
    if (mal) return toast(`${find(E, mal.sku)!.name}: cuenta ${unidadTxt(find(E, mal.sku)!.unit, 2)} enteros (los abiertos no cuentan).`, 'err');
    const n = lineas.filter(l => redondea(l.contado - find(E, l.sku)!.stock) !== 0).length;
    if (!ejecutar({ op: 'recuento', args: { id: nuevoId(), pasillo: nombre, lineas } })) return;
    closeModal();
    toast(!n ? 'Recuento sin diferencias: no se ha ajustado nada.' : validar ? `Recuento guardado: ${n} ajuste${n === 1 ? '' : 's'}.` : `Recuento enviado: ${n} diferencia${n === 1 ? '' : 's'} pendiente${n === 1 ? '' : 's'} de validar por el administrador.`, 'ok', 6000);
  };
  return (<>
    <SheetHead title={`Recuento de ${nombre}`} sub={validar ? 'Escribe lo que cuentas en el almacén. Solo se ajustan las líneas con diferencia.' : 'Escribe lo que cuentas. Las diferencias quedan pendientes de validar por el administrador.'} />
    <div className="p-5 flex flex-col">{ps.map(p =>
      <div key={p.sku} className="flex items-center gap-3 py-2.5 border-b border-surface-container">
        <div className="flex-1 min-w-0"><div className="font-medium truncate">{p.name}</div><div className="font-mono text-label-sm text-secondary">{p.sku} · sistema: {qtyTxt(p, p.stock)}</div></div>
        <input value={vals[p.sku] ?? ''} onChange={e => setVals({ ...vals, [p.sku]: e.target.value })} inputMode="decimal" placeholder={num(p.stock)}
          className={`${INP} !w-28 h-12 text-center font-mono`} aria-label={`Cantidad contada de ${p.name}`} />
      </div>)}</div>
    <SheetFoot><button onClick={confirmar} className={`${BTN_P} w-full h-14`}><Icon n="fact_check" className="ico-fill" />Confirmar recuento y ajustar diferencias</button></SheetFoot>
  </>);
}

/* ---------- Reposición (E-006): la bandeja vive en features/reposicion ---------- */
export function pedir(sku: string) {
  const E = S(), p = find(E, sku)!;
  if (E.rol !== 'admin') return toast('El aviso ya está en la bandeja de reposición: el administrador hace el pedido.', 'ok', 5000);
  const q = pedidoSugerido(p) || 1;
  if (ejecutar({ op: 'pedido', args: { sku, qty: q } })) toast(`Marcado como pedido: ${qtyTxt(p, q)} de ${p.name}.`, 'ok');
}
export const abrirAvisos = () => { void import('../reposicion/Reposicion').then(m => m.abrirReposicion()); };

/* ---------- Operario activo y menú móvil ---------- */
export const abrirPerfil = () => openModal(<Perfil />);
function Perfil() {
  const E = useAlmacen(), ses = sesion.use(), ops = [OFICINA, ...E.tecnicos.map(t => t.nombre)];
  if (!operarioSeleccionable) return (<>
    <SheetHead title={ses.perfil?.nombre || 'Mi usuario'} sub={ses.perfil ? `${ses.perfil.email || ''} · ${ses.perfil.rol === 'admin' ? 'Administrador' : 'Almacén'}` : ''} />
    <div className="p-5 flex flex-col gap-3"><p className="text-body-sm text-secondary">Cada movimiento queda registrado a tu nombre. Para usar la app con otra persona, cierra la sesión.</p>
      <button onClick={() => { closeModal(); void salir(); }} className={`${BTN_S} h-12`}><Icon n="logout" className="ico-20" />Cerrar sesión</button></div>
  </>);
  const elegir = (o: string) => { E.operator = o; guardar(); closeModal(); toast(`Operario activo: ${o}.`, 'ok'); };
  return (<>
    <SheetHead title="¿Quién está usando la app?" sub="Cada movimiento queda registrado a nombre del operario activo." />
    <div className="p-4 flex flex-col gap-1">{ops.map(o =>
      <button key={o} onClick={() => elegir(o)} className={`flex items-center gap-3 px-3 h-14 rounded-xl text-left ${E.operator === o ? 'bg-primary-fixed text-primary font-semibold' : 'hover:bg-surface-container-low'}`}>
        <Avatar n={o} /><span className="flex-1">{o}</span>{E.operator === o && <Icon n="check" />}</button>)}</div>
  </>);
}
export const abrirMenu = () => openModal(<Menu />);
function Menu() {
  const E = useAlmacen(), vista = useVista(), nCrit = critical(E).length;
  return (<>
    <SheetHead title="Menú" sub={`Operario activo: ${E.operator}`} />
    <div className="p-3 flex flex-col gap-1">
      {(Object.keys(VISTAS) as Vista[]).map(v =>
        <button key={v} onClick={() => { closeModal(); ir(v); }} className={`flex items-center gap-3 px-4 h-14 rounded-xl text-left ${vista === v ? 'bg-primary-fixed text-primary font-semibold' : 'hover:bg-surface-container-low'}`}><Icon n={VISTAS[v].icon} /><span className="flex-1">{VISTAS[v].label}</span></button>)}
      <button onClick={() => { closeModal(); void import('../altaCamara/AltaCamara').then(m => m.abrirAltaCamara()); }} className="flex items-center gap-3 px-4 h-14 rounded-xl bg-primary-fixed/50 text-primary font-semibold"><Icon n="add_a_photo" /><span className="flex-1 text-left">Nuevo con la cámara</span></button>
      <button onClick={abrirAvisos} className="flex items-center gap-3 px-4 h-14 rounded-xl hover:bg-surface-container-low"><Icon n="notifications" /><span className="flex-1 text-left">Avisos de stock</span>{nCrit > 0 && <Tag c="bg-error-container text-error">{nCrit}</Tag>}</button>
      <button onClick={abrirPerfil} className="flex items-center gap-3 px-4 h-14 rounded-xl hover:bg-surface-container-low"><Icon n="person" /><span className="flex-1 text-left">Cambiar operario</span></button>
    </div>
  </>);
}
