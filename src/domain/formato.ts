/* Formatos y utilidades de texto (sin dependencias del navegador) */

export const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Sin precio (custodia) se muestra un guion, nunca "0,00 €" */
export const eur = (n: number | null | undefined) => n == null ? "—" : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: n >= 1000 ? 0 : 2 }).format(n || 0);
export const num = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(n || 0);
export const parseSN = (t: unknown) => String(t ?? '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
/** Acepta coma decimal */
export const toNum = (v: unknown) => Number(String(v ?? '').replace(',', '.'));
export const redondea = (n: number) => Math.round(n * 1000) / 1000;
export const initials = (n: string) => String(n || '?').split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
export const uid = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function hace(ts: number, ahora = Date.now()): string {
  const s = (ahora - ts) / 1000;
  if (s < 60) return 'ahora mismo';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  const d = new Date(ts), hoy = new Date(ahora);
  const hm = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === hoy.toDateString()) return `Hoy · ${hm}`;
  const ay = new Date(ahora); ay.setDate(ay.getDate() - 1);
  if (d.toDateString() === ay.toDateString()) return `Ayer · ${hm}`;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) + ' · ' + hm;
}
export const fechaHora = (ts: number) => new Date(ts).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const esHoy = (ts: number) => new Date(ts).toDateString() === new Date().toDateString();
export const hoyISO = () => new Date().toISOString().slice(0, 10);
