-- =====================================================================================================
-- E-021 · Formato de SKU y rutas de foto robustas
-- - SKU: solo A-Z, 0-9, guion, guion bajo y punto, de 2 a 40 caracteres. Se comprueba al dar de alta, importar o cambiar el código
--   (disparador: vale para todas las funciones). Los SKU antiguos no válidos siguen existiendo hasta que se cambian.
-- - Carpeta de la foto: una CLAVE derivada del SKU (los caracteres no válidos van como !HH, hexadecimal de su UTF-8).
--   Para un SKU válido la clave es el propio SKU: las fotos ya subidas no cambian de ruta.
-- =====================================================================================================
create or replace function public._sku_valido(p_sku text) returns boolean language sql immutable as $$
  select coalesce(p_sku ~ '^[A-Z0-9._-]{2,40}$', false)
$$;

create or replace function public._comprobar_sku() returns trigger language plpgsql security definer set search_path = public as $$
declare otro record;
begin
  if (tg_op = 'INSERT' or new.sku is distinct from old.sku) and not _sku_valido(new.sku) then
    raise exception 'El código "%" no es válido: usa solo letras, números, guion, guion bajo y punto, de 2 a 40 caracteres (sin espacios, "/" ni ":")', new.sku
      using errcode = '22023';
  end if;
  -- tampoco puede ser el código alternativo (EAN…) de otro artículo (E-020)
  if tg_op = 'INSERT' or new.sku is distinct from old.sku then
    select a.sku, p.nombre into otro from codigos_articulo a join productos p on p.sku = a.sku where upper(a.codigo) = new.sku;
    if found then raise exception 'El código % ya está asociado a % (%) como código alternativo', new.sku, otro.nombre, otro.sku using errcode = '23505'; end if;
  end if;
  return new;
end $$;
create trigger productos_sku_valido before insert or update of sku on public.productos for each row execute function public._comprobar_sku();

-- Clave de la carpeta de fotos de un SKU (reversible): lo que no sea A-Z0-9._- va como !HH por cada byte UTF-8
create or replace function public._clave_sku(p_sku text) returns text language plpgsql immutable as $$
declare r text := ''; c text; b bytea; i int;
begin
  foreach c in array regexp_split_to_array(coalesce(p_sku, ''), '') loop
    if c ~ '^[A-Z0-9._-]$' then r := r || c;
    else
      b := convert_to(c, 'UTF8');
      for i in 0 .. length(b) - 1 loop r := r || '!' || upper(lpad(to_hex(get_byte(b, i)), 2, '0')); end loop;
    end if;
  end loop;
  return r;
end $$;

-- SKU al que pertenece una ruta del bucket: productos/<clave>/<marca>.webp (null si la ruta no tiene ese formato)
create or replace function public._sku_de_ruta(p_ruta text) returns text
language sql stable security definer set search_path = public as $$
  select case when p_ruta ~ '^productos/[A-Za-z0-9._!-]+/[A-Za-z0-9_-]+\.(webp|jpg)$' then
    coalesce((select sku from productos where _clave_sku(sku) = split_part(p_ruta, '/', 2) limit 1), upper(split_part(p_ruta, '/', 2))) end
$$;

-- Artículos con un código no válido (creados antes de esta comprobación): el administrador los ve en su bandeja para cambiarlo
create or replace function public.skus_no_validos() returns table (sku text, nombre text)
language sql stable security definer set search_path = public as $$
  select sku, nombre from productos where not archivado and not _sku_valido(sku) order by sku
$$;

revoke execute on function public._sku_valido(text), public._comprobar_sku(), public._clave_sku(text), public._sku_de_ruta(text), public.skus_no_validos() from public, anon;
grant execute on function public.skus_no_validos() to authenticated;

-- Cambiar el código a un código alternativo del MISMO artículo: deja de ser alternativo y pasa a ser su SKU
create or replace function public.cambiar_codigo_producto(p_sku text, p_nuevo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); a productos; v_nuevo text := upper(trim(coalesce(p_nuevo, '')));
begin
  select * into a from productos where sku = upper(p_sku);
  if not found then raise exception 'Artículo no encontrado: %', p_sku; end if;
  if v_nuevo = '' then raise exception 'Indica el código nuevo'; end if;
  if exists (select 1 from productos where sku = v_nuevo) then raise exception 'Ya existe un artículo con el código %', v_nuevo; end if;
  delete from codigos_articulo where upper(codigo) = v_nuevo and sku = a.sku;
  insert into productos (sku, ean, ref_proveedor, nombre, categoria, unidad, contenido, formato, formato_texto, minimo, minimo_definido, objetivo, proveedor, proveedor_habitual,
                         con_serie, borrador, propiedad, propietario_id, modelo, talla, notas, foto, foto_mini, foto_origen)
  select v_nuevo, ean, ref_proveedor, nombre, categoria, unidad, contenido, formato, formato_texto, minimo, minimo_definido, objetivo, proveedor, proveedor_habitual,
         false, borrador, propiedad, propietario_id, modelo, talla, notas, foto, foto_mini, foto_origen from productos where sku = a.sku;
  update productos set ean = null where sku = a.sku;          -- el EAN pasa a la ficha nueva
  perform fusionar_productos(a.sku, v_nuevo, 'Cambio de código ' || a.sku || ' → ' || v_nuevo);
  return jsonb_build_object('estado', 'aplicado', 'sku', v_nuevo);
end $$;
