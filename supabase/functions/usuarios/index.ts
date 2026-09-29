// Función de servidor "usuarios" (Supabase Edge Function, Deno).
// Solo el administrador la puede usar. Crea usuarios con contraseña y cambia contraseñas: para eso hace falta
// la clave de servicio, que Supabase inyecta en el servidor y nunca llega al navegador.
// El rol y la activación se cambian con la función SQL actualizar_perfil (probada en supabase/tests/e004.test.ts).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CORS, json, validarAlta, validarClave } from '../_compartido/validar.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  // 1) ¿Quién llama? Se comprueba con su propia sesión y la función SQL es_admin()
  const auth = req.headers.get('Authorization') || '';
  const comoUsuario = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: esAdmin, error: e1 } = await comoUsuario.rpc('es_admin');
  if (e1 || esAdmin !== true) return json({ error: 'Solo el administrador puede gestionar usuarios' }, 403);

  const admin = createClient(URL, SERVICIO, { auth: { persistSession: false } });
  let cuerpo: Record<string, string>;
  try { cuerpo = await req.json(); } catch { return json({ error: 'Petición no válida' }, 400); }

  if (cuerpo.accion === 'crear') {
    const alta = { email: String(cuerpo.email || '').trim().toLowerCase(), nombre: String(cuerpo.nombre || '').trim(), rol: cuerpo.rol as 'admin' | 'almacen', clave: String(cuerpo.clave || '') };
    const err = validarAlta(alta);
    if (err) return json({ error: err }, 400);
    const { data, error } = await admin.auth.admin.createUser({ email: alta.email, password: alta.clave, email_confirm: true, user_metadata: { nombre: alta.nombre } });
    if (error || !data.user) return json({ error: error?.message?.includes('already') ? 'Ya existe un usuario con ese correo' : (error?.message || 'No se pudo crear') }, 400);
    const { error: e2 } = await admin.from('perfiles').insert({ id: data.user.id, nombre: alta.nombre, email: alta.email, rol: alta.rol, activo: true });
    if (e2) { await admin.auth.admin.deleteUser(data.user.id); return json({ error: e2.message }, 400); }
    return json({ ok: true, id: data.user.id });
  }

  if (cuerpo.accion === 'clave') {
    const err = validarClave(cuerpo.clave);
    if (err) return json({ error: err }, 400);
    const { error } = await admin.auth.admin.updateUserById(String(cuerpo.id), { password: cuerpo.clave });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (cuerpo.accion === 'bloqueo') {
    // al desactivar un perfil también se cierra su acceso en Auth (además de que RLS ya no le deja ver nada)
    const { error } = await admin.auth.admin.updateUserById(String(cuerpo.id), { ban_duration: cuerpo.activo === 'true' ? 'none' : '876000h' });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: 'Acción desconocida' }, 400);
});
