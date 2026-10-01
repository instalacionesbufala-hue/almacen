-- =====================================================================================================
-- E-020 · Códigos alternativos de un artículo (EAN del fabricante, Code 128, QR…)
-- Los artículos usan el código del proveedor como SKU, pero las cajas traen el EAN del fabricante: se le enseña a la app una vez.
-- Un código pertenece a un solo artículo; un artículo puede tener varios. El administrador y el almacén asocian
-- (queda en la auditoría); solo el administrador quita. Al fusionar un artículo, sus códigos pasan al destino.
-- =====================================================================================================
create table public.codigos_articulo (
  codigo   text primary key check (codigo = btrim(codigo) and length(codigo) between 1 and 200),
  sku      text not null references public.productos(sku),
  tipo     text not null default 'otro' check (tipo in ('EAN', 'UPC', 'Code 128', 'QR', 'otro')),
  creado   timestamptz not null default now(),
  usuario  uuid references public.perfiles(id),
  operario text not null default ''
);
create index codigos_articulo_sku on public.codigos_articulo (sku);
alter table public.codigos_articulo enable row level security;
revoke all on public.codigos_articulo from anon, authenticated;
grant select on public.codigos_articulo to authenticated;
create policy codigos_articulo_leer on public.codigos_articulo for select to authenticated using (public.es_usuario_activo());

create or replace function public.asociar_codigo(p_codigo text, p_sku text, p_tipo text default 'otro') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := perfil_actual(); c text := btrim(coalesce(p_codigo, '')); pr productos; otro record;
begin
  if not es_usuario_activo() then raise exception 'Tu usuario no está activo' using errcode = '42501'; end if;
  if c = '' then raise exception 'Indica el código'; end if;
  select * into pr from productos where sku = upper(p_sku);
  if not found then raise exception 'Producto no encontrado: %', p_sku; end if;
  if pr.archivado then raise exception '% está archivado: asocia el código al artículo que lo sustituye', pr.sku; end if;
  select a.sku, p.nombre into otro from codigos_articulo a join productos p on p.sku = a.sku where upper(a.codigo) = upper(c);
  if found then
    if otro.sku = pr.sku then return jsonb_build_object('estado', 'duplicado'); end if;
    raise exception 'El código % ya está asociado a % (%)', c, otro.nombre, otro.sku;
  end if;
  select sku, nombre into otro from productos where not archivado and sku <> pr.sku
    and upper(c) in (sku, upper(coalesce(ean, '')), upper(coalesce(ref_proveedor, ''))) limit 1;
  if found then raise exception 'El código % ya es de % (%)', c, otro.nombre, otro.sku; end if;
  if upper(c) in (pr.sku, upper(coalesce(pr.ean, ''))) then return jsonb_build_object('estado', 'duplicado'); end if;
  insert into codigos_articulo (codigo, sku, tipo, usuario, operario)
  values (c, pr.sku, case when p_tipo in ('EAN', 'UPC', 'Code 128', 'QR', 'otro') then p_tipo else 'otro' end, u.id, u.nombre);
  insert into auditoria (usuario, operario, accion, detalle) values (u.id, u.nombre, 'asociar_codigo', jsonb_build_object('codigo', c, 'sku', pr.sku, 'tipo', p_tipo));
  return jsonb_build_object('estado', 'aplicado');
end $$;

create or replace function public.quitar_codigo(p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); s text;
begin
  delete from codigos_articulo where codigo = btrim(p_codigo) returning sku into s;
  if s is null then return jsonb_build_object('estado', 'duplicado'); end if;
  insert into auditoria (usuario, operario, accion, detalle) values (u.id, u.nombre, 'quitar_codigo', jsonb_build_object('codigo', btrim(p_codigo), 'sku', s));
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- Al fusionar (o cambiar el código, que fusiona en la ficha nueva), los códigos alternativos pasan al artículo que lo sustituye
create or replace function public._codigos_al_fusionar() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.fusionado_en is not null and new.fusionado_en is distinct from old.fusionado_en then
    update codigos_articulo set sku = new.fusionado_en where sku = new.sku;
  end if;
  return new;
end $$;
create trigger productos_codigos_al_fusionar after update of fusionado_en on public.productos for each row execute function public._codigos_al_fusionar();

revoke execute on function public.asociar_codigo(text, text, text), public.quitar_codigo(text), public._codigos_al_fusionar() from public, anon;
grant execute on function public.asociar_codigo(text, text, text), public.quitar_codigo(text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.codigos_articulo;
  end if;
end $$;

-- "Borrar datos de ejemplo" también vacía los códigos alternativos
create or replace function public.limpiar_demostracion() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); c config_app; fotos text[]; n jsonb;
begin
  select * into c from config_app where id = 1 for update;
  if not c.modo_demo then raise exception 'Los datos de ejemplo ya se borraron el % (por %)', to_char(c.demo_borrada at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'), c.demo_borrada_por; end if;
  select coalesce(array_agg(r), '{}') into fotos from (select unnest(array[foto, foto_mini]) r from productos) x where r is not null;
  n := jsonb_build_object('productos', (select count(*) from productos), 'movimientos', (select count(*) from movimientos), 'entregas', (select count(*) from entregas),
                          'equipos', (select count(*) from equipos), 'tecnicos', (select count(*) from tecnicos), 'dotacion', (select count(*) from dotacion));
  perform set_config('almacen.limpieza_demo', 'si', true);
  truncate table codigos_articulo, propuestas_ficha, cierre_lineas, cierres, portal_enlaces, copias_entrega, envios_aviso, reservas, entrega_lineas, entregas, stock_vehiculo, movimientos, pendientes, recuentos, albaranes, avisos_reposicion,
    actas_custodia, series, costes_producto, costes_incidencia, dotacion_historial, costes_dotacion, dotacion, minimos_herramienta,
    plantilla_lineas, plantillas_entrega, tallas_tecnico, asignaciones_tecnico, asignaciones_vehiculo, vehiculos, tecnicos, equipos, productos;
  perform set_config('almacen.limpieza_demo', '', true);
  alter sequence entregas_numero restart with 1;
  alter sequence actas_numero restart with 1;
  update config_app set modo_demo = false, demo_borrada = now(), demo_borrada_por = p.nombre where id = 1;
  insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'limpiar_demostracion', n || jsonb_build_object('fotos', coalesce(array_length(fotos, 1), 0)));
  return jsonb_build_object('estado', 'aplicado', 'borrado', n, 'fotos', to_jsonb(fotos));
end $$;
