/* E-021 / E-022 · Motivo de un rechazo del servidor (o de Storage) en lenguaje normal, en lugar del texto técnico */

export const MOTIVO_FOTO_SKU = 'El código del artículo tiene caracteres no válidos (/ :). Cámbialo en Editar y vuelve a hacer la foto.';

export function motivoLegible(msg: string | undefined | null): string {
  const m = String(msg || '').replace(/^(Error:\s*)+/i, '').trim();
  if (!m) return 'El servidor no ha dado el motivo.';
  if (/Ruta de la foto no válida|Invalid key|new row violates row-level security policy/i.test(m)) return MOTIVO_FOTO_SKU;
  if (/duplicate key value violates unique constraint "productos_pkey"/i.test(m)) return 'Ya existe un artículo con ese código.';
  if (/violates foreign key constraint/i.test(m)) return 'El artículo tiene historial (movimientos, entregas…): no se puede borrar, solo archivar.';
  if (/permission denied|insufficient_privilege/i.test(m)) return 'Tu usuario no tiene permiso para hacer esto.';
  if (/JWT expired|invalid JWT|refresh token/i.test(m)) return 'La sesión ha caducado: vuelve a entrar.';
  if (/^(null value|invalid input syntax|column .* does not exist|function .* does not exist)/i.test(m)) return `Error interno del servidor (${m}). Avisa al administrador.`;
  return m;
}
