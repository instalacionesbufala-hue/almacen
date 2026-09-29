/* Hojas (modales) del inventario: ficha, movimiento, alta/edición, recuento, selector, avisos */
import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import type { Movimiento, Producto, TipoMov } from '../../data/tipos';
import { CATS, OFICINA, REASONS, UNIT } from '../../data/catalogo';
import { aisle, critical, find, LOC_RE, locTxt, pedidoSugerido, qrContenido, qtyTxt, searchProducts, status, vanStock } from '../../domain/reglas';
import { eur, hace, num, parseSN, redondea, toNum } from '../../domain/formato';
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

/* ---------- Fila de movimiento ---------- */
export function MovRow({ m }: { m: Movimiento }) {
  const p = find(S(), m.sku), t = TIPO[m.type];
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-surface-container last:border-0">
      <span className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${t.c}`}><Icon n={t.icon} className="ico-20" /></span>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{p ? p.name : m.sku}</div>
        <div className="text-body-sm text-secondary truncate">{m.reason}{m.ref && ` · ${m.ref}`} · {m.operator}{m.serials?.length ? ` · S/N ${m.serials.join(', ')}` : ''}</div>
      </div>
      <div className="text-right shrink-0">
        <div className={`font-semibold ${m.type === 'entrada' ? 'text-tertiary' : m.type === 'merma' ? 'text-error' : ''}`}>{t.sign}{num(m.qty)} {p ? UNIT[p.unit] : ''}</div>
        <div className="font-mono text-label-sm text-secondary">{hace(m.ts)}</div>
      </div>
    </div>
  );
}

/* ---------- QR ---------- */
export function QR({ texto, className = 'w-24 h-24' }: { texto: string; className?: string }) {
  const svg = useMemo(() => { const q = qrcode(0, 'M'); q.addData(texto); q.make(); return q.createSvgTag({ cellSize: 3, margin: 2, scalable: true }); }, [texto]);
  return <div className={`${className} bg-white rounded-lg`} dangerouslySetInnerHTML={{ __html: svg }} />;
}
function imprimirEtiqueta(p: Producto) {
  const q = qrcode(0, 'M'); q.addData(qrContenido(p.sku)); q.make();
  const w = window.open('', '_blank', 'width=420,height=520');
  if (!w) return toast('El navegador ha bloqueado la ventana de impresión.', 'warn');
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Etiqueta ${esc(p.sku)}</title><body style="font-family:system-ui;text-align:center;padding:24px"><div style="width:220px;margin:auto">${q.createSvgTag({ cellSize: 6, margin: 2, scalable: true })}</div><h2 style="margin:8px 0 2px;font-size:18px">${esc(p.sku)}</h2><div>${esc(p.name)}</div><div style="font:600 20px monospace;margin-top:8px">${esc(p.loc)}</div><script>setTimeout(()=>print(),300)<\/script>`);
  w.document.close();
}

/* ---------- Ficha ---------- */
export const abrirFicha = (sku: string) => openModal(<Ficha sku={sku} />);
function Ficha({ sku }: { sku: string }) {
  const E = useAlmacen(), p = find(E, sku), perm = usePermisos();
  if (!p) return <SheetHead title="Referencia no encontrada" />;
  const movs = E.movements.filter(m => m.sku === sku).slice(0, 8);
  const datos: [string, string][] = [['SKU', p.sku], ['Ubicación', `${p.loc} (${locTxt(p.loc)})`], ['EAN', p.ean || '—'], ['Ref. proveedor', p.supplierRef || '—'], ['Formato', p.packLabel || '—'], ['Unidad base', p.unit === 'm' ? 'metros' : 'unidades']];
  return (<>
    <SheetHead title={p.name} sub={`${CATS[p.cat].label} · ${p.supplier}`} />
    <div className="p-5 flex flex-col gap-4">
      <EditorFoto p={p} />
      <div className="flex items-center gap-3">
        <div className="flex-1"><div className={`text-headline-lg font-bold ${status(p) === 'red' ? 'text-error' : ''}`}>{qtyTxt(p, p.stock)}</div><div className="text-body-sm text-secondary">Mínimo {qtyTxt(p, p.min)}{p.propiedad === 'custodia' ? ' · sin precio (no es material propio)' : perm.verCostes ? ` · ${eur(p.price)}/${UNIT[p.unit]} · valor ${eur(p.stock * (p.price ?? 0))}` : ''}</div>
          <div className="flex gap-1 mt-1"><TagCustodia p={p} nombre={E.propietarios.find(o => o.id === p.propietario)?.nombre} />{p.borrador && <Tag c="bg-amber-100 text-amber-800">Borrador: falta completarla</Tag>}</div></div>
        <Pill p={p} /></div>
      <div className="grid grid-cols-2 gap-2 text-body-sm">{datos.map(([k, v]) => <div key={k} className="bg-surface-container-low rounded-lg p-2.5"><div className={LBL}>{k}</div><div className="font-medium break-words">{v}</div></div>)}</div>
      {p.serialized && <div><div className={`${LBL} mb-1`}>Números de serie en stock ({(p.serials || []).length})</div>
        <div className="flex flex-wrap gap-1.5">{(p.serials || []).length ? p.serials!.map(s => <Tag key={s} c="bg-primary-fixed text-primary">{s}</Tag>) : <span className="text-secondary text-body-sm">Ninguno</span>}</div></div>}
      <div className="flex items-center gap-4 bg-surface-container-low rounded-xl p-3">
        <QR texto={qrContenido(p.sku)} className="w-24 h-24 shrink-0" />
        <div className="text-body-sm text-secondary">Etiqueta QR (<span className="font-mono">{qrContenido(p.sku)}</span>). Pégala en la estantería <b className="text-on-surface">{p.loc}</b>: el escáner la reconoce al instante.<br />
          <button onClick={() => imprimirEtiqueta(p)} className="text-primary font-semibold mt-1">Imprimir etiqueta</button></div>
      </div>
      <div><div className={`${LBL} mb-1`}>Últimos movimientos</div>{movs.length ? movs.map(m => <MovRow key={m.id} m={m} />) : <p className="text-secondary text-body-sm">Sin movimientos todavía.</p>}</div>
    </div>
    <SheetFoot className={`grid gap-2 ${perm.editarCatalogo ? 'grid-cols-3' : 'grid-cols-2'}`}>
      <button onClick={() => abrirMovimiento(sku, 'entrada')} className={`${BTN_T} h-12 !text-tertiary`}><Icon n="add" className="ico-20" />Entrada</button>
      <button onClick={() => abrirMovimiento(sku, 'salida')} className={`${BTN_P} h-12`}><Icon n="remove" className="ico-20" />Salida</button>
      {perm.editarCatalogo && <button onClick={() => abrirFormProducto(sku)} className={`${BTN_S} h-12`}><Icon n="edit" className="ico-20" />{p.borrador ? 'Completar' : 'Editar'}</button>}
    </SheetFoot>
    {perm.editarCatalogo && p.stock === 0 && !E.movements.some(m => m.sku === sku) && <div className="px-4 pb-4"><button onClick={() => { if (confirm(`¿Borrar la referencia ${sku}? No tiene stock ni historial.`) && ejecutar({ op: 'borrarProducto', args: { sku } })) { closeModal(); toast('Referencia borrada.', 'ok'); } }} className="text-error text-body-sm font-semibold">Borrar esta referencia</button></div>}
  </>);
}

/* ---------- Movimiento (entrada / salida / merma) ---------- */
interface MovOpts { reason?: string; ref?: string; qty?: number; snTxt?: string; equipo?: string; max?: number; lock?: boolean }
export const abrirMovimiento = (sku: string, type: TipoMov, opts: MovOpts = {}) => openModal(<HojaMovimiento sku={sku} type0={type} opts={opts} />);
function HojaMovimiento({ sku, type0, opts }: { sku: string; type0: TipoMov; opts: MovOpts }) {
  const E = useAlmacen(), p = find(E, sku)!;
  const [type, setType] = useState<TipoMov>(type0);
  const [qty, setQty] = useState<string>(String(p.serialized ? 0 : opts.qty ?? 1));
  const [reason, setReason] = useState(opts.reason || REASONS[type0][0]);
  const [ref, setRef] = useState(opts.ref || '');
  const [sel, setSel] = useState<string[]>([]);
  const [snTxt, setSnTxt] = useState(opts.snTxt || '');
  const q = !p.serialized ? toNum(qty) || 0 : type === 'entrada' ? parseSN(snTxt).length : sel.length;
  const after = type === 'entrada' ? p.stock + q : p.stock - q;
  const superaVan = !!opts.max && q > opts.max, bad = (type !== 'entrada' && q > p.stock) || superaVan;
  const snPool = opts.equipo ? (vanStock(E, opts.equipo).find(x => x.sku === p.sku)?.serials || []) : (p.serials || []);
  const steps = p.unit === 'm' ? [1, 10, 50, 100] : p.pack > 1 ? [1, 5, 10, p.pack] : [1, 5, 10];
  const paso = (d: number) => { let n = Math.max(0, redondea((toNum(qty) || 0) + d)); if (type !== 'entrada' && n > p.stock) n = p.stock; setQty(String(n)); };
  const cambiaTipo = (t: TipoMov) => { setType(t); setReason(REASONS[t][0]); setSel([]); };
  const confirmar = () => {
    const serials = p.serialized ? (type === 'entrada' ? parseSN(snTxt) : sel) : [];
    const r = mover({ sku, type, qty: q, reason, ref: ref.trim(), serials, equipo: opts.equipo });
    if (r) { closeModal(); toast(`${TIPO[type].t} registrada: ${qtyTxt(p, q)} de ${p.name}. Stock: ${qtyTxt(p, p.stock)}.`, 'ok'); }
  };
  return (<>
    <SheetHead title={`${TIPO[type].t} de material`} sub={p.name} />
    <div className="p-5 flex flex-col gap-4">
      {!opts.lock && <div className="grid grid-cols-3 bg-surface-container-low rounded-xl p-1">{(['entrada', 'salida', 'merma'] as TipoMov[]).map(t =>
        <button key={t} onClick={() => cambiaTipo(t)} className={`h-12 rounded-lg font-semibold ${type === t ? 'bg-white shadow-sm ' + (t === 'entrada' ? 'text-tertiary' : t === 'merma' ? 'text-error' : 'text-primary') : 'text-on-surface-variant'}`}>{TIPO[t].t}</button>)}</div>}
      <div className="flex items-center gap-3 bg-surface-container-low rounded-xl p-3"><Tile p={p} />
        <div className="flex-1 min-w-0"><div className="font-mono text-label-sm text-secondary">{p.sku} · {p.loc}</div><div className="text-body-sm">Stock actual <b>{qtyTxt(p, p.stock)}</b> · mín. {qtyTxt(p, p.min)}</div></div></div>
      {p.serialized ? (type === 'entrada'
        ? <Campo label="Números de serie que entran (uno por línea)"><textarea value={snTxt} onChange={e => setSnTxt(e.target.value)} rows={4} className={`${INP} font-mono`} placeholder="Escanea o escribe cada n.º de serie" /><span className="text-body-sm text-secondary">{q} unidad{q === 1 ? '' : 'es'}</span></Campo>
        : <div><div className={`${LBL} mb-2`}>Elige los n.º de serie que salen ({q} seleccionado{q === 1 ? '' : 's'})</div>
          <div className="flex flex-wrap gap-2">{snPool.length ? snPool.map(s => <button key={s} onClick={() => setSel(sel.includes(s) ? sel.filter(x => x !== s) : [...sel, s])} className={`px-3 h-11 rounded-lg font-mono text-label-md ${sel.includes(s) ? 'bg-primary text-white' : 'bg-surface-container-low'}`}>{sel.includes(s) ? '✓ ' : ''}{s}</button>) : <span className="text-secondary">No hay unidades con n.º de serie.</span>}</div></div>)
        : <div><div className={`${LBL} mb-2`}>Cantidad ({p.unit === 'm' ? 'metros' : 'unidades'})</div>
          <div className="flex items-center bg-white ring-1 ring-surface-container-high rounded-xl">
            <button onClick={() => paso(-1)} className="w-14 h-14 grid place-items-center text-primary" aria-label="Menos"><Icon n="remove" className="ico-28" /></button>
            <input value={qty} onChange={e => setQty(e.target.value)} inputMode="decimal" className="flex-1 min-w-0 text-center text-headline-lg font-bold bg-transparent focus:outline-none" aria-label="Cantidad" />
            <button onClick={() => paso(1)} className="w-14 h-14 grid place-items-center text-primary" aria-label="Más"><Icon n="add" className="ico-28" /></button></div>
          <div className="grid grid-cols-4 gap-2 mt-2">{steps.map(s => <button key={s} onClick={() => paso(s)} className="h-11 rounded-lg bg-primary-fixed/60 text-primary font-semibold">+{num(s)}</button>)}</div></div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo label="Motivo"><select value={reason} onChange={e => setReason(e.target.value)} className={`${INP} h-12`}>{REASONS[type].map(r => <option key={r}>{r}</option>)}</select></Campo>
        <Campo label={type === 'entrada' ? 'Albarán / origen' : 'Obra / referencia'}><input value={ref} onChange={e => setRef(e.target.value)} className={`${INP} h-12`} placeholder={type === 'entrada' ? 'Alb. 2.824.560' : 'C/ Recogidas 12, Granada'} /></Campo>
      </div>
      <div className={`flex items-center justify-between rounded-xl p-3 ${bad ? 'bg-error-container text-error' : 'bg-surface-container-low'}`}>
        <span className="text-body-sm">{bad ? (superaVan ? `La furgoneta solo lleva ${qtyTxt(p, opts.max!)}` : `No hay tanto stock: quedan ${qtyTxt(p, p.stock)}`) : <>Stock pasará de <b>{qtyTxt(p, p.stock)}</b> a <b>{qtyTxt(p, Math.max(0, after))}</b></>}</span>
        {!bad && <Pill p={{ stock: after, min: p.min }} short />}
      </div>
      {type === 'merma' && E.rol !== 'admin' && <p className="text-body-sm text-amber-800 bg-amber-50 rounded-lg p-3">Si la merma supera 50 € o es material en custodia, queda pendiente de validar por el administrador y el stock no cambia hasta entonces.</p>}
      {p.propiedad === 'custodia' && type === 'salida' && <p className="text-body-sm text-violet-800 bg-violet-50 rounded-lg p-3">Material en custodia: indica la obra o instalación de destino (Esmove quiere saber dónde está cada equipo).</p>}
      <p className="text-body-sm text-secondary">Se registra a nombre de <b>{E.operator}</b> con fecha y hora.</p>
    </div>
    <SheetFoot><button onClick={confirmar} disabled={!(q > 0) || bad} className={`${BTN_P} w-full h-14 text-body-lg`}><Icon n="check_circle" className="ico-fill" />Confirmar {TIPO[type].t.toLowerCase()} de {q > 0 ? qtyTxt(p, q) : '…'}</button></SheetFoot>
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
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} type="search" className={`${INP} h-12`} placeholder="Busca por nombre, SKU o ubicación" />
      <div className="flex flex-col">{lista.length ? lista.map(p =>
        <button key={p.sku} onClick={() => abrirMovimiento(p.sku, type)} className="flex items-center gap-3 py-2.5 border-b border-surface-container text-left"><Tile p={p} size="w-10 h-10" />
          <div className="flex-1 min-w-0"><div className="font-medium truncate">{p.name}</div><div className="font-mono text-label-sm text-secondary">{p.sku} · {p.loc} · {qtyTxt(p, p.stock)}</div></div><Pill p={p} short /></button>) : <Vacio>Sin resultados.</Vacio>}</div>
    </div>
  </>);
}

/* ---------- Alta / edición de referencia ---------- */
type FormProd = { sku: string; ean: string; name: string; cat: Producto['cat']; unit: Producto['unit']; packLabel: string; pack: string; stock: string; min: string; P: string; E: string; N: string; supplier: string; supplierRef: string; price: string; serialized: boolean;
  objetivo: string; proveedorHabitual: string; modelo: string; talla: string; propiedad: 'propia' | 'custodia'; propietario: string };
export const abrirFormProducto = (sku?: string, preset: Partial<Producto> = {}, onCreado?: (sku: string) => void) =>
  openModal(<FormProducto sku={sku} preset={preset} onCreado={onCreado} />);
function FormProducto({ sku, preset, onCreado }: { sku?: string; preset: Partial<Producto>; onCreado?: (sku: string) => void }) {
  const p = sku ? find(S(), sku) : undefined;
  const base: Partial<Producto> = p ?? { cat: 'fijaciones', unit: 'ud', pack: 1, min: 10, loc: 'P01-E01-N1', price: 0, ...preset };
  const [a, b, c] = String(base.loc || 'P01-E01-N1').split('-');
  const [f, setF] = useState<FormProd>({
    sku: base.sku || '', ean: base.ean || '', name: base.name || '', cat: base.cat || 'fijaciones', unit: base.unit || 'ud', packLabel: base.packLabel || '',
    pack: String(base.pack ?? 1), stock: '0', min: String(base.min ?? 10), P: a.replace('P', ''), E: b.replace('E', ''), N: c.replace('N', ''),
    supplier: base.supplier || '', supplierRef: base.supplierRef || '', price: String(base.price ?? 0), serialized: !!base.serialized,
    objetivo: base.objetivo != null ? String(base.objetivo) : '', proveedorHabitual: base.proveedorHabitual || '', modelo: base.modelo || '', talla: base.talla || '',
    propiedad: base.propiedad || 'propia', propietario: base.propietario || S().propietarios[0]?.id || '',
  });
  const set = (k: keyof FormProd) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  const guardarProd = () => {
    const E = S(), code = f.sku.trim().toUpperCase(), name = f.name.trim();
    if (!code || !name) return toast('El SKU y el nombre son obligatorios.', 'err');
    if (!p && find(E, code)) return toast(`Ya existe una referencia con el SKU ${code}.`, 'err');
    const loc = `P${f.P.replace(/\D/g, '').padStart(2, '0')}-E${f.E.replace(/\D/g, '').padStart(2, '0')}-N${f.N.replace(/\D/g, '')}`;
    if (!LOC_RE.test(loc)) return toast('Ubicación incompleta: indica pasillo, estantería y nivel.', 'err');
    const n = { pack: toNum(f.pack) || 1, min: toNum(f.min), price: toNum(f.price), stock: toNum(f.stock) || 0 };
    if (Object.values(n).some(v => !(v >= 0))) return toast('Revisa los números: no pueden ser negativos.', 'err');
    if (f.cat === 'cargadores' && !f.serialized) return toast('Los cargadores llevan siempre n.º de serie.', 'err');
    const custodia = f.propiedad === 'custodia';
    const obj = { sku: code, name, cat: f.cat, unit: f.unit, pack: n.pack, packLabel: f.packLabel, min: n.min, loc, supplier: f.supplier.trim(), price: custodia ? null : n.price, ean: f.ean.trim() || undefined, supplierRef: f.supplierRef.trim() || undefined, serialized: f.serialized,
      objetivo: f.objetivo.trim() === '' ? undefined : toNum(f.objetivo), proveedorHabitual: f.proveedorHabitual.trim() || undefined, modelo: f.modelo.trim() || undefined, talla: f.talla.trim() || undefined,
      propiedad: f.propiedad, propietario: custodia ? f.propietario : undefined };
    if (!ejecutar({ op: 'producto', args: { producto: { ...obj, stock: p?.stock ?? 0 }, nuevo: !p, stockInicial: p ? 0 : n.stock } })) return;
    if (p) toast('Referencia actualizada.', 'ok');
    else {
      toast(`Referencia ${code} creada${obj.serialized && n.stock > 0 ? '. Da entrada a las unidades con su n.º de serie.' : '.'}`, 'ok');
      onCreado?.(code);
    }
    closeModal();
  };
  const inp = (k: keyof FormProd, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) =>
    <Campo label={label}><input value={String(f[k])} onChange={set(k)} className={`${INP} h-12`} {...extra} /></Campo>;
  return (<>
    <SheetHead title={p ? 'Editar referencia' : 'Nueva referencia'} sub={p ? p.sku : 'Alta en el catálogo del almacén'} />
    <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
      {inp('sku', 'SKU / ID *', p ? { readOnly: true } : { autoFocus: true })}
      {inp('ean', 'EAN / código de barras', { inputMode: 'numeric' })}
      <div className="sm:col-span-2">{inp('name', 'Nombre *')}</div>
      <Campo label="Categoría"><select value={f.cat} onChange={set('cat')} className={`${INP} h-12`}>{Object.entries(CATS).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select></Campo>
      <Campo label="Unidad base"><select value={f.unit} onChange={set('unit')} className={`${INP} h-12`}><option value="ud">Unidades</option><option value="m">Metros</option></select></Campo>
      {inp('packLabel', 'Formato (caja 100 ud, bobina 100 m…)')}
      {inp('pack', 'Unidades por formato', { inputMode: 'decimal' })}
      {!p && inp('stock', 'Stock inicial', { inputMode: 'decimal' })}
      {inp('min', 'Stock mínimo (alerta)', { inputMode: 'decimal' })}
      <div className="sm:col-span-2"><span className={LBL}>Ubicación (Pasillo · Estantería · Nivel)</span>
        <div className="grid grid-cols-3 gap-2 mt-1">{(['P', 'E', 'N'] as const).map(k =>
          <label key={k} className={`flex items-center gap-1 ${INP} h-12`}><span className="font-mono text-secondary">{k}</span>
            <input value={f[k]} onChange={set(k)} inputMode="numeric" className="w-full bg-transparent focus:outline-none font-mono" aria-label={k === 'P' ? 'Pasillo' : k === 'E' ? 'Estantería' : 'Nivel'} /></label>)}</div></div>
      {inp('supplier', 'Proveedor')}
      {inp('supplierRef', 'Código del proveedor')}
      <Campo label="Propiedad"><select value={f.propiedad} onChange={set('propiedad')} className={`${INP} h-12`}><option value="propia">Material propio</option><option value="custodia">En custodia (no es nuestro)</option></select></Campo>
      {f.propiedad === 'custodia'
        ? <Campo label="Propietario"><select value={f.propietario} onChange={set('propietario')} className={`${INP} h-12`}>{S().propietarios.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></Campo>
        : inp('price', 'Precio de coste por unidad base (€)', { inputMode: 'decimal' })}
      {inp('objetivo', 'Objetivo de reposición (vacío = 2 × mínimo)', { inputMode: 'decimal' })}
      {inp('proveedorHabitual', 'Proveedor habitual (a quién se pide)')}
      {(f.cat === 'ropa' || f.cat === 'epis') && <>{inp('modelo', 'Modelo (agrupa las tallas)')}{inp('talla', 'Talla')}</>}
      <label className="flex items-center gap-3 bg-surface-container-low rounded-lg px-3 h-12"><input type="checkbox" checked={f.serialized} onChange={set('serialized')} className="w-5 h-5 accent-primary" /><span>Control por número de serie</span></label>
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Cancelar</button><button onClick={guardarProd} className={`${BTN_P} h-12 flex-1`}><Icon n="save" className="ico-20" />{p ? 'Guardar cambios' : 'Crear referencia'}</button></SheetFoot>
  </>);
}

/* ---------- Borrador de referencia (almacén): solo el código escaneado; el administrador completa precio, mínimo y ubicación ---------- */
export const abrirBorrador = (codigo = '', onCreado?: (sku: string) => void) => openModal(<Borrador codigo={codigo} onCreado={onCreado} />);
function Borrador({ codigo, onCreado }: { codigo: string; onCreado?: (sku: string) => void }) {
  const esEan = /^\d{8,14}$/.test(codigo);
  const [f, setF] = useState({ sku: esEan ? '' : codigo.toUpperCase(), ean: esEan ? codigo : '', nombre: '', cat: 'aparamenta' as CatId });
  const crear = () => {
    if (!ejecutar({ op: 'borrador', args: f })) return;
    const sku = (f.sku || 'BORR-' + f.ean).toUpperCase();
    closeModal(); toast(`Borrador ${sku} creado. El administrador completará precio, mínimo y ubicación antes de poder moverlo.`, 'ok', 7000); onCreado?.(sku);
  };
  return (<>
    <SheetHead title="Nueva referencia (borrador)" sub="Solo el código y un nombre. El administrador la completa." />
    <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Campo label="Código / SKU"><input value={f.sku} onChange={e => setF({ ...f, sku: e.target.value })} className={`${INP} h-12 font-mono`} /></Campo>
      <Campo label="EAN (código de barras)"><input value={f.ean} onChange={e => setF({ ...f, ean: e.target.value })} inputMode="numeric" className={`${INP} h-12 font-mono`} /></Campo>
      <Campo label="Nombre" className="sm:col-span-2"><input autoFocus value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} className={`${INP} h-12`} placeholder="Lo que pone en la caja" /></Campo>
      <Campo label="Categoría" className="sm:col-span-2"><select value={f.cat} onChange={e => setF({ ...f, cat: e.target.value as CatId })} className={`${INP} h-12`}>{Object.entries(CATS).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select></Campo>
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Cancelar</button><button onClick={crear} className={`${BTN_P} h-12 flex-1`}><Icon n="save" className="ico-20" />Crear borrador</button></SheetFoot>
  </>);
}

/* ---------- Recuento de pasillo ---------- */
export const abrirConteo = (pas: string) => openModal(<Conteo pas={pas} />);
function Conteo({ pas }: { pas: string }) {
  const E = useAlmacen(); const [vals, setVals] = useState<Record<string, string>>({});
  const ps = E.products.filter(p => aisle(p.loc) === pas).sort((a, b) => a.loc.localeCompare(b.loc));
  const { validar } = usePermisos();
  const confirmar = () => {
    const lineas = Object.entries(vals).filter(([, v]) => v.trim() !== '').map(([sku, v]) => ({ sku, contado: toNum(v) }));
    if (lineas.some(l => !(l.contado >= 0))) return toast('Revisa las cantidades: no pueden ser negativas.', 'err');
    const n = lineas.filter(l => redondea(l.contado - find(E, l.sku)!.stock) !== 0).length;
    if (!ejecutar({ op: 'recuento', args: { id: nuevoId(), pasillo: pas, lineas } })) return;
    closeModal();
    toast(!n ? 'Recuento sin diferencias: no se ha ajustado nada.' : validar ? `Recuento guardado: ${n} ajuste${n === 1 ? '' : 's'}.` : `Recuento enviado: ${n} diferencia${n === 1 ? '' : 's'} pendiente${n === 1 ? '' : 's'} de validar por el administrador.`, 'ok', 6000);
  };
  return (<>
    <SheetHead title={`Recuento del pasillo ${pas.replace('P', '')}`} sub={validar ? 'Escribe lo que cuentas. Solo se ajustan las líneas con diferencia, y solo al confirmar.' : 'Escribe lo que cuentas. Las diferencias quedan pendientes de validar por el administrador.'} />
    <div className="p-5 flex flex-col">{ps.map(p =>
      <div key={p.sku} className="flex items-center gap-3 py-2.5 border-b border-surface-container">
        <div className="flex-1 min-w-0"><div className="font-medium truncate">{p.name}</div><div className="font-mono text-label-sm text-secondary">{p.loc} · sistema: {qtyTxt(p, p.stock)}</div></div>
        <input value={vals[p.sku] ?? ''} onChange={e => setVals({ ...vals, [p.sku]: e.target.value })} inputMode="decimal" placeholder={num(p.stock)} disabled={p.serialized}
          title={p.serialized ? 'Los cargadores se recuentan por n.º de serie con el escáner' : undefined} className={`${INP} !w-28 h-12 text-center font-mono`} aria-label={`Cantidad contada de ${p.name}`} />
      </div>)}</div>
    <SheetFoot><button onClick={confirmar} className={`${BTN_P} w-full h-14`}><Icon n="fact_check" className="ico-fill" />Confirmar recuento y ajustar diferencias</button></SheetFoot>
  </>);
}

/* ---------- Reposición (E-006): la bandeja vive en features/reposicion ---------- */
export function pedir(sku: string) {
  const E = S(), p = find(E, sku)!;
  if (E.rol !== 'admin') return toast('El aviso ya está en la bandeja de reposición: el administrador hace el pedido.', 'ok', 5000);
  const q = pedidoSugerido(p) || p.pack || 1;
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
      <button onClick={abrirAvisos} className="flex items-center gap-3 px-4 h-14 rounded-xl hover:bg-surface-container-low"><Icon n="notifications" /><span className="flex-1 text-left">Avisos de stock</span>{nCrit > 0 && <Tag c="bg-error-container text-error">{nCrit}</Tag>}</button>
      <button onClick={abrirPerfil} className="flex items-center gap-3 px-4 h-14 rounded-xl hover:bg-surface-container-low"><Icon n="person" /><span className="flex-1 text-left">Cambiar operario</span></button>
    </div>
  </>);
}
