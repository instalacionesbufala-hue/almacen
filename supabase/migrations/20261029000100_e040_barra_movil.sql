-- E-040 · Barra inferior del móvil personalizable, por usuario (en cualquier móvil). No toca el menú lateral del escritorio.
-- perfiles.barra_movil: {"accesos": [hasta 5 ids, en orden], "central": id destacado o null}; null = la barra de siempre.
-- perfil_actual() ya la devuelve (devuelve la fila del perfil). La guarda el propio usuario con guardar_barra_movil(), también un
-- usuario de socio (solo cambia su propia barra, nada más). Qué accesos se ven lo decide la app según los permisos del rol.

alter table public.perfiles add column if not exists barra_movil jsonb;

create or replace function public.guardar_barra_movil(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare validos text[] := array['inventario', 'escanear', 'entrega', 'equipos', 'retirada', 'albaranes', 'escanear_albaran', 'movimientos', 'custodia',
                                'cierres', 'recuento', 'dotacion', 'avisos', 'camara', 'mas'];
        a text[]; c text;
begin
  if not exists (select 1 from perfiles where id = auth.uid() and activo) then raise exception 'Usuario sin acceso o desactivado' using errcode = '42501'; end if;
  if p is null or p = 'null'::jsonb then
    update perfiles set barra_movil = null where id = auth.uid();
    return jsonb_build_object('estado', 'restablecida');
  end if;
  if jsonb_typeof(p->'accesos') <> 'array' then raise exception 'Barra no válida'; end if;
  select coalesce(array_agg(x), '{}') into a from jsonb_array_elements_text(p->'accesos') x;
  if cardinality(a) = 0 then raise exception 'Elige al menos un acceso'; end if;
  if cardinality(a) > 5 then raise exception 'Como mucho 5 accesos en la barra'; end if;
  if exists (select 1 from unnest(a) x where x <> all(validos)) then raise exception 'Acceso no válido en la barra'; end if;
  if (select count(distinct x) from unnest(a) x) <> cardinality(a) then raise exception 'Un acceso está repetido en la barra'; end if;
  c := nullif(p->>'central', '');
  if c is not null and c <> all(a) then raise exception 'El botón central tiene que ser uno de los accesos de la barra'; end if;
  update perfiles set barra_movil = jsonb_build_object('accesos', to_jsonb(a), 'central', c) where id = auth.uid();
  return jsonb_build_object('estado', 'guardada', 'barra', jsonb_build_object('accesos', to_jsonb(a), 'central', c));
end $$;
revoke execute on function public.guardar_barra_movil(jsonb) from public, anon;
grant execute on function public.guardar_barra_movil(jsonb) to authenticated;
