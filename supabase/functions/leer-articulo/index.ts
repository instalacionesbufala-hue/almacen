// Función de servidor "leer-articulo" (Supabase Edge Function, Deno) · E-015
// Recibe la foto de un artículo o de su etiqueta (y el código escaneado, si lo hay), se la pasa a Gemini y devuelve la ficha PROPUESTA:
// nombre, marca, modelo, EAN, categoría, unidad y contenido. La clave GEMINI_API_KEY solo existe aquí. La app enseña la propuesta
// y el usuario la corrige antes de guardar. Aviso: en el nivel gratuito, Google puede usar el contenido enviado para mejorar sus productos.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { conCors, json } from '../_compartido/validar.ts';
import { base64, llamarGemini } from '../_compartido/gemini.ts';
import { CATEGORIAS, construirPromptArticulo, esquemaArticulo, normalizarArticulo } from '../_compartido/articulo.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const CLAVE = Deno.env.get('GEMINI_API_KEY') || '';
const MODELO = Deno.env.get('GEMINI_MODELO') || 'gemini-flash-latest';
const RESERVA = Deno.env.get('GEMINI_MODELO_RESERVA') || 'gemini-3.5-flash-lite';
const MAX_BYTES = 8 * 1024 * 1024;

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  if (!CLAVE) return json({ error: 'La lectura con IA no está configurada (falta GEMINI_API_KEY)' }, 503);

  const db = createClient(URL, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
  const { data: activo } = await db.rpc('es_usuario_activo');
  if (activo !== true) return json({ error: 'Inicia sesión para leer artículos' }, 401);
  // E-027: dar de alta con la cámara exige "Modificar inventario"
  const { data: puede } = await db.rpc('tiene_permiso', { p_permiso: 'inventario.modificar' });
  if (puede !== true) return json({ error: 'Tu rol no permite dar de alta artículos' }, 403);

  let foto: File | null = null, codigo = '';
  try { const fd = await req.formData(); const f = fd.get('foto'); foto = f instanceof File ? f : null; codigo = String(fd.get('codigo') || '').slice(0, 64); } catch { /* no es multipart */ }
  if (!foto) return json({ error: 'Falta la foto del artículo' }, 400);
  if (foto.size > MAX_BYTES) return json({ error: 'La foto supera 8 MB' }, 413);
  const mime = foto.type || 'application/octet-stream';
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(mime)) return json({ error: 'Formato no admitido: haz una foto (JPG, PNG o WebP)' }, 415);

  // E-016: las categorías activas de la tabla (configurables por el administrador)
  const { data: cats } = await db.from('categorias').select('id').eq('activa', true).order('orden');
  const categorias = (cats || []).map(c => c.id as string);
  const lista = categorias.length ? categorias : CATEGORIAS;
  const r = await llamarGemini({
    clave: CLAVE, modelo: MODELO, reserva: RESERVA, funcion: 'leer-articulo', esquema: esquemaArticulo(lista),
    partes: [{ inline_data: { mime_type: mime, data: base64(await foto.arrayBuffer()) } }, { text: construirPromptArticulo(codigo, lista) }],
  });
  if (!r.ok) return json({ error: r.error }, r.status);
  try {
    return json({ ...normalizarArticulo(r.texto, lista), modelo: r.modelo });
  } catch {
    return json({ error: 'No se ha podido interpretar la respuesta de la IA' }, 502);
  }
}));
