-- E-030 · Resolver una línea "sin equivalencia" (o "pendiente") con VARIOS artículos (p. ej. los 3 o 5 conductores H07Z1-K de la
-- línea) y DESHACER una resolución manual (caso real: E2632246, 49 m de un solo cable amarillo/verde).
-- - Una resolución es un grupo (resolucion): la línea original pasa a "resuelta" con el primer artículo y guarda cómo estaba
--   (previo); los demás artículos son líneas nuevas del mismo grupo. Los ids los pone la app (iguales en la app y en el servidor).
-- - Deshacer: borra las líneas añadidas, devuelve la original a como estaba y _sincronizar_cierre deja el consumo en su objetivo:
--   lo descontado vuelve a bordo con un movimiento de ajuste ("Corrección de cierre") enlazado al cierre.
-- - Las dos cosas dejan versión en el cierre (con la diferencia) y auditoría.

alter table public.cierre_lineas add column if not exists resolucion uuid, add column if not exists previo jsonb;
create index if not exists cierre_lineas_resolucion on public.cierre_lineas (resolucion) where resolucion is not null;

-- Versión del cierre con la diferencia de consumo desde "antes"
create or replace function public._version_admin_cierre(p_cierre uuid, p_antes jsonb, p_documento text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare despues jsonb := _consumo_cierre(p_cierre); dif jsonb; v int;
begin
  select coalesce(jsonb_agg(jsonb_build_object('sku', k, 'unidades', d) order by k), '[]') into dif
  from (select k, coalesce((despues->>k)::numeric, 0) - coalesce((p_antes->>k)::numeric, 0) d from (select jsonb_object_keys(p_antes) k union select jsonb_object_keys(despues)) ks) x where d <> 0;
  update cierres set version = version + 1 where id = p_cierre returning version into v;
  insert into cierre_versiones (cierre_id, n, origen, documento, entrada, diferencia) values (p_cierre, v, 'admin', p_documento, '{}', dif);
  return dif;
end $$;

-- p_articulos: [{id?, sku, cantidad}] (el primero va a la línea original; los demás, líneas nuevas con el id que trae)
create or replace function public.resolver_linea_varios(p_linea uuid, p_grupo uuid, p_articulos jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); l cierre_lineas; a jsonb; i int := 0; n int; v_sku text; v_cant numeric; antes jsonb; dif jsonb; est text; nombres text[] := '{}';
begin
  select * into l from cierre_lineas where id = p_linea for update;
  if not found then raise exception 'Línea no encontrada'; end if;
  if l.estado not in ('pendiente', 'sin_equivalencia') then return jsonb_build_object('estado', 'duplicado'); end if;
  n := jsonb_array_length(coalesce(p_articulos, '[]'));
  if n = 0 then raise exception 'Elige al menos un artículo'; end if;
  if n > 10 then raise exception 'Como mucho 10 artículos por línea'; end if;
  -- validar todo antes de tocar nada
  for a in select * from jsonb_array_elements(p_articulos) loop
    v_sku := upper(trim(coalesce(a->>'sku', '')));
    if not exists (select 1 from productos where sku = v_sku and not borrador and not archivado) then raise exception 'Artículo no encontrado: %', a->>'sku'; end if;
    v_cant := (a->>'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then raise exception 'La cantidad de % debe ser mayor que 0', v_sku; end if;
  end loop;
  antes := _consumo_cierre(l.cierre_id);
  for a in select * from jsonb_array_elements(p_articulos) loop
    i := i + 1; v_sku := upper(trim(a->>'sku')); v_cant := (a->>'cantidad')::numeric;
    nombres := nombres || (select nombre from productos where sku = v_sku);
    if i = 1 then
      update cierre_lineas set sku = v_sku, cantidad = v_cant, estado = 'resuelta', resolucion = p_grupo,
        previo = jsonb_build_object('estado', l.estado, 'sku', l.sku, 'cantidad', l.cantidad, 'nota', l.nota),
        nota = trim(l.nota || ' · resuelta por ' || u.nombre || case when n > 1 then format(' (%s artículos)', n) else '' end)
      where id = l.id;
    else
      insert into cierre_lineas (id, cierre_id, campo, formula, valor, sku, cantidad, estimada, estado, regla, nota, resolucion)
      values (coalesce(nullif(a->>'id', '')::uuid, gen_random_uuid()), l.cierre_id, l.campo, l.formula, l.valor, v_sku, v_cant, l.estimada, 'resuelta', l.regla,
              format('resuelta por %s (%s de %s)', u.nombre, i, n), p_grupo);
    end if;
  end loop;
  est := _sincronizar_cierre(l.cierre_id);
  dif := _version_admin_cierre(l.cierre_id, antes, format('Línea %s resuelta por %s: %s', l.campo, u.nombre, array_to_string(nombres, ' + ')));
  insert into auditoria (usuario, operario, accion, detalle)
  values (u.id, u.nombre, 'resolver_linea_cierre', jsonb_build_object('cierre', l.cierre_id, 'linea', l.id, 'campo', l.campo, 'articulos', p_articulos, 'diferencia', dif));
  return jsonb_build_object('estado', est, 'diferencia', dif);
end $$;

-- La de siempre (un artículo) pasa por la nueva, para que también se pueda deshacer
create or replace function public.resolver_linea_cierre(p_linea uuid, p_sku text, p_cantidad numeric default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); l cierre_lineas;
begin
  select * into l from cierre_lineas where id = p_linea;
  if not found then raise exception 'Línea no encontrada'; end if;
  return resolver_linea_varios(p_linea, gen_random_uuid(), jsonb_build_array(jsonb_build_object('sku', p_sku, 'cantidad', coalesce(p_cantidad, l.cantidad))));
end $$;

-- Deshacer una resolución manual (cualquier línea del grupo). Las resueltas antes de E-030 no guardaban cómo estaban:
-- vuelven a "sin equivalencia" sin artículo, con su cantidad y sin la marca "resuelta por".
create or replace function public.deshacer_resolucion(p_linea uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); l cierre_lineas; base cierre_lineas; antes jsonb; dif jsonb; est text; quitados text[];
begin
  select * into l from cierre_lineas where id = p_linea for update;
  if not found then raise exception 'Línea no encontrada'; end if;
  if l.estado <> 'resuelta' then raise exception 'Esta línea no está resuelta a mano'; end if;
  antes := _consumo_cierre(l.cierre_id);
  if l.resolucion is not null then
    select * into base from cierre_lineas where resolucion = l.resolucion and previo is not null for update;
    select coalesce(array_agg(sku order by id), '{}') into quitados from cierre_lineas where resolucion = l.resolucion;
    delete from cierre_lineas where resolucion = l.resolucion and id <> base.id;
    update cierre_lineas set estado = base.previo->>'estado', sku = nullif(base.previo->>'sku', ''), cantidad = (base.previo->>'cantidad')::numeric,
      nota = coalesce(base.previo->>'nota', ''), resolucion = null, previo = null
    where id = base.id;
  else
    base := l; quitados := array[l.sku];
    update cierre_lineas set estado = 'sin_equivalencia', sku = null, nota = trim(regexp_replace(nota, '\s*·\s*resuelta por .*$', '')) where id = l.id;
  end if;
  est := _sincronizar_cierre(l.cierre_id);
  dif := _version_admin_cierre(l.cierre_id, antes, format('Resolución de %s deshecha por %s', base.campo, u.nombre));
  insert into auditoria (usuario, operario, accion, detalle)
  values (u.id, u.nombre, 'deshacer_resolucion', jsonb_build_object('cierre', l.cierre_id, 'linea', base.id, 'campo', base.campo, 'articulos', to_jsonb(quitados), 'diferencia', dif));
  return jsonb_build_object('estado', est, 'diferencia', dif);
end $$;

insert into public.permisos_funcion (funcion, permiso) values ('resolver_linea_varios', 'cierres.modificar'), ('deshacer_resolucion', 'cierres.modificar')
on conflict (funcion) do update set permiso = excluded.permiso;

revoke execute on function public._version_admin_cierre(uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.resolver_linea_varios(uuid, uuid, jsonb), public.deshacer_resolucion(uuid) from public, anon;
grant execute on function public.resolver_linea_varios(uuid, uuid, jsonb), public.deshacer_resolucion(uuid) to authenticated;
