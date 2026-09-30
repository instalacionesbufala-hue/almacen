/* Conexión con Supabase. Sin VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY la app funciona en modo local (demo). */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Solo el dominio del proyecto: si se pega la URL con /rest/v1/ (la que enseña Supabase en algunas pantallas), se quita */
export function urlProyecto(v: string | undefined): string {
  const t = (v || '').trim();
  if (!t) return '';
  try { return new URL(t).origin; } catch { return t.replace(/\/(rest|auth)\/v1\/?.*$/, '').replace(/\/+$/, ''); }
}
const URL_SB = urlProyecto(import.meta.env.VITE_SUPABASE_URL as string | undefined);
const CLAVE = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';

export const modoNube = !!(URL_SB && CLAVE);
/** La clave "anon" es pública por diseño: la seguridad está en RLS y en las funciones SQL */
export const supabase: SupabaseClient | null = modoNube
  ? createClient(URL_SB, CLAVE, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'almacen-bufala-sesion' } })
  : null;
export const urlSupabase = URL_SB;
export const claveAnon = CLAVE;
