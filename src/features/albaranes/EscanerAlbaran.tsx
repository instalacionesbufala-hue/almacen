/* E-024 · "Escanear albarán", como "Escanear documentos" del iPhone:
   cámara trasera a pantalla completa con el contorno de la hoja dibujado encima, disparo automático cuando la hoja está quieta
   (y manual), linterna; tras cada foto, recorte con las 4 esquinas ajustables con el dedo, mejora (color, contraste, blanco y negro)
   y giro; varias páginas con miniaturas para reordenar o borrar, y "Listo". Todo en el móvil, sin descargas ni CDN. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { detectarHoja, encuadreQuieto, enderezar, girar, mejorar, quadPorDefecto, type Img, type Mejora, type Quad } from '../../domain/documento';
import { crearStore } from '../../store/crear';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, Icon } from '../../ui/base';
import { blobAImg, fotograma, imgAJpeg } from './paginas';

/* ---------- Abrir / cerrar desde cualquier pantalla ---------- */
interface Peticion { abierto: boolean; iniciales: Blob[]; listo: ((paginas: Blob[]) => void) | null }
const peticion = crearStore<Peticion>({ abierto: false, iniciales: [], listo: null });
/** Abre el escáner. `iniciales`: fotos de la galería para recortarlas igual que las de la cámara. */
export function abrirEscanerAlbaran(listo: (paginas: Blob[]) => void, iniciales: Blob[] = []) { peticion.set({ abierto: true, iniciales, listo }); }
const cerrar = () => peticion.set({ abierto: false, iniciales: [], listo: null });

export function EscanerAlbaranRaiz() {
  const p = peticion.use();
  return p.abierto ? <Escaner iniciales={p.iniciales} listo={b => { cerrar(); p.listo?.(b); }} /> : null;
}

/* ---------- Una página ---------- */
interface Pagina { id: number; original: Blob; w: number; h: number; quad: Quad; mejora: Mejora; giro: 0 | 1 | 2 | 3; final: Blob; mini: string }
const LADO_FOTO = 2400, LADO_VIVO = 320;
let sec = 0;

async function procesar(original: Blob, quad: Quad, mejora: Mejora, giro: Pagina['giro']): Promise<{ final: Blob; mini: string }> {
  const img = await blobAImg(original, LADO_FOTO);
  let r = mejorar(enderezar(img, quad, 1600), mejora);
  if (giro === 1) r = girar(r, 1); else if (giro === 2) r = girar(r, 2); else if (giro === 3) r = girar(r, -1);
  const final = await imgAJpeg(r);
  return { final, mini: URL.createObjectURL(await imgAJpeg(r, 240, 0.7)) };
}
async function nuevaPagina(original: Blob, img: Img, quad: Quad | null): Promise<Pagina> {
  const q = quad || detectarHoja(img) || quadPorDefecto(img.width, img.height, 0);
  const mejora: Mejora = 'contraste';
  return { id: ++sec, original, w: img.width, h: img.height, quad: q, mejora, giro: 0, ...await procesar(original, q, mejora, 0) };
}

function Escaner({ iniciales, listo }: { iniciales: Blob[]; listo: (b: Blob[]) => void }) {
  const [paginas, setPaginas] = useState<Pagina[]>([]);
  const [fase, setFase] = useState<{ k: 'camara' } | { k: 'editar'; id: number; nueva: boolean } | { k: 'paginas' }>(iniciales.length ? { k: 'paginas' } : { k: 'camara' });
  const [ocupado, setOcupado] = useState(!!iniciales.length);
  const galeria = useRef<HTMLInputElement>(null);
  // fotos de la galería: se recortan solas (detección de la hoja) y se pueden ajustar una a una
  const anadirFotos = useCallback(async (fotos: Blob[]) => {
    if (!fotos.length) return;
    setOcupado(true); setFase({ k: 'paginas' });
    const r: Pagina[] = [];
    for (const b of fotos) { try { const img = await blobAImg(b, LADO_FOTO); r.push(await nuevaPagina(await imgAJpeg(img, LADO_FOTO, 0.92), img, null)); } catch (e) { toast((e as Error).message, 'err'); } }
    setPaginas(x => [...x, ...r]); setOcupado(false);
  }, []);
  const cargadas = useRef(false);
  useEffect(() => { if (cargadas.current) return; cargadas.current = true; void anadirFotos(iniciales); }, [iniciales, anadirFotos]);
  useEffect(() => () => paginas.forEach(p => URL.revokeObjectURL(p.mini)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const salir = () => { if (!paginas.length || confirm(`¿Salir sin guardar ${paginas.length === 1 ? 'la página escaneada' : `las ${paginas.length} páginas escaneadas`}?`)) cerrar(); };
  const terminar = () => { if (!paginas.length) return toast('Escanea al menos una página.', 'warn'); listo(paginas.map(p => p.final)); };
  const actual = fase.k === 'editar' ? paginas.find(p => p.id === fase.id) : undefined;

  return (
    <div className="fixed inset-0 z-[55] bg-black text-white flex flex-col" role="dialog" aria-modal="true" aria-label="Escanear albarán">
      <input ref={galeria} type="file" accept="image/*" multiple className="hidden" onChange={e => { void anadirFotos([...(e.target.files || [])]); e.target.value = ''; }} />
      {fase.k === 'camara' && <Camara n={paginas.length} mini={paginas[paginas.length - 1]?.mini} onGaleria={() => galeria.current?.click()}
        onFoto={async (b, img, q) => { const p = await nuevaPagina(b, img, q); setPaginas(x => [...x, p]); setFase({ k: 'editar', id: p.id, nueva: true }); }}
        onSalir={salir} onPaginas={() => setFase({ k: 'paginas' })} />}
      {fase.k === 'editar' && actual && <Editar p={actual} nueva={fase.nueva}
        onCambio={np => setPaginas(x => x.map(y => (y.id === np.id ? np : y)))}
        onRepetir={() => { setPaginas(x => x.filter(y => y.id !== actual.id)); setFase({ k: 'camara' }); }}
        onOtra={() => setFase({ k: 'camara' })} onTerminar={() => setFase({ k: 'paginas' })} />}
      {fase.k === 'paginas' && <Paginas paginas={paginas} ocupado={ocupado} setPaginas={setPaginas}
        onEditar={id => setFase({ k: 'editar', id, nueva: false })} onAnadir={() => setFase({ k: 'camara' })} onGaleria={() => galeria.current?.click()} onSalir={salir} onListo={terminar} />}
    </div>
  );
}

/* ---------- Cámara ---------- */
function Camara({ n, mini, onFoto, onSalir, onPaginas, onGaleria }: { n: number; mini?: string; onFoto: (b: Blob, img: Img, q: Quad | null) => Promise<void>; onSalir: () => void; onPaginas: () => void; onGaleria: () => void }) {
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null);
  const [est, setEst] = useState({ on: false, msg: '', torch: false, puedeTorch: false });
  const [auto, setAuto] = useState(true), [quad, setQuad] = useState<Quad | null>(null), [dim, setDim] = useState({ w: 16, h: 9 }), [disparando, setDisparando] = useState(false);
  const hist = useRef<{ ts: number; q: Quad }[]>([]), ultimoDisparo = useRef(0), ocupado = useRef(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setEst(e => ({ ...e, msg: 'Este navegador no deja usar la cámara aquí (hace falta https). Elige fotos o un PDF de la galería.' }));
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false });
        if (!vivo) { s.getTracks().forEach(t => t.stop()); return; }
        stream.current = s;
        const t = s.getVideoTracks()[0] as MediaStreamTrack & { getCapabilities?: () => { torch?: boolean; focusMode?: string[] } };
        const cap = (t.getCapabilities?.() ?? {}) as { torch?: boolean; focusMode?: string[] };
        if (cap.focusMode?.includes('continuous')) t.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => undefined); }
        setEst({ on: true, msg: '', torch: false, puedeTorch: !!cap.torch });
      } catch (e) {
        setEst(x => ({ ...x, msg: (e as Error).name === 'NotAllowedError' ? 'Permiso de cámara denegado. Actívalo en los ajustes del navegador o elige fotos de la galería.' : 'No se ha podido abrir la cámara. Elige fotos o un PDF de la galería.' }));
      }
    })();
    return () => { vivo = false; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; };
  }, []);

  const disparar = useCallback(async (q: Quad | null) => {
    const v = video.current; if (!v || ocupado.current) return;
    ocupado.current = true; setDisparando(true); ultimoDisparo.current = Date.now();
    try {
      navigator.vibrate?.(30);
      const grande = fotograma(v, LADO_FOTO); if (!grande) return;
      const k = grande.width / v.videoWidth;
      const qg = q ? (q.map(p => ({ x: p.x * k, y: p.y * k })) as Quad) : null;
      await onFoto(await imgAJpeg(grande, LADO_FOTO, 0.92), grande, qg);
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { ocupado.current = false; setDisparando(false); }
  }, [onFoto]);

  // detección de la hoja en vivo (unas 6 veces por segundo) y disparo automático cuando está quieta
  useEffect(() => {
    if (!est.on) return;
    const lienzo = document.createElement('canvas');
    const id = setInterval(() => {
      const v = video.current; if (!v || v.readyState < 2 || ocupado.current) return;
      const peq = fotograma(v, LADO_VIVO, lienzo); if (!peq) return;
      setDim(d => (d.w === v.videoWidth && d.h === v.videoHeight ? d : { w: v.videoWidth, h: v.videoHeight }));
      const q0 = detectarHoja(peq, { lado: LADO_VIVO, areaMin: 0.2 });
      const k = v.videoWidth / peq.width, q = q0 ? (q0.map(p => ({ x: p.x * k, y: p.y * k })) as Quad) : null;
      setQuad(q);
      const ahora = Date.now();
      if (!q) { hist.current = []; return; }
      hist.current = [...hist.current.filter(e => ahora - e.ts < 2000), { ts: ahora, q }];
      if (auto && ahora - ultimoDisparo.current > 2500 && encuadreQuieto(hist.current, ahora, Math.hypot(v.videoWidth, v.videoHeight), 900, 0.015)) { hist.current = []; void disparar(q); }
    }, 160);
    return () => clearInterval(id);
  }, [est.on, auto, disparar]);

  const linterna = () => { const t = stream.current?.getVideoTracks()[0]; if (!t) return; const on = !est.torch; t.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).catch(() => undefined); setEst(e => ({ ...e, torch: on })); };
  const puntos = quad?.map(p => `${p.x},${p.y}`).join(' ');
  return (<>
    <div className="flex items-center justify-between gap-2 px-3 pt-[max(env(safe-area-inset-top),12px)] pb-2">
      <button onClick={onSalir} className="h-11 px-3 rounded-lg bg-white/10 font-semibold">Cancelar</button>
      <button onClick={() => setAuto(a => !a)} aria-pressed={auto} className={`h-11 px-4 rounded-full font-semibold ${auto ? 'bg-amber-400 text-black' : 'bg-white/10'}`}>{auto ? 'Automático' : 'Manual'}</button>
      {est.puedeTorch ? <button onClick={linterna} aria-pressed={est.torch} aria-label="Linterna" className={`w-11 h-11 rounded-full grid place-items-center ${est.torch ? 'bg-amber-400 text-black' : 'bg-white/10'}`}><Icon n={est.torch ? 'flashlight_on' : 'flashlight_off'} /></button> : <span className="w-11" />}
    </div>
    <div className="relative flex-1 min-h-0">
      <video ref={video} playsInline muted className="absolute inset-0 w-full h-full object-contain" />
      <svg viewBox={`0 0 ${dim.w} ${dim.h}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
        {puntos && <polygon points={puntos} fill="rgba(0,120,255,.22)" stroke="#3b9cff" strokeWidth={Math.max(dim.w, dim.h) / 220} strokeLinejoin="round" />}
      </svg>
      {disparando && <div className="absolute inset-0 bg-white/60 pointer-events-none" />}
      <div className="absolute top-3 inset-x-0 flex justify-center pointer-events-none"><span className="px-3 py-1.5 rounded-full bg-black/60 text-body-sm">
        {est.msg || (!est.on ? 'Abriendo la cámara…' : quad ? (auto ? 'Quieto… se hace la foto sola' : 'Hoja detectada: pulsa el botón') : 'Encuadra la hoja entera sobre un fondo oscuro')}</span></div>
    </div>
    <div className="grid grid-cols-3 items-center px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]">
      {n ? <button onClick={onPaginas} className="justify-self-start relative w-14 h-16 rounded-md overflow-hidden bg-white/10" aria-label={`Ver las ${n} páginas`}>
        {mini && <img src={mini} alt="" className="w-full h-full object-cover" />}<span className="absolute top-0 right-0 min-w-6 h-6 px-1 rounded-full bg-primary text-white text-label-sm grid place-items-center">{n}</span></button>
        : <button onClick={onGaleria} className="justify-self-start h-14 px-3 rounded-lg bg-white/10 flex flex-col items-center justify-center text-label-sm" aria-label="Elegir fotos de la galería"><Icon n="photo_library" />Galería</button>}
      <button onClick={() => void disparar(quad)} disabled={!est.on || disparando} aria-label="Hacer foto" className="justify-self-center w-[72px] h-[72px] rounded-full bg-white ring-4 ring-white/40 disabled:opacity-40 grid place-items-center"><span className="w-[60px] h-[60px] rounded-full border-2 border-black/20" /></button>
      <button onClick={onPaginas} disabled={!n} className="justify-self-end h-11 px-4 rounded-lg bg-primary font-semibold disabled:opacity-30">Guardar ({n})</button>
    </div>
  </>);
}

/* ---------- Recorte, mejora y giro de una página ---------- */
function Editar({ p, nueva, onCambio, onRepetir, onOtra, onTerminar }: { p: Pagina; nueva: boolean; onCambio: (p: Pagina) => void; onRepetir: () => void; onOtra: () => void; onTerminar: () => void }) {
  const [url, setUrl] = useState(''), [quad, setQuad] = useState<Quad>(p.quad), [arrastre, setArrastre] = useState<number | null>(null), [ocupado, setOcupado] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => { const u = URL.createObjectURL(p.original); setUrl(u); return () => URL.revokeObjectURL(u); }, [p.original]);
  const aplicar = async (cambio: Partial<Pick<Pagina, 'quad' | 'mejora' | 'giro'>>) => {
    const x = { ...p, ...cambio }; setOcupado(true);
    try { URL.revokeObjectURL(p.mini); onCambio({ ...x, ...await procesar(x.original, x.quad, x.mejora, x.giro) }); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setOcupado(false); }
  };
  const punto = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect(), e2 = Math.min(r.width / p.w, r.height / p.h);
    const ox = (r.width - p.w * e2) / 2, oy = (r.height - p.h * e2) / 2;
    return { x: Math.max(0, Math.min(p.w, (e.clientX - r.left - ox) / e2)), y: Math.max(0, Math.min(p.h, (e.clientY - r.top - oy) / e2)) };
  };
  const radio = Math.max(p.w, p.h) / 28;
  return (<>
    <div className="flex items-center justify-between gap-2 px-3 pt-[max(env(safe-area-inset-top),12px)] pb-2">
      <button onClick={nueva ? onRepetir : onTerminar} className="h-11 px-3 rounded-lg bg-white/10 font-semibold">{nueva ? 'Repetir' : 'Volver'}</button>
      <span className="text-body-sm text-white/80">Arrastra las esquinas si no encajan</span>
      <button onClick={() => aplicar({ giro: ((p.giro + 1) % 4) as Pagina['giro'] })} disabled={ocupado} aria-label="Girar" className="w-11 h-11 rounded-full grid place-items-center bg-white/10"><Icon n="rotate_right" /></button>
    </div>
    <div className="relative flex-1 min-h-0 touch-none">
      {url && <img src={url} alt="Foto de la página" className="absolute inset-0 w-full h-full object-contain select-none" draggable={false} />}
      <svg ref={svg} viewBox={`0 0 ${p.w} ${p.h}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full"
        onPointerMove={e => { if (arrastre === null) return; const n = [...quad] as Quad; n[arrastre] = punto(e); setQuad(n); }}
        onPointerUp={() => { if (arrastre !== null) { setArrastre(null); void aplicar({ quad }); } }}>
        <polygon points={quad.map(q => `${q.x},${q.y}`).join(' ')} fill="rgba(0,120,255,.15)" stroke="#3b9cff" strokeWidth={radio / 5} strokeLinejoin="round" />
        {quad.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={radio} fill="rgba(255,255,255,.35)" stroke="#fff" strokeWidth={radio / 6} className="cursor-grab"
          onPointerDown={e => { (e.target as Element).setPointerCapture(e.pointerId); setArrastre(i); }} aria-label={['Esquina de arriba a la izquierda', 'Esquina de arriba a la derecha', 'Esquina de abajo a la derecha', 'Esquina de abajo a la izquierda'][i]} />)}
      </svg>
      <div className="absolute bottom-3 right-3 w-24 rounded-md overflow-hidden ring-2 ring-white/70 bg-white">{ocupado ? <div className="h-32 grid place-items-center text-black"><Icon n="progress_activity" className="girar" /></div> : <img src={p.mini} alt="Página recortada" className="w-full" />}</div>
    </div>
    <div className="px-3 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] flex flex-col gap-3">
      <div className="flex justify-center"><div className="inline-flex bg-white/10 p-1 rounded-lg" role="group" aria-label="Mejora de lectura">
        {([['color', 'Color'], ['contraste', 'Contraste'], ['byn', 'Blanco y negro']] as [Mejora, string][]).map(([m, t]) =>
          <button key={m} onClick={() => aplicar({ mejora: m })} disabled={ocupado} aria-pressed={p.mejora === m} className={`h-10 px-3 rounded-md text-body-sm font-semibold ${p.mejora === m ? 'bg-white text-black' : ''}`}>{t}</button>)}</div></div>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onOtra} disabled={ocupado} className={`${BTN_S} h-14 !bg-white/10 !text-white !ring-0`}><Icon n="add_a_photo" />Otra página</button>
        <button onClick={onTerminar} disabled={ocupado} className={`${BTN_P} h-14`}><Icon n="check" />Listo</button>
      </div>
    </div>
  </>);
}

/* ---------- Páginas: reordenar, borrar, editar y "Listo" ---------- */
function Paginas({ paginas, ocupado, setPaginas, onEditar, onAnadir, onGaleria, onSalir, onListo }: { paginas: Pagina[]; ocupado: boolean; setPaginas: (f: (x: Pagina[]) => Pagina[]) => void; onEditar: (id: number) => void; onAnadir: () => void; onGaleria: () => void; onSalir: () => void; onListo: () => void }) {
  const mover = (i: number, d: -1 | 1) => setPaginas(x => { const n = [...x], j = i + d; if (j < 0 || j >= n.length) return x; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const borrar = (id: number) => { if (confirm('¿Borrar esta página?')) setPaginas(x => x.filter(p => { if (p.id === id) URL.revokeObjectURL(p.mini); return p.id !== id; })); };
  return (<>
    <div className="flex items-center justify-between gap-2 px-3 pt-[max(env(safe-area-inset-top),12px)] pb-2">
      <button onClick={onSalir} className="h-11 px-3 rounded-lg bg-white/10 font-semibold">Cancelar</button>
      <span className="font-semibold">{paginas.length} página{paginas.length === 1 ? '' : 's'} · un solo albarán</span><span className="w-16" />
    </div>
    <div className="flex-1 min-h-0 overflow-auto px-3">
      {ocupado ? <div className="h-full grid place-items-center text-white/80"><span className="flex items-center gap-2"><Icon n="progress_activity" className="girar" />Recortando las fotos…</span></div>
        : <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 py-2">{paginas.map((p, i) =>
          <div key={p.id} className="bg-white/10 rounded-xl p-2 flex flex-col gap-2">
            <button onClick={() => onEditar(p.id)} className="relative bg-white rounded-md overflow-hidden aspect-[3/4]" aria-label={`Ajustar la página ${i + 1}`}>
              <img src={p.mini} alt={`Página ${i + 1}`} className="w-full h-full object-contain" /><span className="absolute top-1 left-1 w-7 h-7 rounded-full bg-primary text-white text-label-md grid place-items-center">{i + 1}</span></button>
            <div className="grid grid-cols-3 gap-1">
              <button onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Antes" className="h-10 rounded-md bg-white/10 grid place-items-center disabled:opacity-30"><Icon n="arrow_back" className="ico-20" /></button>
              <button onClick={() => borrar(p.id)} aria-label="Borrar página" className="h-10 rounded-md bg-white/10 grid place-items-center text-red-300"><Icon n="delete" className="ico-20" /></button>
              <button onClick={() => mover(i, 1)} disabled={i === paginas.length - 1} aria-label="Después" className="h-10 rounded-md bg-white/10 grid place-items-center disabled:opacity-30"><Icon n="arrow_forward" className="ico-20" /></button>
            </div>
          </div>)}
          <div className="rounded-xl border-2 border-dashed border-white/30 aspect-[3/4] flex flex-col items-stretch justify-center gap-2 p-3 text-white/90">
            <button onClick={onAnadir} className="h-14 rounded-lg bg-white/10 flex items-center justify-center gap-2"><Icon n="add_a_photo" />Añadir página</button>
            <button onClick={onGaleria} className="h-14 rounded-lg bg-white/10 flex items-center justify-center gap-2"><Icon n="photo_library" />De la galería</button></div>
        </div>}
    </div>
    <div className="px-3 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]">
      <button onClick={onListo} disabled={!paginas.length || ocupado} className={`${BTN_P} h-14 w-full text-body-lg`}><Icon n="document_scanner" />Listo: leer el albarán</button>
    </div>
  </>);
}

