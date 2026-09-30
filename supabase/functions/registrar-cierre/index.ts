// Función de servidor "registrar-cierre" (Supabase Edge Function, Deno) · E-012
// La llama el Google Apps Script del wizard de cierres (servidor a servidor, UrlFetchApp) justo después de guardar la fila en "Registro".
// Cabecera X-Integracion: <token>. Del token solo se guarda el hash (Configuración → Integraciones); si se revoca, se rechaza.
// Cuerpo: un cierre { numInst, esbrainUuid, fechaCierreIso, equipo, hardware, despFallido, version?, metrosLinea, pvc32… }
//         o varios { cierres: [...] } (carga del histórico). El token solo puede registrar cierres: no lee nada.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { json } from '../_compartido/validar.ts';
import { normalizarCierre, traducirCierre, type Kits, type Regla } from '../_compartido/cierres.ts';
import { hashToken, TOKEN_RE } from '../_compartido/portal.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MAX_LOTE = 200;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const token = req.headers.get('x-integracion') || '';
  if (!TOKEN_RE.test(token)) return json({ error: 'Falta la cabecera X-Integracion o no es válida' }, 401);
  let cuerpo: Record<string, unknown>;
  try { cuerpo = await req.json(); } catch { return json({ error: 'El cuerpo debe ser JSON' }, 400); }
  const lista = (Array.isArray(cuerpo.cierres) ? cuerpo.cierres : [cuerpo]) as Record<string, unknown>[];
  if (!lista.length || lista.length > MAX_LOTE) return json({ error: `Envía entre 1 y ${MAX_LOTE} cierres por llamada` }, 400);

  const db = createClient(URL, SERVICIO, { auth: { persistSession: false } });
  const hash = await hashToken(token);
  const { data: integ } = await db.from('integraciones').select('id').eq('token_hash', hash).is('revocado', null).maybeSingle();
  if (!integ) return json({ error: 'Integración no válida o revocada' }, 401);

  // equivalencias confirmadas y activas, kits y catálogo (una vez por llamada)
  const [{ data: filas }, { data: kitsF }, { data: conf }, { data: prods }] = await Promise.all([
    db.from('equivalencias_cierre').select('*').eq('confirmada', true).eq('activa', true),
    db.from('kits_fijacion').select('*'),
    db.from('config_app').select('kit_fijacion').eq('id', 1).single(),
    db.from('productos').select('sku').eq('borrador', false),
  ]);
  const reglas: Regla[] = (filas || []).map(r => ({ id: r.id, campo: r.campo, formula: r.formula, condiciones: r.condiciones || {}, articulos: r.articulos || [], kit: r.kit, estimada: r.estimada, activa: r.activa, orden: r.orden, nota: r.nota }));
  const kits: Kits = Object.fromEntries((kitsF || []).map(k => [k.kit, k.articulos || []]));
  const catalogo = new Set((prods || []).map(p => p.sku as string));

  const resultados = [];
  for (const raw of lista) {
    try {
      const c = normalizarCierre(raw);
      const lineas = traducirCierre(c, reglas, kits, conf?.kit_fijacion || 'A', catalogo);
      const { data, error } = await db.rpc('aplicar_cierre', { p_hash: hash, p: c, p_lineas: lineas });
      resultados.push(error ? { numInst: c.numInst, error: error.message } : { numInst: c.numInst, ...data });
    } catch (e) { resultados.push({ numInst: String(raw?.numInst ?? ''), error: (e as Error).message }); }
  }
  const errores = resultados.filter(r => 'error' in r).length;
  return json(Array.isArray(cuerpo.cierres) ? { resultados, errores } : resultados[0], errores && !Array.isArray(cuerpo.cierres) ? 422 : 200);
});
