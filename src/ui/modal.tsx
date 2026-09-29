import { useEffect, type ReactNode } from 'react';
import { crearStore } from '../store/crear';
import { Icon } from './base';

interface ModalState { node: ReactNode; ancha: boolean; key: number }
const modal = crearStore<ModalState | null>(null);
let k = 0;

/** Abre una hoja inferior (móvil) o un diálogo centrado (escritorio). Sustituye a la que hubiera. */
export function openModal(node: ReactNode, opts: { ancha?: boolean } = {}) { modal.set({ node, ancha: !!opts.ancha, key: ++k }); }
export function closeModal() { modal.set(null); }
export const hayModal = () => modal.get() !== null;

export function ModalHost() {
  const m = modal.use();
  useEffect(() => {
    document.body.style.overflow = m ? 'hidden' : '';
    if (!m) return;
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); };
    addEventListener('keydown', f); return () => removeEventListener('keydown', f);
  }, [m]);
  useEffect(() => { const f = () => closeModal(); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  if (!m) return null;
  return (
    <div id="modal" className="fixed inset-0 z-50">
      <div className="velo" onClick={closeModal} />
      <div key={m.key} className={`hoja ${m.ancha ? 'ancha' : ''}`} role="dialog" aria-modal="true">{m.node}</div>
    </div>
  );
}

export function SheetHead({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="sticky top-0 bg-white z-10 px-5 pt-3 pb-3 border-b border-surface-container">
      <div className="w-12 h-1.5 rounded-full bg-surface-container-high mx-auto mb-3 lg:hidden" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="text-headline-md font-semibold">{title}</h2>{sub && <p className="text-body-sm text-secondary">{sub}</p>}</div>
        <button onClick={closeModal} className="p-2 -m-2 rounded-lg hover:bg-surface-container-low" aria-label="Cerrar"><Icon n="close" /></button>
      </div>
    </div>
  );
}

export const SheetFoot = ({ children, className = '' }: { children: ReactNode; className?: string }) =>
  <div className={`sticky bottom-0 bg-white border-t border-surface-container p-4 ${className}`}>{children}</div>;
