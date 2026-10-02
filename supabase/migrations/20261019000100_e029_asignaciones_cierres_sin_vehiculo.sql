-- E-029 · Cierres bloqueados como "Equipo sin vehículo" (los del 30/09: las asignaciones se crearon esa noche, después de los cierres)
-- 1. Editar la fecha de inicio de una asignación (vehículo → equipo o técnico → equipo), sin solapes y con auditoría;
--    devuelve los cierres "sin vehículo" de ese equipo que caen en el nuevo tramo, para reprocesarlos.
-- 2. Reprocesar varios cierres (con el vehículo que tenía el equipo en su fecha) y el atajo "usar el vehículo que el equipo tiene ahora".
--    Los dos dejan una versión en el cierre con quién lo hizo y lo que descontó.

-- ---------- 1. Fecha de inicio de una asignación ----------
create or replace function public.editar_inicio_asignacion(p_tipo text, p_id uuid, p_desde timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); av asignaciones_vehiculo; at asignaciones_tecnico; v_eq text; v_hasta timestamptz; v_antes timestamptz; v_choque text;
  afectados uuid[] := '{}';
begin
  if p_desde is null then raise exception 'Falta la fecha de inicio'; end if;
  if p_desde > now() then raise exception 'La fecha de inicio no puede ser futura'; end if;
  if p_tipo = 'vehiculo' then
    select * into av from asignaciones_vehiculo where id = p_id for update;
    if not found then raise exception 'Asignación no encontrada'; end if;
    if av.hasta is not null and p_desde > av.hasta then raise exception 'La fecha de inicio no puede ser posterior a la de fin (%)', to_char(av.hasta at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'); end if;
    -- sin solapes: ni el mismo vehículo en otro equipo ni el mismo equipo con otro vehículo a la vez
    select concat(vh.matricula, ' en ', e.nombre, ' desde ', to_char(o.desde at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI')) into v_choque
    from asignaciones_vehiculo o join vehiculos vh on vh.id = o.vehiculo_id join equipos e on e.id = o.equipo_id
    where o.id <> av.id and (o.vehiculo_id = av.vehiculo_id or o.equipo_id = av.equipo_id)
      and tstzrange(o.desde, coalesce(o.hasta, 'infinity')) && tstzrange(p_desde, coalesce(av.hasta, 'infinity'))
    order by o.desde limit 1;
    if v_choque is not null then raise exception 'Se solapa con otra asignación (%): corrige esa primero', v_choque; end if;
    v_antes := av.desde; v_eq := av.equipo_id; v_hasta := av.hasta;
    update asignaciones_vehiculo set desde = p_desde where id = av.id;
    select coalesce(array_agg(c.id order by c.fecha_cierre), '{}') into afectados from cierres c join equipos e on e.id = v_eq
    where c.estado = 'sin_vehiculo' and (c.equipo_id = v_eq or (c.equipo_id is null and lower(trim(c.equipo_wizard)) = lower(trim(e.nombre))))
      and c.fecha_cierre >= p_desde and (v_hasta is null or c.fecha_cierre < v_hasta);
  elsif p_tipo = 'tecnico' then
    select * into at from asignaciones_tecnico where id = p_id for update;
    if not found then raise exception 'Asignación no encontrada'; end if;
    if at.hasta is not null and p_desde > at.hasta then raise exception 'La fecha de inicio no puede ser posterior a la de fin (%)', to_char(at.hasta at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'); end if;
    select concat(t.nombre, ' en ', e.nombre, ' desde ', to_char(o.desde at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI')) into v_choque
    from asignaciones_tecnico o join tecnicos t on t.id = o.tecnico_id join equipos e on e.id = o.equipo_id
    where o.id <> at.id and o.tecnico_id = at.tecnico_id
      and tstzrange(o.desde, coalesce(o.hasta, 'infinity')) && tstzrange(p_desde, coalesce(at.hasta, 'infinity'))
    order by o.desde limit 1;
    if v_choque is not null then raise exception 'Se solapa con otra asignación (%): corrige esa primero', v_choque; end if;
    v_antes := at.desde; v_eq := at.equipo_id;
    update asignaciones_tecnico set desde = p_desde where id = at.id;
  else
    raise exception 'Tipo de asignación no válido';
  end if;
  insert into auditoria (usuario, operario, accion, detalle)
  values (u.id, u.nombre, 'editar_inicio_asignacion', jsonb_build_object('tipo', p_tipo, 'asignacion', p_id, 'equipo', v_eq, 'antes', v_antes, 'despues', p_desde));
  return jsonb_build_object('estado', 'aplicado', 'afectados', to_jsonb(afectados));
end $$;

-- ---------- 2. Procesar un cierre "sin vehículo" con un vehículo, dejando versión ----------
create or replace function public._procesar_cierre_con_vehiculo(p_cierre uuid, p_vehiculo text, p_documento text) returns text
language plpgsql security definer set search_path = public as $$
declare ci cierres; antes jsonb; despues jsonb; dif jsonb; est text;
begin
  select * into ci from cierres where id = p_cierre for update;
  antes := _consumo_cierre(ci.id);
  update cierres set vehiculo_id = p_vehiculo where id = ci.id;
  est := _sincronizar_cierre(ci.id);
  despues := _consumo_cierre(ci.id);
  select coalesce(jsonb_agg(jsonb_build_object('sku', k, 'unidades', d) order by k), '[]') into dif
  from (select k, coalesce((despues->>k)::numeric, 0) - coalesce((antes->>k)::numeric, 0) d from (select jsonb_object_keys(antes) k union select jsonb_object_keys(despues)) ks) x where d <> 0;
  update cierres set version = version + 1 where id = ci.id returning version into ci.version;
  insert into cierre_versiones (cierre_id, n, origen, documento, entrada, diferencia) values (ci.id, ci.version, 'admin', p_documento, '{}', dif);
  return est;
end $$;

-- Equipo del cierre (el que tenía o el que corresponde al nombre que envió el wizard)
create or replace function public._equipo_de_cierre(ci cierres) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(ci.equipo_id, (select id from equipos where activo and lower(trim(nombre)) = lower(trim(ci.equipo_wizard)) limit 1))
$$;

-- Reprocesar varios: cada uno con el vehículo que tenía su equipo en la fecha del cierre (tras corregir el historial)
create or replace function public.reprocesar_cierres(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); ci cierres; eq text; veh text; hechos int := 0; siguen jsonb := '[]';
begin
  for ci in select * from cierres where id = any(coalesce(p_ids, '{}')) and estado = 'sin_vehiculo' order by fecha_cierre for update loop
    eq := _equipo_de_cierre(ci);
    veh := case when eq is null then null else vehiculo_de_equipo(eq, ci.fecha_cierre) end;
    if veh is null then siguen := siguen || to_jsonb(ci.num_inst); continue; end if;
    update cierres set equipo_id = eq where id = ci.id;
    perform _procesar_cierre_con_vehiculo(ci.id, veh, 'Reprocesado por ' || u.nombre || ' con ' || (select matricula from vehiculos where id = veh) || ' (historial de asignaciones)');
    hechos := hechos + 1;
  end loop;
  return jsonb_build_object('estado', 'aplicado', 'procesados', hechos, 'siguen', siguen);
end $$;

-- Atajo: usar el vehículo que el equipo tiene AHORA (no toca el historial de asignaciones)
create or replace function public.usar_vehiculo_actual(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); ci cierres; eq text; veh vehiculos; hechos int := 0; siguen jsonb := '[]';
begin
  for ci in select * from cierres where id = any(coalesce(p_ids, '{}')) and estado = 'sin_vehiculo' order by fecha_cierre for update loop
    eq := _equipo_de_cierre(ci);
    veh := null;
    select * into veh from vehiculos where equipo_id = eq and activo;
    if eq is null or veh.id is null then siguen := siguen || to_jsonb(ci.num_inst); continue; end if;
    update cierres set equipo_id = eq where id = ci.id;
    perform _procesar_cierre_con_vehiculo(ci.id, veh.id, 'Vehículo asignado a mano por ' || u.nombre || ': ' || veh.matricula || ' (el que el equipo tiene ahora)');
    hechos := hechos + 1;
  end loop;
  return jsonb_build_object('estado', 'aplicado', 'procesados', hechos, 'siguen', siguen);
end $$;

-- ---------- Permisos (E-027/E-028: toda función que comprueba al usuario, registrada) ----------
insert into public.permisos_funcion (funcion, permiso) values
  ('editar_inicio_asignacion', 'equipos.modificar'), ('reprocesar_cierres', 'cierres.modificar'), ('usar_vehiculo_actual', 'cierres.modificar')
on conflict (funcion) do update set permiso = excluded.permiso;

revoke execute on function public._procesar_cierre_con_vehiculo(uuid, text, text), public._equipo_de_cierre(cierres) from public, anon, authenticated;
revoke execute on function public.editar_inicio_asignacion(text, uuid, timestamptz), public.reprocesar_cierres(uuid[]), public.usar_vehiculo_actual(uuid[]) from public, anon;
grant execute on function public.editar_inicio_asignacion(text, uuid, timestamptz), public.reprocesar_cierres(uuid[]), public.usar_vehiculo_actual(uuid[]) to authenticated;
