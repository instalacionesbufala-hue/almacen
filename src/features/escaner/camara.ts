/* Cámara con lectura de códigos. La usan el escáner, el alta con cámara y la cesta de entrega (lectura seguida).
   E-020: lector ZXing (WebAssembly, empaquetado con la app) en todos los navegadores, también en iPhone, donde no hay BarcodeDetector.
   Lee EAN, UPC, Code 128/39, ITF, Codabar, QR y DataMatrix, también girados. Si en el fotograma solo hay el QR de una web ajena
   (el del fabricante), avisa y sigue escaneando; pasados unos segundos lo entrega como código desconocido. */
import { useCallback, useEffect, useRef, useState } from 'react';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { hayModal } from '../../ui/modal';
import { elegirCodigo } from '../../domain/codigos';
import { leerCodigos, prepararLector } from './lector';

let preparado = false;
const LADO_MAX = 1280;          // se analiza el fotograma completo, reducido como mucho a 1280 px
const CADA_MS = 140;            // unas 7 lecturas por segundo
const AJENA_MS = 4000;          // tiempo con solo un QR ajeno antes de darlo por desconocido
export const AVISO_AJENA = 'QR del fabricante, no es un código del almacén. Enfoca el código de barras o la etiqueta del almacén.';

/** pausarConModal: en el escáner se pausa mientras hay una hoja abierta encima; en la cesta sigue leyendo.
    repetirMs: tiempo mínimo para aceptar otra vez el mismo código (evita sumar dos veces la misma pasada). */
export function useCamara(activa: boolean, onCode: (c: string, formato?: string) => void, o: { pausarConModal?: boolean; repetirMs?: number } = {}) {
  const pausar = o.pausarConModal ?? true, repetir = o.repetirMs ?? 2500;
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null);
  const [estado, setEstado] = useState<{ on: boolean; msg: string; torch: boolean; puedeTorch: boolean; lector: string; aviso: string }>({ on: false, msg: '', torch: false, puedeTorch: false, lector: '', aviso: '' });
  const cb = useRef(onCode); cb.current = onCode;
  const parar = useCallback(() => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; if (video.current) video.current.srcObject = null; setEstado(e => ({ ...e, on: false, torch: false, aviso: '' })); }, []);
  const arrancar = useCallback(async () => {
    if (stream.current) return;
    if (!navigator.mediaDevices?.getUserMedia) return setEstado(e => ({ ...e, msg: 'Este navegador no permite usar la cámara aquí (hace falta https). Escribe el código o usa los de prueba.' }));
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      stream.current = s;
      const track = s.getVideoTracks()[0] as MediaStreamTrack & { getCapabilities?: () => { torch?: boolean; focusMode?: string[] } };
      const cap = (track.getCapabilities?.() ?? {}) as { torch?: boolean; focusMode?: string[] };
      if (cap.focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
      if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => undefined); }
      setEstado({ on: true, msg: '', torch: false, puedeTorch: !!cap.torch, lector: 'EAN · CODE128 · QR', aviso: '' });
    } catch (e) {
      setEstado(x => ({ ...x, on: false, msg: (e as Error).name === 'NotAllowedError' ? 'Permiso de cámara denegado. Actívalo en los ajustes del navegador o escribe el código a mano.' : 'No se ha podido abrir la cámara. Escribe el código o usa los de prueba.' }));
    }
  }, []);
  useEffect(() => { if (activa) arrancar(); return parar; }, [activa, arrancar, parar]);
  useEffect(() => { // bucle de lectura
    if (!estado.on) return;
    if (!preparado) { prepararLector({ wasmUrl }); preparado = true; }
    let ocupado = false, ultimo = { c: '', t: 0 }, ajenaDesde = 0;
    const cv = document.createElement('canvas');
    const id = setInterval(async () => {
      const v = video.current; if (ocupado || !v || v.readyState < 2 || !v.videoWidth || (pausar && hayModal())) return;
      ocupado = true;
      try {
        const k = Math.min(1, LADO_MAX / Math.max(v.videoWidth, v.videoHeight)), w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k);
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(v, 0, 0, w, h);
        const e = elegirCodigo(await leerCodigos(ctx.getImageData(0, 0, w, h)));
        let code: string | null = null, formato: string | undefined;
        if (e?.tipo === 'codigo') { code = e.codigo; formato = e.formato; ajenaDesde = 0; setEstado(x => x.aviso ? { ...x, aviso: '' } : x); }
        else if (e?.tipo === 'ajena') {
          if (!ajenaDesde) { ajenaDesde = Date.now(); setEstado(x => ({ ...x, aviso: AVISO_AJENA })); }
          else if (Date.now() - ajenaDesde > AJENA_MS) { code = e.url; formato = 'QRCode'; ajenaDesde = 0; setEstado(x => ({ ...x, aviso: '' })); }
        }
        if (code && !(code === ultimo.c && Date.now() - ultimo.t < repetir)) { ultimo = { c: code, t: Date.now() }; cb.current(code, formato); }
      } catch { /* fotograma no legible */ }
      ocupado = false;
    }, CADA_MS);
    return () => clearInterval(id);
  }, [estado.on, pausar, repetir]);
  const linterna = () => { const t = stream.current?.getVideoTracks()[0]; if (!t) return; const on = !estado.torch; t.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).catch(() => undefined); setEstado(e => ({ ...e, torch: on })); };
  return { video, estado, arrancar, parar, linterna };
}
