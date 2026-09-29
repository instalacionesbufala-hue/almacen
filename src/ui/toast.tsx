import { crearStore } from '../store/crear';
import { Icon } from './base';

type Tipo = 'ok' | 'err' | 'warn' | '';
interface Aviso { id: number; msg: string; kind: Tipo }
const avisos = crearStore<Aviso[]>([]);
let n = 0;

export function toast(msg: string, kind: Tipo = '', ms = 4000) {
  const id = ++n;
  avisos.set([...avisos.get(), { id, msg, kind }]);
  setTimeout(() => avisos.set(avisos.get().filter(a => a.id !== id)), ms);
}

const COLOR: Record<Tipo, string> = { ok: 'bg-inverse-surface text-white', err: 'bg-error text-white', warn: 'bg-amber-500 text-black', '': 'bg-inverse-surface text-white' };
const ICONO: Record<Tipo, string> = { ok: 'check_circle', err: 'error', warn: 'warning', '': 'info' };

export function Toasts() {
  const lista = avisos.use();
  return (
    <div className="fixed z-[60] left-1/2 -translate-x-1/2 bottom-24 lg:bottom-6 flex flex-col gap-2 w-[min(92vw,420px)] pointer-events-none">
      {lista.map(a => (
        <div key={a.id} role={a.kind === 'err' ? 'alert' : 'status'} className={`toast pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl shadow-xl ${COLOR[a.kind]}`}>
          <Icon n={ICONO[a.kind]} className="ico-20 shrink-0" /><span className="text-body-md">{a.msg}</span>
        </div>
      ))}
    </div>
  );
}
