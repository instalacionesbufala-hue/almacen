-- =====================================================================================================
-- E-014 · Portal del técnico (solo lectura, sin usuario) y copia por WhatsApp
-- - Enlace personal: #/tecnico/<token>. El token (32 bytes aleatorios) lo genera el móvil o el ordenador que lo envía;
--   aquí solo se guarda su HASH (SHA-256). Cada entrega enviada por WhatsApp lleva un enlace nuevo, así funciona sin
--   cobertura y nunca hace falta recuperar un token. El administrador revoca TODOS los enlaces de un técnico de una vez.
-- - portal_datos(hash): lo único que ve el portal. Solo lo puede ejecutar la función de servidor "portal-tecnico".
-- - Teléfono del técnico (+34…) y registro de cada copia enviada (canal y fecha) en el historial de la entrega.
-- =====================================================================================================
create table public.portal_enlaces (
  hash       text primary key check (hash ~ '^[0-9a-f]{64}$'),
  tecnico_id text not null references public.tecnicos(id),
  entrega_id uuid references public.entregas(id),          -- la entrega con la que se envió (informativo)
  creado     timestamptz not null default now(),
  creado_por text not null,
  revocado   timestamptz
);
create index portal_enlaces_tecnico on public.portal_enlaces (tecnico_id) where revocado is null;

create table public.copias_entrega (
  id         uuid primary key,                              -- generado en el cliente (idempotencia de la cola)
  entrega_id uuid not null references public.entregas(id),
  canal      text not null check (canal in ('whatsapp', 'compartir', 'correo')),
  destino    text not null default '',
  ts         timestamptz not null default now(),
  usuario    uuid references public.perfiles(id),
  operario   text not null
);
create index copias_entrega_entrega on public.copias_entrega (entrega_id, ts);

create or replace function public._telefono_valido(t text) returns boolean language sql immutable as $$ select t ~ '^\+[1-9][0-9]{7,14}$' $$;

-- Teléfono del técnico: como el correo (E-011), cualquier usuario activo puede escribirlo desde la pantalla de firma
create or replace function public.guardar_telefono_tecnico(p_tecnico text, p_telefono text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := perfil_actual(); t text := nullif(regexp_replace(coalesce(p_telefono, ''), '[\s().-]', '', 'g'), '');
begin
  if t is not null and not _telefono_valido(t) then raise exception 'Teléfono no válido: escríbelo con el prefijo del país (+34 600 000 000)'; end if;
  update tecnicos set telefono = t where id = p_tecnico;
  if not found then raise exception 'Técnico no encontrado'; end if;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- Enlace nuevo para un técnico (llega solo el hash). Idempotente: reintentar la cola no duplica.
create or replace function public.crear_enlace_portal(p_tecnico text, p_hash text, p_entrega uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := perfil_actual();
begin
  if coalesce(p_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'Enlace no válido'; end if;
  if not exists (select 1 from tecnicos where id = p_tecnico and activo) then raise exception 'Técnico no encontrado o de baja'; end if;
  if exists (select 1 from portal_enlaces where hash = p_hash) then
    if (select tecnico_id from portal_enlaces where hash = p_hash) <> p_tecnico then raise exception 'Enlace no válido'; end if;
    return jsonb_build_object('estado', 'duplicado');
  end if;
  insert into portal_enlaces (hash, tecnico_id, entrega_id, creado_por) values (p_hash, p_tecnico, p_entrega, u.nombre);
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- Revocar: todos los enlaces del técnico dejan de funcionar al momento (el historial se conserva)
create or replace function public.revocar_enlaces_portal(p_tecnico text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); n int;
begin
  update portal_enlaces set revocado = now() where tecnico_id = p_tecnico and revocado is null;
  get diagnostics n = row_count;
  insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'revocar_enlaces_portal', jsonb_build_object('tecnico', p_tecnico, 'enlaces', n));
  return jsonb_build_object('estado', 'aplicado', 'revocados', n);
end $$;

-- Registro de una copia enviada desde el móvil (WhatsApp o compartir el PDF). Las de correo ya están en envios_aviso.
create or replace function public.registrar_copia_entrega(p_id uuid, p_entrega uuid, p_canal text, p_destino text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := perfil_actual();
begin
  if exists (select 1 from copias_entrega where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  if not exists (select 1 from entregas where id = p_entrega and estado = 'firmada') then raise exception 'Solo se envían copias de entregas firmadas'; end if;
  insert into copias_entrega (id, entrega_id, canal, destino, usuario, operario) values (p_id, p_entrega, p_canal, coalesce(p_destino, ''), u.id, u.nombre);
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- Lo que ve el técnico con su enlace: SUS entregas firmadas y el material del vehículo de su equipo. Nada de otros técnicos, sin importes.
create or replace function public.portal_datos(p_hash text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t tecnicos; v vehiculos; eq equipos;
begin
  select tc.* into t from portal_enlaces pe join tecnicos tc on tc.id = pe.tecnico_id
  where pe.hash = p_hash and pe.revocado is null and tc.activo;
  if not found then return null; end if;
  select * into eq from equipos where id = t.equipo_id and activo;
  select * into v from vehiculos where equipo_id = t.equipo_id and activo;
  return jsonb_build_object(
    'tecnico', jsonb_build_object('id', t.id, 'nombre', t.nombre, 'equipo', eq.nombre),
    'entregas', coalesce((
      select jsonb_agg(x order by x->>'fecha' desc) from (
        select jsonb_build_object('id', e.id, 'numero', e.numero, 'fecha', coalesce(e.firmada_ts, e.ts), 'obra', coalesce(e.obra, ''),
          'equipo', (select nombre from equipos where id = e.equipo_id), 'vehiculo', (select matricula from vehiculos where id = e.vehiculo_id),
          'lineas', coalesce((select jsonb_agg(jsonb_build_object(
              'nombre', coalesce(pr.nombre, d.nombre, l.sku), 'codigo', coalesce(l.sku, d.serie, ''), 'cantidad', l.cantidad,
              'unidad', case when l.tipo = 'herramienta' then 'ud' else coalesce(pr.unidad, 'ud') end, 'foto', pr.foto_mini) order by l.n)
            from entrega_lineas l left join productos pr on pr.sku = l.sku left join dotacion d on d.id = l.dotacion_id where l.entrega_id = e.id), '[]'::jsonb)) as x
        from entregas e where e.receptor_id = t.id and e.estado = 'firmada'
        order by coalesce(e.firmada_ts, e.ts) desc limit 100) q), '[]'::jsonb),
    'vehiculo', case when v.id is null then null else jsonb_build_object('matricula', v.matricula, 'modelo', v.modelo) end,
    'a_bordo', case when v.id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('sku', s.sku, 'nombre', pr.nombre, 'unidad', pr.unidad, 'contenido', pr.contenido, 'unidades', s.unidades, 'foto', pr.foto_mini) order by pr.nombre)
      from stock_vehiculo s join productos pr on pr.sku = s.sku where s.vehiculo_id = v.id and s.unidades <> 0), '[]'::jsonb) end
  );
end $$;

-- ¿Esta entrega es de ese enlace? (para el PDF del portal)
create or replace function public.portal_entrega_permitida(p_hash text, p_entrega uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from portal_enlaces pe join tecnicos tc on tc.id = pe.tecnico_id join entregas e on e.receptor_id = tc.id
                 where pe.hash = p_hash and pe.revocado is null and tc.activo and e.id = p_entrega and e.estado = 'firmada')
$$;

-- El borrado de la demostración (E-013) también vacía los enlaces del portal y las copias
create or replace function public.limpiar_demostracion() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); c config_app; fotos text[]; n jsonb;
begin
  select * into c from config_app where id = 1 for update;
  if not c.modo_demo then raise exception 'Los datos de ejemplo ya se borraron el % (por %)', to_char(c.demo_borrada at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'), c.demo_borrada_por; end if;
  select coalesce(array_agg(r), '{}') into fotos from (select unnest(array[foto, foto_mini]) r from productos) x where r is not null;
  n := jsonb_build_object('productos', (select count(*) from productos), 'movimientos', (select count(*) from movimientos), 'entregas', (select count(*) from entregas),
                          'equipos', (select count(*) from equipos), 'tecnicos', (select count(*) from tecnicos), 'dotacion', (select count(*) from dotacion));
  -- los bloqueos del historial se desactivan SOLO dentro de esta transacción
  perform set_config('almacen.limpieza_demo', 'si', true);
  truncate table portal_enlaces, copias_entrega, envios_aviso, reservas, entrega_lineas, entregas, stock_vehiculo, movimientos, pendientes, recuentos, albaranes, avisos_reposicion,
    actas_custodia, series, costes_producto, costes_incidencia, dotacion_historial, costes_dotacion, dotacion, minimos_herramienta,
    plantilla_lineas, plantillas_entrega, tallas_tecnico, asignaciones_tecnico, asignaciones_vehiculo, vehiculos, tecnicos, equipos, productos;
  perform set_config('almacen.limpieza_demo', '', true);
  alter sequence entregas_numero restart with 1;
  alter sequence actas_numero restart with 1;
  update config_app set modo_demo = false, demo_borrada = now(), demo_borrada_por = p.nombre where id = 1;
  insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'limpiar_demostracion', n || jsonb_build_object('fotos', coalesce(array_length(fotos, 1), 0)));
  -- la app borra estas fotos del bucket (el administrador tiene permiso de borrado)
  return jsonb_build_object('estado', 'aplicado', 'borrado', n, 'fotos', to_jsonb(fotos));
end $$;

-- ---------- Seguridad ----------
alter table public.portal_enlaces enable row level security;
alter table public.copias_entrega enable row level security;
revoke all on public.portal_enlaces, public.copias_entrega from anon, authenticated;
grant select (tecnico_id, entrega_id, creado, creado_por, revocado) on public.portal_enlaces to authenticated;   -- el hash no hace falta en la app
grant select on public.copias_entrega to authenticated;
create policy portal_enlaces_lectura on public.portal_enlaces for select to authenticated using (public.es_usuario_activo());
create policy copias_entrega_lectura on public.copias_entrega for select to authenticated using (public.es_usuario_activo());

revoke execute on function public.guardar_telefono_tecnico(text, text), public.crear_enlace_portal(text, text, uuid), public.revocar_enlaces_portal(text),
  public.registrar_copia_entrega(uuid, uuid, text, text), public.portal_datos(text), public.portal_entrega_permitida(text, uuid), public._telefono_valido(text) from public, anon;
grant execute on function public.guardar_telefono_tecnico(text, text), public.crear_enlace_portal(text, text, uuid), public.revocar_enlaces_portal(text),
  public.registrar_copia_entrega(uuid, uuid, text, text) to authenticated;
revoke execute on function public.portal_datos(text), public.portal_entrega_permitida(text, uuid) from authenticated;
grant execute on function public.portal_datos(text), public.portal_entrega_permitida(text, uuid) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.portal_enlaces, public.copias_entrega;
  end if;
end $$;
