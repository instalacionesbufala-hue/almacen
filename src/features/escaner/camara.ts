/* Cámara con lectura de códigos (BarcodeDetector nativo o jsQR). La usan el escáner y la cesta de entrega (lectura seguida). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { hayModal } from '../../ui/modal';

interface BarcodeDetectorLike { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
declare global { interface Window { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike } }

/** pausarConModal: en el escáner se pausa mientras hay una hoja abierta encima; en la cesta sigue leyendo.
    repetirMs: tiempo mínimo para aceptar otra vez el mismo código (evita sumar dos veces la misma pasada). */
export function useCamara(activa: boolean, onCode: (c: string) => void, o: { pausarConModal?: boolean; repetirMs?: number } = {}) {
  const pausar = o.pausarConModal ?? true, repetir = o.repetirMs ?? 2500;
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
      const v = video.current; if (ocupado || !v || v.readyState < 2 || (pausar && hayModal())) return;
      ocupado = true;
      try {
        let code: string | null = null;
        if (det) { const r = await det.detect(v); if (r.length) code = r[0].rawValue; }
        else if (jsQR) {
          const w = 480, h = Math.round(w * v.videoHeight / v.videoWidth) || 360; cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(v, 0, 0, w, h);
          const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' }); if (r) code = r.data;
        }
        if (code && !(code === ultimo.c && Date.now() - ultimo.t < repetir)) { ultimo = { c: code, t: Date.now() }; cb.current(code); }
      } catch { /* fotograma no legible */ }
      ocupado = false;
    }, 280);
    return () => clearInterval(id);
  }, [estado.on, pausar, repetir]);
  const linterna = () => { const t = stream.current?.getVideoTracks()[0]; if (!t) return; const on = !estado.torch; t.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).catch(() => undefined); setEstado(e => ({ ...e, torch: on })); };
  return { video, estado, arrancar, parar, linterna };
}
