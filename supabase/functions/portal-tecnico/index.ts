// Función de servidor "portal-tecnico" (Supabase Edge Function, Deno) · E-014
// Portal de solo lectura del técnico, sin usuario ni contraseña: se entra con su enlace personal (#/tecnico/<token>).
// - { token }            → sus entregas firmadas y lo que lleva el vehículo de su equipo (fotos con URL firmadas de 1 hora)
// - { token, pdf: <id> } → URL firmada (10 minutos) del PDF firmado de UNA de sus entregas (se genera y se guarda la primera vez)
// Del token solo se guarda el hash; un enlace revocado o de otro técnico no ve nada.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { conCors, json } from '../_compartido/validar.ts';
import { conFotosFirmadas, fotosDelPortal, hashToken, TOKEN_RE, type DatosPortal } from '../_compartido/portal.ts';
import { pdfEntrega } from '../_compartido/pdf-entrega.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  let cuerpo: { token?: string; pdf?: string } = {};
  try { cuerpo = await req.json(); } catch { /* sin cuerpo */ }
  const token = String(cuerpo.token || '');
  if (!TOKEN_RE.test(token)) return json({ error: 'Enlace no válido' }, 400);
  const hash = await hashToken(token);
  const db = createClient(URL, SERVICIO, { auth: { persistSession: false } });

  if (cuerpo.pdf) {
    const id = String(cuerpo.pdf);
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Entrega no válida' }, 400);
    const { data: permitida } = await db.rpc('portal_entrega_permitida', { p_hash: hash, p_entrega: id });
    if (permitida !== true) return json({ error: 'Esta entrega no es de este enlace o el enlace ya no es válido' }, 403);
    const ruta = `entregas/${id}.pdf`;
    let firmada = await db.storage.from('justificantes').createSignedUrl(ruta, 600, { download: true });
    if (firmada.error) {
      // primera vez: se genera el PDF firmado y se guarda en el espacio privado de justificantes
      const r = await pdfEntrega(db, id);
      const sub = await db.storage.from('justificantes').upload(ruta, new Blob([r.pdf], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false });
      if (sub.error && !/exists|duplicate/i.test(sub.error.message)) return json({ error: 'No se ha podido preparar el PDF' }, 500);
      firmada = await db.storage.from('justificantes').createSignedUrl(ruta, 600, { download: r.nombre });
    }
    if (firmada.error || !firmada.data) return json({ error: 'No se ha podido preparar el PDF' }, 500);
    return json({ url: firmada.data.signedUrl });
  }

  const { data, error } = await db.rpc('portal_datos', { p_hash: hash });
  if (error) return json({ error: 'No se han podido leer los datos' }, 500);
  if (!data) return json({ error: 'Este enlace ya no es válido. Pide uno nuevo en el almacén.' }, 404);
  const d = data as DatosPortal;
  const rutas = fotosDelPortal(d);
  const urls: Record<string, string> = {};
  if (rutas.length) {
    const { data: f } = await db.storage.from('fotos-articulos').createSignedUrls(rutas, 3600);
    (f || []).forEach(x => { if (!x.error && x.path && x.signedUrl) urls[x.path] = x.signedUrl; });
  }
  return json(conFotosFirmadas(d, urls));
}));
