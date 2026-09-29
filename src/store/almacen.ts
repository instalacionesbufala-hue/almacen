/* Estado del almacén: persistencia local (localStorage) y acciones con avisos.
   Cuando llegue el backend (E-002), este módulo es el único que cambia. */
import type { Estado, Producto } from '../data/tipos';
import { fresh } from '../data/semilla';
import { SEED_PRODUCTS } from '../data/catalogo';
import { applyMovement, qtyTxt, type MovInput, type MovResult } from '../domain/reglas';
import { hashEntrega } from '../domain/hash';
import { crearStore } from './crear';
import { toast } from '../ui/toast';

const LS = 'almacen-bufala-v3';
const LS_OLD = 'almacen-bufala-v2';

function migrate(s: Partial<Estado>): Estado {
  const f = fresh() as unknown as Record<string, unknown>;
  const o = s as Record<string, unknown>;
  for (const k of Object.keys(f)) if (o[k] === undefined) o[k] = f[k];
  return o as unknown as Estado;
}

function load(): Estado {
  try {
    const r = localStorage.getItem(LS);
    if (r) { const s = JSON.parse(r); if (s && Array.isArray(s.products)) return migrate(s); }
    const old = localStorage.getItem(LS_OLD); // datos de la primera versión de la app
    if (old) {
      const o = JSON.parse(old), s = fresh();
      if (o && Array.isArray(o.products)) {
        s.products = o.products; s.movements = o.movements || []; s.albaranes = (o.albaranes || []).concat(s.albaranes);
        for (const p of SEED_PRODUCTS) if (!s.products.find((x: Producto) => x.sku === p.sku)) s.products.push(JSON.parse(JSON.stringify(p)));
        return s;
      }
    }
  } catch { /* datos corruptos o almacenamiento bloqueado: se empieza de cero */ }
  return fresh();
}

export const almacen = crearStore<Estado>(load());
export const useAlmacen = almacen.use;
export const S = () => almacen.get();
export let ultimoGuardado = Date.now();

export function guardar() {
  ultimoGuardado = Date.now();
  try { localStorage.setItem(LS, JSON.stringify(almacen.get())); }
  catch { toast('No se ha podido guardar en este navegador (almacenamiento lleno o bloqueado).', 'err'); }
  almacen.emit();
}

export function reemplazar(nuevo: Partial<Estado>) { almacen.set(migrate(nuevo)); guardar(); }
export async function restaurarDemo() {
  const s = fresh();
  for (const e of s.entregas) e.hash = await hashEntrega(e);
  almacen.set(s); guardar();
}
export function exportarCopia() { return JSON.stringify(almacen.get(), null, 1); }
export function tamañoGuardado() { try { return (localStorage.getItem(LS) || '').length; } catch { return 0; } }

/** Aviso inmediato si un producto cambia a rojo o amarillo */
export function avisoEstado(r: MovResult) {
  if (r.after === 'red' && r.before !== 'red') toast(`Alerta: ${r.p.name} queda en stock crítico (${qtyTxt(r.p, r.p.stock)}, mínimo ${qtyTxt(r.p, r.p.min)}).`, 'err', 7000);
  else if (r.after === 'amber' && r.before === 'green') toast(`Aviso: ${r.p.name} baja de nivel (${qtyTxt(r.p, r.p.stock)}).`, 'warn', 6000);
}

/** Registra un movimiento, guarda y avisa. Devuelve false si no es válido. */
export function mover(input: MovInput): MovResult | null {
  try { const r = applyMovement(almacen.get(), input); guardar(); avisoEstado(r); return r; }
  catch (e) { toast((e as Error).message, 'err'); return null; }
}

// huellas de las entregas sembradas
void (async () => {
  let cambio = false;
  for (const e of almacen.get().entregas) if (!e.hash) { e.hash = await hashEntrega(e); cambio = true; }
  if (cambio) guardar();
})();
