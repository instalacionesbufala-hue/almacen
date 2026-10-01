/* E-019 · Listas largas sin páginas: "Cargar más" (de 100 en 100), botón flotante "Subir" y pintado progresivo para listas muy grandes */
import { useEffect, useRef, useState } from 'react';
import { Icon } from './base';

/** Cuántos elementos se muestran: de `paso` en `paso`; vuelve al principio cuando cambian los filtros (`clave`) */
export function useMas(paso = 100, clave = ''): [number, () => void] {
  const [n, setN] = useState(paso);
  useEffect(() => { setN(paso); }, [clave, paso]);
  return [n, () => setN(x => x + paso)];
}
export function CargarMas({ visibles, total, mas, que = 'elementos' }: { visibles: number; total: number; mas: () => void; que?: string }) {
  if (visibles >= total) return null;
  return (
    <div className="flex flex-col items-center gap-1 py-4">
      <button onClick={mas} className="h-12 px-6 rounded-xl bg-surface-container-low font-semibold text-primary hover:bg-surface-container">Cargar más</button>
      <span className="font-mono text-label-sm text-secondary">Mostrando {visibles} de {total} {que}</span>
    </div>
  );
}

/** Más de 300 filas: se pintan por tandas al acercarse al final (el aspecto no cambia y las miniaturas ya cargan al verse) */
export function useProgresivo<T>(lista: T[], clave = '', umbral = 300, tanda = 200): { visibles: T[]; centinela: React.RefObject<HTMLDivElement | null> } {
  const [n, setN] = useState(lista.length > umbral ? tanda : Infinity);
  const centinela = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setN(lista.length > umbral ? tanda : Infinity); }, [clave, lista.length > umbral, umbral, tanda]);
  useEffect(() => {
    const el = centinela.current; if (!el || n >= lista.length) return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setN(x => x + tanda); }, { rootMargin: '800px' });
    io.observe(el); return () => io.disconnect();
  }, [n, lista.length, tanda]);
  return { visibles: n >= lista.length ? lista : lista.slice(0, n), centinela };
}

/** Botón flotante "Subir" cuando se ha bajado mucho */
export function BotonSubir({ desde = 900, className = 'bottom-[calc(7.5rem+env(safe-area-inset-bottom))] right-4' }: { desde?: number; className?: string }) {
  const [ver, setVer] = useState(false);
  useEffect(() => { const f = () => setVer(scrollY > desde); f(); addEventListener('scroll', f, { passive: true }); return () => removeEventListener('scroll', f); }, [desde]);
  if (!ver) return null;
  return <button onClick={() => scrollTo({ top: 0, behavior: 'smooth' })} className={`fixed z-30 h-12 px-4 rounded-full bg-inverse-surface text-white shadow-lg inline-flex items-center gap-1 font-semibold ${className}`} aria-label="Subir"><Icon n="arrow_upward" className="ico-20" />Subir</button>;
}
