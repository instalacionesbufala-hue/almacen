/* E-006 · Llamadas a la función de servidor "notificar" y alta de este dispositivo para notificaciones push */
import { supabase } from './cliente';
import { procesarCola, recargar } from './sync';

const VAPID = (import.meta.env.VITE_VAPID_PUBLICA as string | undefined)?.trim() || '';
export const pushDisponible = () => !!supabase && !!VAPID && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function invocar(cuerpo: Record<string, unknown>): Promise<string | null> {
  if (!supabase) return 'La nube no está configurada';
  const { data, error } = await supabase.functions.invoke('notificar', { body: cuerpo });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    try { const j = ctx ? await ctx.json() : null; if (j?.error) return j.error; } catch { /* sin cuerpo */ }
    return error.message;
  }
  return (data as { error?: string })?.error || null;
}

/** Envía la cola al servidor y pide a "notificar" que la procese ya (sin esperar al minuto de pg_cron) */
export async function procesarAhora(): Promise<string | null> {
  await procesarCola();
  const e = await invocar({ accion: 'procesar' });
  await recargar();
  return e;
}

export async function enviarInforme(propietario: string, desde: number, hasta: number, destinatarios: string[]): Promise<string | null> {
  await procesarCola();
  const e = await invocar({ accion: 'informe', propietario, desde, hasta, destinatarios });
  await recargar();
  return e;
}

const aBytes = (b64: string) => { const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); };

/** Pide permiso y registra este dispositivo. En iPhone solo funciona con la app añadida a la pantalla de inicio (iOS 16.4+). */
export async function activarPush(): Promise<string | null> {
  if (!pushDisponible()) return 'Este navegador no admite notificaciones push aquí (o falta la clave VITE_VAPID_PUBLICA).';
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return 'Has denegado las notificaciones. Actívalas en los ajustes del navegador.';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(VAPID) });
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error } = await supabase!.rpc('guardar_suscripcion_push', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  return error ? error.message : null;
}
