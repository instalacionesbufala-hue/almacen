/* E-040 · Dónde vive la barra inferior del móvil de cada usuario: en su perfil del servidor (la tiene en cualquier móvil) y una
   copia en el dispositivo (sin conexión se usa la última guardada). Si se cambia sin conexión, se envía al volver a entrar. */
import { normalizarBarra, type ConfigBarra } from '../domain/barra';
import { crearStore } from './crear';
import { modoNube, supabase } from './nube/cliente';
import { sesion } from './nube/sync';

const clave = () => `almacen-barra-movil:${sesion.get().perfil?.id || 'local'}`;
type Guardada = { barra: ConfigBarra | null; pendiente?: boolean };
const leer = (): Guardada | null => { try { const x = JSON.parse(localStorage.getItem(clave()) || 'null'); return x && 'barra' in x ? { barra: normalizarBarra(x.barra), pendiente: !!x.pendiente } : null; } catch { return null; } };
const escribir = (g: Guardada) => { try { localStorage.setItem(clave(), JSON.stringify(g)); } catch { /* sin espacio */ } };

const store = crearStore(0);
let ultimoPerfil: string | undefined;
sesion.subscribe(() => {
  const p = sesion.get().perfil;
  if (!p || p.id === ultimoPerfil) return;
  ultimoPerfil = p.id;
  const local = leer();
  if (local?.pendiente) void enviar(local.barra);                                       // cambiada sin conexión: ahora se envía
  else if ('barra_movil' in p) escribir({ barra: normalizarBarra(p.barra_movil) });     // la del servidor manda
  store.emit();
});

/** La configuración del usuario (null = la de siempre) */
export function barraGuardada(): ConfigBarra | null {
  const local = leer();
  if (local?.pendiente) return local.barra;
  const p = sesion.get().perfil;
  if (modoNube && p && 'barra_movil' in p) return normalizarBarra(p.barra_movil);
  return local?.barra ?? null;
}
export function useBarraGuardada() { store.use(); sesion.use(); return barraGuardada(); }

async function enviar(barra: ConfigBarra | null): Promise<boolean> {
  if (!modoNube || !supabase) return true;
  const { error } = await supabase.rpc('guardar_barra_movil', { p: barra });
  if (error) return false;
  const p = sesion.get().perfil; if (p) p.barra_movil = barra;
  escribir({ barra });
  store.emit();
  return true;
}

/** Guarda la barra (null = restablecer). Devuelve false si no se ha podido enviar (queda en el móvil y se enviará después). */
export async function guardarBarra(barra: ConfigBarra | null): Promise<boolean> {
  escribir({ barra, pendiente: modoNube });
  store.emit();
  return enviar(barra);
}
