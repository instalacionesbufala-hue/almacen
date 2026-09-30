/* Cola de envíos (envios_aviso): cuándo se reintenta un envío y cómo queda tras un fallo. Puro, probado con Vitest. */
export const MAX_REINTENTOS = 5;
export interface EstadoEnvio { estado: 'pendiente' | 'enviado' | 'error' | 'descartado'; reintentos: number }

/** Se vuelve a intentar mientras esté pendiente o con error y no haya agotado los intentos (cada minuto, con pg_cron) */
export const toca = (e: EstadoEnvio) => (e.estado === 'pendiente' || e.estado === 'error') && e.reintentos < MAX_REINTENTOS;

/** Resultado de un intento: enviado, o error con el motivo (recortado) y un intento más */
export function trasIntento(e: EstadoEnvio, error?: unknown): { estado: 'enviado' | 'error'; reintentos: number; error: string | null } {
  if (error === undefined) return { estado: 'enviado', reintentos: e.reintentos, error: null };
  const msg = error instanceof Error ? error.message : String(error);
  return { estado: 'error', reintentos: e.reintentos + 1, error: msg.slice(0, 500) };
}

/** Texto para la app: si la copia de una entrega ha llegado */
export function estadoCopia(envios: EstadoEnvio[]): 'sin-correo' | 'pendiente' | 'enviada' | 'fallida' {
  const vivos = envios.filter(e => e.estado !== 'descartado');
  if (!vivos.length) return 'sin-correo';
  if (vivos.some(e => e.estado === 'enviado')) return 'enviada';
  if (vivos.some(toca)) return 'pendiente';
  return 'fallida';
}
