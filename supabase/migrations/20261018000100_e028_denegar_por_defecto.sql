-- E-028 · Permisos: denegar por defecto a los roles que no son de almacén
-- Si la función de la API que se está ejecutando no tiene permiso asignado en permisos_funcion, antes se dejaba pasar.
-- Ahora solo pasa para Almacén (lo de siempre) y el administrador; Solo lectura y los roles propios se rechazan.
-- Excepción: llamar a perfil_actual() directamente (la app lo hace al entrar para saber quién es) no modifica nada.

create or replace function public.perfil_actual() returns public.perfiles
language plpgsql stable security definer set search_path = public as $$
declare p public.perfiles; v_perm text; v_rol roles; v_fn text; c text;
begin
  select * into p from perfiles where id = auth.uid() and activo;
  if not found then raise exception 'Usuario sin acceso o desactivado' using errcode = '42501'; end if;
  get diagnostics c = pg_context;
  -- dentro de exigir_admin() decide exigir_admin (con su mensaje de siempre)
  if p.rol <> 'admin' and position('function exigir_admin(' in c) = 0 and position('function public.exigir_admin(' in c) = 0 then
    v_fn := _funcion_llamante();
    v_perm := _permiso_llamada();
    if v_perm is null then
      if p.rol <> 'almacen' and v_fn is distinct from 'perfil_actual' then
        raise exception 'Esta acción no tiene permiso asignado: avisa al administrador (%)', coalesce(v_fn, '?') using errcode = '42501';
      end if;
    elsif not _rol_tiene(p.rol, v_perm) then
      select * into v_rol from roles where id = p.rol;
      raise exception 'Tu rol (%) no permite hacer esto (%)', coalesce(v_rol.nombre, p.rol), v_perm using errcode = '42501';
    end if;
  end if;
  return p;
end $$;
