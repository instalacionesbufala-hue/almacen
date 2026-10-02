/* Validaciones puras (sin Deno), compartidas por las funciones y probadas con Vitest */

/** E-027: el rol es el id de cualquier rol (admin, almacen, lectura o uno propio); la base comprueba que exista */
export interface AltaUsuario { email: string; nombre: string; rol: string; clave: string }

export function validarAlta(d: Partial<AltaUsuario>): string | null {
  if (!d.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return 'Correo no válido';
  if (!d.nombre || !d.nombre.trim()) return 'Indica el nombre';
  if (!d.rol || !/^[a-z0-9_]{2,40}$/.test(d.rol)) return 'Rol no válido';
  return validarClave(d.clave);
}

/** Contraseña mínima razonable para un almacén: 10 caracteres con letras y números */
export function validarClave(c?: string): string | null {
  if (!c || c.length < 10) return 'La contraseña debe tener al menos 10 caracteres';
  if (!/[A-Za-z]/.test(c) || !/\d/.test(c)) return 'La contraseña debe llevar letras y números';
  return null;
}

/** E-010 · Bloqueo en Auth: misma regla que actualizar_perfil. Nadie se bloquea a sí mismo ni deja la app sin administrador activo.
    `adminsActivos` son los perfiles admin activos en este momento (el perfil ya puede venir desactivado por actualizar_perfil). */
export function validarBloqueo(d: { llamante: string; objetivo: string; activar: boolean; adminsActivos: string[] }): string | null {
  if (d.activar) return null;
  if (!d.objetivo) return 'Falta el usuario';
  if (d.objetivo === d.llamante) return 'No puedes bloquearte a ti mismo';
  if (!d.adminsActivos.some(id => id !== d.objetivo)) return 'Tiene que quedar al menos un administrador activo';
  return null;
}

/** E-010 · CORS: solo el origen de la app (ORIGEN_APP, p. ej. https://usuario.github.io; admite varios separados por comas) y localhost en desarrollo */
export function origenPermitido(origen: string | null | undefined, configurado: string | undefined): string | null {
  if (!origen) return null;
  const lista = String(configurado || '').split(',').map(o => o.trim().replace(/\/+$/, '')).filter(Boolean);
  if (lista.includes(origen)) return origen;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origen)) return origen;
  return null;
}

const ORIGEN_APP = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get('ORIGEN_APP');

export function cors(req?: Request): Record<string, string> {
  const ok = origenPermitido(req?.headers.get('Origin'), ORIGEN_APP);
  return {
    // sin origen válido no se envía Allow-Origin: el navegador bloquea la respuesta (las llamadas de servidor, como pg_cron, no lo necesitan)
    ...(ok ? { 'Access-Control-Allow-Origin': ok } : {}),
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

/** Envuelve una función de servidor: responde al preflight y pone las cabeceras CORS del origen que llama */
export const conCors = (h: (req: Request) => Promise<Response>) => async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const r = await h(req);
  for (const [k, val] of Object.entries(cors(req))) r.headers.set(k, val);
  return r;
};

export const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
