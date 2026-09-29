/* Firma con el dedo (entregas y actas de custodia) */
import { useEffect, useRef } from 'react';

export type Trazo = [number, number][];

/** Lienzo de firma: guarda los trazos normalizados (0–1) para redibujar al cambiar de tamaño */
export function Firma({ trazos, onChange }: { trazos: Trazo[]; onChange: (t: Trazo[]) => void }) {
  const ref = useRef<HTMLCanvasElement>(null), actual = useRef<Trazo | null>(null), lista = useRef(trazos);
  lista.current = trazos;
  const dibujar = () => {
    const cv = ref.current; if (!cv) return;
    const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    const ctx = cv.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
    ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0037b0';
    for (const st of [...lista.current, ...(actual.current ? [actual.current] : [])]) {
      ctx.beginPath(); st.forEach(([x, y], i) => i ? ctx.lineTo(x * r.width, y * r.height) : ctx.moveTo(x * r.width, y * r.height));
      if (st.length === 1) ctx.lineTo(st[0][0] * r.width + .5, st[0][1] * r.height); ctx.stroke();
    }
  };
  useEffect(() => { dibujar(); const f = () => dibujar(); addEventListener('resize', f); return () => removeEventListener('resize', f); });
  const pt = (e: React.PointerEvent): [number, number] => { const b = ref.current!.getBoundingClientRect(); return [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height]; };
  return <canvas ref={ref} className="firma w-full h-40 bg-surface-container-low rounded-xl block" aria-label="Zona de firma"
    onPointerDown={e => { ref.current!.setPointerCapture(e.pointerId); actual.current = [pt(e)]; dibujar(); }}
    onPointerMove={e => { if (!actual.current) return; actual.current.push(pt(e)); dibujar(); }}
    onPointerUp={() => { if (!actual.current) return; const t = actual.current; actual.current = null; onChange([...lista.current, t]); }}
    onPointerCancel={() => { actual.current = null; dibujar(); }} />;
}

export function firmaPNG(trazos: Trazo[]) {
  const c = document.createElement('canvas'); c.width = 360; c.height = 140;
  const ctx = c.getContext('2d')!; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0037b0';
  for (const st of trazos) { ctx.beginPath(); st.forEach(([x, y], i) => i ? ctx.lineTo(x * 360, y * 140) : ctx.moveTo(x * 360, y * 140)); ctx.stroke(); }
  return c.toDataURL('image/png');
}

