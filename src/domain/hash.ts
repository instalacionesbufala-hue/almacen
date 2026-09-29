/* Huella de integridad de las entregas firmadas */
import type { Entrega } from '../data/tipos';

export async function sha256(txt: string): Promise<string> {
  try {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  } catch { // contexto no seguro (sin crypto.subtle)
    let h = 2166136261; for (const c of txt) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return 'fnv1a-' + (h >>> 0).toString(16);
  }
}

export const hashEntrega = (e: Entrega) =>
  sha256(JSON.stringify({ id: e.id, ts: e.ts, equipo: e.equipo, receptor: e.receptor, dni: e.dni || '', lineas: e.lineas, firma: e.firma }));
