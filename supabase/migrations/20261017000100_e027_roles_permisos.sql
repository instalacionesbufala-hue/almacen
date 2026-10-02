-- =====================================================================================================
-- E-027 · Roles y permisos configurables, con un rol de solo lectura para dirección
-- - Tabla roles (Administrador, Almacén y Solo lectura son de sistema; el administrador crea los suyos).
--   perfiles.rol pasa a ser una referencia a roles.id. Nadie cambia de rol con esta migración.
-- - El permiso se comprueba en el SERVIDOR, en un solo sitio: perfil_actual() y exigir_admin() miran qué función de la API
--   les ha llamado (la última de la pila, PG_CONTEXT) y buscan su permiso en permisos_funcion. Así todas las funciones que
--   escriben quedan cubiertas sin reescribirlas, y una función nueva sin permiso asignado sigue como estaba
--   (las de exigir_admin, solo para el administrador).
--   · Administrador: todo.
--   · Roles de sistema (Almacén, Solo lectura): las funciones de administrador siguen siendo solo del administrador;
--     las demás, si su rol tiene el permiso. Almacén conserva exactamente lo que podía; Solo lectura no escribe nada.
--   · Roles propios: con "Modificar" de un apartado pueden lo mismo que el administrador en ese apartado, salvo usuarios y roles.
-- - Lecturas (RLS) y Storage: "Ver" del apartado. Integraciones, usuarios y auditoría, solo el administrador.
-- =====================================================================================================
create table if not exists public.roles (
  id          text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  nombre      text not null check (length(trim(nombre)) > 0),
  descripcion text not null default '',
  sistema     boolean not null default false,
  permisos    jsonb not null default '{}',
  creado      timestamptz not null default now()
);
insert into public.roles (id, nombre, descripcion, sistema, permisos) values
  ('admin', 'Administrador', 'Todo, también usuarios, roles y configuración.', true, '{}'),
  ('almacen', 'Almacén', 'Lo del día a día del almacén: movimientos, entregas, recuentos, albaranes y borradores de artículos.', true,
   '{"inventario.ver":true,"inventario.modificar":true,"movimientos.ver":true,"movimientos.modificar":true,"albaranes.ver":true,"albaranes.modificar":true,"entregas.ver":true,"entregas.modificar":true,"equipos.ver":true,"equipos.modificar":true,"recuentos.ver":true,"recuentos.modificar":true,"dotacion.ver":true,"dotacion.modificar":true,"custodia.ver":true,"custodia.modificar":true,"cierres.ver":true,"cierres.modificar":false,"bandeja.ver":true,"bandeja.modificar":false,"exportar.ver":false,"configuracion.ver":false,"configuracion.modificar":false,"usuarios.ver":false,"usuarios.modificar":false}'),
  ('lectura', 'Solo lectura', 'Para dirección: ve inventario, movimientos, albaranes, entregas, equipos, cierres, custodia y avisos, y exporta. No modifica nada.', true,
   '{"inventario.ver":true,"inventario.modificar":false,"movimientos.ver":true,"movimientos.modificar":false,"albaranes.ver":true,"albaranes.modificar":false,"entregas.ver":true,"entregas.modificar":false,"equipos.ver":true,"equipos.modificar":false,"recuentos.ver":true,"recuentos.modificar":false,"dotacion.ver":true,"dotacion.modificar":false,"custodia.ver":true,"custodia.modificar":false,"cierres.ver":true,"cierres.modificar":false,"bandeja.ver":true,"bandeja.modificar":false,"exportar.ver":true,"configuracion.ver":false,"configuracion.modificar":false,"usuarios.ver":false,"usuarios.modificar":false}')
on conflict (id) do nothing;

alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles drop constraint if exists perfiles_rol_fkey;
alter table public.perfiles add constraint perfiles_rol_fkey foreign key (rol) references public.roles(id);

-- ---------- Qué permiso pide cada función de la API que escribe ----------
create table if not exists public.permisos_funcion (funcion text primary key, permiso text not null);
insert into public.permisos_funcion (funcion, permiso) values
  -- inventario
  ('guardar_producto', 'inventario.modificar'), ('importar_catalogo', 'inventario.modificar'), ('crear_borrador_articulo', 'inventario.modificar'),
  ('crear_borrador_producto', 'inventario.modificar'), ('proponer_cambio_ficha', 'inventario.modificar'), ('resolver_propuesta_ficha', 'inventario.modificar'),
  ('poner_foto', 'inventario.modificar'), ('quitar_foto', 'inventario.modificar'), ('asociar_codigo', 'inventario.modificar'), ('quitar_codigo', 'inventario.modificar'),
  ('cambiar_codigo_producto', 'inventario.modificar'), ('fusionar_productos', 'inventario.modificar'), ('deshacer_fusion', 'inventario.modificar'),
  ('archivar_producto', 'inventario.modificar'), ('restaurar_producto', 'inventario.modificar'), ('borrar_producto', 'inventario.modificar'),
  ('cambiar_propiedad', 'inventario.modificar'), ('fijar_minimos', 'inventario.modificar'), ('marcar_pedido', 'inventario.modificar'), ('rastro_producto', 'inventario.ver'),
  -- movimientos
  ('registrar_movimiento', 'movimientos.modificar'), ('ajustar_inventario', 'movimientos.modificar'), ('proponer_ajuste', 'movimientos.modificar'),
  -- albaranes
  ('aprobar_albaran', 'albaranes.modificar'), ('reasignar_linea_albaran', 'albaranes.modificar'),
  -- entregas
  ('preparar_entrega', 'entregas.modificar'), ('confirmar_entrega', 'entregas.modificar'), ('registrar_entrega', 'entregas.modificar'), ('anular_entrega', 'entregas.modificar'),
  ('reenviar_copia_entrega', 'entregas.modificar'), ('registrar_copia_entrega', 'entregas.modificar'), ('guardar_plantilla', 'entregas.modificar'),
  -- equipos, técnicos y vehículos
  ('guardar_equipo', 'equipos.modificar'), ('retirar_equipo', 'equipos.modificar'), ('cambiar_estado_equipo', 'equipos.modificar'), ('guardar_tecnico', 'equipos.modificar'),
  ('baja_tecnico', 'equipos.modificar'), ('asignar_tecnico', 'equipos.modificar'), ('guardar_vehiculo', 'equipos.modificar'), ('baja_vehiculo', 'equipos.modificar'),
  ('asignar_vehiculo', 'equipos.modificar'), ('guardar_email_tecnico', 'equipos.modificar'), ('guardar_telefono_tecnico', 'equipos.modificar'),
  ('crear_enlace_portal', 'equipos.modificar'), ('revocar_enlaces_portal', 'equipos.modificar'),
  -- recuentos
  ('registrar_recuento', 'recuentos.modificar'), ('registrar_recuento_vehiculo', 'recuentos.modificar'),
  -- dotación
  ('alta_dotacion', 'dotacion.modificar'), ('asignar_dotacion', 'dotacion.modificar'), ('registrar_incidencia', 'dotacion.modificar'),
  ('fijar_minimo_herramienta', 'dotacion.modificar'), ('marcar_pedido_herramienta', 'dotacion.modificar'), ('guardar_tallas', 'dotacion.modificar'),
  -- custodia
  ('registrar_acta_custodia', 'custodia.modificar'),
  -- cierres
  ('aplicar_cierre_admin', 'cierres.modificar'), ('recalcular_cierre_admin', 'cierres.modificar'), ('reprocesar_cierre', 'cierres.modificar'),
  ('resolver_linea_cierre', 'cierres.modificar'), ('revisar_material_especial', 'cierres.modificar'),
  -- avisos y bandeja
  ('validar_pendiente', 'bandeja.modificar'), ('marcar_merma_vista', 'bandeja.modificar'), ('guardar_suscripcion_push', 'bandeja.ver'),
  -- configuración
  ('guardar_categoria', 'configuracion.modificar'), ('desactivar_categoria', 'configuracion.modificar'), ('guardar_propietario', 'configuracion.modificar'),
  ('guardar_config_avisos', 'configuracion.modificar'), ('guardar_equivalencia', 'configuracion.modificar'), ('borrar_equivalencia', 'configuracion.modificar'),
  ('cargar_propuesta_equivalencias', 'configuracion.modificar'), ('confirmar_equivalencias', 'configuracion.modificar'), ('guardar_kit_fijacion', 'configuracion.modificar'),
  ('config_cierres', 'configuracion.modificar'),
  -- usuarios, roles e integraciones: solo el administrador, siempre
  ('actualizar_perfil', 'usuarios.modificar'), ('guardar_rol', 'usuarios.modificar'), ('borrar_rol', 'usuarios.modificar'),
  ('crear_integracion', 'usuarios.modificar'), ('revocar_integracion', 'usuarios.modificar')
on conflict (funcion) do update set permiso = excluded.permiso;

-- ¿El rol tiene el permiso? ("modificar" implica "ver"; usuarios.* nunca fuera del administrador)
create or replace function public._rol_tiene(p_rol text, p_permiso text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_rol = 'admin' or (p_permiso not like 'usuarios.%' and exists (select 1 from roles r where r.id = p_rol and (
    coalesce((r.permisos->>p_permiso)::boolean, false)
    or (p_permiso like '%.ver' and coalesce((r.permisos->>(replace(p_permiso, '.ver', '.modificar')))::boolean, false)))))
$$;
create or replace function public.tiene_permiso(p_permiso text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and activo and _rol_tiene(rol, p_permiso))
$$;

-- Función de la API que está en curso: la última de la pila de llamadas
create or replace function public._funcion_llamante() returns text
language plpgsql stable set search_path = public as $$
declare c text; m text[]; ult text;
begin
  get diagnostics c = pg_context;
  for m in select regexp_matches(c, 'function (?:public\.)?"?([a-z_0-9]+)"?', 'g') loop ult := m[1]; end loop;
  return ult;
end $$;
create or replace function public._permiso_llamada() returns text
language sql stable security definer set search_path = public as $$
  select permiso from permisos_funcion where funcion = _funcion_llamante()
$$;

create or replace function public.perfil_actual() returns public.perfiles
language plpgsql stable security definer set search_path = public as $$
declare p public.perfiles; v_perm text; v_rol roles; c text;
begin
  select * into p from perfiles where id = auth.uid() and activo;
  if not found then raise exception 'Usuario sin acceso o desactivado' using errcode = '42501'; end if;
  get diagnostics c = pg_context;
  -- dentro de exigir_admin() decide exigir_admin (con su mensaje de siempre)
  if p.rol <> 'admin' and position('function exigir_admin(' in c) = 0 and position('function public.exigir_admin(' in c) = 0 then
    v_perm := _permiso_llamada();
    if v_perm is not null and not _rol_tiene(p.rol, v_perm) then
      select * into v_rol from roles where id = p.rol;
      raise exception 'Tu rol (%) no permite hacer esto (%)', coalesce(v_rol.nombre, p.rol), v_perm using errcode = '42501';
    end if;
  end if;
  return p;
end $$;

create or replace function public.exigir_admin() returns public.perfiles
language plpgsql stable security definer set search_path = public as $$
declare p public.perfiles := perfil_actual(); v_perm text;
begin
  if p.rol = 'admin' then return p; end if;
  -- un rol propio con "Modificar" de ese apartado puede lo mismo que el administrador en él (nunca usuarios ni roles)
  v_perm := _permiso_llamada();
  if v_perm is not null and v_perm not like 'usuarios.%' and not coalesce((select sistema from roles where id = p.rol), true) and _rol_tiene(p.rol, v_perm) then return p; end if;
  if v_perm is not null and v_perm not like 'usuarios.%' and not coalesce((select sistema from roles where id = p.rol), true) then
    raise exception 'Tu rol (%) no permite hacer esto (%)', (select nombre from roles where id = p.rol), v_perm using errcode = '42501';
  end if;
  raise exception 'Solo el administrador puede hacer esto' using errcode = '42501';
end $$;

-- ---------- Roles: crear, editar, duplicar (desde la app) y borrar ----------
create or replace function public.guardar_rol(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); v_id text := lower(trim(coalesce(p->>'id', ''))); v_nombre text := trim(coalesce(p->>'nombre', '')); r roles; v_perm jsonb := '{}';
  k text; mod boolean;
begin
  if v_id !~ '^[a-z0-9_]{2,40}$' then raise exception 'Identificador de rol no válido'; end if;
  if v_nombre = '' then raise exception 'Pon el nombre del rol'; end if;
  select * into r from roles where id = v_id;
  if found and r.sistema then raise exception 'Los roles de sistema no se modifican: duplícalo y cambia la copia'; end if;
  if exists (select 1 from roles where id <> v_id and lower(nombre) = lower(v_nombre)) then raise exception 'Ya hay un rol llamado %', v_nombre; end if;
  -- solo apartados conocidos; "modificar" marca "ver"; nada de usuarios
  for k in select distinct split_part(x, '.', 1) from jsonb_object_keys(coalesce(p->'permisos', '{}')) x loop
    continue when k = 'usuarios' or k not in ('inventario', 'movimientos', 'albaranes', 'entregas', 'equipos', 'recuentos', 'dotacion', 'custodia', 'cierres', 'bandeja', 'exportar', 'configuracion');
    mod := k <> 'exportar' and coalesce((p->'permisos'->>(k || '.modificar'))::boolean, false);
    v_perm := v_perm || jsonb_build_object(k || '.ver', mod or coalesce((p->'permisos'->>(k || '.ver'))::boolean, false));
    if k <> 'exportar' then v_perm := v_perm || jsonb_build_object(k || '.modificar', mod); end if;
  end loop;
  insert into roles (id, nombre, descripcion, sistema, permisos) values (v_id, v_nombre, coalesce(p->>'descripcion', ''), false, v_perm)
  on conflict (id) do update set nombre = excluded.nombre, descripcion = excluded.descripcion, permisos = excluded.permisos;
  insert into auditoria (usuario, operario, accion, detalle) values (u.id, u.nombre, 'guardar_rol', jsonb_build_object('id', v_id, 'nombre', v_nombre, 'permisos', v_perm));
  return jsonb_build_object('estado', 'aplicado', 'id', v_id);
end $$;

create or replace function public.borrar_rol(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); r roles; n int;
begin
  select * into r from roles where id = p_id;
  if not found then raise exception 'Rol no encontrado'; end if;
  if r.sistema then raise exception 'Los roles de sistema no se borran'; end if;
  select count(*) into n from perfiles where rol = p_id;
  if n > 0 then raise exception 'El rol % lo usa% % usuario%: cámbiales el rol antes de borrarlo', r.nombre, case when n = 1 then '' else 'n' end, n, case when n = 1 then '' else 's' end; end if;
  delete from roles where id = p_id;
  insert into auditoria (usuario, operario, accion, detalle) values (u.id, u.nombre, 'borrar_rol', jsonb_build_object('id', p_id, 'nombre', r.nombre));
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- El rol de un usuario puede ser cualquiera de la tabla (antes solo admin o almacen)
create or replace function public.actualizar_perfil(p_id uuid, p_nombre text, p_rol text, p_activo boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin();
begin
  if not exists (select 1 from roles where id = p_rol) then raise exception 'Rol no válido'; end if;
  if p_id = p.id and (p_rol <> 'admin' or not p_activo) then raise exception 'No puedes quitarte a ti mismo el acceso de administrador'; end if;
  update perfiles set nombre = coalesce(nullif(trim(p_nombre), ''), nombre), rol = p_rol, activo = p_activo where id = p_id;
  if not found then raise exception 'Usuario no encontrado'; end if;
  if not exists (select 1 from perfiles where rol = 'admin' and activo) then raise exception 'Tiene que quedar al menos un administrador activo'; end if;
  insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'actualizar_perfil', jsonb_build_object('id', p_id, 'rol', p_rol, 'activo', p_activo));
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- ---------- Lecturas (RLS): "Ver" del apartado ----------
do $$
declare t record;
begin
  for t in select * from (values
    ('movimientos', 'movimientos_lectura', 'movimientos.ver'),
    ('albaranes', 'albaranes_lectura', 'albaranes.ver'),
    ('entregas', 'entregas_lectura', 'entregas.ver'), ('entrega_lineas', 'entrega_lineas_lectura', 'entregas.ver'), ('copias_entrega', 'copias_entrega_lectura', 'entregas.ver'),
    ('plantillas_entrega', 'plantillas_lectura', 'entregas.ver'), ('plantilla_lineas', 'plantilla_lineas_lectura', 'entregas.ver'),
    ('portal_enlaces', 'portal_enlaces_lectura', 'equipos.ver'),
    ('recuentos', 'recuentos_lectura', 'recuentos.ver'),
    ('dotacion', 'dotacion_lectura', 'dotacion.ver'), ('dotacion_historial', 'historial_lectura', 'dotacion.ver'),
    ('minimos_herramienta', 'minimos_herr_lectura', 'dotacion.ver'), ('tallas_tecnico', 'tallas_lectura', 'dotacion.ver'),
    ('actas_custodia', 'actas_lectura', 'custodia.ver'),
    ('cierres', 'cierres_lectura', 'cierres.ver'), ('cierre_lineas', 'cierre_lineas_lectura', 'cierres.ver'), ('cierre_versiones', 'cierre_versiones_lectura', 'cierres.ver'),
    ('equivalencias_cierre', 'equivalencias_lectura', 'cierres.ver'), ('kits_fijacion', 'kits_lectura', 'cierres.ver'),
    ('avisos_reposicion', 'avisos_lectura', 'bandeja.ver'), ('pedidos_reposicion', 'pedidos_lectura', 'inventario.ver'),
    ('productos', 'productos_lectura', 'inventario.ver'), ('codigos_articulo', 'codigos_articulo_leer', 'inventario.ver'),
    ('series', 'series_lectura', 'inventario.ver')
  ) x(tabla, politica, permiso) loop
    continue when to_regclass('public.' || t.tabla) is null;
    execute format('drop policy if exists %I on public.%I', t.politica, t.tabla);
    execute format('create policy %I on public.%I for select to authenticated using (public.tiene_permiso(%L))', t.politica, t.tabla, t.permiso);
  end loop;
end $$;
-- pendientes: el administrador, quien valida la bandeja, y cada uno los suyos
drop policy if exists pendientes_lectura on public.pendientes;
create policy pendientes_lectura on public.pendientes for select to authenticated using (public.tiene_permiso('bandeja.modificar') or usuario = auth.uid());

alter table public.roles enable row level security;
alter table public.permisos_funcion enable row level security;
revoke all on public.roles, public.permisos_funcion from anon, authenticated;
grant select on public.roles to authenticated;
create policy roles_lectura on public.roles for select to authenticated using (public.es_usuario_activo());

-- ---------- Storage: ver con "Ver", subir con "Modificar" ----------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'objects') then
    execute $p$drop policy if exists fotos_leer on storage.objects$p$;
    execute $p$create policy fotos_leer on storage.objects for select to authenticated using (bucket_id = 'fotos-articulos' and public.tiene_permiso('inventario.ver'))$p$;
    execute $p$drop policy if exists fotos_subir on storage.objects$p$;
    execute $p$create policy fotos_subir on storage.objects for insert to authenticated with check (bucket_id = 'fotos-articulos' and public.tiene_permiso('inventario.modificar') and public.puede_subir_foto(name))$p$;
    execute $p$drop policy if exists albaranes_paginas_leer on storage.objects$p$;
    execute $p$create policy albaranes_paginas_leer on storage.objects for select to authenticated using (bucket_id = 'albaranes-paginas' and public.tiene_permiso('albaranes.ver'))$p$;
    execute $p$drop policy if exists albaranes_paginas_subir on storage.objects$p$;
    execute $p$create policy albaranes_paginas_subir on storage.objects for insert to authenticated with check (bucket_id = 'albaranes-paginas' and public.tiene_permiso('albaranes.modificar') and public.puede_subir_pagina(name))$p$;
    execute $p$drop policy if exists justificantes_leer on storage.objects$p$;
    execute $p$create policy justificantes_leer on storage.objects for select to authenticated using (bucket_id = 'justificantes' and public.tiene_permiso('entregas.ver'))$p$;
    execute $p$drop policy if exists justificantes_subir on storage.objects$p$;
    execute $p$create policy justificantes_subir on storage.objects for insert to authenticated with check (bucket_id = 'justificantes' and public.tiene_permiso('entregas.modificar'))$p$;
  end if;
end $$;

revoke execute on function public._rol_tiene(text, text), public._funcion_llamante(), public._permiso_llamada() from public, anon, authenticated;
revoke execute on function public.tiene_permiso(text), public.guardar_rol(jsonb), public.borrar_rol(text) from public, anon;
grant execute on function public.tiene_permiso(text), public.guardar_rol(jsonb), public.borrar_rol(text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.roles;
  end if;
end $$;
