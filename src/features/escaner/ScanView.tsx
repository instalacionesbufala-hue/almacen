/* Escáner: cámara real (BarcodeDetector o jsQR) + entrada manual y códigos de prueba */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Producto, TipoMov } from '../../data/tipos';
import { REASONS, UNIT } from '../../data/catalogo';
import { find, qrContenido, qtyTxt, resolveCode } from '../../domain/reglas';
import { hace, num, parseSN, redondea, toNum } from '../../domain/formato';
import { mover, S, useAlmacen } from '../../store/almacen';
import { hayModal } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_BASE, BTN_P, BTN_S, BTN_T, Icon, INP, LBL, Pill, Tile } from '../../ui/base';
import { abrirBorrador, abrirFicha, abrirFormProducto, MovRow } from '../inventario/hojas';

type Modo = 'entrada' | 'salida' | 'consulta';
interface Hit { code: string; sku: string | null; serial: string; via: string }
interface BarcodeDetectorLike { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
declare global { interface Window { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike } }

const PRUEBAS: [string, string][] = [['BUF:BF-FIX-SX8', 'Caja tacos SX 8'], ['4006209700985', 'EAN tacos SX 6'], [qrContenido('WBX-PULSAR-22', 'WBX-22-899281'), 'QR Wallbox 22 kW'], [qrContenido('WBX-PULSAR-22', 'WBX-22-899399'), 'QR Wallbox nuevo'], ['CAB-RZ1K-5G6', 'Bobina 5G6'], ['A9F74240', 'Ref. Schneider iC60N']];

function useCamara(activa: boolean, onCode: (c: string) => void) {
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null);
  const [estado, setEstado] = useState<{ on: boolean; msg: string; torch: boolean; puedeTorch: boolean; lector: string }>({ on: false, msg: '', torch: false, puedeTorch: false, lector: '' });
  const cb = useRef(onCode); cb.current = onCode;
  const parar = useCallback(() => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; if (video.current) video.current.srcObject = null; setEstado(e => ({ ...e, on: false, torch: false })); }, []);
  const arrancar = useCallback(async () => {
    if (stream.current) return;
    if (!navigator.mediaDevices?.getUserMedia) return setEstado(e => ({ ...e, msg: 'Este navegador no permite usar la cámara aquí (hace falta https). Escribe el código o usa los de prueba.' }));
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      stream.current = s;
      if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => undefined); }
      const track = s.getVideoTracks()[0] as unknown as { getCapabilities?: () => { torch?: boolean } };
      setEstado({ on: true, msg: '', torch: false, puedeTorch: !!track.getCapabilities?.().torch, lector: window.BarcodeDetector ? 'QR · EAN · CODE128' : 'LECTOR QR' });
    } catch (e) {
      setEstado(x => ({ ...x, on: false, msg: (e as Error).name === 'NotAllowedError' ? 'Permiso de cámara denegado. Actívalo en los ajustes del navegador o escribe el código a mano.' : 'No se ha podido abrir la cámara. Escribe el código o usa los de prueba.' }));
    }
  }, []);
  useEffect(() => { if (activa) arrancar(); return parar; }, [activa, arrancar, parar]);
  useEffect(() => { // bucle de lectura
    if (!estado.on) return;
    let det: BarcodeDetectorLike | null = null, ocupado = false, ultimo = { c: '', t: 0 };
    let jsQR: typeof import('jsqr').default | null = null;
    try { if (window.BarcodeDetector) det = new window.BarcodeDetector({ formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'data_matrix'] }); } catch { det = null; }
    if (!det) import('jsqr').then(m => { jsQR = m.default; }); // solo si el navegador no lee códigos por sí mismo
    const cv = document.createElement('canvas');
    const id = setInterval(async () => {
      const v = video.current; if (ocupado || !v || v.readyState < 2 || hayModal()) return;
      ocupado = true;
      try {
        let code: string | null = null;
        if (det) { const r = await det.detect(v); if (r.length) code = r[0].rawValue; }
        else if (jsQR) {
          const w = 480, h = Math.round(w * v.videoHeight / v.videoWidth) || 360; cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(v, 0, 0, w, h);
          const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' }); if (r) code = r.data;
        }
        if (code && !(code === ultimo.c && Date.now() - ultimo.t < 2500)) { ultimo = { c: code, t: Date.now() }; cb.current(code); }
      } catch { /* fotograma no legible */ }
      ocupado = false;
    }, 280);
    return () => clearInterval(id);
  }, [estado.on]);
  const linterna = () => { const t = stream.current?.getVideoTracks()[0]; if (!t) return; const on = !estado.torch; t.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).catch(() => undefined); setEstado(e => ({ ...e, torch: on })); };
  return { video, estado, arrancar, parar, linterna };
}

export default function ScanView() {
  const E = useAlmacen();
  const [modo, setModo] = useState<Modo>('entrada');
  const [hit, setHit] = useState<Hit | null>(null);
  const [qty, setQty] = useState('1'), [snTxt, setSnTxt] = useState(''), [sel, setSel] = useState<string[]>([]);
  const [reason, setReason] = useState(REASONS.entrada[0]), [ref, setRef] = useState(''), [manual, setManual] = useState('');
  const [log, setLog] = useState<{ ts: number; type: TipoMov; txt: string }[]>([]);
  const p = hit?.sku ? find(E, hit.sku) : undefined;

  const prepararSerie = (h: Hit, prod?: Producto) => { setSel([]); setSnTxt(''); if (prod?.serialized && h.serial) { setSnTxt(h.serial); if ((prod.serials || []).includes(h.serial)) setSel([h.serial]); } };
  /* Se recrea en cada render; la cámara siempre llama a la última versión */
  const alLeer = (raw: string, via: string) => {
    const r = resolveCode(S(), raw), pPrev = hit?.sku ? find(S(), hit.sku) : undefined;
    navigator.vibrate?.(r ? 60 : [40, 60, 40]);
    if (pPrev?.serialized && modo === 'entrada' && r && r.p.sku === pPrev.sku && r.serial) { // cajas seguidas del mismo modelo: se acumulan
      const sn = parseSN(snTxt);
      if (!sn.includes(r.serial)) { sn.push(r.serial); setSnTxt(sn.join('\n')); toast(`S/N ${r.serial} añadido (${sn.length}).`, 'ok', 2000); }
      return;
    }
    const h: Hit = { code: raw.trim(), sku: r ? r.p.sku : null, serial: r ? r.serial : '', via };
    setHit(h); setQty('1'); setRef(''); setReason(REASONS[modo === 'consulta' ? 'salida' : modo][0]); prepararSerie(h, r?.p);
  };
  const cam = useCamara(true, c => alLeer(c, 'cámara'));

  const cambiarModo = (m: Modo) => { setModo(m); setReason(REASONS[m === 'consulta' ? 'salida' : m][0]); if (hit) prepararSerie(hit, p); };
  const siguiente = () => { setHit(null); if (!cam.estado.on) cam.arrancar(); };
  const serialIn = !!p?.serialized && modo === 'entrada', serialOut = !!p?.serialized && modo === 'salida';
  const q = p?.serialized ? (serialIn ? parseSN(snTxt).length : sel.length) : toNum(qty) || 0;
  const bad = !!p && modo === 'salida' && q > p.stock;
  const yaEnStock = !!p && serialIn && parseSN(snTxt).some(s => (p.serials || []).includes(s));
  const confirmar = () => {
    if (!p || modo === 'consulta') return;
    const serials = p.serialized ? (modo === 'entrada' ? parseSN(snTxt) : sel) : [];
    const r = mover({ sku: p.sku, type: modo, qty: q, reason, ref: ref.trim(), serials });
    if (!r) return;
    setLog(l => [{ ts: Date.now(), type: modo, txt: `${qtyTxt(p, q)} ${p.name}` }, ...l]);
    toast(`${modo === 'entrada' ? 'Entrada' : 'Salida'} registrada: ${qtyTxt(p, q)} · stock ${qtyTxt(p, p.stock)}.`, 'ok');
    setHit(null);
  };
  const paso = (d: number) => { if (!p) return; let n = Math.max(1, redondea((toNum(qty) || 0) + d)); if (modo === 'salida' && n > p.stock) n = Math.max(1, p.stock); setQty(String(n)); };

  return (
    <div className="lg:px-gutter lg:py-space-lg lg:grid lg:grid-cols-12 lg:gap-space-lg lg:items-start max-w-[1500px]">
      <section className="lg:col-span-7 flex flex-col">
        <div className="hidden lg:block mb-4"><span className={LBL}>Lectura QR · EAN · n.º de serie</span><h1 className="text-headline-lg font-bold">Escanear stock con cámara</h1></div>
        <div className="px-4 pt-3 lg:px-0 lg:pt-0"><div className="grid grid-cols-3 bg-inverse-surface rounded-xl p-1 gap-1">{([['entrada', 'Entrada stock', 'move_to_inbox'], ['salida', 'Salida', 'outbox'], ['consulta', 'Consulta', 'search']] as [Modo, string, string][]).map(([k, l, i]) =>
          <button key={k} onClick={() => cambiarModo(k)} className={`h-14 rounded-lg flex flex-col items-center justify-center gap-0.5 text-body-sm font-semibold ${modo === k ? 'bg-primary-container text-white' : 'text-white/70'}`}><Icon n={i} className="ico-20" />{l}</button>)}</div></div>
        <div className="cam mt-3 h-[44vh] min-h-[280px] lg:h-[520px] lg:rounded-2xl">
          <div className="cam-fondo" /><video ref={cam.video} playsInline muted autoPlay />
          <div className="esq tl" /><div className="esq tr" /><div className="esq bl" /><div className="esq br" />
          {cam.estado.on && !hit && <div className="laser" />}
          <span className="absolute top-4 left-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/45 text-tertiary-fixed font-mono text-label-md"><span className={`w-1.5 h-1.5 rounded-full bg-tertiary-fixed ${cam.estado.on ? 'pulso' : ''}`} />{cam.estado.on ? cam.estado.lector : 'CÁMARA APAGADA'}</span>
          <div className="absolute top-4 right-4 flex flex-col gap-2">
            {cam.estado.puedeTorch && <button onClick={cam.linterna} className="w-12 h-12 rounded-full bg-black/45 text-white grid place-items-center" aria-label="Linterna"><Icon n={cam.estado.torch ? 'flashlight_off' : 'flashlight_on'} /></button>}
            {cam.estado.on && <button onClick={cam.parar} className="w-12 h-12 rounded-full bg-black/45 text-white grid place-items-center" aria-label="Apagar cámara"><Icon n="videocam_off" /></button>}
          </div>
          {hit && <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${p ? 'bg-inverse-surface/85' : 'bg-error/90'} backdrop-blur text-white rounded-xl px-4 py-3 text-center shadow-xl max-w-[80%]`}>
            <div className="font-mono text-label-md text-tertiary-fixed flex items-center justify-center gap-1.5">{p ? <><Icon n="verified" className="ico-18" />CÓDIGO RECONOCIDO</> : <span className="text-white">CÓDIGO DESCONOCIDO</span>}</div><div className="font-mono text-label-lg mt-1 break-all">{hit.code}</div></div>}
          {!cam.estado.on && !hit && <div className="absolute inset-0 grid place-items-center p-6"><div className="text-center text-white flex flex-col items-center gap-3"><Icon n="photo_camera" className="ico-40 text-tertiary-fixed" />
            <p className="text-body-md max-w-xs text-white/85">{cam.estado.msg || 'Activa la cámara para leer QR de cargadores, EAN de cajas o etiquetas de estantería.'}</p>
            <button onClick={cam.arrancar} className={`${BTN_BASE} bg-tertiary-fixed text-on-tertiary-fixed h-12 px-5`}><Icon n="videocam" />Activar cámara</button></div></div>}
          <div className="absolute bottom-3 inset-x-4 flex justify-between font-mono text-label-sm text-white/70"><span>{cam.estado.on ? 'Enfoque continuo' : ''}</span><span>{log.length ? `${log.length} bulto${log.length === 1 ? '' : 's'} en esta sesión` : ''}</span></div>
        </div>
      </section>

      <section className="lg:col-span-5 relative z-10 -mt-6 lg:mt-0 bg-surface-container-lowest rounded-t-3xl lg:rounded-2xl shadow-[0_-8px_24px_rgba(11,28,48,0.10)] lg:shadow-sm p-4 lg:p-5">
        <div className="w-12 h-1.5 rounded-full bg-surface-container-high mx-auto mb-4 lg:hidden" />
        {!hit ? <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3"><span className="w-12 h-12 rounded-xl bg-primary-fixed text-primary grid place-items-center"><Icon n="center_focus_weak" className="ico-28" /></span>
            <div><div className="font-semibold text-headline-sm">Apunta al código</div><div className="text-body-sm text-secondary">Modo <b>{modo === 'entrada' ? 'entrada de stock' : modo === 'salida' ? 'salida de material' : 'consulta'}</b>. Al leerlo verás la ficha aquí.</div></div></div>
          <Manual valor={manual} setValor={setManual} onEnviar={c => alLeer(c, 'teclado')} />
          <div><div className={`${LBL} mb-2`}>Códigos de prueba (tócalos para simular la lectura)</div>
            <div className="flex flex-wrap gap-2">{PRUEBAS.map(([c, l]) => <button key={c} onClick={() => alLeer(c, 'simulación')} className="px-3 h-10 rounded-lg bg-surface-container-low text-body-sm hover:bg-surface-container-high">{l}</button>)}</div></div>
          <Registro log={log} />
        </div>
          : !p ? <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 bg-error-container/60 rounded-xl p-4"><Icon n="help" className="text-error ico-32" /><div><div className="font-semibold">“{hit.code}” no está en el catálogo</div><div className="text-body-sm text-secondary">Puedes darlo de alta ahora con este código.</div></div></div>
            <button onClick={() => { const c = hit.code.replace(/^BUF:/i, '').split('|')[0]; if (E.rol !== 'admin') abrirBorrador(c, () => setHit(null)); else abrirFormProducto(undefined, /^\d{8,14}$/.test(c) ? { ean: c } : { sku: c.toUpperCase() }, () => { setHit(null); }); }} className={`${BTN_P} h-14`}><Icon n="add_circle" className="ico-fill" />Crear referencia con este código</button>
            <button onClick={siguiente} className={`${BTN_T} h-14 text-body-lg`}><Icon n="skip_next" />Escanear siguiente</button>
            <Manual valor={manual} setValor={setManual} onEnviar={c => alLeer(c, 'teclado')} />
          </div>
            : <div className="flex flex-col gap-3">
              <div className="bg-surface-container-low rounded-2xl p-4 flex gap-3"><Tile p={p} size="w-14 h-14" />
                <div className="flex-1 min-w-0"><div className="flex justify-between items-center gap-2"><span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-mono text-label-sm">● IDENTIFICADO</span><span className="font-mono text-label-sm text-secondary">vía {hit.via}</span></div>
                  <div className="text-headline-sm font-semibold mt-1 leading-snug">{p.name}</div>
                  <div className="font-mono text-label-sm text-primary mt-0.5">SKU: {p.sku} <span className="text-secondary">· Stock {qtyTxt(p, p.stock)}</span></div></div></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface-container-low rounded-xl p-3"><div className={`${LBL} flex justify-between`}>{p.serialized ? 'S/N leído' : 'Código leído'}<Icon n="check_circle" className="ico-18 text-tertiary" /></div><div className="font-mono text-label-lg mt-1 break-all">{hit.serial || hit.code}</div></div>
                <div className="bg-primary-fixed/50 rounded-xl p-3"><div className={`${LBL} flex justify-between`}>Ubicación<Icon n="location_on" className="ico-18 text-primary" /></div><div className="font-mono text-label-lg text-primary mt-1">{p.loc}</div></div>
              </div>
              {modo === 'consulta' ? <>
                <div className="flex items-center justify-between bg-surface-container-low rounded-xl p-3"><Pill p={p} /><span className="text-body-sm text-secondary">Mín. {qtyTxt(p, p.min)} · {p.supplier}</span></div>
                <div>{E.movements.filter(m => m.sku === p.sku).slice(0, 3).map(m => <MovRow key={m.id} m={m} />)}</div>
                <div className="grid grid-cols-2 gap-2"><button onClick={() => cambiarModo('entrada')} className={`${BTN_T} h-12 !text-tertiary`}><Icon n="move_to_inbox" className="ico-20" />Dar entrada</button><button onClick={() => cambiarModo('salida')} className={`${BTN_T} h-12`}><Icon n="outbox" className="ico-20" />Dar salida</button></div>
                <button onClick={() => abrirFicha(p.sku)} className={`${BTN_S} h-12`}><Icon n="description" className="ico-20" />Ver ficha completa</button>
              </> : <>
                {serialIn ? <label className="flex flex-col gap-1 bg-surface-container-low rounded-xl p-3"><span className={LBL}>N.º de serie que entran · uno por línea</span>
                  <textarea value={snTxt} onChange={e => setSnTxt(e.target.value)} rows={3} className={`${INP} font-mono !bg-white`} />
                  {yaEnStock ? <span className="text-body-sm text-error">Alguno de estos n.º de serie ya está en stock.</span> : <span className="text-body-sm text-secondary">{q} unidad{q === 1 ? '' : 'es'}. Escanea la siguiente caja para añadir más.</span>}</label>
                  : serialOut ? <div className="bg-surface-container-low rounded-xl p-3"><div className={`${LBL} mb-2`}>Unidades que salen ({q})</div>
                    <div className="flex flex-wrap gap-2">{(p.serials || []).length ? p.serials!.map(s => <button key={s} onClick={() => setSel(sel.includes(s) ? sel.filter(x => x !== s) : [...sel, s])} className={`px-3 h-11 rounded-lg font-mono text-label-md ${sel.includes(s) ? 'bg-primary text-white' : 'bg-white'}`}>{sel.includes(s) ? '✓ ' : ''}{s}</button>) : <span className="text-error">No quedan unidades en stock.</span>}</div></div>
                    : <div className="bg-surface-container-low rounded-xl p-3"><div className="flex justify-between items-center mb-2"><span className={LBL}>{modo === 'entrada' ? 'Unidades recibidas' : 'Cantidad que sale'}</span>{p.pack > 1 && <span className="font-mono text-label-sm text-primary">Formato: {p.packLabel}</span>}</div>
                      <div className="flex gap-2"><div className="flex items-center bg-white rounded-xl flex-1 min-w-0">
                        <button onClick={() => paso(-1)} className="w-12 h-14 grid place-items-center" aria-label="Menos"><Icon n="remove" /></button>
                        <input value={qty} onChange={e => setQty(e.target.value)} inputMode="decimal" className="w-full min-w-0 text-center text-headline-md font-bold bg-transparent focus:outline-none" aria-label="Cantidad" /><span className="text-body-sm text-secondary pr-1">{UNIT[p.unit]}</span>
                        <button onClick={() => paso(1)} className="w-12 h-14 grid place-items-center" aria-label="Más"><Icon n="add" /></button></div>
                        {(p.pack > 1 ? [p.pack, p.pack * 5] : [5, 10]).map(s => <button key={s} onClick={() => paso(s)} className="w-14 h-14 shrink-0 rounded-xl bg-primary-fixed/70 text-primary font-semibold text-body-sm">+{num(s)}</button>)}</div></div>}
                <div className="grid grid-cols-2 gap-2">
                  <select value={reason} onChange={e => setReason(e.target.value)} className={`${INP} h-12`} aria-label="Motivo">{REASONS[modo].map(r => <option key={r}>{r}</option>)}</select>
                  <input value={ref} onChange={e => setRef(e.target.value)} className={`${INP} h-12`} placeholder={modo === 'entrada' ? 'Albarán' : 'Obra'} aria-label="Referencia" /></div>
                {bad && <div className="bg-error-container text-error rounded-xl p-3 text-body-sm">Solo quedan {qtyTxt(p, p.stock)}.</div>}
                <button onClick={confirmar} disabled={!(q > 0) || bad || yaEnStock} className={`${BTN_P} h-14 text-headline-sm`}><Icon n={modo === 'entrada' ? 'library_add_check' : 'outbox'} className="ico-fill" />{modo === 'entrada' ? `Añadir al almacén (+${qtyTxt(p, q)})` : `Registrar salida (−${qtyTxt(p, q)})`}</button>
              </>}
              <button onClick={siguiente} className={`${BTN_T} h-14 text-body-lg`}><Icon n="skip_next" />Escanear siguiente</button>
              <Registro log={log} />
            </div>}
      </section>
    </div>
  );
}

function Manual({ valor, setValor, onEnviar }: { valor: string; setValor: (v: string) => void; onEnviar: (c: string) => void }) {
  return <form onSubmit={e => { e.preventDefault(); if (valor.trim()) { onEnviar(valor); setValor(''); } }} className="flex gap-2">
    <input value={valor} onChange={e => setValor(e.target.value)} className={`${INP} h-12 font-mono`} placeholder="Escribe o pega un código" autoComplete="off" aria-label="Código manual" />
    <button type="submit" className={`${BTN_P} h-12 px-4`} aria-label="Buscar código"><Icon n="keyboard_return" /></button></form>;
}
function Registro({ log }: { log: { ts: number; type: TipoMov; txt: string }[] }) {
  if (!log.length) return null;
  return <div className="pt-2"><div className={`${LBL} mb-1`}>Registrado en esta sesión</div>{log.slice(0, 6).map((l, i) =>
    <div key={i} className="flex justify-between text-body-sm py-1.5 border-b border-surface-container"><span className="truncate pr-2">{l.type === 'entrada' ? '+' : '−'}{l.txt}</span><span className="font-mono text-label-sm text-secondary shrink-0">{hace(l.ts)}</span></div>)}</div>;
}
