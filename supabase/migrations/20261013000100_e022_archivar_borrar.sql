-- =====================================================================================================
-- E-022 · Borrar, archivar, restaurar y deshacer fusiones; los archivados no bloquean su código
-- - Rastro de una referencia (movimientos, pendientes, entregas, cierres, avisos, códigos, foto, reservas, plantillas, vehículos,
--   propuestas, artículos fusionados en ella): con rastro no se borra definitivamente; se ARCHIVA (con stock 0).
-- - Decisión: el SKU de un archivado NO se renombra (<SKU>~A1): 12 tablas de historial inalterables y las huellas de las entregas
--   apuntan a ese código. En su lugar, al dar de alta, importar o cambiar el código a uno archivado, ESE artículo se reactiva
--   (su stock es 0) con la ficha nueva; su historial antiguo sigue con su código.
-- - Archivados: quién y cuándo; restaurar, deshacer fusión y borrar definitivamente (solo sin rastro).
-- =====================================================================================================
alter table public.productos add column archivado_ts timestamptz, add column archivado_por text;
update public.productos set archivado_ts = actualizado where archivado and archivado_ts is null;

create or replace function public._marcar_archivado() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.archivado and not old.archivado then
    new.archivado_ts := now(); new.archivado_por := coalesce((select nombre from perfiles where id = auth.uid()), '');
  elsif old.archivado and not new.archivado then
    new.archivado_ts := null; new.archivado_por := null;
  end if;
  return new;
end $$;
create trigger productos_marcar_archivado before update of archivado on public.productos for each row execute function public._marcar_archivado();

-- Lo que retiene una referencia (conteos y texto en lenguaje normal)
create or replace function public._rastro_producto(p_sku text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s text := upper(p_sku); c jsonb; partes text[] := '{}'; k text; n int; t text;
  orden constant text[] := array['movimientos', 'pendientes', 'entregas', 'cierres', 'avisos', 'codigos', 'foto', 'reservas', 'plantillas', 'vehiculos', 'propuestas', 'fusionados'];
  nombres constant jsonb := '{"movimientos": ["movimiento", "movimientos"], "pendientes": ["pendiente en tu bandeja", "pendientes en tu bandeja"],
    "entregas": ["línea de entrega", "líneas de entregas"], "cierres": ["consumo de cierres", "consumos de cierres"], "avisos": ["aviso de reposición", "avisos de reposición"],
    "codigos": ["código alternativo", "códigos alternativos"], "foto": ["foto", "fotos"], "reservas": ["reserva", "reservas"], "plantillas": ["plantilla de entrega", "plantillas de entrega"],
    "vehiculos": ["vehículo con material", "vehículos con material"], "propuestas": ["propuesta de cambio", "propuestas de cambio"], "fusionados": ["artículo fusionado en ella", "artículos fusionados en ella"]}';
begin
  c := jsonb_build_object(
    'movimientos', (select count(*) from movimientos where sku = s), 'pendientes', (select count(*) from pendientes where sku = s),
    'entregas', (select count(*) from entrega_lineas where sku = s), 'cierres', (select count(*) from cierre_lineas where sku = s),
    'avisos', (select count(*) from avisos_reposicion where sku = s), 'codigos', (select count(*) from codigos_articulo where sku = s),
    'foto', (select count(*) from productos where sku = s and foto is not null), 'reservas', (select count(*) from reservas where sku = s),
    'plantillas', (select count(*) from plantilla_lineas where sku = s), 'vehiculos', (select count(*) from stock_vehiculo where sku = s and unidades <> 0),
    'propuestas', (select count(*) from propuestas_ficha where sku = s), 'fusionados', (select count(*) from productos where fusionado_en = s));
  foreach k in array orden loop
    n := (c->>k)::int;
    if n > 0 then
      t := case when k = 'foto' then 'foto' else n || ' ' || (nombres->k->>(case when n = 1 then 0 else 1 end)) end;
      partes := partes || t;
    end if;
  end loop;
  return jsonb_build_object('conteos', c, 'borrable', coalesce(array_length(partes, 1), 0) = 0,
    'texto', case when coalesce(array_length(partes, 1), 0) = 0 then ''
                  when array_length(partes, 1) = 1 then 'Tiene ' || partes[1]
                  else 'Tiene ' || array_to_string(partes[1:array_length(partes, 1) - 1], ', ') || ' y ' || partes[array_length(partes, 1)] end);
end $$;

create or replace function public.rastro_producto(p_sku text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin perform exigir_admin(); return _rastro_producto(p_sku); end $$;

-- Reactiva un archivado para reutilizar su código (solo con stock 0, en el almacén y en los vehículos)
create or replace function public._reactivar_archivado(p public.perfiles, p_sku text) returns void
language plpgsql security definer set search_path = public as $$
declare a productos;
begin
  select * into a from productos where sku = upper(p_sku) for update;
  if not found or not a.archivado then return; end if;
  if a.stock <> 0 or exists (select 1 from stock_vehiculo where sku = a.sku and unidades <> 0) then
    raise exception '% está archivado con stock: restáuralo desde Configuración → Archivados', a.sku;
  end if;
  update productos set archivado = false, fusionado_en = null, actualizado = now() where sku = a.sku;
  insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'reactivar_archivado', jsonb_build_object('sku', a.sku, 'estaba_fusionado_en', a.fusionado_en));
end $$;

create or replace function public.borrar_producto(p_sku text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); a productos; r jsonb;
begin
  select * into a from productos where sku = upper(p_sku) for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  r := _rastro_producto(a.sku);
  if not (r->>'borrable')::boolean then
    raise exception 'No se puede borrar definitivamente: %. Archívala: deja de salir en listas, buscador, escáner y entregas, y el historial se conserva.', r->>'texto';
  end if;
  if a.stock <> 0 then raise exception 'Solo se puede borrar una referencia sin stock'; end if;
  delete from stock_vehiculo where sku = a.sku;
  delete from productos where sku = a.sku;
  insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'borrar_producto', jsonb_build_object('sku', a.sku, 'nombre', a.nombre));
  return jsonb_build_object('estado', 'aplicado');
end $$;

create or replace function public.archivar_producto(p_sku text, p_motivo text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); a productos;
begin
  select * into a from productos where sku = upper(p_sku) for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  if a.archivado then return jsonb_build_object('estado', 'duplicado'); end if;
  if a.stock <> 0 then raise exception '% tiene % % en el almacén: haz antes un ajuste de inventario o fusiónala en otro artículo', a.nombre, _fmt(a.stock), a.unidad; end if;
  if exists (select 1 from stock_vehiculo where sku = a.sku and unidades <> 0) then raise exception '% tiene material en vehículos: devuélvelo o ajústalo antes de archivar', a.nombre; end if;
  if reservado(a.sku, null) > 0 then raise exception '% tiene entregas preparadas: fírmalas o anúlalas antes de archivar', a.nombre; end if;
  update productos set archivado = true, fusionado_en = null, actualizado = now() where sku = a.sku;
  update avisos_reposicion set estado = 'cerrado' where sku = a.sku and estado <> 'cerrado';
  insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'archivar_producto', jsonb_build_object('sku', a.sku, 'motivo', coalesce(p_motivo, '')));
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- Restaurar: vuelve a estar activo con su código (que nunca deja de ser suyo). Si estaba fusionado, vuelve con stock 0.
create or replace function public.restaurar_producto(p_sku text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); a productos;
begin
  select * into a from productos where sku = upper(p_sku) for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  if not a.archivado then return jsonb_build_object('estado', 'duplicado'); end if;
  update productos set archivado = false, fusionado_en = null, actualizado = now() where sku = a.sku;
  insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'restaurar_producto', jsonb_build_object('sku', a.sku, 'estaba_fusionado_en', a.fusionado_en));
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- Deshacer una fusión: revierte los ajustes enlazados de ESA fusión (misma transacción que el archivado) si el destino aún tiene lo que recibió
create or replace function public.deshacer_fusion(p_sku text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); a productos; b productos; m record; abordo numeric;
begin
  select * into a from productos where sku = upper(p_sku) for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  if not a.archivado or a.fusionado_en is null then raise exception '% no está fusionado en otro artículo', a.sku; end if;
  select * into b from productos where sku = a.fusionado_en for update;
  if b.archivado then raise exception 'El artículo en el que se fusionó (%) también está archivado: deshaz antes esa fusión', b.sku; end if;
  for m in select mb.cantidad qb, mb.unidades ub, mb.vehiculo_id from movimientos ma join movimientos mb on mb.corrige = ma.id
           where ma.sku = a.sku and mb.sku = b.sku and ma.motivo = 'Fusión en ' || b.sku and ma.ts = a.archivado_ts loop
    if m.vehiculo_id is null and b.stock < m.qb then
      raise exception 'No se puede deshacer: % ya no tiene las % % que recibió en la fusión (tiene %). Haz antes un ajuste de inventario.', b.nombre, _fmt(m.qb), b.unidad, _fmt(b.stock);
    end if;
    if m.vehiculo_id is not null then
      select unidades into abordo from stock_vehiculo where vehiculo_id = m.vehiculo_id and sku = b.sku;
      if coalesce(abordo, 0) < m.ub then raise exception 'No se puede deshacer: el vehículo ya no lleva lo que recibió % en la fusión', b.nombre; end if;
    end if;
  end loop;
  update productos set archivado = false, fusionado_en = null, actualizado = now() where sku = a.sku;
  for m in select ma.cantidad qa, mb.cantidad qb, mb.vehiculo_id from movimientos ma join movimientos mb on mb.corrige = ma.id
           where ma.sku = a.sku and mb.sku = b.sku and ma.motivo = 'Fusión en ' || b.sku and ma.ts = a.archivado_ts loop
    if m.vehiculo_id is null then
      perform _aplicar_movimiento(p, gen_random_uuid(), b.sku, 'ajuste', -m.qb, 'Deshacer fusión de ' || a.sku, 'Fusión deshecha', '{}', null, null, null, null);
      perform _aplicar_movimiento(p, gen_random_uuid(), a.sku, 'ajuste', -m.qa, 'Deshacer fusión en ' || b.sku, 'Fusión deshecha', '{}', null, null, null, null);
    else
      perform _mover_vehiculo(p, gen_random_uuid(), b.sku, 'ajuste', m.vehiculo_id, -m.qb, 'Deshacer fusión de ' || a.sku, 'Fusión deshecha', null);
      perform _mover_vehiculo(p, gen_random_uuid(), a.sku, 'ajuste', m.vehiculo_id, -m.qa, 'Deshacer fusión en ' || b.sku, 'Fusión deshecha', null);
    end if;
  end loop;
  insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'deshacer_fusion', jsonb_build_object('origen', a.sku, 'destino', b.sku));
  return jsonb_build_object('estado', 'aplicado', 'destino', b.sku);
end $$;

-- Alta: el código de un archivado se reutiliza (reactivándolo)
create or replace function public.guardar_producto(p_producto jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p perfiles := exigir_admin();
  v_sku text := upper(trim(p_producto->>'sku'));
  antes productos; existe boolean := false; era_borrador boolean := false;
  inicial numeric := nullif(p_producto->>'stock_inicial', '')::numeric;
  custodia boolean := coalesce(p_producto->>'propiedad', 'propia') = 'custodia';
  despues productos; cambios jsonb := '{}'; campo text;
begin
  if coalesce(v_sku, '') = '' then raise exception 'El SKU es obligatorio'; end if;
  select * into antes from productos where sku = v_sku;
  existe := found;
  -- E-022: un archivado no bloquea su código: se reactiva con la ficha nueva (su stock es 0) y se trata como un alta
  if existe and antes.archivado then perform _reactivar_archivado(p, v_sku); existe := false; end if;
  era_borrador := existe and antes.borrador;
  if existe and coalesce((p_producto->>'nuevo')::boolean, false) then raise exception 'Ya existe una referencia con el SKU %', v_sku; end if;
  if custodia and nullif(p_producto->>'propietario_id', '') is null then raise exception 'Indica de quién es el material en custodia'; end if;
  if not exists (select 1 from categorias where id = p_producto->>'categoria') then raise exception 'Categoría desconocida: %', p_producto->>'categoria'; end if;
  insert into productos (sku, ean, ref_proveedor, nombre, categoria, unidad, contenido, formato, formato_texto, minimo, minimo_definido, objetivo, proveedor, proveedor_habitual,
                         con_serie, borrador, propiedad, propietario_id, modelo, talla, notas)
  values (v_sku, nullif(trim(p_producto->>'ean'), ''), nullif(trim(p_producto->>'ref_proveedor'), ''), trim(p_producto->>'nombre'),
          p_producto->>'categoria', coalesce(p_producto->>'unidad', 'ud'), coalesce(nullif(p_producto->>'contenido', '')::numeric, 1), 1, coalesce(p_producto->>'formato_texto', ''),
          coalesce(nullif(p_producto->>'minimo', '')::numeric, 0), nullif(p_producto->>'minimo', '') is not null, nullif(p_producto->>'objetivo', '')::numeric,
          coalesce(p_producto->>'proveedor', ''), nullif(trim(p_producto->>'proveedor_habitual'), ''),
          false, false, case when custodia then 'custodia' else 'propia' end, case when custodia then p_producto->>'propietario_id' end,
          nullif(trim(p_producto->>'modelo'), ''), nullif(trim(p_producto->>'talla'), ''), coalesce(p_producto->>'notas', ''))
  on conflict (sku) do update set ean = excluded.ean, ref_proveedor = excluded.ref_proveedor, nombre = excluded.nombre,
    categoria = excluded.categoria, unidad = excluded.unidad, contenido = excluded.contenido, formato_texto = excluded.formato_texto,
    minimo = excluded.minimo, minimo_definido = excluded.minimo_definido, objetivo = excluded.objetivo, proveedor = excluded.proveedor,
    proveedor_habitual = excluded.proveedor_habitual, borrador = false, stock_propuesto = null,
    propiedad = excluded.propiedad, propietario_id = excluded.propietario_id, modelo = excluded.modelo, talla = excluded.talla, notas = excluded.notas, actualizado = now()
  returning * into despues;
  if not existe or era_borrador then
    inicial := coalesce(inicial, case when era_borrador then antes.stock_propuesto end, 0);
    if inicial > 0 then
      perform _aplicar_movimiento(p, gen_random_uuid(), v_sku, 'entrada', inicial, 'Alta de artículo',
                                  case when era_borrador then 'Borrador aprobado' else 'Stock inicial' end, '{}', null, null, null, null);
    end if;
  end if;
  -- auditoría: valor anterior y nuevo de cada campo cambiado
  if existe then
    foreach campo in array array['nombre', 'ean', 'ref_proveedor', 'categoria', 'unidad', 'contenido', 'formato_texto', 'minimo', 'objetivo', 'proveedor', 'proveedor_habitual',
                                 'propiedad', 'propietario_id', 'modelo', 'talla', 'notas'] loop
      if (to_jsonb(antes)->campo) is distinct from (to_jsonb(despues)->campo) then
        cambios := cambios || jsonb_build_object(campo, jsonb_build_object('antes', to_jsonb(antes)->campo, 'despues', to_jsonb(despues)->campo));
      end if;
    end loop;
  end if;
  insert into auditoria (usuario, operario, accion, detalle)
  values (p.id, p.nombre, case when not existe then 'alta_producto' when era_borrador then 'aprobar_borrador' else 'editar_producto' end, jsonb_build_object('sku', v_sku, 'cambios', cambios));
  return jsonb_build_object('estado', 'aplicado', 'sku', v_sku);
end $$;

-- Importación: igual
create or replace function public.importar_catalogo(p_filas jsonb, p_actualizar boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); f jsonb; v_sku text; prop text; nuevos int := 0; existentes int := 0; actualizados int := 0; aperturas int := 0; ref text; inicial numeric; un text; cat text; cont numeric;
begin
  for f in select * from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) loop
    v_sku := upper(trim(f->>'sku'));
    if coalesce(v_sku, '') = '' then raise exception 'Hay una fila sin SKU'; end if;
    un := lower(coalesce(nullif(trim(f->>'unidad'), ''), 'ud'));
    if un not in ('m', 'ud', 'bote', 'sobre', 'bolsa', 'pack', 'caja') then raise exception 'Unidad desconocida en %: %', v_sku, un; end if;
    cat := lower(trim(coalesce(f->>'categoria', '')));
    if not exists (select 1 from categorias where id = cat and activa) then raise exception 'Categoría desconocida en %: %', v_sku, cat; end if;
    cont := case when un in ('m', 'ud') then 1 else coalesce(nullif(f->>'contenido', '')::numeric, 1) end;
    prop := null;
    if coalesce(f->>'propiedad', 'propia') = 'custodia' then
      select id into prop from propietarios where upper(id) = upper(trim(f->>'propietario')) or lower(nombre) = lower(trim(f->>'propietario'));
      if prop is null then raise exception 'Propietario desconocido en %: %', v_sku, f->>'propietario'; end if;
    end if;
    -- E-022: el código de un archivado se reutiliza: se reactiva con los datos de la fila
    if exists (select 1 from productos where sku = v_sku and archivado) then
      perform _reactivar_archivado(p, v_sku);
      update productos set ref_proveedor = nullif(trim(f->>'ref_proveedor'), ''), nombre = trim(f->>'nombre'), categoria = cat, unidad = un, contenido = cont,
        minimo = coalesce(nullif(f->>'minimo', '')::numeric, 0), minimo_definido = nullif(f->>'minimo', '') is not null, proveedor = coalesce(f->>'proveedor', ''),
        propiedad = case when prop is null then 'propia' else 'custodia' end, propietario_id = prop, actualizado = now()
      where sku = v_sku;
      nuevos := nuevos + 1;
    elsif exists (select 1 from productos where sku = v_sku) then
      existentes := existentes + 1;
      if p_actualizar then
        update productos set nombre = trim(f->>'nombre'), categoria = cat, proveedor = coalesce(f->>'proveedor', proveedor), unidad = un, contenido = cont,
          ref_proveedor = coalesce(nullif(trim(f->>'ref_proveedor'), ''), ref_proveedor), actualizado = now()
        where sku = v_sku and (nombre, categoria, proveedor, unidad, contenido) is distinct from (trim(f->>'nombre'), cat, coalesce(f->>'proveedor', proveedor), un, cont);
        if found then actualizados := actualizados + 1; end if;
      end if;
    else
      insert into productos (sku, ref_proveedor, nombre, categoria, unidad, contenido, minimo, minimo_definido, proveedor, propiedad, propietario_id, con_serie, borrador)
      values (v_sku, nullif(trim(f->>'ref_proveedor'), ''), trim(f->>'nombre'), cat, un, cont,
              coalesce(nullif(f->>'minimo', '')::numeric, 0), nullif(f->>'minimo', '') is not null, coalesce(f->>'proveedor', ''),
              case when prop is null then 'propia' else 'custodia' end, prop, false, false);
      nuevos := nuevos + 1;
    end if;
    inicial := coalesce(nullif(f->>'stock_inicial', '')::numeric, 0);
    ref := 'Albaranes ' || coalesce(nullif(trim(f->>'albaranes'), ''), 'sin albarán');
    -- el inventario de apertura solo entra en artículos sin stock ni movimientos (los existentes ya tienen su stock)
    if inicial > 0 and not exists (select 1 from movimientos where sku = v_sku and (motivo = 'Inventario de apertura' and referencia = ref))
       and (select count(*) from movimientos where sku = v_sku) = 0 and (select stock from productos where sku = v_sku) = 0 then
      perform _aplicar_movimiento(p, gen_random_uuid(), v_sku, 'entrada', inicial, 'Inventario de apertura', ref, '{}', null, null, null, null);
      aperturas := aperturas + 1;
    end if;
  end loop;
  insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'importar_catalogo',
    jsonb_build_object('nuevos', nuevos, 'existentes', existentes, 'actualizados', actualizados, 'aperturas', aperturas, 'actualizar', p_actualizar));
  return jsonb_build_object('estado', 'aplicado', 'nuevos', nuevos, 'existentes', existentes, 'actualizados', actualizados, 'aperturas', aperturas);
end $$;

-- Cambiar el código: si el código nuevo es de un ARCHIVADO, ese artículo se reactiva con esta ficha y se fusiona en él
create or replace function public.cambiar_codigo_producto(p_sku text, p_nuevo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); a productos; v_nuevo text := upper(trim(coalesce(p_nuevo, ''))); otro productos;
begin
  select * into a from productos where sku = upper(p_sku);
  if not found then raise exception 'Artículo no encontrado: %', p_sku; end if;
  if a.archivado then raise exception '% está archivado: restáuralo antes de cambiarle el código', a.sku; end if;
  if v_nuevo = '' then raise exception 'Indica el código nuevo'; end if;
  if v_nuevo = a.sku then return jsonb_build_object('estado', 'duplicado', 'sku', v_nuevo); end if;
  select * into otro from productos where sku = v_nuevo;
  if found and not otro.archivado then raise exception 'Ya existe un artículo activo con el código %: % (ábrelo o fusiona en él)', v_nuevo, otro.nombre using errcode = '23505'; end if;
  delete from codigos_articulo where upper(codigo) = v_nuevo and sku = a.sku;
  if otro.sku is not null then
    perform _reactivar_archivado(p, v_nuevo);
    update productos n set ean = a.ean, ref_proveedor = a.ref_proveedor, nombre = a.nombre, categoria = a.categoria, unidad = a.unidad, contenido = a.contenido,
      formato = a.formato, formato_texto = a.formato_texto, minimo = a.minimo, minimo_definido = a.minimo_definido, objetivo = a.objetivo, proveedor = a.proveedor,
      proveedor_habitual = a.proveedor_habitual, borrador = a.borrador, propiedad = a.propiedad, propietario_id = a.propietario_id, modelo = a.modelo, talla = a.talla,
      notas = a.notas, foto = coalesce(a.foto, n.foto), foto_mini = coalesce(a.foto_mini, n.foto_mini), foto_origen = coalesce(a.foto_origen, n.foto_origen), actualizado = now()
    where n.sku = v_nuevo;
  else
    insert into productos (sku, ean, ref_proveedor, nombre, categoria, unidad, contenido, formato, formato_texto, minimo, minimo_definido, objetivo, proveedor, proveedor_habitual,
                           con_serie, borrador, propiedad, propietario_id, modelo, talla, notas, foto, foto_mini, foto_origen)
    select v_nuevo, ean, ref_proveedor, nombre, categoria, unidad, contenido, formato, formato_texto, minimo, minimo_definido, objetivo, proveedor, proveedor_habitual,
           false, borrador, propiedad, propietario_id, modelo, talla, notas, foto, foto_mini, foto_origen from productos where sku = a.sku;
  end if;
  update productos set ean = null where sku = a.sku;          -- el EAN pasa a la ficha con el código nuevo
  perform fusionar_productos(a.sku, v_nuevo, 'Cambio de código ' || a.sku || ' → ' || v_nuevo);
  return jsonb_build_object('estado', 'aplicado', 'sku', v_nuevo);
end $$;

revoke execute on function public._marcar_archivado(), public._rastro_producto(text), public._reactivar_archivado(perfiles, text) from public, anon, authenticated;
revoke execute on function public.rastro_producto(text), public.archivar_producto(text, text), public.restaurar_producto(text), public.deshacer_fusion(text) from public, anon;
grant execute on function public.rastro_producto(text), public.archivar_producto(text, text), public.restaurar_producto(text), public.deshacer_fusion(text) to authenticated;
