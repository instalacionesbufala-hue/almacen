/* Validaciones puras (sin Deno), compartidas por las funciones y probadas con Vitest */

export interface AltaUsuario { email: string; nombre: string; rol: 'admin' | 'almacen'; clave: string }

export function validarAlta(d: Partial<AltaUsuario>): string | null {
  if (!d.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return 'Correo no válido';
  if (!d.nombre || !d.nombre.trim()) return 'Indica el nombre';
  if (d.rol !== 'admin' && d.rol !== 'almacen') return 'Rol no válido';
  return validarClave(d.clave);
}

/** Contraseña mínima razonable para un almacén: 10 caracteres con letras y números */
export function validarClave(c?: string): string | null {
  if (!c || c.length < 10) return 'La contraseña debe tener al menos 10 caracteres';
  if (!/[A-Za-z]/.test(c) || !/\d/.test(c)) return 'La contraseña debe llevar letras y números';
  return null;
}

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
