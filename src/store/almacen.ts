/* Estado del almacén.
   - Modo local (sin Supabase configurado): demo con datos de ejemplo guardados en este navegador.
   - Modo nube: los datos vienen de Supabase; aquí solo se guarda una copia para abrir sin conexión y la cesta de entrega.
   Todas las escrituras pasan por ejecutar(op): validación inmediata en local y, en nube, envío a la función SQL. */
import type { Estado, Producto } from '../data/tipos';
import { fresh } from '../data/semilla';
import { CONFIG_AVISOS_DEFECTO, OFICINA, SEED_PRODUCTS, CATEGORIAS_INICIALES, fijarCategorias } from '../data/catalogo';
import { find, qtyTxt, status, type MovInput } from '../domain/reglas';
import { hashEntrega } from '../domain/hash';
import { crearStore } from './crear';
import { aplicarLocal, nuevoId, type Op } from './ops';
import { modoNube } from './nube/cliente';
import { encolar, enlazar } from './nube/sync';
import { toast } from '../ui/toast';
import { motivoSinPermiso } from '../domain/permisos';

// v4: datos de demostración con custodia, cuadros, ropa y EPIs (E-006/E-008)
const LS = modoNube ? 'almacen-bufala-nube-cache-v1' : 'almacen-bufala-v5';
const LS_OLD = 'almacen-bufala-v2';

export const vacio = (): Estado => ({ v: 3, products: [], movements: [], albaranes: [], equipos: [], tecnicos: [], entregas: [], herramientas: [], propietarios: [], pendientes: [], perfiles: [], rol: 'almacen', avisos: [], minimosHerramienta: [], configAvisos: { ...CONFIG_AVISOS_DEFECTO }, envios: [], actas: [], vehiculos: [], asignaciones: [], aBordo: [], configApp: { modoDemo: false, kitFijacion: 'A' }, categorias: CATEGORIAS_INICIALES.map(c => ({ ...c })), codigos: [], propuestas: [], portalEnlaces: [], copias: [], cierres: [], lineasCierre: [], equivalencias: [], kits: {}, integraciones: [],
  operator: '', pedidos: {}, cesta: { equipo: '', receptor: null, lineas: [], obra: '', paso: 1 }, seq: { ent: 0 } });

function migrate(s: Partial<Estado>): Estado {
  const f = (modoNube ? vacio() : fresh()) as unknown as Record<string, unknown>;
  const o = s as Record<string, unknown>;
  for (const k of Object.keys(f)) if (o[k] === undefined) o[k] = f[k];
  // E-013: los datos guardados con el modelo anterior (series, estanterías, precios) se sustituyen por la demostración nueva
  if (!modoNube && !Array.isArray(s.vehiculos)) return fresh();
  return o as unknown as Estado;
}

function load(): Estado {
  try {
    const r = localStorage.getItem(LS);
    if (r) { const s = JSON.parse(r); if (s && Array.isArray(s.products)) return migrate(s); }
    if (modoNube) return vacio();
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
  return modoNube ? vacio() : fresh();
}

export const almacen = crearStore<Estado>(load());
// E-016: el registro de categorías sigue siempre a las del estado
fijarCategorias(almacen.get().categorias);
almacen.subscribe(() => fijarCategorias(almacen.get().categorias));
export const useAlmacen = almacen.use;
export const S = () => almacen.get();
export let ultimoGuardado = Date.now();

export function guardar() {
  ultimoGuardado = Date.now();
  try { localStorage.setItem(LS, JSON.stringify(almacen.get())); }
  catch { toast('No se ha podido guardar en este navegador (almacenamiento lleno o bloqueado).', 'err'); }
  almacen.emit();
}
enlazar(() => almacen.get(), e => { almacen.set(e); guardar(); }, toast);

/** Aplica una operación: la valida y la muestra al momento; en modo nube la envía al servidor (o la deja en cola sin cobertura). */
export function ejecutar(op: Op): boolean {
  // E-027: lo que el rol no permite no se intenta (el servidor lo rechazaría igual)
  const sinPermiso = motivoSinPermiso(almacen.get(), op.op);
  if (sinPermiso) { toast(sinPermiso, 'warn', 6000); return false; }
  try { aplicarLocal(almacen.get(), op); }
  catch (e) { toast((e as Error).message, 'err'); return false; }
  guardar();
  if (modoNube) encolar(op);
  return true;
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
export function avisoEstado(r: { p: Producto; before: string; after: string }) {
  if (r.after === 'red' && r.before !== 'red') toast(`Alerta: ${r.p.name} queda en stock crítico (${qtyTxt(r.p, r.p.stock)}, mínimo ${qtyTxt(r.p, r.p.min)}).`, 'err', 7000);
  else if (r.after === 'amber' && r.before === 'green') toast(`Aviso: ${r.p.name} baja de nivel (${qtyTxt(r.p, r.p.stock)}).`, 'warn', 6000);
}

/** Registra un movimiento suelto. Devuelve false si no es válido. */
export function mover(input: MovInput): boolean {
  const p = find(almacen.get(), input.sku); if (!p) { toast('Producto no encontrado', 'err'); return false; }
  const before = status(p);
  const ok = ejecutar({ op: 'movimiento', args: { id: nuevoId(), sku: input.sku, tipo: input.type, qty: Number(input.qty), motivo: input.reason, ref: input.ref || '', series: input.serials || [], equipo: input.equipo, vehiculo: input.vehiculo } });
  if (ok) avisoEstado({ p, before, after: status(p) });
  return ok;
}

/** En modo local se elige quién usa la app; en la nube es siempre el usuario con sesión */
export const operarioSeleccionable = !modoNube;
export const OPERARIO_LOCAL = OFICINA;

// huellas de las entregas de demostración (solo modo local)
if (!modoNube) void (async () => {
  let cambio = false;
  for (const e of almacen.get().entregas) if (!e.hash) { e.hash = await hashEntrega(e); cambio = true; }
  if (cambio) guardar();
})();
