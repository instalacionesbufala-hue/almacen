-- =====================================================================================================
-- E-016 · Correcciones tras la primera carga real
-- 1. Categorías configurables (tabla) sin Fontanería; bolsas, cinta y bridas pasan a Consumibles.
-- 2. Proveedor normalizado: Saltoki único (la delegación, aparte); el cliente (Búfala) nunca es proveedor.
-- 3. Importar catálogo con "Actualizar fichas existentes" (sin tocar el stock).
-- 4. Reasignar una línea de un albarán ya ingresado (ajustes enlazados, sin borrar historial).
-- 5. Editar fichas con auditoría campo a campo, cambiar el código (SKU) y fusionar dos artículos (el historial no se toca).
-- 6. Propuestas de cambio de ficha del personal de almacén.
-- 7. Equivalencias: historial de versiones, borrar reglas en borrador y recalcular cierres.
-- =====================================================================================================

-- ---------- 1. Categorías ----------
create table public.categorias (
  id     text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  nombre text not null check (length(trim(nombre)) > 0),
  icono  text not null default 'category',
  color  text not null default 'gris',
  orden  int not null default 100,
  activa boolean not null default true
);
insert into public.categorias (id, nombre, icono, color, orden) values
  ('cargadores', 'Cargadores VE', 'ev_charger', 'azul', 10),
  ('cuadros', 'Cuadros de protecciones', 'electrical_services', 'violeta', 20),
  ('cables', 'Cables', 'cable', 'ambar', 30),
  ('tubos', 'Tubos y canalización', 'straighten', 'gris', 40),
  ('fijaciones', 'Fijaciones', 'hardware', 'pizarra', 50),
  ('aparamenta', 'Aparamenta', 'electric_bolt', 'verde', 60),
  ('consumibles', 'Consumibles', 'inventory_2', 'rosa', 70),
  ('epis', 'EPIs', 'health_and_safety', 'naranja', 80),
  ('ropa', 'Ropa de trabajo', 'apparel', 'marron', 90),
  ('herramientas', 'Herramientas', 'construction', 'cian', 100);

alter table public.productos drop constraint if exists productos_categoria_check;
-- Fontanería desaparece: la empresa es de instalaciones eléctricas y puntos de recarga (si quedara algún artículo, pasa a Fijaciones)
update public.productos set categoria = 'fijaciones' where categoria = 'fontaneria';
update public.productos set categoria = 'fijaciones' where categoria not in (select id from public.categorias);
update public.productos set categoria = 'consumibles', actualizado = now()
  where categoria <> 'consumibles' and nombre ~* '(bolsas? (de )?basura|cinta aislante|\mbridas?\M)';
alter table public.productos add constraint productos_categoria_fk foreign key (categoria) references public.categorias(id);

create or replace function public.guardar_categoria(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); v_id text := lower(trim(coalesce(p->>'id', '')));
begin
  if v_id !~ '^[a-z0-9_]{2,30}$' then raise exception 'Identificador no válido: letras minúsculas, números o _'; end if;
  if coalesce(trim(p->>'nombre'), '') = '' then raise exception 'Indica el nombre de la categoría'; end if;
  insert into categorias (id, nombre, icono, color, orden, activa)
  values (v_id, trim(p->>'nombre'), coalesce(nullif(p->>'icono', ''), 'category'), coalesce(nullif(p->>'color', ''), 'gris'), coalesce((p->>'orden')::int, 100), coalesce((p->>'activa')::boolean, true))
  on conflict (id) do update set nombre = excluded.nombre, icono = excluded.icono, color = excluded.color, orden = excluded.orden, activa = excluded.activa;
  return jsonb_build_object('estado', 'aplicado', 'id', v_id);
end $$;

-- Una categoría con artículos no se borra: se desactiva y sus artículos pasan a otra
create or replace function public.desactivar_categoria(p_id text, p_mover_a text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); n int;
begin
  select count(*) into n from productos where categoria = p_id and not archivado;
  if n > 0 then
    if p_mover_a is null or p_mover_a = p_id or not exists (select 1 from categorias where id = p_mover_a and activa) then
      raise exception 'La categoría tiene % artículos: elige otra categoría activa a la que moverlos', n;
    end if;
    update productos set categoria = p_mover_a, actualizado = now() where categoria = p_id;
  end if;
  update categorias set activa = false where id = p_id;
  insert into auditoria (usuario, operario, accion, detalle) values (u.id, u.nombre, 'desactivar_categoria', jsonb_build_object('categoria', p_id, 'movidos', n, 'a', p_mover_a));
  return jsonb_build_object('estado', 'aplicado', 'movidos', n);
end $$;

-- ---------- 2. Proveedor ----------
alter table public.albaranes add column delegacion text not null default '';
update public.productos set proveedor_habitual = coalesce(proveedor_habitual, proveedor), proveedor = 'Saltoki'
  where proveedor ~* '^\s*saltoki' and proveedor <> 'Saltoki';
update public.productos set proveedor = '' where proveedor ~* 'b[uú]fala';   -- el cliente no es proveedor (se corrige con "Actualizar fichas")

create or replace function public.aprobar_albaran(p_id uuid, p_cabecera jsonb, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := perfil_actual(); l jsonb; n int := 0; u numeric := 0;
begin
  if exists (select 1 from albaranes where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  insert into albaranes (id, numero, proveedor, delegacion, cif, fecha, confianza, modo, usuario, operario)
  values (p_id, coalesce(p_cabecera->>'numero', ''), coalesce(p_cabecera->>'proveedor', ''), coalesce(p_cabecera->>'delegacion', ''), coalesce(p_cabecera->>'cif', ''),
          coalesce(p_cabecera->>'fecha', ''), nullif(p_cabecera->>'confianza', '')::numeric, coalesce(p_cabecera->>'modo', 'sim'), p.id, p.nombre);
  for l in select * from jsonb_array_elements(p_lineas) loop
    perform _aplicar_movimiento(p, gen_random_uuid(), upper(l->>'sku'), 'entrada', (l->>'cantidad')::numeric, 'Compra a proveedor',
                                'Albarán ' || coalesce(p_cabecera->>'numero', ''), '{}', null, null, p_id, null);
    n := n + 1; u := u + (l->>'cantidad')::numeric;
  end loop;
  update albaranes set lineas = n, unidades = u where id = p_id;
  return jsonb_build_object('estado', 'aplicado', 'lineas', n);
end $$;

-- ---------- 5. Fichas: notas, archivado (fusión) y auditoría ----------
alter table public.productos
  add column notas text not null default '',
  add column archivado boolean not null default false,
  add column fusionado_en text references public.productos(sku);

-- Un artículo archivado (fusionado en otro) ya no se mueve: sus movimientos van al artículo que lo sustituye
create or replace function public._no_mover_archivados() returns trigger language plpgsql as $$
begin
  if exists (select 1 from productos where sku = new.sku and archivado) and new.motivo not like 'Fusión%' then
    raise exception '% está archivado (fusionado en %): usa ese artículo', new.sku, (select fusionado_en from productos where sku = new.sku);
  end if;
  return new;
end $$;
create trigger movimientos_no_archivados before insert on public.movimientos for each row execute function public._no_mover_archivados();

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
  era_borrador := existe and antes.borrador;
  if existe and coalesce((p_producto->>'nuevo')::boolean, false) then raise exception 'Ya existe una referencia con el SKU %', v_sku; end if;
  if existe and antes.archivado then raise exception '% está archivado (fusionado en %)', v_sku, antes.fusionado_en; end if;
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

-- Fusionar A en B: el stock (almacén y vehículos) pasa con ajustes enlazados, A queda archivado. Nada se borra.
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
  update productos set archivado = true, fusionado_en = b.sku, actualizado = now() where sku = a.sku;
  update avisos_reposicion set estado = 'cerrado' where sku = a.sku and estado <> 'cerrado';
  insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'fusionar_productos', jsonb_build_object('origen', a.sku, 'destino', b.sku, 'stock', a.stock, 'convertido', qb, 'motivo', p_motivo));
  return jsonb_build_object('estado', 'aplicado', 'origen', a.sku, 'destino', b.sku, 'cantidad', qb);
end $$;

-- Cambiar el código (SKU): se crea la ficha con el código nuevo y la antigua se fusiona en ella. El historial, los albaranes y las
-- entregas firmadas (con su huella) conservan el código con el que se hicieron; buscar el código antiguo lleva al nuevo.
create or replace function public.cambiar_codigo_producto(p_sku text, p_nuevo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); a productos; v_nuevo text := upper(trim(coalesce(p_nuevo, '')));
begin
  select * into a from productos where sku = upper(p_sku);
  if not found then raise exception 'Artículo no encontrado: %', p_sku; end if;
  if v_nuevo = '' then raise exception 'Indica el código nuevo'; end if;
  if exists (select 1 from productos where sku = v_nuevo) then raise exception 'Ya existe un artículo con el código %', v_nuevo; end if;
  insert into productos (sku, ean, ref_proveedor, nombre, categoria, unidad, contenido, formato, formato_texto, minimo, minimo_definido, objetivo, proveedor, proveedor_habitual,
                         con_serie, borrador, propiedad, propietario_id, modelo, talla, notas, foto, foto_mini, foto_origen)
  select v_nuevo, ean, ref_proveedor, nombre, categoria, unidad, contenido, formato, formato_texto, minimo, minimo_definido, objetivo, proveedor, proveedor_habitual,
         false, borrador, propiedad, propietario_id, modelo, talla, notas, foto, foto_mini, foto_origen from productos where sku = a.sku;
  update productos set ean = null where sku = a.sku;          -- el EAN pasa a la ficha nueva
  perform fusionar_productos(a.sku, v_nuevo, 'Cambio de código ' || a.sku || ' → ' || v_nuevo);
  return jsonb_build_object('estado', 'aplicado', 'sku', v_nuevo);
end $$;

-- ---------- 4. Reasignar una línea de un albarán ya ingresado ----------
-- La cantidad de la entrada de A pasa a B: ajuste −A (corrige la entrada) y ajuste +B (enlazado al anterior). p_id = id del ajuste −A.
create or replace function public.reasignar_linea_albaran(p_id uuid, p_movimiento uuid, p_destino text, p_cantidad numeric default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); m movimientos; al albaranes; a productos; b productos; ya numeric; q numeric;
begin
  if exists (select 1 from movimientos where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  select * into m from movimientos where id = p_movimiento;
  if not found or m.tipo <> 'entrada' or m.albaran_id is null then raise exception 'Esa línea no es una entrada de un albarán'; end if;
  select * into al from albaranes where id = m.albaran_id;
  select * into a from productos where sku = m.sku;
  select * into b from productos where sku = upper(p_destino);
  if not found then raise exception 'Artículo no encontrado: %', p_destino; end if;
  if b.sku = a.sku then raise exception 'Elige otro artículo'; end if;
  if b.borrador or b.archivado then raise exception '% no se puede usar (borrador o archivado)', b.sku; end if;
  select coalesce(-sum(cantidad), 0) into ya from movimientos where corrige = m.id and sku = m.sku and motivo = 'Reasignación de línea de albarán';
  q := coalesce(p_cantidad, m.cantidad - ya);
  if q <= 0 or q > m.cantidad - ya then raise exception 'Cantidad no válida: de esa línea quedan % por reasignar', m.cantidad - ya; end if;
  if a.stock < q then raise exception 'De % solo quedan % en el almacén: el resto ya ha salido', a.nombre, a.stock; end if;
  perform _aplicar_movimiento(p, p_id, a.sku, 'ajuste', -q, 'Reasignación de línea de albarán', 'Albarán ' || al.numero || ' · pasa a ' || b.sku, '{}', null, null, al.id, m.id);
  perform _aplicar_movimiento(p, gen_random_uuid(), b.sku, 'ajuste', q, 'Reasignación de línea de albarán', 'Albarán ' || al.numero || ' · venía como ' || a.sku, '{}', null, null, al.id, p_id);
  insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'reasignar_linea_albaran', jsonb_build_object('albaran', al.numero, 'de', a.sku, 'a', b.sku, 'cantidad', q));
  return jsonb_build_object('estado', 'aplicado', 'cantidad', q);
end $$;

-- ---------- 3. Importar catálogo: actualizar fichas existentes (sin tocar el stock) ----------
drop function public.importar_catalogo(jsonb);
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
    if exists (select 1 from productos where sku = v_sku) then
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

-- ---------- 6. Propuestas de cambio de ficha (personal de almacén) ----------
create table public.propuestas_ficha (
  id          uuid primary key,
  sku         text not null references public.productos(sku),
  cambios     jsonb not null,
  ts          timestamptz not null default now(),
  usuario     uuid references public.perfiles(id),
  operario    text not null,
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'aplicada', 'descartada')),
  resuelto_por text,
  resuelto_ts timestamptz
);
create or replace function public.proponer_cambio_ficha(p_id uuid, p_sku text, p_cambios jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := perfil_actual();
begin
  if exists (select 1 from propuestas_ficha where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  if not exists (select 1 from productos where sku = upper(p_sku)) then raise exception 'Artículo no encontrado: %', p_sku; end if;
  if jsonb_typeof(p_cambios) <> 'object' or p_cambios = '{}'::jsonb then raise exception 'No hay cambios que proponer'; end if;
  insert into propuestas_ficha (id, sku, cambios, usuario, operario) values (p_id, upper(p_sku), p_cambios, u.id, u.nombre);
  return jsonb_build_object('estado', 'aplicado');
end $$;
create or replace function public.resolver_propuesta_ficha(p_id uuid, p_aplicada boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin();
begin
  update propuestas_ficha set estado = case when p_aplicada then 'aplicada' else 'descartada' end, resuelto_por = u.nombre, resuelto_ts = now()
  where id = p_id and estado = 'pendiente';
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- ---------- 7. Equivalencias: historial, borrar borradores y recalcular cierres ----------
create table public.equivalencias_historial (
  id       uuid primary key default gen_random_uuid(),
  regla_id text not null,
  version  jsonb not null,
  ts       timestamptz not null default now(),
  operario text not null
);
create or replace function public.guardar_equivalencia(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); antes equivalencias_cierre;
begin
  select * into antes from equivalencias_cierre where id = p->>'id';
  if found and antes.confirmada then insert into equivalencias_historial (regla_id, version, operario) values (antes.id, to_jsonb(antes), u.nombre); end if;
  insert into equivalencias_cierre (id, campo, formula, condiciones, articulos, kit, estimada, activa, orden, nota, confirmada)
  values (p->>'id', trim(p->>'campo'), p->>'formula', coalesce(p->'condiciones', '{}'), coalesce(p->'articulos', '[]'), nullif(p->>'kit', ''),
          coalesce((p->>'estimada')::boolean, false), coalesce((p->>'activa')::boolean, true), coalesce((p->>'orden')::int, 100), coalesce(p->>'nota', ''),
          coalesce((p->>'confirmada')::boolean, true))
  on conflict (id) do update set campo = excluded.campo, formula = excluded.formula, condiciones = excluded.condiciones, articulos = excluded.articulos,
    kit = excluded.kit, estimada = excluded.estimada, activa = excluded.activa, orden = excluded.orden, nota = excluded.nota, confirmada = excluded.confirmada, actualizado = now();
  return jsonb_build_object('estado', 'aplicado');
end $$;
create or replace function public.borrar_equivalencia(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin();
begin
  if exists (select 1 from equivalencias_cierre where id = p_id and confirmada) then raise exception 'Una regla confirmada no se borra: desactívala'; end if;
  delete from equivalencias_cierre where id = p_id;
  return jsonb_build_object('estado', 'aplicado');
end $$;
-- Recalcular un cierre con las reglas actuales (la traducción la hace la app): sustituye sus líneas y aplica solo la diferencia
create or replace function public.recalcular_cierre_admin(p_cierre uuid, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); ci cierres; l jsonb; v_sku text; resueltos text[];
begin
  select * into ci from cierres where id = p_cierre for update;
  if not found then raise exception 'Cierre no encontrado'; end if;
  if ci.estado = 'ignorado' then return jsonb_build_object('estado', 'ignorado'); end if;
  select coalesce(array_agg(campo), '{}') into resueltos from cierre_lineas where cierre_id = ci.id and estado = 'resuelta';
  delete from cierre_lineas where cierre_id = ci.id and estado <> 'resuelta';
  for l in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) loop
    continue when (l->>'estado') <> 'aplicable' and (l->>'campo') = any(resueltos);
    v_sku := nullif(l->>'sku', '');
    if v_sku is not null and not exists (select 1 from productos where sku = v_sku and not borrador and not archivado) then v_sku := null; end if;
    insert into cierre_lineas (cierre_id, campo, formula, valor, sku, cantidad, estimada, estado, regla, nota)
    values (ci.id, l->>'campo', coalesce(l->>'formula', 'directa'), coalesce((l->>'valor')::numeric, 0), v_sku, coalesce((l->>'cantidad')::numeric, 0),
            coalesce((l->>'estimada')::boolean, false),
            case when (l->>'estado') = 'aplicable' and v_sku is not null then 'aplicada' when (l->>'estado') = 'pendiente' then 'pendiente' else 'sin_equivalencia' end,
            l->>'regla', coalesce(l->>'nota', ''));
  end loop;
  return jsonb_build_object('estado', _sincronizar_cierre(ci.id));
end $$;

-- ---------- Borrado de la demostración: también las propuestas ----------
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
  truncate table propuestas_ficha, cierre_lineas, cierres, portal_enlaces, copias_entrega, envios_aviso, reservas, entrega_lineas, entregas, stock_vehiculo, movimientos, pendientes, recuentos, albaranes, avisos_reposicion,
    actas_custodia, series, costes_producto, costes_incidencia, dotacion_historial, costes_dotacion, dotacion, minimos_herramienta,
    plantilla_lineas, plantillas_entrega, tallas_tecnico, asignaciones_tecnico, asignaciones_vehiculo, vehiculos, tecnicos, equipos, productos;
  perform set_config('almacen.limpieza_demo', '', true);
  alter sequence entregas_numero restart with 1;
  alter sequence actas_numero restart with 1;
  update config_app set modo_demo = false, demo_borrada = now(), demo_borrada_por = p.nombre where id = 1;
  insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'limpiar_demostracion', n || jsonb_build_object('fotos', coalesce(array_length(fotos, 1), 0)));
  return jsonb_build_object('estado', 'aplicado', 'borrado', n, 'fotos', to_jsonb(fotos));
end $$;

-- ---------- Seguridad ----------
alter table public.categorias enable row level security;
alter table public.propuestas_ficha enable row level security;
alter table public.equivalencias_historial enable row level security;
revoke all on public.categorias, public.propuestas_ficha, public.equivalencias_historial from anon, authenticated;
grant select on public.categorias, public.propuestas_ficha, public.equivalencias_historial to authenticated;
create policy categorias_lectura on public.categorias for select to authenticated using (public.es_usuario_activo());
create policy propuestas_lectura on public.propuestas_ficha for select to authenticated using (public.es_admin() or usuario = auth.uid());
create policy equivalencias_historial_lectura on public.equivalencias_historial for select to authenticated using (public.es_admin());

revoke execute on function public.guardar_categoria(jsonb), public.desactivar_categoria(text, text), public.fusionar_productos(text, text, text),
  public.cambiar_codigo_producto(text, text), public.reasignar_linea_albaran(uuid, uuid, text, numeric), public.importar_catalogo(jsonb, boolean),
  public.proponer_cambio_ficha(uuid, text, jsonb), public.resolver_propuesta_ficha(uuid, boolean), public.borrar_equivalencia(text), public.recalcular_cierre_admin(uuid, jsonb)
  from public, anon;
grant execute on function public.guardar_categoria(jsonb), public.desactivar_categoria(text, text), public.fusionar_productos(text, text, text),
  public.cambiar_codigo_producto(text, text), public.reasignar_linea_albaran(uuid, uuid, text, numeric), public.importar_catalogo(jsonb, boolean),
  public.proponer_cambio_ficha(uuid, text, jsonb), public.resolver_propuesta_ficha(uuid, boolean), public.borrar_equivalencia(text), public.recalcular_cierre_admin(uuid, jsonb)
  to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.categorias, public.propuestas_ficha;
  end if;
end $$;
