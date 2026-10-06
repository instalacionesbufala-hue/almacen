-- E-034 · Usuarios de socio (Esmove, Instant Box…): solo ven SU material en custodia, sin datos internos, y no escriben nada.
-- - perfiles.propietario_id: el usuario es de ese socio. Rol de sistema "socio" (solo "Ver" de inventario, movimientos,
--   custodia y exportar), o uno propio sin ningún "Modificar" y solo de esos apartados.
-- - Seguridad: es_usuario_activo(), es_admin() y tiene_permiso() son FALSE para un socio. Como TODAS las políticas RLS (tablas y
--   storage) pasan por ellas, el socio no lee ninguna tabla directamente. perfil_actual() le niega cualquier función de la API
--   (salvo consultar su propio perfil), así que no escribe nada. Lo que ve le llega por datos_socio(): solo sus filas, y solo
--   las columnas permitidas (sin técnicos, firmas, operarios, prefacturas ni el resto del cierre).
-- - Storage: solo las fotos de sus artículos. Realtime: no recibe nada (RLS).

alter table public.perfiles add column if not exists propietario_id text references public.propietarios(id);

insert into public.roles (id, nombre, descripcion, sistema, permisos) values
  ('socio', 'Socio (solo lectura)', 'Para un socio de custodia (Esmove, Instant Box…): ve solo su material en custodia, sus movimientos, instalaciones e informes. No modifica nada.', true,
   '{"inventario.ver":true,"inventario.modificar":false,"movimientos.ver":true,"movimientos.modificar":false,"albaranes.ver":false,"albaranes.modificar":false,"entregas.ver":false,"entregas.modificar":false,"equipos.ver":false,"equipos.modificar":false,"recuentos.ver":false,"recuentos.modificar":false,"dotacion.ver":false,"dotacion.modificar":false,"custodia.ver":true,"custodia.modificar":false,"cierres.ver":false,"cierres.modificar":false,"bandeja.ver":false,"bandeja.modificar":false,"exportar.ver":true,"configuracion.ver":false,"configuracion.modificar":false,"usuarios.ver":false,"usuarios.modificar":false}')
on conflict (id) do nothing;

-- ¿Este rol vale para un usuario de socio? Sin "Modificar" y solo apartados de su custodia
create or replace function public._rol_de_socio(p_rol text) returns boolean language sql stable security definer set search_path = public as $$
  select p_rol = 'socio' or exists (select 1 from roles r where r.id = p_rol and not r.sistema
    and not exists (select 1 from jsonb_each(r.permisos) e where e.value = 'true'::jsonb
                    and (e.key like '%.modificar' or split_part(e.key, '.', 1) not in ('inventario', 'movimientos', 'custodia', 'exportar'))))
$$;
create or replace function public._perfil_socio_valido() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.propietario_id is not null then
    if not exists (select 1 from propietarios where id = new.propietario_id) then raise exception 'Socio no encontrado: %', new.propietario_id; end if;
    if not _rol_de_socio(new.rol) then
      raise exception 'Un usuario de socio solo puede tener el rol «Socio (solo lectura)» o uno propio sin «Modificar» y solo de inventario, movimientos, custodia y exportar';
    end if;
  elsif new.rol = 'socio' then
    raise exception 'El rol «Socio (solo lectura)» es solo para usuarios de un socio de custodia: elige el socio';
  end if;
  return new;
end $$;
drop trigger if exists perfiles_socio on public.perfiles;
create trigger perfiles_socio before insert or update of rol, propietario_id on public.perfiles for each row execute function public._perfil_socio_valido();
-- un rol propio que ya usa un socio no puede ganar "Modificar" ni otros apartados
create or replace function public._rol_socio_valido() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from perfiles where rol = new.id and propietario_id is not null) and exists (select 1 from jsonb_each(new.permisos) e where e.value = 'true'::jsonb
       and (e.key like '%.modificar' or split_part(e.key, '.', 1) not in ('inventario', 'movimientos', 'custodia', 'exportar'))) then
    raise exception 'Este rol lo usa un socio: no puede tener «Modificar» ni apartados que no sean de su custodia';
  end if;
  return new;
end $$;
drop trigger if exists roles_socio on public.roles;
create trigger roles_socio before update of permisos on public.roles for each row execute function public._rol_socio_valido();

-- ---------- Un socio no es un usuario interno: todas las políticas le dicen que no ----------
create or replace function public.es_usuario_activo() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and activo and propietario_id is null)
$$;
create or replace function public.es_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and activo and rol = 'admin' and propietario_id is null)
$$;
create or replace function public.tiene_permiso(p_permiso text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and activo and propietario_id is null and _rol_tiene(rol, p_permiso))
$$;
-- el socio del usuario que llama (null si no es de un socio)
create or replace function public._socio_actual() returns text language sql stable security definer set search_path = public as $$
  select propietario_id from perfiles where id = auth.uid() and activo and propietario_id is not null
$$;

-- perfil_actual (E-028) + E-034: un socio solo puede consultar su propio perfil; ninguna otra función de la API
create or replace function public.perfil_actual() returns public.perfiles
language plpgsql stable security definer set search_path = public as $$
declare p public.perfiles; v_perm text; v_rol roles; v_fn text; c text;
begin
  select * into p from perfiles where id = auth.uid() and activo;
  if not found then raise exception 'Usuario sin acceso o desactivado' using errcode = '42501'; end if;
  if p.propietario_id is not null then
    if _funcion_llamante() is distinct from 'perfil_actual' then
      raise exception 'Acceso de socio: solo se consulta el material en custodia, no se modifica nada' using errcode = '42501';
    end if;
    return p;
  end if;
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

-- Las pocas funciones que se pueden llamar sin pasar por perfil_actual: nada para un socio (la clave de servicio, sin usuario, sí)
create or replace function public.reservado(p_sku text, p_excepto uuid default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(cantidad), 0) from reservas where sku = p_sku and caduca > now() and entrega_id is distinct from p_excepto
    and (auth.uid() is null or es_usuario_activo())
$$;
create or replace function public.skus_no_validos() returns table (sku text, nombre text)
language sql stable security definer set search_path = public as $$
  select sku, nombre from productos where not archivado and not _sku_valido(sku) and es_usuario_activo() order by sku
$$;
create or replace function public.vehiculo_de_equipo(p_equipo text, p_fecha timestamptz default now()) returns text
language sql stable security definer set search_path = public as $$
  select vehiculo_id from asignaciones_vehiculo
  where equipo_id = p_equipo and desde <= p_fecha and (hasta is null or hasta > p_fecha) and (auth.uid() is null or es_usuario_activo())
  order by desde desc limit 1
$$;

-- ---------- Lo que ve un socio: solo sus filas y las columnas permitidas ----------
create or replace function public.datos_socio() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s text := _socio_actual(); skus text[];
begin
  if s is null then raise exception 'Solo para usuarios de un socio de custodia' using errcode = '42501'; end if;
  select coalesce(array_agg(sku), '{}') into skus from productos where propiedad = 'custodia' and propietario_id = s;
  return jsonb_build_object(
    'productos', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
      select sku, ean, ref_proveedor, nombre, categoria, unidad, contenido, unidad_contenido, metros_sueltos, formato_texto, stock, minimo, minimo_definido,
             proveedor, propiedad, propietario_id, modelo, talla, foto, foto_mini, foto_origen, borrador, archivado, fusionado_en
      from productos where sku = any(skus)) x),
    'stock_vehiculo', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select vehiculo_id, sku, unidades from stock_vehiculo where sku = any(skus)) x),
    'vehiculos', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select id, matricula, modelo, equipo_id, activo from vehiculos) x),
    'equipos', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select id, nombre, estado, activo from equipos) x),
    'movimientos', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
      select id, ts, sku, tipo, cantidad, motivo, referencia, equipo_id, vehiculo_id, unidades, cierre_id, albaran_id, corrige, 'Búfala' as operario
      from movimientos where sku = any(skus) order by ts desc limit 2000) x),
    'cierres', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
      select id, clave, version, num_inst, cliente, direccion, fecha_cierre, equipo_wizard, equipo_id, vehiculo_id, hardware, desp_fallido, estado, origen, recibido
      from cierres c where exists (select 1 from cierre_lineas l where l.cierre_id = c.id and l.sku = any(skus))) x),
    'cierre_lineas', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
      select id, cierre_id, campo, formula, valor, sku, cantidad, estimada, estado, '' as nota from cierre_lineas where sku = any(skus)) x),
    'actas_custodia', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
      select id, numero, ts, propietario_id, representante, '' as firma, lineas, hash, 'Búfala' as operario from actas_custodia where propietario_id = s) x),
    'avisos_reposicion', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
      select id, sku, destino, grupo, estado, creado, cantidad_pedida, pedido_ts from avisos_reposicion where destino = 'propietario' and grupo = s and sku = any(skus)) x),
    'propietarios', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select id, nombre, activo, color from propietarios where id = s) x),
    'categorias', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from categorias c),
    'roles', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from roles r where r.id = (select rol from perfiles where id = auth.uid())),
    'perfiles', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select id, nombre, email, rol, activo, propietario_id from perfiles where id = auth.uid()) x),
    'config_app', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select modo_demo, kit_fijacion, apertura_cierres, cargadores_a_bordo_hasta from config_app) x)
  );
end $$;

-- Fotos: las de sus artículos (la política se evalúa como el usuario: la comprobación va en una función propia)
create or replace function public._foto_de_socio(p_ruta text) returns boolean language sql stable security definer set search_path = public as $$
  select _socio_actual() is not null and exists (select 1 from productos p where p.sku = _sku_de_ruta(p_ruta) and p.propiedad = 'custodia' and p.propietario_id = _socio_actual())
$$;
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'objects') then
    execute 'drop policy if exists fotos_leer_socio on storage.objects';
    execute $p$create policy fotos_leer_socio on storage.objects for select to authenticated using (bucket_id = 'fotos-articulos' and public._foto_de_socio(name))$p$;
  end if;
end $$;

-- ---------- Usuarios: el administrador elige el socio (además del rol) ----------
create or replace function public.actualizar_perfil(p_id uuid, p_nombre text, p_rol text, p_activo boolean, p_propietario text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin();
begin
  if not exists (select 1 from roles where id = p_rol) then raise exception 'Rol no válido'; end if;
  if p_id = p.id and (p_rol <> 'admin' or not p_activo or nullif(p_propietario, '') is not null) then raise exception 'No puedes quitarte a ti mismo el acceso de administrador'; end if;
  update perfiles set nombre = coalesce(nullif(trim(p_nombre), ''), nombre), rol = p_rol, activo = p_activo, propietario_id = nullif(p_propietario, '') where id = p_id;
  if not found then raise exception 'Usuario no encontrado'; end if;
  if not exists (select 1 from perfiles where rol = 'admin' and activo and propietario_id is null) then raise exception 'Tiene que quedar al menos un administrador activo'; end if;
  insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'actualizar_perfil', jsonb_build_object('id', p_id, 'rol', p_rol, 'activo', p_activo, 'socio', nullif(p_propietario, '')));
  return jsonb_build_object('estado', 'aplicado');
end $$;

revoke execute on function public._rol_de_socio(text), public._perfil_socio_valido(), public._rol_socio_valido(), public._socio_actual(), public._foto_de_socio(text) from public, anon;
grant execute on function public._foto_de_socio(text) to authenticated;
revoke execute on function public.datos_socio(), public.actualizar_perfil(uuid, text, text, boolean, text) from public, anon;
grant execute on function public.datos_socio(), public.actualizar_perfil(uuid, text, text, boolean, text) to authenticated;
