-- =====================================================================================================
-- E-015 · Alta de artículos con la cámara del móvil
-- El administrador crea el artículo directamente (guardar_producto, con su "Alta de artículo").
-- El personal de almacén lo crea como BORRADOR con la ficha completa y el stock que ha contado; el stock NO entra
-- hasta que el administrador lo completa o lo aprueba desde su bandeja, y entonces entra como "Alta de artículo".
-- =====================================================================================================
alter table public.productos
  add column stock_propuesto numeric(14,3) check (stock_propuesto is null or stock_propuesto >= 0),   -- lo contado por el almacén al crear el borrador
  add column propuesto_por   text;

create or replace function public.crear_borrador_articulo(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u perfiles := perfil_actual();
  v_sku text := upper(trim(coalesce(p->>'sku', '')));
  v_ean text := nullif(trim(coalesce(p->>'ean', '')), '');
  v_ref text := nullif(trim(coalesce(p->>'ref_proveedor', '')), '');
  v_nombre text := trim(coalesce(p->>'nombre', ''));
  v_unidad text := lower(coalesce(nullif(trim(p->>'unidad'), ''), 'ud'));
  v_contenido numeric := coalesce(nullif(p->>'contenido', '')::numeric, 1);
  v_stock numeric := coalesce(nullif(p->>'stock_inicial', '')::numeric, 0);
  custodia boolean := coalesce(p->>'propiedad', 'propia') = 'custodia';
  otro productos;
begin
  if v_sku = '' then raise exception 'Falta el código del artículo'; end if;
  if v_nombre = '' then raise exception 'Indica el nombre del artículo'; end if;
  if v_unidad not in ('m', 'ud', 'bote', 'sobre', 'bolsa', 'pack', 'caja') then raise exception 'Unidad desconocida: %', v_unidad; end if;
  if v_contenido <= 0 then raise exception 'El contenido debe ser mayor que cero'; end if;
  if v_stock < 0 then raise exception 'El stock inicial no puede ser negativo'; end if;
  if v_unidad <> 'm' and v_stock <> trunc(v_stock) then raise exception 'El stock inicial va en % enteros', v_unidad; end if;
  if custodia and nullif(p->>'propietario_id', '') is null then raise exception 'Indica de quién es el material en custodia'; end if;
  -- duplicados por código: SKU, EAN o código del proveedor
  select * into otro from productos where sku = v_sku or (v_ean is not null and ean = v_ean) or (v_ref is not null and upper(ref_proveedor) = upper(v_ref)) limit 1;
  if found then
    -- reintento de la cola: el mismo borrador ya está creado
    if otro.sku = v_sku and otro.borrador and otro.nombre = v_nombre then return jsonb_build_object('estado', 'duplicado', 'sku', v_sku); end if;
    raise exception 'Ya existe una referencia con ese código: % (%)', otro.sku, otro.nombre;
  end if;
  insert into productos (sku, ean, ref_proveedor, nombre, categoria, unidad, contenido, formato, minimo, minimo_definido, proveedor, con_serie, borrador,
                         propiedad, propietario_id, modelo, talla, stock_propuesto, propuesto_por)
  values (v_sku, v_ean, v_ref, v_nombre, coalesce(nullif(p->>'categoria', ''), 'aparamenta'), v_unidad,
          case when v_unidad in ('m', 'ud') then 1 else v_contenido end, 1, 0, false, coalesce(trim(p->>'proveedor'), ''), false, true,
          case when custodia then 'custodia' else 'propia' end, case when custodia then p->>'propietario_id' end,
          nullif(trim(coalesce(p->>'modelo', '')), ''), nullif(trim(coalesce(p->>'talla', '')), ''), v_stock, u.nombre);
  return jsonb_build_object('estado', 'aplicado', 'sku', v_sku);
end $$;

-- guardar_producto: al completar un BORRADOR también entra su stock inicial ("Alta de artículo"): el que envíe el administrador
-- o, si no envía ninguno, el que propuso el almacén
create or replace function public.guardar_producto(p_producto jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p perfiles := exigir_admin();
  v_sku text := upper(trim(p_producto->>'sku'));
  existe boolean;
  era_borrador boolean := false;
  propuesto numeric;
  inicial numeric := nullif(p_producto->>'stock_inicial', '')::numeric;
  custodia boolean := coalesce(p_producto->>'propiedad', 'propia') = 'custodia';
begin
  if coalesce(v_sku, '') = '' then raise exception 'El SKU es obligatorio'; end if;
  select true, borrador, stock_propuesto into existe, era_borrador, propuesto from productos where sku = v_sku;
  if coalesce(existe, false) and coalesce((p_producto->>'nuevo')::boolean, false) then raise exception 'Ya existe una referencia con el SKU %', v_sku; end if;
  if custodia and nullif(p_producto->>'propietario_id', '') is null then raise exception 'Indica de quién es el material en custodia'; end if;
  insert into productos (sku, ean, ref_proveedor, nombre, categoria, unidad, contenido, formato, formato_texto, minimo, minimo_definido, objetivo, proveedor, proveedor_habitual,
                         con_serie, borrador, propiedad, propietario_id, modelo, talla)
  values (v_sku, nullif(trim(p_producto->>'ean'), ''), nullif(trim(p_producto->>'ref_proveedor'), ''), trim(p_producto->>'nombre'),
          p_producto->>'categoria', coalesce(p_producto->>'unidad', 'ud'), coalesce(nullif(p_producto->>'contenido', '')::numeric, 1), 1, coalesce(p_producto->>'formato_texto', ''),
          coalesce(nullif(p_producto->>'minimo', '')::numeric, 0), nullif(p_producto->>'minimo', '') is not null, nullif(p_producto->>'objetivo', '')::numeric,
          coalesce(p_producto->>'proveedor', ''), nullif(trim(p_producto->>'proveedor_habitual'), ''),
          false, false, case when custodia then 'custodia' else 'propia' end, case when custodia then p_producto->>'propietario_id' end,
          nullif(trim(p_producto->>'modelo'), ''), nullif(trim(p_producto->>'talla'), ''))
  on conflict (sku) do update set ean = excluded.ean, ref_proveedor = excluded.ref_proveedor, nombre = excluded.nombre,
    categoria = excluded.categoria, unidad = excluded.unidad, contenido = excluded.contenido, formato_texto = excluded.formato_texto,
    minimo = excluded.minimo, minimo_definido = excluded.minimo_definido, objetivo = excluded.objetivo, proveedor = excluded.proveedor,
    proveedor_habitual = excluded.proveedor_habitual, borrador = false, stock_propuesto = null,
    propiedad = excluded.propiedad, propietario_id = excluded.propietario_id, modelo = excluded.modelo, talla = excluded.talla, actualizado = now();
  if not coalesce(existe, false) or coalesce(era_borrador, false) then
    inicial := coalesce(inicial, case when era_borrador then propuesto end, 0);
    if inicial > 0 then
      perform _aplicar_movimiento(p, gen_random_uuid(), v_sku, 'entrada', inicial, 'Alta de artículo',
                                  case when era_borrador then 'Borrador aprobado' else 'Stock inicial' end, '{}', null, null, null, null);
    end if;
  end if;
  return jsonb_build_object('estado', 'aplicado', 'sku', v_sku);
end $$;

revoke execute on function public.crear_borrador_articulo(jsonb) from public, anon;
grant execute on function public.crear_borrador_articulo(jsonb) to authenticated;
