/* E-014 · Portal del técnico: token del enlace personal y forma de los datos que ve.
   Módulo puro (Web Crypto): lo usan la app (genera el token y envía solo su hash), la función "portal-tecnico" y las pruebas. */

/** 32 bytes aleatorios en base64url sin relleno: 43 caracteres */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function generarToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SHA-256 en hexadecimal: es lo único que se guarda del token */
export async function hashToken(token: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** "#/tecnico/<token>" → token (o null si la dirección no es del portal o el token no tiene la forma correcta) */
export function tokenDeRuta(hash: string): string | null {
  const m = /^#\/tecnico\/([^/?#]+)/.exec(hash || '');
  return m && TOKEN_RE.test(m[1]) ? m[1] : null;
}

export interface LineaPortal { nombre: string; codigo: string; cantidad: number; unidad: string; foto: string | null }
export interface EntregaPortal { id: string; numero: string; fecha: string; obra: string; equipo: string | null; vehiculo: string | null; recoge?: string | null; lineas: LineaPortal[] }
export interface ABordoPortal { sku: string; nombre: string; unidad: string; contenido: number; unidades: number; foto: string | null }
export interface DatosPortal {
  tecnico: { id: string; nombre: string; equipo: string | null };
  entregas: EntregaPortal[];
  vehiculo: { matricula: string; modelo: string } | null;
  a_bordo: ABordoPortal[];
}

/** Rutas de fotos que hay que firmar para enseñarlas en el portal */
export const fotosDelPortal = (d: DatosPortal) => [...new Set([...d.entregas.flatMap(e => e.lineas.map(l => l.foto)), ...d.a_bordo.map(a => a.foto)].filter((f): f is string => !!f))];

/** Cambia cada ruta de foto por su URL firmada (o null si no se pudo firmar) */
export function conFotosFirmadas(d: DatosPortal, urls: Record<string, string>): DatosPortal {
  const u = (f: string | null) => (f ? urls[f] ?? null : null);
  return { ...d, entregas: d.entregas.map(e => ({ ...e, lineas: e.lineas.map(l => ({ ...l, foto: u(l.foto) })) })), a_bordo: d.a_bordo.map(a => ({ ...a, foto: u(a.foto) })) };
}
