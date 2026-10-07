-- E-038 · Retirada de material en custodia por el socio (Esmove…) o por un tercero en su nombre.
-- - registrar_retirada(id, datos): del almacén y/o de un vehículo, solo artículos en custodia de ESE socio, sin pasar del stock
--   (ni de lo reservado para entregas preparadas), firma de quien recoge, número RET-AAAA-NNNN y huella SHA-256.
--   Movimientos "Retirada por el socio" enlazados (retirada_id): en el almacén, salida; en un vehículo, sale de su stock a bordo.
-- - anular_retirada(id, motivo): solo administrador; movimientos inversos enlazados (corrige), la retirada queda "anulada".
-- - Historial inalterable: la retirada firmada no se modifica ni se borra (solo pasa a anulada, una vez).
-- - El socio la ve (con la firma, para descargar el PDF) en datos_socio.

create sequence if not exists public.retiradas_numero;
create table if not exists public.retiradas (
  id               uuid primary key,                         -- generado en el cliente (idempotencia)
  numero           text not null unique,                     -- RET-AAAA-NNNN, lo asigna el servidor
  ts               timestamptz not null default now(),
  propietario_id   text not null references public.propietarios(id),
  vehiculo_id      text references public.vehiculos(id),     -- origen: null = almacén
  recoge_nombre    text not null,
  recoge_doc       text not null default '',                 -- DNI o empresa (opcional)
  en_nombre        text not null default 'socio' check (en_nombre in ('socio', 'tercero')),
  tercero_nombre   text not null default '',
  tercero_empresa  text not null default '',
  motivo           text not null check (motivo in ('devolucion', 'traslado', 'garantia', 'otro')),
  motivo_texto     text not null default '',
  referencia       text not null default '',                 -- n.º de pedido, RMA o albarán del socio
  transporte       text not null default '',                 -- matrícula o transportista
  notas            text not null default '',
  lineas           jsonb not null,                           -- [{sku, nombre, cantidad (formatos), unidades (contenido)}]
  firma            text not null,
  hash             text not null default '',
  estado           text not null default 'firmada' check (estado in ('firmada', 'anulada')),
  anulada_ts       timestamptz,
  anulada_por      text,
  anulacion_motivo text,
  usuario          uuid references public.perfiles(id),
  operario         text not null
);
alter table public.movimientos add column if not exists retirada_id uuid references public.retiradas(id);

alter table public.retiradas enable row level security;
grant select on public.retiradas to authenticated;
create policy retiradas_lectura on public.retiradas for select to authenticated using (public.tiene_permiso('movimientos.ver') or public.tiene_permiso('custodia.ver'));

create or replace function public._retiradas_inalterables() returns trigger language plpgsql as $$
begin
  if _limpiando() then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and old.hash = '' and new.hash <> '' and (to_jsonb(new) - 'hash') = (to_jsonb(old) - 'hash') then return new; end if;
  if tg_op = 'UPDATE' and old.estado = 'firmada' and new.estado = 'anulada'
     and (to_jsonb(new) - array['estado', 'anulada_ts', 'anulada_por', 'anulacion_motivo']) = (to_jsonb(old) - array['estado', 'anulada_ts', 'anulada_por', 'anulacion_motivo']) then return new; end if;
  raise exception 'Una retirada firmada no se puede modificar ni borrar: anúlala' using errcode = '42501';
end $$;
create trigger retiradas_inalterables before update or delete on public.retiradas for each row execute function public._retiradas_inalterables();

create or replace function public._hash_retirada(p_id uuid) returns text
language sql stable security definer set search_path = public, extensions as $$
  select encode(extensions.digest(jsonb_build_object(
    'id', r.id, 'numero', r.numero, 'ts', floor(extract(epoch from r.ts) * 1000)::bigint, 'socio', r.propietario_id, 'vehiculo', r.vehiculo_id,
    'recoge', r.recoge_nombre, 'doc', r.recoge_doc, 'enNombre', r.en_nombre, 'tercero', r.tercero_nombre, 'empresa', r.tercero_empresa,
    'motivo', r.motivo, 'motivoTexto', r.motivo_texto, 'referencia', r.referencia, 'lineas', r.lineas, 'firma', r.firma
  )::text, 'sha256'), 'hex')
  from retiradas r where r.id = p_id
$$;

-- p: {socio, vehiculo?, recoge, recogeDoc?, enNombre ('socio'|'tercero'), tercero?, terceroEmpresa?, motivo, motivoTexto?, referencia?, transporte?, notas?,
--     firma, lineas: [{sku, cantidad (formatos)}]}
create or replace function public.registrar_retirada(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := perfil_actual(); r retiradas; l jsonb; pr productos; v vehiculos; q numeric; ud numeric; abordo numeric; num text; h text;
        v_socio text := nullif(trim(coalesce(p->>'socio', '')), ''); v_veh text := nullif(trim(coalesce(p->>'vehiculo', '')), ''); lineas jsonb := '[]'; vistos text[] := '{}';
begin
  select * into r from retiradas where id = p_id;
  if found then return jsonb_build_object('estado', 'duplicado', 'numero', r.numero, 'hash', r.hash); end if;
  if v_socio is null or not exists (select 1 from propietarios where id = v_socio and activo is not false) then raise exception 'Elige el socio que retira el material'; end if;
  if v_veh is not null then
    select * into v from vehiculos where id = v_veh and activo;
    if not found then raise exception 'Vehículo no encontrado'; end if;
  end if;
  if coalesce(trim(p->>'recoge'), '') = '' then raise exception 'Indica quién recoge el material'; end if;
  if coalesce(p->>'enNombre', 'socio') = 'tercero' and coalesce(trim(p->>'tercero'), '') = '' then raise exception 'Indica el tercero autorizado en cuyo nombre se recoge'; end if;
  if coalesce(p->>'motivo', '') not in ('devolucion', 'traslado', 'garantia', 'otro') then raise exception 'Elige el motivo de la retirada'; end if;
  if p->>'motivo' = 'otro' and coalesce(trim(p->>'motivoTexto'), '') = '' then raise exception 'Explica el motivo de la retirada'; end if;
  if coalesce(p->>'firma', '') = '' then raise exception 'Falta la firma de quien recoge'; end if;
  if jsonb_array_length(coalesce(p->'lineas', '[]')) = 0 then raise exception 'Añade al menos un artículo'; end if;
  -- validar todo antes de mover nada
  for l in select * from jsonb_array_elements(p->'lineas') loop
    select * into pr from productos where sku = upper(trim(coalesce(l->>'sku', ''))) for update;
    if not found or pr.borrador or pr.archivado then raise exception 'Artículo no encontrado: %', l->>'sku'; end if;
    if pr.propiedad <> 'custodia' or pr.propietario_id is distinct from v_socio then
      raise exception '% no es material en custodia de %: solo se retira lo suyo', pr.nombre, (select nombre from propietarios where id = v_socio);
    end if;
    if pr.sku = any(vistos) then raise exception '% está dos veces en la retirada', pr.nombre; end if;
    vistos := vistos || pr.sku;
    q := (l->>'cantidad')::numeric;
    if q is null or q <= 0 then raise exception 'La cantidad de % debe ser mayor que 0', pr.nombre; end if;
    if v_veh is null then
      if _es_formato_entero(pr) and q <> trunc(q) then raise exception 'En el almacén % se mueve por % entero', pr.nombre, pr.unidad; end if;
      if pr.stock < q then raise exception 'Solo hay % % de % en el almacén', _fmt(pr.stock), pr.unidad, pr.nombre; end if;
      if pr.stock - q < reservado(pr.sku) then raise exception 'Hay % reservadas para entregas preparadas de %: no se pueden retirar', _fmt(reservado(pr.sku)), pr.nombre; end if;
    else
      select coalesce((select unidades from stock_vehiculo where vehiculo_id = v.id and sku = pr.sku), 0) into abordo;
      if abordo < q * pr.contenido then raise exception 'El vehículo % solo lleva % % de %', v.matricula, _fmt(abordo / pr.contenido), pr.unidad, pr.nombre; end if;
    end if;
    lineas := lineas || jsonb_build_object('sku', pr.sku, 'nombre', pr.nombre, 'cantidad', q, 'unidades', q * pr.contenido);
  end loop;
  num := format('RET-%s-%s', extract(year from now())::int, lpad(nextval('retiradas_numero')::text, 4, '0'));
  insert into retiradas (id, numero, propietario_id, vehiculo_id, recoge_nombre, recoge_doc, en_nombre, tercero_nombre, tercero_empresa, motivo, motivo_texto,
                         referencia, transporte, notas, lineas, firma, usuario, operario)
  values (p_id, num, v_socio, v_veh, trim(p->>'recoge'), trim(coalesce(p->>'recogeDoc', '')), coalesce(p->>'enNombre', 'socio'), trim(coalesce(p->>'tercero', '')),
          trim(coalesce(p->>'terceroEmpresa', '')), p->>'motivo', trim(coalesce(p->>'motivoTexto', '')), trim(coalesce(p->>'referencia', '')),
          trim(coalesce(p->>'transporte', '')), trim(coalesce(p->>'notas', '')), lineas, p->>'firma', u.id, u.nombre);
  for l in select * from jsonb_array_elements(lineas) loop
    q := (l->>'cantidad')::numeric; ud := (l->>'unidades')::numeric;
    if v_veh is null then
      update productos set stock = stock - q, actualizado = now() where sku = l->>'sku';
      insert into movimientos (id, sku, tipo, cantidad, motivo, referencia, series, usuario, operario, retirada_id)
      values (gen_random_uuid(), l->>'sku', 'salida', q, 'Retirada por el socio', num, '{}', u.id, u.nombre, p_id);
    else
      update stock_vehiculo set unidades = unidades - ud where vehiculo_id = v.id and sku = l->>'sku';
      insert into movimientos (id, sku, tipo, cantidad, motivo, referencia, series, equipo_id, vehiculo_id, unidades, usuario, operario, retirada_id)
      values (gen_random_uuid(), l->>'sku', 'consumo', q, 'Retirada por el socio', num, '{}', v.equipo_id, v.id, -ud, u.id, u.nombre, p_id);
    end if;
  end loop;
  h := _hash_retirada(p_id);
  update retiradas set hash = h where id = p_id;
  insert into auditoria (usuario, operario, accion, detalle) values (u.id, u.nombre, 'registrar_retirada', jsonb_build_object('numero', num, 'socio', v_socio, 'vehiculo', v_veh, 'lineas', lineas));
  return jsonb_build_object('estado', 'aplicado', 'numero', num, 'hash', h);
end $$;

create or replace function public.anular_retirada(p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); r retiradas; m movimientos;
begin
  select * into r from retiradas where id = p_id for update;
  if not found then raise exception 'Retirada no encontrada'; end if;
  if r.estado = 'anulada' then return jsonb_build_object('estado', 'duplicado', 'numero', r.numero); end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo de la anulación'; end if;
  for m in select * from movimientos where retirada_id = p_id and corrige is null order by ts loop
    if m.vehiculo_id is null then
      update productos set stock = stock + m.cantidad, actualizado = now() where sku = m.sku;
      insert into movimientos (id, sku, tipo, cantidad, motivo, referencia, series, usuario, operario, corrige, retirada_id)
      values (gen_random_uuid(), m.sku, 'entrada', m.cantidad, 'Anulación de retirada ' || r.numero, trim(p_motivo), '{}', u.id, u.nombre, m.id, p_id);
    else
      insert into stock_vehiculo (vehiculo_id, sku, unidades) values (m.vehiculo_id, m.sku, -m.unidades)
        on conflict (vehiculo_id, sku) do update set unidades = stock_vehiculo.unidades + excluded.unidades;
      insert into movimientos (id, sku, tipo, cantidad, motivo, referencia, series, equipo_id, vehiculo_id, unidades, usuario, operario, corrige, retirada_id)
      values (gen_random_uuid(), m.sku, 'ajuste', m.cantidad, 'Anulación de retirada ' || r.numero, trim(p_motivo), '{}', m.equipo_id, m.vehiculo_id, -m.unidades, u.id, u.nombre, m.id, p_id);
    end if;
  end loop;
  update retiradas set estado = 'anulada', anulada_ts = now(), anulada_por = u.nombre, anulacion_motivo = trim(p_motivo) where id = p_id;
  insert into auditoria (usuario, operario, accion, detalle) values (u.id, u.nombre, 'anular_retirada', jsonb_build_object('numero', r.numero, 'motivo', trim(p_motivo)));
  return jsonb_build_object('estado', 'aplicado', 'numero', r.numero);
end $$;

-- datos_socio: también sus retiradas (con la firma, para el PDF; quien recoge es un dato de la retirada, no de un técnico)
do $$
declare d text; a text := '    ''config_app'', (select';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'datos_socio';
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'E-038: datos_socio no tiene el anclaje esperado'; end if;
  execute replace(d, a, '    ''retiradas'', (select coalesce(jsonb_agg(to_jsonb(x) - ''usuario''), ''[]'') from (select * from retiradas where propietario_id = s) x),' || chr(10) || a);
end $$;

insert into public.permisos_funcion (funcion, permiso) values ('registrar_retirada', 'movimientos.modificar'), ('anular_retirada', 'movimientos.modificar')
on conflict (funcion) do update set permiso = excluded.permiso;
revoke execute on function public._hash_retirada(uuid) from public, anon, authenticated;
revoke execute on function public.registrar_retirada(uuid, jsonb), public.anular_retirada(uuid, text) from public, anon;
grant execute on function public.registrar_retirada(uuid, jsonb), public.anular_retirada(uuid, text) to authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then alter publication supabase_realtime add table public.retiradas; end if;
end $$;

-- limpiar_demostracion: las retiradas también se vacían (apuntan a vehículos y productos que se borran)
do $$
declare d text; a text := 'truncate table cierre_versiones,'; b text := 'alter sequence entregas_numero restart with 1;';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'limpiar_demostracion';
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 or (length(d) - length(replace(d, b, ''))) / length(b) <> 1 then raise exception 'E-038: limpiar_demostracion no tiene los anclajes esperados'; end if;
  execute replace(replace(d, a, 'truncate table retiradas, cierre_versiones,'), b, b || chr(10) || '  alter sequence retiradas_numero restart with 1;');
end $$;
