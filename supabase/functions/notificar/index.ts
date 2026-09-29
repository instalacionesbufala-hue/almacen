// Función de servidor "notificar" (Supabase Edge Function, Deno).
// Vacía la cola envios_aviso: correo (Resend), notificación push (Web Push) y Telegram.
// La llaman pg_cron (cada minuto, con la cabecera x-clave-cron) y el administrador desde la app ("Enviar prueba", informes).
// Secretos (Supabase → Edge Functions → Secrets): RESEND_API_KEY, TELEGRAM_BOT_TOKEN, VAPID_PUBLICA, VAPID_PRIVADA, VAPID_CONTACTO, CLAVE_CRON.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { conCors, json } from '../_compartido/validar.ts';
import { construirInforme, informeCsv, informeHtml, periodoAnterior, type DatosInforme } from '../_compartido/informe.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const env = (k: string) => Deno.env.get(k) || '';

type Envio = { id: string; canal: 'correo' | 'push' | 'telegram'; tipo: string; asunto: string; cuerpo: string; destinatarios: string[]; adjunto_csv: string | null; reintentos: number };

Deno.serve(conCors(async (req) => {
  let cuerpo: Record<string, unknown> = {};
  try { cuerpo = await req.json(); } catch { /* sin cuerpo */ }
  const db = createClient(URL, SERVICIO, { auth: { persistSession: false } });

  const esCron = !!env('CLAVE_CRON') && req.headers.get('x-clave-cron') === env('CLAVE_CRON');
  if (!esCron) {
    const comoUsuario = createClient(URL, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: esAdmin } = await comoUsuario.rpc('es_admin');
    if (esAdmin !== true) return json({ error: 'Solo el administrador' }, 403);
  }

  try {
    if (cuerpo.accion === 'informe' || (esCron && cuerpo.accion === 'informe_programado')) await encolarInformes(db, cuerpo, esCron);
    const r = await procesar(db);
    return json({ ok: true, ...r });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}));

async function procesar(db: SupabaseClient) {
  const { data: config } = await db.from('config_avisos').select('*').eq('id', 1).single();
  const { data: cola } = await db.from('envios_aviso').select('*').in('estado', ['pendiente', 'error']).lt('reintentos', 5).order('ts').limit(50);
  let enviados = 0, errores = 0;
  for (const e of (cola || []) as Envio[]) {
    try {
      if (e.canal === 'correo') await enviarCorreo(e, config?.correo_remitente);
      else if (e.canal === 'push') await enviarPush(db, e);
      else await enviarTelegram(e, config?.telegram_chat_id);
      await db.from('envios_aviso').update({ estado: 'enviado', enviado_ts: new Date().toISOString(), error: null }).eq('id', e.id);
      enviados++;
    } catch (err) {
      await db.from('envios_aviso').update({ estado: 'error', error: String((err as Error).message).slice(0, 500), reintentos: e.reintentos + 1 }).eq('id', e.id);
      errores++;
    }
  }
  return { enviados, errores };
}

async function enviarCorreo(e: Envio, remitente?: string) {
  if (!env('RESEND_API_KEY')) throw new Error('Falta el secreto RESEND_API_KEY');
  if (!e.destinatarios?.length) throw new Error('Sin destinatarios');
  const esHtml = e.cuerpo.trim().startsWith('<');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: remitente || 'Almacén <onboarding@resend.dev>', to: e.destinatarios, subject: e.asunto,
      ...(esHtml ? { html: e.cuerpo } : { text: e.cuerpo }),
      ...(e.adjunto_csv ? { attachments: [{ filename: 'informe.csv', content: btoa(unescape(encodeURIComponent(e.adjunto_csv))) }] } : {}),
    }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

async function enviarPush(db: SupabaseClient, e: Envio) {
  if (!env('VAPID_PUBLICA') || !env('VAPID_PRIVADA')) throw new Error('Faltan las claves VAPID');
  webpush.setVapidDetails(env('VAPID_CONTACTO') || 'mailto:admin@example.com', env('VAPID_PUBLICA'), env('VAPID_PRIVADA'));
  // el aviso siempre llega a los administradores
  const { data: admins } = await db.from('perfiles').select('id').eq('rol', 'admin').eq('activo', true);
  const { data: subs } = await db.from('suscripciones_push').select('*').in('usuario', (admins || []).map(a => a.id));
  if (!subs?.length) throw new Error('Ningún dispositivo del administrador tiene activadas las notificaciones');
  let ok = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: e.asunto, body: e.cuerpo.slice(0, 300), url: './#stock' }));
      ok++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.from('suscripciones_push').delete().eq('endpoint', s.endpoint); // dispositivo dado de baja
    }
  }
  if (!ok) throw new Error('No se pudo entregar a ningún dispositivo');
}

async function enviarTelegram(e: Envio, chatId?: string) {
  if (!env('TELEGRAM_BOT_TOKEN')) throw new Error('Falta el secreto TELEGRAM_BOT_TOKEN');
  if (!chatId) throw new Error('Falta el chat_id de Telegram en Configuración → Avisos');
  const r = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: `${e.asunto}\n\n${e.cuerpo.replace(/<[^>]+>/g, '')}`.slice(0, 4000) }),
  });
  if (!r.ok) throw new Error(`Telegram ${r.status}: ${await r.text()}`);
}

/** E-008: informe de custodia (sin importes) para cada propietario con correos de informes */
async function encolarInformes(db: SupabaseClient, cuerpo: Record<string, unknown>, programado: boolean) {
  const { data: config } = await db.from('config_avisos').select('*').eq('id', 1).single();
  const tipo = config?.informe_custodia as 'mensual' | 'semanal' | 'ninguno';
  if (programado) {
    if (tipo === 'ninguno') return;
    const hoy = new Date();
    if (tipo === 'semanal' && hoy.getUTCDay() !== 1) return;          // lunes
    if (tipo === 'mensual' && hoy.getUTCDate() !== 1) return;         // día 1
  }
  const periodo = cuerpo.desde && cuerpo.hasta ? { desde: Number(cuerpo.desde), hasta: Number(cuerpo.hasta) } : periodoAnterior(tipo === 'semanal' ? 'semanal' : 'mensual');
  const { data: props } = await db.from('propietarios').select('*').eq('activo', true);
  for (const o of props || []) {
    if (cuerpo.propietario && cuerpo.propietario !== o.id) continue;
    const destinatarios = (cuerpo.destinatarios as string[] | undefined)?.length ? cuerpo.destinatarios as string[] : o.correos_informes;
    if (!destinatarios?.length) continue;
    const { data: productos } = await db.from('productos').select('sku, nombre, unidad, stock, minimo, ref_proveedor, con_serie, foto_mini').eq('propiedad', 'custodia').eq('propietario_id', o.id);
    const skus = (productos || []).map(p => p.sku);
    const { data: movs } = await db.from('movimientos').select('ts, sku, tipo, cantidad, motivo, referencia, series, operario, equipo_id')
      .in('sku', skus.length ? skus : ['-']).gte('ts', new Date(periodo.desde).toISOString()).lt('ts', new Date(periodo.hasta).toISOString());
    const { data: actas } = await db.from('actas_custodia').select('numero, ts, representante, lineas').eq('propietario_id', o.id);
    const datos: DatosInforme = {
      propietario: o.nombre, ...periodo,
      productos: (productos || []).map(p => ({ sku: p.sku, nombre: p.nombre, unidad: p.unidad, stock: Number(p.stock), minimo: Number(p.minimo), codigoModelo: p.ref_proveedor ?? undefined, conSerie: p.con_serie })),
      movimientos: (movs || []).map(m => ({ ts: new Date(m.ts).getTime(), sku: m.sku, tipo: m.tipo, cantidad: Number(m.cantidad), motivo: m.motivo, referencia: m.referencia, series: m.series || [], operario: m.operario, equipo: m.equipo_id ?? undefined })),
      actas: (actas || []).map(a => ({ numero: a.numero, ts: new Date(a.ts).getTime(), representante: a.representante, lineas: a.lineas })),
    };
    const inf = construirInforme(datos);
    // E-009: miniaturas con URL firmadas de 30 días (el bucket es privado; el correo no lleva sesión)
    const conFoto = (productos || []).filter(p => p.foto_mini);
    const { data: firmadas } = conFoto.length ? await db.storage.from('fotos-articulos').createSignedUrls(conFoto.map(p => p.foto_mini as string), 30 * 24 * 3600) : { data: [] };
    const fotos: Record<string, string> = {};
    (firmadas || []).forEach((f, i) => { if (!f.error && f.signedUrl) fotos[conFoto[i].sku] = f.signedUrl; });
    await db.from('envios_aviso').insert({ canal: 'correo', tipo: 'informe', asunto: inf.titulo + ' · ' + inf.periodo, cuerpo: informeHtml(inf, undefined, fotos), destinatarios, adjunto_csv: informeCsv(inf) });
  }
}
