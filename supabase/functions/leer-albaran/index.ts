// Función de servidor "leer-albaran" (Supabase Edge Function, Deno) · E-003
// Recibe la foto o el PDF de un albarán, se lo pasa a Gemini (capa gratuita) con el catálogo y devuelve las líneas
// emparejadas con su SKU y su confianza. La clave GEMINI_API_KEY solo existe aquí (Supabase → Edge Functions → Secrets).
// Nada entra en stock desde aquí: la app enseña la propuesta y el usuario confirma.
// Aviso (revisión del chat): en el nivel gratuito, Google puede usar el contenido enviado para mejorar sus productos.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { conCors, json } from '../_compartido/validar.ts';
import { construirPrompt, ESQUEMA_RESPUESTA, normalizarRespuesta, type ItemCatalogo } from '../_compartido/albaran.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const CLAVE = Deno.env.get('GEMINI_API_KEY') || '';
// Alias que Google mantiene apuntando al Flash vigente: los modelos con número se retiran (gemini-2.5-flash ya no admite usuarios nuevos)
const MODELO = Deno.env.get('GEMINI_MODELO') || 'gemini-flash-latest';
const RESERVA = Deno.env.get('GEMINI_MODELO_RESERVA') || 'gemini-3.5-flash-lite';  // más ligero, para cuando el principal está saturado
const MAX_BYTES = 10 * 1024 * 1024;

function base64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

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

  const { data: prods, error } = await db.from('productos').select('sku, ref_proveedor, ean, nombre, unidad, proveedor, propiedad').eq('borrador', false);
  if (error) return json({ error: error.message }, 500);
  const catalogo: ItemCatalogo[] = (prods || []).map(p => ({ sku: p.sku, ref: p.ref_proveedor ?? undefined, ean: p.ean ?? undefined, nombre: p.nombre, unidad: p.unidad, proveedor: p.proveedor, custodia: p.propiedad === 'custodia' }));

  // Gemini gratuito se satura a ratos (503) o agota el cupo de un modelo (429): se reintenta y, si sigue, se usa un modelo de reserva
  const cuerpo = JSON.stringify({
    contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: base64(await archivo.arrayBuffer()) } }, { text: construirPrompt(catalogo) }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: ESQUEMA_RESPUESTA },
  });
  const intentos: [string, number][] = [[MODELO, 0], [MODELO, 2500], [RESERVA, 1000], [RESERVA, 4000]];
  let r: Response | null = null, usado = MODELO;
  for (const [modelo, espera] of intentos) {
    if (espera) await new Promise(ok => setTimeout(ok, espera));
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': CLAVE }, body: cuerpo,
    });
    usado = modelo;
    if (r.ok) break;
    if (r.status === 404 && modelo === RESERVA) continue;            // la reserva también retirada: se prueba el siguiente intento
    if (![429, 500, 503, 504].includes(r.status) && !(r.status === 404 && modelo !== MODELO)) break;
  }
  r = r!;
  if (r.status === 503 || r.status === 500 || r.status === 504) return json({ error: 'Gemini está saturado ahora mismo (le pasa a ratos al nivel gratuito). Espera un minuto y vuelve a subir el albarán.' }, 503);
  if (r.status === 429) return json({ error: 'Se ha alcanzado el límite gratuito de lecturas de Gemini. Prueba más tarde.' }, 429);
  if (r.status === 404) return json({ error: `Gemini no reconoce el modelo "${usado}" (Google lo habrá retirado). Quita el secreto GEMINI_MODELO o pon uno vigente, y vuelve a desplegar leer-albaran.` }, 502);
  if (r.status === 400 || r.status === 403) return json({ error: `Gemini rechaza la petición (${r.status}): revisa que GEMINI_API_KEY sea correcta y esté activa en Google AI Studio.` }, 502);
  if (!r.ok) return json({ error: `Gemini ha respondido ${r.status}` }, 502);
  const g = await r.json();
  const texto = g?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
  if (!texto) return json({ error: 'La IA no ha devuelto nada: prueba con una foto más nítida y de frente' }, 422);
  try {
    return json({ ...normalizarRespuesta(texto, catalogo), modelo: usado });
  } catch {
    return json({ error: 'No se ha podido interpretar la respuesta de la IA' }, 502);
  }
}));
