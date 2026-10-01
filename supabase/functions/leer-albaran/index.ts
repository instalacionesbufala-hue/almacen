// Función de servidor "leer-albaran" (Supabase Edge Function, Deno) · E-003
// Recibe la foto o el PDF de un albarán, se lo pasa a Gemini (capa gratuita) con el catálogo y devuelve las líneas
// emparejadas con su SKU y su confianza. La clave GEMINI_API_KEY solo existe aquí (Supabase → Edge Functions → Secrets).
// Nada entra en stock desde aquí: la app enseña la propuesta y el usuario confirma.
// Aviso (revisión del chat): en el nivel gratuito, Google puede usar el contenido enviado para mejorar sus productos.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { conCors, json } from '../_compartido/validar.ts';
import { construirPrompt, ESQUEMA_RESPUESTA, normalizarRespuesta, type ItemCatalogo } from '../_compartido/albaran.ts';
import { base64, llamarGemini } from '../_compartido/gemini.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const CLAVE = Deno.env.get('GEMINI_API_KEY') || '';
// Alias que Google mantiene apuntando al Flash vigente: los modelos con número se retiran (gemini-2.5-flash ya no admite usuarios nuevos)
const MODELO = Deno.env.get('GEMINI_MODELO') || 'gemini-flash-latest';
const RESERVA = Deno.env.get('GEMINI_MODELO_RESERVA') || 'gemini-3.5-flash-lite';  // más ligero, para cuando el principal está saturado
const MAX_BYTES = 10 * 1024 * 1024;

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  if (!CLAVE) return json({ error: 'La lectura con IA no está configurada (falta GEMINI_API_KEY)' }, 503);

  // Solo usuarios con sesión y activos; el catálogo se lee con SU sesión (RLS)
  const db = createClient(URL, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
  const { data: activo } = await db.rpc('es_usuario_activo');
  if (activo !== true) return json({ error: 'Inicia sesión para leer albaranes' }, 401);

  let archivo: File | null = null;
  try { const fd = await req.formData(); const f = fd.get('archivo'); archivo = f instanceof File ? f : null; } catch { /* no es multipart */ }
  if (!archivo) return json({ error: 'Falta el archivo del albarán' }, 400);
  if (archivo.size > MAX_BYTES) return json({ error: 'El archivo supera 10 MB: haz una foto más ligera' }, 413);
  const mime = archivo.type || 'application/octet-stream';
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(mime) && mime !== 'application/pdf') return json({ error: 'Formato no admitido: sube una foto (JPG, PNG) o un PDF' }, 415);

  const { data: prods, error } = await db.from('productos').select('sku, ref_proveedor, ean, nombre, unidad, contenido, proveedor, propiedad').eq('borrador', false).eq('archivado', false);
  if (error) return json({ error: error.message }, 500);
  // E-020: también los códigos alternativos (EAN del fabricante…)
  const { data: alts } = await db.from('codigos_articulo').select('codigo, sku');
  const codigosDe = (sku: string) => (alts || []).filter(a => a.sku === sku).map(a => a.codigo as string);
  const catalogo: ItemCatalogo[] = (prods || []).map(p => ({ sku: p.sku, ref: p.ref_proveedor ?? undefined, ean: p.ean ?? undefined, codigos: codigosDe(p.sku), nombre: p.nombre, unidad: p.unidad, contenido: Number(p.contenido) || 1, proveedor: p.proveedor, custodia: p.propiedad === 'custodia' }));

  const r = await llamarGemini({
    clave: CLAVE, modelo: MODELO, reserva: RESERVA, funcion: 'leer-albaran', esquema: ESQUEMA_RESPUESTA,
    partes: [{ inline_data: { mime_type: mime, data: base64(await archivo.arrayBuffer()) } }, { text: construirPrompt(catalogo) }],
  });
  if (!r.ok) return json({ error: r.error.replace('vuelve a intentarlo', 'vuelve a subir el albarán') }, r.status);
  const texto = r.texto, usado = r.modelo;
  try {
    return json({ ...normalizarRespuesta(texto, catalogo), modelo: usado });
  } catch {
    return json({ error: 'No se ha podido interpretar la respuesta de la IA' }, 502);
  }
}));
