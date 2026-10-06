-- E-035 · Corregir un cierre a mano en todo (lo automático todavía falla) y regla del Policharger trifásico (caso real E2632405).
-- - cierres.correccion: datos corregidos por el administrador (fase, tipoLinea, seccion, equipo). Mandan sobre las versiones
--   automáticas posteriores (la función registrar-cierre los aplica al preparar cada versión: previo_cierre los devuelve).
-- - cierre_lineas.manual: líneas fijadas a mano (artículo y cantidad, o "quitada": no descuenta). Las versiones y recálculos
--   posteriores no las tocan ni añaden otras para esa partida, hasta "Volver a lo automático".
-- - corregir_cierre(p_cierre, p): datos, líneas fijadas y "volver a lo automático"; la diferencia con lo ya descontado se aplica
--   con ajustes enlazados al cierre (si cambia el vehículo, se devuelve todo al anterior) y queda una versión "Corrección manual".

alter table public.cierres add column if not exists correccion jsonb;
alter table public.cierre_lineas add column if not exists manual boolean not null default false;
alter table public.cierre_lineas drop constraint if exists cierre_lineas_estado_check;
alter table public.cierre_lineas add constraint cierre_lineas_estado_check
  check (estado in ('aplicada', 'discrepancia', 'sin_equivalencia', 'pendiente', 'resuelta', 'no_entregado', 'no_gestionado', 'quitada'));

-- ---------- Las versiones automáticas respetan lo corregido a mano ----------
create or replace function public._reescribir(p_fn text, p_cambios text[][]) returns void language plpgsql as $$
declare d text; i int; n int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = p_fn;
  if d is null then raise exception 'E-035: no existe %', p_fn; end if;
  for i in 1 .. array_length(p_cambios, 1) loop
    n := (length(d) - length(replace(d, p_cambios[i][1], ''))) / length(p_cambios[i][1]);
    if n <> 1 then raise exception 'E-035: en % el texto aparece % veces: %', p_fn, n, p_cambios[i][1]; end if;
    d := replace(d, p_cambios[i][1], p_cambios[i][2]);
  end loop;
  execute d;
end $$;
do $$
declare
  cambios text[][] := array[
    ['delete from cierre_lineas where cierre_id = ci.id and estado <> ''resuelta'';', 'delete from cierre_lineas where cierre_id = ci.id and estado <> ''resuelta'' and not manual;'],
    ['delete from cierre_lineas where cierre_id = ci.id and estado = ''resuelta'' and campo in', 'delete from cierre_lineas where cierre_id = ci.id and estado = ''resuelta'' and not manual and campo in'],
    ['for l in select * from jsonb_array_elements(coalesce(p_lineas, ''[]''::jsonb)) loop',
     'for l in select * from jsonb_array_elements(coalesce(p_lineas, ''[]''::jsonb)) loop continue when exists (select 1 from cierre_lineas x where x.cierre_id = ci.id and x.manual and x.campo = l->>''campo'');']];
begin
  perform _reescribir('_registrar_version_cierre', cambios);
  perform _reescribir('recalcular_cierre_admin', cambios);
  perform _reescribir('previo_cierre', array[['''wizard'', c.datos_wizard,', '''wizard'', c.datos_wizard, ''correccion'', c.correccion,']]);
end $$;
drop function public._reescribir(text, text[][]);

-- Devuelve al vehículo todo lo que el cierre había descontado (antes de pasarlo a otro vehículo)
create or replace function public._revertir_consumo_cierre(p_cierre uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ci cierres; r record; pr productos;
begin
  select * into ci from cierres where id = p_cierre;
  for r in select sku, sum(unidades) u, vehiculo_id from movimientos where cierre_id = ci.id group by sku, vehiculo_id having sum(unidades) <> 0 loop
    select * into pr from productos where sku = r.sku;
    update stock_vehiculo set unidades = unidades - r.u where vehiculo_id = r.vehiculo_id and sku = r.sku;
    insert into movimientos (id, sku, tipo, cantidad, motivo, referencia, series, equipo_id, vehiculo_id, unidades, usuario, operario, cierre_id)
    values (gen_random_uuid(), r.sku, 'ajuste', greatest(round(abs(r.u) / pr.contenido, 3), 0.001), 'Corrección de cierre', concat_ws(' · ', nullif(ci.num_inst, ''), 'cambio de vehículo'),
            '{}', ci.equipo_id, r.vehiculo_id, -r.u, null, 'Corrección manual', ci.id);
  end loop;
end $$;

-- ---------- Corregir un cierre ----------
-- p: { datos?: {fase, tipoLinea, seccion, equipo} | null   (ausente = sin cambio; null = volver a lo automático en los datos)
--      fijar?: { campo: [{sku, cantidad}] }                 (lista vacía = quitar la partida: no descuenta)
--      soltar?: [campo]                                      (volver a lo automático en esas partidas)
--      lineas: [...] }                                       (la traducción automática con los datos ya corregidos, la calcula la app)
create or replace function public.corregir_cierre(p_cierre uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); ci cierres; antes jsonb; despues jsonb; dif jsonb; est text; corr jsonb; eq text; veh text; k text; a jsonb; l jsonb; v_sku text;
  resumen text[] := '{}'; resueltos text[];
begin
  select * into ci from cierres where id = p_cierre for update;
  if not found then raise exception 'Cierre no encontrado'; end if;
  if ci.estado = 'ignorado' then raise exception 'Este cierre es anterior a la apertura del inventario: no descuenta'; end if;
  -- validar los artículos antes de tocar nada
  for k, a in select key, value from jsonb_each(coalesce(p->'fijar', '{}')) loop
    for l in select * from jsonb_array_elements(a) loop
      if not exists (select 1 from productos where sku = upper(l->>'sku') and not borrador and not archivado) then raise exception 'Artículo no encontrado: %', l->>'sku'; end if;
      if coalesce((l->>'cantidad')::numeric, 0) <= 0 then raise exception 'La cantidad de % debe ser mayor que 0', l->>'sku'; end if;
    end loop;
  end loop;
  antes := _consumo_cierre(ci.id);
  -- a) datos
  if p ? 'datos' then
    corr := case when jsonb_typeof(p->'datos') = 'object' then (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(p->'datos') where key in ('fase', 'tipoLinea', 'seccion', 'equipo') and coalesce(value #>> '{}', '') <> '') end;
    if corr = '{}'::jsonb then corr := null; end if;
    update cierres set correccion = corr where id = ci.id;
    resumen := resumen || case when corr is null then 'datos: vuelta a lo automático' else 'datos: ' || (select string_agg(key || ' = ' || (value #>> '{}'), ', ') from jsonb_each(corr)) end;
    -- equipo corregido (o vuelta al del wizard): su vehículo en la fecha del cierre; si cambia, se devuelve todo al anterior
    select id into eq from equipos where activo and lower(trim(nombre)) = lower(trim(coalesce(corr->>'equipo', ci.datos_wizard->>'equipo', ci.equipo_wizard)));
    veh := case when eq is null then null else vehiculo_de_equipo(eq, ci.fecha_cierre) end;
    if veh is not null and veh is distinct from ci.vehiculo_id then
      if ci.vehiculo_id is not null then perform _revertir_consumo_cierre(ci.id); end if;
      update cierres set equipo_id = eq, equipo_wizard = coalesce(corr->>'equipo', equipo_wizard), vehiculo_id = veh where id = ci.id;
    end if;
  end if;
  -- c) volver a lo automático en algunas partidas
  if jsonb_array_length(coalesce(p->'soltar', '[]')) > 0 then
    delete from cierre_lineas where cierre_id = ci.id and manual and campo in (select jsonb_array_elements_text(p->'soltar'));
    resumen := resumen || ('vuelta a lo automático: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(p->'soltar') x));
  end if;
  -- b) partidas fijadas a mano
  for k, a in select key, value from jsonb_each(coalesce(p->'fijar', '{}')) loop
    delete from cierre_lineas where cierre_id = ci.id and campo = k;
    if jsonb_array_length(a) = 0 then
      insert into cierre_lineas (cierre_id, campo, formula, valor, sku, cantidad, estimada, estado, nota, manual)
      values (ci.id, k, 'directa', 0, null, 0, false, 'quitada', 'quitada a mano por ' || u.nombre || ': no descuenta', true);
      resumen := resumen || (k || ': quitada');
    else
      for l in select * from jsonb_array_elements(a) loop
        insert into cierre_lineas (cierre_id, campo, formula, valor, sku, cantidad, estimada, estado, nota, manual)
        values (ci.id, k, 'directa', (l->>'cantidad')::numeric, upper(l->>'sku'), (l->>'cantidad')::numeric, false, 'resuelta', 'corregida a mano por ' || u.nombre, true);
      end loop;
      resumen := resumen || (k || ': ' || (select string_agg((x->>'cantidad') || ' × ' || coalesce((select nombre from productos where sku = upper(x->>'sku')), x->>'sku'), ' + ') from jsonb_array_elements(a) x));
    end if;
  end loop;
  -- lo automático (con los datos corregidos), sin tocar lo fijado a mano
  if p ? 'lineas' then
    delete from cierre_lineas where cierre_id = ci.id and estado = 'resuelta' and not manual and campo in (select x->>'campo' from jsonb_array_elements(p->'lineas') x
      where x->>'estado' = 'aplicable' and exists (select 1 from productos where sku = nullif(x->>'sku', '') and not borrador and not archivado));
    select coalesce(array_agg(campo), '{}') into resueltos from cierre_lineas where cierre_id = ci.id and estado = 'resuelta';
    delete from cierre_lineas where cierre_id = ci.id and estado <> 'resuelta' and not manual;
    for l in select * from jsonb_array_elements(p->'lineas') loop
      continue when exists (select 1 from cierre_lineas x where x.cierre_id = ci.id and x.manual and x.campo = l->>'campo');
      continue when (l->>'estado') <> 'aplicable' and (l->>'campo') = any(resueltos);
      v_sku := nullif(l->>'sku', '');
      if v_sku is not null and not exists (select 1 from productos where sku = v_sku and not borrador and not archivado) then v_sku := null; end if;
      insert into cierre_lineas (cierre_id, campo, formula, valor, sku, cantidad, estimada, estado, regla, nota)
      values (ci.id, l->>'campo', coalesce(l->>'formula', 'directa'), coalesce((l->>'valor')::numeric, 0), v_sku, coalesce((l->>'cantidad')::numeric, 0), coalesce((l->>'estimada')::boolean, false),
              case when (l->>'estado') = 'aplicable' and v_sku is not null then 'aplicada' when (l->>'estado') = 'pendiente' then 'pendiente' when (l->>'estado') = 'no_gestionado' then 'no_gestionado' else 'sin_equivalencia' end,
              l->>'regla', coalesce(l->>'nota', ''));
    end loop;
  end if;
  est := _sincronizar_cierre(ci.id);
  despues := _consumo_cierre(ci.id);
  select coalesce(jsonb_agg(jsonb_build_object('sku', k2, 'unidades', d) order by k2), '[]') into dif
  from (select k2, coalesce((despues->>k2)::numeric, 0) - coalesce((antes->>k2)::numeric, 0) d from (select jsonb_object_keys(antes) k2 union select jsonb_object_keys(despues)) ks) x where d <> 0;
  update cierres set version = version + 1 where id = ci.id returning version into ci.version;
  insert into cierre_versiones (cierre_id, n, origen, documento, entrada, diferencia)
  values (ci.id, ci.version, 'admin', 'Corrección manual por ' || u.nombre || case when array_length(resumen, 1) > 0 then ': ' || array_to_string(resumen, ' · ') else '' end, p - 'lineas', dif);
  insert into auditoria (usuario, operario, accion, detalle) values (u.id, u.nombre, 'corregir_cierre', jsonb_build_object('cierre', ci.id, 'num_inst', ci.num_inst, 'cambios', p - 'lineas', 'diferencia', dif));
  return jsonb_build_object('estado', est, 'version', ci.version, 'diferencia', dif);
end $$;

insert into public.permisos_funcion (funcion, permiso) values ('corregir_cierre', 'cierres.modificar') on conflict (funcion) do update set permiso = excluded.permiso;
revoke execute on function public._revertir_consumo_cierre(uuid) from public, anon, authenticated;
revoke execute on function public.corregir_cierre(uuid, jsonb) from public, anon;
grant execute on function public.corregir_cierre(uuid, jsonb) to authenticated;

-- ---------- Regla del Policharger trifásico (antes de la de "policharger", que queda para los monofásicos) ----------
do $$
declare o int;
begin
  if not exists (select 1 from public.equivalencias_cierre where campo = 'hardware' and confirmada) then return; end if;
  select min(orden) into o from public.equivalencias_cierre where campo = 'hardware' and activa and condiciones->>'hardware~' = 'policharger';
  insert into public.equivalencias_cierre (id, campo, formula, condiciones, articulos, estimada, activa, orden, nota, confirmada)
  values ('H7', 'hardware', 'unidad', '{"hardware~": ["policharger&trif", "policharger&dblt"]}', '[{"sku": "8437024504283", "factor": 1}]', false, true, coalesce(o, 1060) - 5,
          'Policharger NW-DBLT23F trifásico (E-035)', true)
  on conflict (id) do nothing;
end $$;
