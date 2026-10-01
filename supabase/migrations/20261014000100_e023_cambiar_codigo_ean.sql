-- =====================================================================================================
-- E-023 · Cambiar el código de un artículo que tiene EAN (arreglo urgente escrito por el chat)
-- Fallo real del usuario (01/10): TRY32-1-L10-P → 8900500020 daba
--   duplicate key value violates unique constraint "productos_ean_key"
-- porque cambiar_codigo_producto copiaba el EAN a la ficha nueva (reactivada o insertada) y solo DESPUÉS
-- lo quitaba de la antigua. Ahora se mueve primero. Las pruebas existentes usaban artículos sin EAN.
-- =====================================================================================================
create or replace function public.cambiar_codigo_producto(p_sku text, p_nuevo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); a productos; v_nuevo text := upper(trim(coalesce(p_nuevo, ''))); otro productos; v_ean text;
begin
  select * into a from productos where sku = upper(p_sku);
  if not found then raise exception 'Artículo no encontrado: %', p_sku; end if;
  if a.archivado then raise exception '% está archivado: restáuralo antes de cambiarle el código', a.sku; end if;
  if v_nuevo = '' then raise exception 'Indica el código nuevo'; end if;
  if v_nuevo = a.sku then return jsonb_build_object('estado', 'duplicado', 'sku', v_nuevo); end if;
  select * into otro from productos where sku = v_nuevo;
  if found and not otro.archivado then raise exception 'Ya existe un artículo activo con el código %: % (ábrelo o fusiona en él)', v_nuevo, otro.nombre using errcode = '23505'; end if;
  delete from codigos_articulo where upper(codigo) = v_nuevo and sku = a.sku;
  -- E-023: el EAN es único; se quita de la ficha antigua ANTES de ponerlo en la nueva (si no, choca "productos_ean_key")
  v_ean := a.ean;
  update productos set ean = null where sku = a.sku and ean is not null;
  -- si el archivado que se reactiva tiene un EAN propio distinto, se libera también
  if v_ean is not null then update productos set ean = null where ean = v_ean and sku <> a.sku; end if;
  if otro.sku is not null then
    perform _reactivar_archivado(p, v_nuevo);
    update productos n set ean = v_ean, ref_proveedor = a.ref_proveedor, nombre = a.nombre, categoria = a.categoria, unidad = a.unidad, contenido = a.contenido,
      formato = a.formato, formato_texto = a.formato_texto, minimo = a.minimo, minimo_definido = a.minimo_definido, objetivo = a.objetivo, proveedor = a.proveedor,
      proveedor_habitual = a.proveedor_habitual, borrador = a.borrador, propiedad = a.propiedad, propietario_id = a.propietario_id, modelo = a.modelo, talla = a.talla,
      notas = a.notas, foto = coalesce(a.foto, n.foto), foto_mini = coalesce(a.foto_mini, n.foto_mini), foto_origen = coalesce(a.foto_origen, n.foto_origen), actualizado = now()
    where n.sku = v_nuevo;
  else
    insert into productos (sku, ean, ref_proveedor, nombre, categoria, unidad, contenido, formato, formato_texto, minimo, minimo_definido, objetivo, proveedor, proveedor_habitual,
                           con_serie, borrador, propiedad, propietario_id, modelo, talla, notas, foto, foto_mini, foto_origen)
    select v_nuevo, v_ean, ref_proveedor, nombre, categoria, unidad, contenido, formato, formato_texto, minimo, minimo_definido, objetivo, proveedor, proveedor_habitual,
           false, borrador, propiedad, propietario_id, modelo, talla, notas, foto, foto_mini, foto_origen from productos where sku = a.sku;
  end if;
  perform fusionar_productos(a.sku, v_nuevo, 'Cambio de código ' || a.sku || ' → ' || v_nuevo);
  return jsonb_build_object('estado', 'aplicado', 'sku', v_nuevo);
end $$;

-- Mensaje claro cuando un EAN ya lo tiene otro artículo (en vez del texto técnico de Postgres)
create or replace function public._ean_unico() returns trigger language plpgsql security definer set search_path = public as $$
declare otro productos;
begin
  if new.ean is not null and (tg_op = 'INSERT' or new.ean is distinct from old.ean) then
    select * into otro from productos where ean = new.ean and sku <> new.sku limit 1;
    if found then
      raise exception 'El EAN % ya lo tiene el artículo % (%)%', new.ean, otro.sku, otro.nombre,
        case when otro.archivado then ' que está archivado: restáuralo o quítale el EAN en Configuración → Archivados' else ': quítaselo allí o fusiona los dos artículos' end
        using errcode = '23505';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists productos_ean_unico on public.productos;
create trigger productos_ean_unico before insert or update of ean on public.productos for each row execute function public._ean_unico();
revoke execute on function public._ean_unico() from public, anon, authenticated;
