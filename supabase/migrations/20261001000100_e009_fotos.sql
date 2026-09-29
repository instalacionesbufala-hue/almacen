-- E-009 · Fotos de los artículos
-- Las fotos viven en el bucket PRIVADO "fotos-articulos" de Supabase Storage (el repositorio y la web son públicos,
-- y muchas fotos son de Saltoki o de fabricantes). Se leen con URL firmadas y solo con sesión iniciada.
-- Ruta de cada archivo: productos/<SKU>/<marca>.webp y productos/<SKU>/<marca>-mini.webp (200 px).
-- Las variantes de talla de un mismo modelo comparten la foto.
-- Permisos: el almacén pone foto a un artículo que no tiene; sustituir o quitar una foto es solo del administrador.

alter table public.productos
  add column foto        text,
  add column foto_mini   text,
  add column foto_origen text check (foto_origen in ('Saltoki', 'Esmove', 'fabricante', 'propia')),
  add constraint productos_foto_completa check ((foto is null) = (foto_mini is null));

-- SKU al que pertenece una ruta del bucket (null si la ruta no tiene el formato esperado)
create or replace function public._sku_de_ruta(p_ruta text) returns text
language sql immutable as $$
  select case when p_ruta ~ '^productos/[^/]+/[A-Za-z0-9_-]+\.(webp|jpg)$' then upper(split_part(p_ruta, '/', 2)) end
$$;

-- Artículos que comparten foto: el propio SKU y, si tiene modelo (ropa y EPIs por tallas), todas las tallas de ese modelo
create or replace function public._grupo_foto(p_sku text) returns setof text
language sql stable security definer set search_path = public as $$
  select sku from productos where sku = upper(p_sku)
  union
  select p.sku from productos p join productos o on o.sku = upper(p_sku)
  where coalesce(o.modelo, '') <> '' and p.modelo = o.modelo
$$;

-- ¿Puede el usuario subir este archivo al bucket? (la usa la política de Storage)
create or replace function public.puede_subir_foto(p_ruta text) returns boolean
language sql stable security definer set search_path = public as $$
  select es_usuario_activo()
    and exists (select 1 from productos where sku = _sku_de_ruta(p_ruta))
    and (es_admin() or not exists (
      select 1 from productos p where p.sku in (select _grupo_foto(_sku_de_ruta(p_ruta)))
        and p.foto is not null and p_ruta not in (p.foto, p.foto_mini)))
$$;

create or replace function public.poner_foto(p_sku text, p_foto text, p_mini text, p_origen text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := perfil_actual(); n int;
begin
  if not exists (select 1 from productos where sku = upper(p_sku)) then raise exception 'Producto no encontrado'; end if;
  if p_origen is null or p_origen not in ('Saltoki', 'Esmove', 'fabricante', 'propia') then raise exception 'Origen de la foto no válido'; end if;
  if _sku_de_ruta(p_foto) is distinct from upper(p_sku) or _sku_de_ruta(p_mini) is distinct from upper(p_sku) then raise exception 'Ruta de la foto no válida'; end if;
  -- reenviar la misma foto (reintento de la cola) no es sustituir
  if u.rol <> 'admin' and exists (select 1 from productos where sku in (select _grupo_foto(p_sku)) and foto is not null and foto <> p_foto) then
    raise exception 'Este artículo ya tiene foto: solo el administrador puede sustituirla' using errcode = '42501';
  end if;
  update productos set foto = p_foto, foto_mini = p_mini, foto_origen = p_origen, actualizado = now() where sku in (select _grupo_foto(p_sku));
  get diagnostics n = row_count;
  return jsonb_build_object('estado', 'aplicado', 'articulos', n);
end $$;

create or replace function public.quitar_foto(p_sku text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); rutas text[];
begin
  select coalesce(array_agg(distinct r), '{}') into rutas from productos, unnest(array[foto, foto_mini]) r
  where sku in (select _grupo_foto(p_sku)) and r is not null;
  update productos set foto = null, foto_mini = null, foto_origen = null, actualizado = now() where sku in (select _grupo_foto(p_sku));
  if not found then raise exception 'Producto no encontrado'; end if;
  -- la app borra estos archivos del bucket (el administrador tiene permiso de borrado)
  return jsonb_build_object('estado', 'aplicado', 'rutas', to_jsonb(rutas));
end $$;

-- ---------- Bucket privado (solo en Supabase) ----------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('fotos-articulos', 'fotos-articulos', false, 2097152, array['image/webp', 'image/jpeg'])
    on conflict (id) do update set public = false;
    execute $p$create policy fotos_leer on storage.objects for select to authenticated using (bucket_id = 'fotos-articulos' and public.es_usuario_activo())$p$;
    execute $p$create policy fotos_subir on storage.objects for insert to authenticated with check (bucket_id = 'fotos-articulos' and public.puede_subir_foto(name))$p$;
    execute $p$create policy fotos_sustituir on storage.objects for update to authenticated using (bucket_id = 'fotos-articulos' and public.es_admin())$p$;
    execute $p$create policy fotos_borrar on storage.objects for delete to authenticated using (bucket_id = 'fotos-articulos' and public.es_admin())$p$;
  end if;
end $$;

revoke execute on function public._sku_de_ruta(text), public._grupo_foto(text), public.puede_subir_foto(text),
  public.poner_foto(text, text, text, text), public.quitar_foto(text) from public, anon;
grant execute on function public.puede_subir_foto(text), public.poner_foto(text, text, text, text), public.quitar_foto(text) to authenticated;
