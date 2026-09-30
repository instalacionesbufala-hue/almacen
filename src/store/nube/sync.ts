/* Sincronización con Supabase: sesión, carga, tiempo real y cola de envío sin cobertura.
   - Cada operación va a la cola con su UUID (clave de idempotencia) y se aplica al momento en pantalla.
   - La cola se envía en orden en cuanto hay conexión; un reintento nunca duplica (el servidor responde "duplicado").
   - Si el servidor rechaza una operación, queda como "rechazada" con su motivo y se recarga el estado real. */
import type { Estado } from '../../data/tipos';
import { crearStore } from '../crear';
import { aplicarLocal, descripcion, rpcDe, type Op } from '../ops';
import { aEstado, COLUMNAS, TABLAS, type Tablas } from './mapeo';
import { supabase } from './cliente';

export interface Perfil { id: string; nombre: string; email: string | null; rol: 'admin' | 'almacen'; activo: boolean }
export interface Sesion { estado: 'cargando' | 'sin-sesion' | 'lista'; perfil?: Perfil; error?: string; conexion: 'en-linea' | 'sin-conexion'; ultimaCarga?: number }
export const sesion = crearStore<Sesion>({ estado: 'cargando', conexion: navigator.onLine ? 'en-linea' : 'sin-conexion' });

export interface ItemCola { op: Op; ts: number; estado: 'pendiente' | 'rechazada'; motivo?: string; desc: string }
const LS_COLA = 'almacen-bufala-cola-v1';
const leerCola = (): ItemCola[] => { try { return JSON.parse(localStorage.getItem(LS_COLA) || '[]'); } catch { return []; } };
export const cola = crearStore<ItemCola[]>(leerCola());
const guardarCola = () => { try { localStorage.setItem(LS_COLA, JSON.stringify(cola.get())); } catch { /* sin espacio */ } cola.emit(); };

/* Enlace con el almacén (lo registra store/almacen.ts para evitar dependencias circulares) */
let obtenerEstado: () => Estado;
let fijarEstado: (e: Estado) => void;
let avisar: (m: string, k?: 'ok' | 'err' | 'warn') => void = () => undefined;
export function enlazar(get: () => Estado, set: (e: Estado) => void, toast: typeof avisar) { obtenerEstado = get; fijarEstado = set; avisar = toast; }

const esErrorDeRed = (status: number, msg: string) => status === 0 || status >= 500 || status === 401 || /fetch|network|load failed|timeout/i.test(msg);

export function encolar(op: Op) {
  cola.get().push({ op, ts: Date.now(), estado: 'pendiente', desc: descripcion(obtenerEstado(), op) });
  guardarCola(); void procesarCola();
}
export function descartar(i: number) { cola.get().splice(i, 1); guardarCola(); void recargar(); }
export function reintentar(i: number) { const it = cola.get()[i]; if (it) { it.estado = 'pendiente'; it.motivo = undefined; guardarCola(); void procesarCola(); } }

let procesando = false;
export async function procesarCola(): Promise<void> {
  if (!supabase || procesando || sesion.get().estado !== 'lista') return;
  procesando = true;
  let hubo = false;
  try {
    for (const it of cola.get()) {
      if (it.estado !== 'pendiente') continue;
      const [fn, args] = rpcDe(it.op);
      const { error, status } = await supabase.rpc(fn, args);
      if (error) {
        if (esErrorDeRed(status, error.message)) { marcarConexion(false); break; }
        it.estado = 'rechazada'; it.motivo = error.message; hubo = true;
        avisar(`El servidor ha rechazado: ${it.desc}. Motivo: ${error.message}`, 'err');
      } else { it.estado = 'pendiente'; (it as ItemCola & { hecho?: boolean }).hecho = true; hubo = true; marcarConexion(true); }
      guardarCola();
    }
  } finally {
    cola.set(cola.get().filter(it => !(it as ItemCola & { hecho?: boolean }).hecho)); guardarCola();
    procesando = false;
  }
  if (hubo) await recargar();
}

function marcarConexion(ok: boolean) { const s = sesion.get(); const c = ok ? 'en-linea' : 'sin-conexion'; if (s.conexion !== c) { s.conexion = c; sesion.emit(); } }

/** Descarga todo lo visible para el usuario y reaplica encima lo que aún está en la cola */
export async function recargar(): Promise<void> {
  if (!supabase || sesion.get().estado !== 'lista') return;
  const res = await Promise.all(TABLAS.map(t => {
    const q = supabase!.from(t).select(COLUMNAS[t] || '*');
    return t === 'movimientos' ? q.order('ts', { ascending: false }).limit(2000) : t === 'envios_aviso' ? q.order('ts', { ascending: false }).limit(200) : t === 'avisos_reposicion' ? q.or(`estado.neq.cerrado,cerrado_ts.gt.${new Date(Date.now() - 30 * 864e5).toISOString()}`) : q;
  }));
  const fallo = res.find(r => r.error);
  if (fallo?.error) { marcarConexion(!esErrorDeRed(fallo.status, fallo.error.message)); return; }
  marcarConexion(true);
  const tablas = Object.fromEntries(TABLAS.map((t, i) => [t, res[i].data || []])) as unknown as Tablas;
  const rol = sesion.get().perfil?.rol || 'almacen';
  const actual = obtenerEstado();
  const nuevo = aEstado(tablas, { cesta: actual.cesta, seq: actual.seq }, sesion.get().perfil?.nombre || '', rol);
  for (const it of cola.get()) if (it.estado === 'pendiente') { try { aplicarLocal(nuevo, it.op); } catch { /* se resolverá al enviarla */ } }
  fijarEstado(nuevo);
  sesion.get().ultimaCarga = Date.now(); sesion.emit();
}

let temporizador: ReturnType<typeof setTimeout> | undefined;
const recargarPronto = () => { clearTimeout(temporizador); temporizador = setTimeout(() => void recargar(), 400); };

async function cargarPerfil(): Promise<boolean> {
  const { data, error } = await supabase!.rpc('perfil_actual');
  if (error || !data) {
    await supabase!.auth.signOut();
    sesion.set({ ...sesion.get(), estado: 'sin-sesion', perfil: undefined, error: error?.message || 'Tu usuario no tiene acceso. Pide al administrador que lo active.' });
    return false;
  }
  sesion.set({ ...sesion.get(), estado: 'lista', perfil: data as Perfil, error: undefined });
  return true;
}

let canal: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
function suscribir() {
  if (!supabase || canal) return;
  canal = supabase.channel('almacen').on('postgres_changes', { event: '*', schema: 'public' }, recargarPronto).subscribe();
}

export async function iniciarNube() {
  if (!supabase) return;
  addEventListener('online', () => { marcarConexion(true); void procesarCola(); void recargar(); });
  addEventListener('offline', () => marcarConexion(false));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { void procesarCola(); recargarPronto(); } });
  setInterval(() => void procesarCola(), 20000);
  supabase.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT') { canal?.unsubscribe(); canal = null; sesion.set({ ...sesion.get(), estado: 'sin-sesion', perfil: undefined }); }
  });
  const { data } = await supabase.auth.getSession();
  if (!data.session) { sesion.set({ ...sesion.get(), estado: 'sin-sesion' }); return; }
  if (await cargarPerfil()) { suscribir(); await recargar(); void procesarCola(); }
}

export async function entrar(email: string, clave: string): Promise<string | null> {
  if (!supabase) return 'La nube no está configurada';
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: clave });
  if (error) return error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos' : error.message;
  if (await cargarPerfil()) { suscribir(); await recargar(); void procesarCola(); return null; }
  return sesion.get().error || 'Sin acceso';
}
export async function salir() {
  if (cola.get().some(i => i.estado === 'pendiente') && !confirm('Hay operaciones sin enviar. Si cierras sesión ahora se perderán. ¿Cerrar sesión igualmente?')) return;
  cola.set([]); guardarCola();
  await supabase?.auth.signOut();
}
export async function verificarEntregasServidor(): Promise<{ numero: string; ok: boolean }[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('verificar_entregas');
  if (error) { avisar(error.message, 'err'); return null; }
  return data as { numero: string; ok: boolean }[];
}
