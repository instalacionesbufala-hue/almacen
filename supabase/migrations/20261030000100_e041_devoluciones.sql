-- E-041 · Devolución de material de una furgoneta al almacén (lo que los técnicos no han usado), como una entrega al revés:
-- cesta, quién devuelve (técnico del equipo), motivo, obra, firma y albarán DEV-AAAA-NNNN.
-- - Las cantidades van en la unidad base (m o ud), aunque el artículo vaya por rollos o cajas: 30 m de un rollo de 100 m
--   suman 0,3 rollos al almacén. Se admite un artículo que no consta a bordo (la furgoneta queda en negativo).
-- - Línea "bien": traspaso vehículo → almacén (movimiento de devolución). Línea "defectuoso": sale de la furgoneta como merma
--   (no suma al stock útil); si es material en custodia, incidencia al socio (E-008). La custodia vuelve a su socio sola.
-- - Anulación (solo administrador, con motivo): movimientos inversos enlazados. Historial inalterable.

create sequence if not exists public.devoluciones_numero;
create table if not exists public.devoluciones (
  id               uuid primary key,
  numero           text not null unique,
  ts               timestamptz not null default now(),
  vehiculo_id      text not null references public.vehiculos(id),
  equipo_id        text references public.equipos(id),
  tecnico_id       text references public.tecnicos(id),          -- quién devuelve y firma
  motivo           text not null check (motivo in ('sobrante', 'no_usado', 'cambio', 'otro')),
  motivo_texto     text not null default '',
  obra             text not null default '',
  lineas           jsonb not null,                               -- [{sku, nombre, unidades, cantidad (formatos), estado, motivoDefecto}]
  firma            text not null,
  hash             text not null default '',
  estado           text not null default 'firmada' check (estado in ('firmada', 'anulada')),
  anulada_ts       timestamptz,
  anulada_por      text,
  anulacion_motivo text,
  usuario          uuid references public.perfiles(id),
  operario         text not null                                 -- quién lo recibe en el almacén
);
alter table public.movimientos add column if not exists devolucion_id uuid references public.devoluciones(id);

grant select on public.devoluciones to authenticated;
alter table public.devoluciones enable row level security;
create policy devoluciones_lectura on public.devoluciones for select to authenticated using (public.tiene_permiso('entregas.ver') or public.tiene_permiso('movimientos.ver'));

create or replace function public._devoluciones_inalterables() returns trigger language plpgsql as $$
begin
  if _limpiando() then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and old.hash = '' and new.hash <> '' and (to_jsonb(new) - 'hash') = (to_jsonb(old) - 'hash') then return new; end if;
  if tg_op = 'UPDATE' and old.estado = 'firmada' and new.estado = 'anulada'
     and (to_jsonb(new) - array['estado', 'anulada_ts', 'anulada_por', 'anulacion_motivo']) = (to_jsonb(old) - array['estado', 'anulada_ts', 'anulada_por', 'anulacion_motivo']) then return new; end if;
  raise exception 'Una devolución firmada no se puede modificar ni borrar: anúlala' using errcode = '42501';
end $$;
create trigger devoluciones_inalterables before update or delete on public.devoluciones for each row execute function public._devoluciones_inalterables();

create or replace function public._hash_devolucion(p_id uuid) returns text
language sql stable security definer set search_path = public, extensions as $$
  select encode(extensions.digest(jsonb_build_object(
    'id', d.id, 'numero', d.numero, 'ts', floor(extract(epoch from d.ts) * 1000)::bigint, 'vehiculo', d.vehiculo_id, 'equipo', d.equipo_id,
    'tecnico', d.tecnico_id, 'motivo', d.motivo, 'motivoTexto', d.motivo_texto, 'obra', d.obra, 'lineas', d.lineas, 'firma', d.firma
  )::text, 'sha256'), 'hex')
  from devoluciones d where d.id = p_id
$$;

-- p: {vehiculo, tecnico, motivo, motivoTexto?, obra?, firma, lineas: [{sku, unidades, estado ('bien'|'defectuoso'), motivoDefecto?}]}
create or replace function public.registrar_devolucion(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := perfil_actual(); d devoluciones; v vehiculos; t tecnicos; l jsonb; pr productos; ud numeric; q numeric; num text; h text; ref text; mid uuid;
        lineas jsonb := '[]'; vistos text[] := '{}'; est text;
begin
  select * into d from devoluciones where id = p_id;
  if found then return jsonb_build_object('estado', 'duplicado', 'numero', d.numero, 'hash', d.hash); end if;
  select * into v from vehiculos where id = p->>'vehiculo' and activo;
  if not found then raise exception 'Elige la furgoneta que devuelve el material'; end if;
  select * into t from tecnicos where id = p->>'tecnico';
  if not found or v.equipo_id is null or not _tecnico_del_equipo(t.id, v.equipo_id) then
    raise exception 'Quien devuelve tiene que ser un técnico del equipo de %', v.matricula;
  end if;
  if coalesce(p->>'motivo', '') not in ('sobrante', 'no_usado', 'cambio', 'otro') then raise exception 'Elige el motivo de la devolución'; end if;
  if p->>'motivo' = 'otro' and coalesce(trim(p->>'motivoTexto'), '') = '' then raise exception 'Explica el motivo de la devolución'; end if;
  if coalesce(p->>'firma', '') = '' then raise exception 'Falta la firma de quien devuelve'; end if;
  if jsonb_array_length(coalesce(p->'lineas', '[]')) = 0 then raise exception 'Añade al menos un artículo'; end if;
  for l in select * from jsonb_array_elements(p->'lineas') loop
    select * into pr from productos where sku = upper(trim(coalesce(l->>'sku', '')));
    if not found or pr.borrador or pr.archivado then raise exception 'Artículo no encontrado: %', l->>'sku'; end if;
    est := coalesce(l->>'estado', 'bien');
    if est not in ('bien', 'defectuoso') then raise exception 'Estado no válido en %', pr.nombre; end if;
    if est = 'defectuoso' and coalesce(trim(l->>'motivoDefecto'), '') = '' then raise exception 'Indica qué le pasa a % (defectuoso)', pr.nombre; end if;
    if (pr.sku || '|' || est) = any(vistos) then raise exception '% está dos veces en la devolución', pr.nombre; end if;
    vistos := vistos || (pr.sku || '|' || est);
    ud := (l->>'unidades')::numeric;
    if ud is null or ud <= 0 then raise exception 'La cantidad de % debe ser mayor que 0', pr.nombre; end if;
    lineas := lineas || jsonb_strip_nulls(jsonb_build_object('sku', pr.sku, 'nombre', pr.nombre, 'unidades', ud, 'cantidad', round(ud / pr.contenido, 3), 'estado', est,
                                                             'motivoDefecto', nullif(trim(coalesce(l->>'motivoDefecto', '')), '')));
  end loop;
  num := format('DEV-%s-%s', extract(year from now())::int, lpad(nextval('devoluciones_numero')::text, 4, '0'));
  insert into devoluciones (id, numero, vehiculo_id, equipo_id, tecnico_id, motivo, motivo_texto, obra, lineas, firma, usuario, operario)
  values (p_id, num, v.id, v.equipo_id, t.id, p->>'motivo', trim(coalesce(p->>'motivoTexto', '')), trim(coalesce(p->>'obra', '')), lineas, p->>'firma', u.id, u.nombre);
  ref := num || case when trim(coalesce(p->>'obra', '')) <> '' then ' · ' || trim(p->>'obra') else '' end;
  for l in select * from jsonb_array_elements(lineas) loop
    select * into pr from productos where sku = l->>'sku' for update;
    ud := (l->>'unidades')::numeric; q := (l->>'cantidad')::numeric; mid := gen_random_uuid();
    insert into stock_vehiculo (vehiculo_id, sku, unidades) values (v.id, pr.sku, -ud)
      on conflict (vehiculo_id, sku) do update set unidades = stock_vehiculo.unidades + excluded.unidades;
    if l->>'estado' = 'bien' then
      update productos set stock = stock + q, actualizado = now() where sku = pr.sku;
      insert into movimientos (id, sku, tipo, cantidad, motivo, referencia, series, equipo_id, vehiculo_id, unidades, usuario, operario, devolucion_id)
      values (mid, pr.sku, 'devolucion', q, 'Devolución al almacén', ref, '{}', v.equipo_id, v.id, -ud, u.id, u.nombre, p_id);
    else
      insert into movimientos (id, sku, tipo, cantidad, motivo, referencia, series, equipo_id, vehiculo_id, unidades, usuario, operario, devolucion_id)
      values (mid, pr.sku, 'merma', q, 'Devuelto defectuoso: ' || (l->>'motivoDefecto'), ref, '{}', v.equipo_id, v.id, -ud, u.id, u.nombre, p_id);
      perform _avisar_merma(u, mid, pr, q, 'Devuelto defectuoso: ' || (l->>'motivoDefecto'), ref, v.matricula);
      if pr.propiedad = 'custodia' then perform _encolar_incidencia_custodia(pr, q, 'Devuelto defectuoso: ' || (l->>'motivoDefecto'), ref, '{}'); end if;
    end if;
  end loop;
  h := _hash_devolucion(p_id);
  update devoluciones set hash = h where id = p_id;
  insert into auditoria (usuario, operario, accion, detalle) values (u.id, u.nombre, 'registrar_devolucion', jsonb_build_object('numero', num, 'vehiculo', v.id, 'tecnico', t.id, 'lineas', lineas));
  return jsonb_build_object('estado', 'aplicado', 'numero', num, 'hash', h);
end $$;

create or replace function public.anular_devolucion(p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); d devoluciones; m movimientos; pr productos;
begin
  select * into d from devoluciones where id = p_id for update;
  if not found then raise exception 'Devolución no encontrada'; end if;
  if d.estado = 'anulada' then return jsonb_build_object('estado', 'duplicado', 'numero', d.numero); end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo de la anulación'; end if;
  for m in select * from movimientos where devolucion_id = p_id and corrige is null order by ts loop
    if m.tipo = 'devolucion' then
      select * into pr from productos where sku = m.sku for update;
      if pr.stock < m.cantidad then raise exception 'Ya no quedan % % de % en el almacén para devolverlos a la furgoneta', _fmt(m.cantidad), pr.unidad, pr.nombre; end if;
      update productos set stock = stock - m.cantidad, actualizado = now() where sku = m.sku;
    end if;
    insert into stock_vehiculo (vehiculo_id, sku, unidades) values (m.vehiculo_id, m.sku, -m.unidades)
      on conflict (vehiculo_id, sku) do update set unidades = stock_vehiculo.unidades + excluded.unidades;
    insert into movimientos (id, sku, tipo, cantidad, motivo, referencia, series, equipo_id, vehiculo_id, unidades, usuario, operario, corrige, devolucion_id)
    values (gen_random_uuid(), m.sku, case when m.tipo = 'devolucion' then 'traspaso' else 'ajuste' end, m.cantidad, 'Anulación de devolución ' || d.numero, trim(p_motivo), '{}',
            m.equipo_id, m.vehiculo_id, -m.unidades, u.id, u.nombre, m.id, p_id);
  end loop;
  update devoluciones set estado = 'anulada', anulada_ts = now(), anulada_por = u.nombre, anulacion_motivo = trim(p_motivo) where id = p_id;
  insert into auditoria (usuario, operario, accion, detalle) values (u.id, u.nombre, 'anular_devolucion', jsonb_build_object('numero', d.numero, 'motivo', trim(p_motivo)));
  return jsonb_build_object('estado', 'aplicado', 'numero', d.numero);
end $$;

-- datos_socio: las devoluciones de su material (solo sus líneas), sin nombres de técnicos ni firma
do $$
declare d text; a text := '    ''config_app'', (select';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'datos_socio';
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'E-041: datos_socio no tiene el anclaje esperado'; end if;
  execute replace(d, a, '    ''devoluciones'', (select coalesce(jsonb_agg(jsonb_build_object(''id'', x.id, ''numero'', x.numero, ''ts'', x.ts, ''vehiculo_id'', x.vehiculo_id, ''equipo_id'', x.equipo_id,'
    || ' ''motivo'', x.motivo, ''obra'', x.obra, ''estado'', x.estado, ''anulada_ts'', x.anulada_ts, ''firma'', '''', ''operario'', ''Búfala'','
    || ' ''lineas'', (select coalesce(jsonb_agg(e), ''[]'') from jsonb_array_elements(x.lineas) e where e->>''sku'' = any(skus)))), ''[]'')'
    || ' from devoluciones x where exists (select 1 from jsonb_array_elements(x.lineas) e where e->>''sku'' = any(skus))),' || chr(10) || a);
end $$;

-- limpiar_demostracion: también las devoluciones
do $$
declare d text; a text := 'truncate table retiradas,'; b text := 'alter sequence retiradas_numero restart with 1;';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'limpiar_demostracion';
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 or (length(d) - length(replace(d, b, ''))) / length(b) <> 1 then raise exception 'E-041: limpiar_demostracion no tiene los anclajes esperados'; end if;
  execute replace(replace(d, a, 'truncate table devoluciones, retiradas,'), b, b || chr(10) || '  alter sequence devoluciones_numero restart with 1;');
end $$;

-- E-040: "Devolución" también se puede poner en la barra del móvil
do $$
declare d text; a text := '''camara'', ''mas''';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'guardar_barra_movil';
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'E-041: guardar_barra_movil no tiene el anclaje esperado'; end if;
  execute replace(d, a, '''camara'', ''devolucion'', ''mas''');
end $$;

insert into public.permisos_funcion (funcion, permiso) values ('registrar_devolucion', 'entregas.modificar'), ('anular_devolucion', 'entregas.modificar')
on conflict (funcion) do update set permiso = excluded.permiso;
revoke execute on function public._hash_devolucion(uuid) from public, anon, authenticated;
revoke execute on function public.registrar_devolucion(uuid, jsonb), public.anular_devolucion(uuid, text) from public, anon;
grant execute on function public.registrar_devolucion(uuid, jsonb), public.anular_devolucion(uuid, text) to authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then alter publication supabase_realtime add table public.devoluciones; end if;
end $$;
