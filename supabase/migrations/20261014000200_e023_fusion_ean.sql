-- =====================================================================================================
-- E-023 (Code) · Fusionar pasa también el EAN del artículo que se archiva
-- Antes el archivado se quedaba su EAN y, como es único, nadie más podía usarlo (ni el artículo en el que se fusionó).
-- Ahora el EAN pasa al destino si no tiene EAN; si ya tiene otro, queda como código alternativo del destino (E-020).
-- Reparación: los archivados que aún tengan EAN lo ceden igual al artículo en el que se fusionaron.
-- =====================================================================================================
create or replace function public.fusionar_productos(p_origen text, p_destino text, p_motivo text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); a productos; b productos; qb numeric; ida uuid; v record;
begin
  select * into a from productos where sku = upper(p_origen) for update;
  if not found then raise exception 'Artículo no encontrado: %', p_origen; end if;
  select * into b from productos where sku = upper(p_destino) for update;
  if not found then raise exception 'Artículo no encontrado: %', p_destino; end if;
  if a.sku = b.sku then raise exception 'Elige dos artículos distintos'; end if;
  if a.archivado or b.archivado then raise exception 'Uno de los artículos ya está archivado'; end if;
  if b.borrador then raise exception '% está en borrador: apruébalo antes de fusionar en él', b.sku; end if;
  if reservado(a.sku, null) > 0 then raise exception '% tiene entregas preparadas: fírmalas o anúlalas antes de fusionar', a.nombre; end if;
  -- almacén: la cantidad se convierte por el contenido de cada formato (3 botes de 1000 = 3000 ud)
  qb := round(a.stock * a.contenido / b.contenido, 3);
  if b.unidad not in ('m') and qb <> trunc(qb) then raise exception 'No cuadra el formato: % % de % serían % % de %', a.stock, a.unidad, a.nombre, qb, b.unidad, b.nombre; end if;
  if a.stock <> 0 then
    ida := gen_random_uuid();
    perform _aplicar_movimiento(p, ida, a.sku, 'ajuste', -a.stock, 'Fusión en ' || b.sku, coalesce(nullif(trim(p_motivo), ''), 'Fusión de artículos'), '{}', null, null, null, null);
    perform _aplicar_movimiento(p, gen_random_uuid(), b.sku, 'ajuste', qb, 'Fusión desde ' || a.sku, coalesce(nullif(trim(p_motivo), ''), 'Fusión de artículos'), '{}', null, null, null, ida);
  end if;
  -- vehículos: las unidades de contenido pasan tal cual
  for v in select * from stock_vehiculo where sku = a.sku and unidades <> 0 loop
    ida := gen_random_uuid();
    insert into movimientos (id, sku, tipo, cantidad, motivo, referencia, series, vehiculo_id, unidades, usuario, operario)
    values (ida, a.sku, 'ajuste', round(-v.unidades / a.contenido, 3), 'Fusión en ' || b.sku, 'Vehículo', '{}', v.vehiculo_id, -v.unidades, p.id, p.nombre);
    insert into movimientos (id, sku, tipo, cantidad, motivo, referencia, series, vehiculo_id, unidades, usuario, operario, corrige)
    values (gen_random_uuid(), b.sku, 'ajuste', round(v.unidades / b.contenido, 3), 'Fusión desde ' || a.sku, 'Vehículo', '{}', v.vehiculo_id, v.unidades, p.id, p.nombre, ida);
    update stock_vehiculo set unidades = 0 where vehiculo_id = v.vehiculo_id and sku = a.sku;
    insert into stock_vehiculo (vehiculo_id, sku, unidades) values (v.vehiculo_id, b.sku, v.unidades)
      on conflict (vehiculo_id, sku) do update set unidades = stock_vehiculo.unidades + excluded.unidades;
  end loop;
  update productos set foto = coalesce(b.foto, a.foto), foto_mini = coalesce(b.foto_mini, a.foto_mini), foto_origen = coalesce(b.foto_origen, a.foto_origen) where sku = b.sku and b.foto is null;
  -- E-023: el EAN del que se archiva no puede quedarse bloqueado (es único): pasa al destino si no tiene; si tiene otro,
  -- queda como código alternativo del destino (escanear la caja vieja sigue abriendo el artículo)
  if a.ean is not null then
    update productos set ean = null where sku = a.sku;
    if b.ean is null then update productos set ean = a.ean where sku = b.sku;
    elsif a.ean <> b.ean and not exists (select 1 from codigos_articulo where upper(codigo) = upper(a.ean)) and not exists (select 1 from productos where sku = upper(a.ean)) then
      insert into codigos_articulo (codigo, sku, tipo, usuario, operario) values (a.ean, b.sku, 'EAN', p.id, p.nombre);
    end if;
  end if;
  update productos set archivado = true, fusionado_en = b.sku, actualizado = now() where sku = a.sku;
  update avisos_reposicion set estado = 'cerrado' where sku = a.sku and estado <> 'cerrado';
  insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'fusionar_productos', jsonb_build_object('origen', a.sku, 'destino', b.sku, 'stock', a.stock, 'convertido', qb, 'motivo', p_motivo));
  return jsonb_build_object('estado', 'aplicado', 'origen', a.sku, 'destino', b.sku, 'cantidad', qb);
end $$;

do $$
declare a record; b productos;
begin
  for a in select * from productos where archivado and ean is not null and fusionado_en is not null loop
    select * into b from productos where sku = a.fusionado_en;
    update productos set ean = null where sku = a.sku;
    if b.ean is null then update productos set ean = a.ean where sku = b.sku;
    elsif a.ean <> b.ean and not exists (select 1 from codigos_articulo where upper(codigo) = upper(a.ean)) then
      insert into codigos_articulo (codigo, sku, tipo, operario) values (a.ean, b.sku, 'EAN', 'Migración E-023');
    end if;
  end loop;
end $$;
