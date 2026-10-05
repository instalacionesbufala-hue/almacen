-- E-031 · Formatos en metros (rollo, bobina, barra; también caja y pack) y conversión del stock al cambiar el formato.
-- Modelo (sin cambios de fondo): el ALMACÉN guarda formatos (productos.stock) y cada VEHÍCULO guarda unidades de contenido
-- (stock_vehiculo.unidades = formatos × contenido); los cierres ya consumen en unidades de contenido (metros / contenido).
-- Lo nuevo:
-- - unidad_contenido ('m' | 'ud'): "rollo de 50 m" frente a "bote de 1000 ud".
-- - metros_sueltos: el artículo se puede entregar en metros (fracciones de formato), p. ej. cable cortado a medida.
-- - Formato entero por artículo (no solo por unidad): en metros sueltos y en los ajustes/recuentos de formatos en metros
--   se admiten decimales ("2 rollos y 15 m" = 2,3 rollos).
-- - cambiar_formato: cambia unidad/contenido convirtiendo el stock, con un ajuste de conversión enlazado y auditoría.

do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.productos'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%unidad = ANY%' and pg_get_constraintdef(oid) not like '%unidad_contenido%' loop
    execute format('alter table public.productos drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.productos
  add constraint productos_unidad_check check (unidad in ('m', 'ud', 'bote', 'sobre', 'bolsa', 'pack', 'caja', 'rollo', 'bobina', 'barra')),
  add column if not exists unidad_contenido text not null default 'ud' check (unidad_contenido in ('m', 'ud')),
  add column if not exists metros_sueltos boolean not null default false;
update public.productos set unidad_contenido = 'm' where unidad = 'm' and unidad_contenido <> 'm';

-- Formato entero según el artículo: metros siempre admiten decimales; un formato en metros con "metros sueltos", también
create or replace function public._es_formato_entero(pr public.productos) returns boolean language sql immutable as $$
  select pr.unidad <> 'm' and not (pr.metros_sueltos and pr.unidad_contenido = 'm')
$$;
revoke execute on function public._es_formato_entero(public.productos) from public, anon, authenticated;

-- Las funciones que exigían formato entero miran ahora el artículo (se reescriben en el sitio, sin copiar su cuerpo)
do $$
declare r record; f record; d text; n int;
begin
  for r in select * from (values
      ('_aplicar_movimiento', '_es_formato_entero(pr.unidad)', '_es_formato_entero(pr) and not (p_tipo = ''ajuste'' and pr.unidad_contenido = ''m'')'),
      ('_mover_vehiculo', '_es_formato_entero(pr.unidad)', '_es_formato_entero(pr)'),
      ('preparar_entrega', '_es_formato_entero(pr.unidad)', '_es_formato_entero(pr)'),
      ('_antes_del_ajuste', '_es_formato_entero(pr.unidad)', '(_es_formato_entero(pr) and pr.unidad_contenido <> ''m'')')
    ) t(fn, a, b) loop
    n := 0;
    for f in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = r.fn loop
      d := pg_get_functiondef(f.oid);
      continue when position(r.a in d) = 0;
      execute replace(d, r.a, r.b);
      n := n + 1;
    end loop;
    if n = 0 then raise exception 'E-031: no encuentro la comprobación de formato entero en %', r.fn; end if;
  end loop;
end $$;

-- guardar_producto: también guarda la unidad del contenido y "metros sueltos" (si no vienen, se conservan)
do $$
declare d text; r record;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'guardar_producto';
  for r in select * from (values
      ('modelo, talla, notas)', 'modelo, talla, notas, unidad_contenido, metros_sueltos)'),
      ('coalesce(p_producto->>''notas'', ''''))', 'coalesce(p_producto->>''notas'', ''''), case when coalesce(p_producto->>''unidad'', ''ud'') = ''m'' then ''m'' when coalesce(p_producto->>''unidad'', ''ud'') = ''ud'' then ''ud'' else coalesce(nullif(p_producto->>''unidad_contenido'', ''''), ''ud'') end, coalesce((p_producto->>''metros_sueltos'')::boolean, false))'),
      ('notas = excluded.notas, actualizado = now()', 'notas = excluded.notas, unidad_contenido = case when p_producto ? ''unidad_contenido'' or excluded.unidad in (''m'', ''ud'') then excluded.unidad_contenido else productos.unidad_contenido end, metros_sueltos = case when p_producto ? ''metros_sueltos'' then excluded.metros_sueltos else productos.metros_sueltos end, actualizado = now()'),
      ('''talla'', ''notas'']', '''talla'', ''notas'', ''unidad_contenido'', ''metros_sueltos'']')
    ) t(a, b) loop
    if (length(d) - length(replace(d, r.a, ''))) / length(r.a) <> 1 then raise exception 'E-031: guardar_producto no tiene una sola vez: %', r.a; end if;
    d := replace(d, r.a, r.b);
  end loop;
  execute d;
end $$;

-- "rollo de 50 m", "bote de 1000 ud", "metros"
create or replace function public._formato_txt(p_unidad text, p_contenido numeric, p_uc text) returns text language sql immutable as $$
  select case when p_unidad = 'm' then 'metros' when p_unidad = 'ud' then 'unidades'
              else p_unidad || ' de ' || _fmt(p_contenido) || ' ' || p_uc end
$$;

-- ---------- Cambiar el formato convirtiendo el stock ----------
-- p_modo 'contenido': el stock actual está en la unidad del contenido (p. ej. 150 eran metros) → el almacén se reexpresa en el
--   formato nuevo (3 rollos de 50 m); los vehículos ya guardan unidades de contenido y no cambian (−18 m = −0,36 rollos).
-- p_modo 'formato': el stock del almacén ya está en el formato nuevo (no se convierte); lo de los vehículos se reescala.
-- En los dos casos: un movimiento "Conversión de formato" (ajuste sin cambio físico) donde cambia la cifra, y auditoría.
create or replace function public.cambiar_formato(p_sku text, p_unidad text, p_contenido numeric, p_unidad_contenido text, p_modo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); pr productos; c_new numeric; uc text; f numeric; nuevo numeric; d numeric; r record; vehs jsonb := '[]'; antes_txt text; despues_txt text;
begin
  select * into pr from productos where sku = upper(trim(p_sku)) and not archivado for update;
  if not found then raise exception 'Producto no encontrado: %', p_sku; end if;
  if p_unidad not in ('m', 'ud', 'bote', 'sobre', 'bolsa', 'pack', 'caja', 'rollo', 'bobina', 'barra') then raise exception 'Formato no válido: %', p_unidad; end if;
  if p_modo not in ('contenido', 'formato') then raise exception 'Indica si el stock actual está en % o ya en el formato nuevo', coalesce(p_unidad_contenido, 'ud'); end if;
  c_new := case when p_unidad in ('m', 'ud') then 1 else p_contenido end;
  if c_new is null or c_new <= 0 then raise exception 'Indica cuánto trae cada %', p_unidad; end if;
  uc := case when p_unidad in ('m', 'ud') then p_unidad else coalesce(nullif(p_unidad_contenido, ''), 'ud') end;
  if uc not in ('m', 'ud') then raise exception 'La unidad del contenido es m o ud'; end if;
  if pr.unidad = p_unidad and pr.contenido = c_new and pr.unidad_contenido = uc then return jsonb_build_object('estado', 'duplicado'); end if;
  if reservado(pr.sku) > 0 then raise exception 'Hay entregas preparadas con % sin firmar: fírmalas o anúlalas antes de cambiar el formato', pr.nombre; end if;
  antes_txt := _formato_txt(pr.unidad, pr.contenido, pr.unidad_contenido); despues_txt := _formato_txt(p_unidad, c_new, uc);
  if p_modo = 'contenido' then
    nuevo := round(pr.stock * pr.contenido / c_new, 3);
    update productos set unidad = p_unidad, contenido = c_new, unidad_contenido = uc, stock = nuevo,
      metros_sueltos = metros_sueltos and uc = 'm',
      minimo = round(minimo * pr.contenido / c_new, 3), objetivo = round(objetivo * pr.contenido / c_new, 3), actualizado = now()
    where sku = pr.sku;
    d := nuevo - pr.stock;
    if d <> 0 then
      insert into movimientos (id, sku, tipo, cantidad, motivo, referencia, series, usuario, operario)
      values (gen_random_uuid(), pr.sku, 'ajuste', d, 'Conversión de formato', format('%s %s → %s %s (sin cambio físico)', _fmt(pr.stock), antes_txt, _fmt(nuevo), despues_txt), '{}', u.id, u.nombre);
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('vehiculo', vehiculo_id, 'unidades', unidades)), '[]') into vehs from stock_vehiculo where sku = pr.sku and unidades <> 0;
  else
    f := c_new / pr.contenido; nuevo := pr.stock;
    update productos set unidad = p_unidad, contenido = c_new, unidad_contenido = uc, metros_sueltos = metros_sueltos and uc = 'm', actualizado = now() where sku = pr.sku;
    for r in select s.*, v.matricula, v.equipo_id from stock_vehiculo s join vehiculos v on v.id = s.vehiculo_id where s.sku = pr.sku and s.unidades <> 0 loop
      d := round(r.unidades * f, 3) - r.unidades;
      continue when d = 0;
      update stock_vehiculo set unidades = unidades + d where vehiculo_id = r.vehiculo_id and sku = pr.sku;
      insert into movimientos (id, sku, tipo, cantidad, motivo, referencia, series, equipo_id, vehiculo_id, unidades, usuario, operario)
      values (gen_random_uuid(), pr.sku, 'ajuste', case when round(d / c_new, 3) = 0 then sign(d) * 0.001 else round(d / c_new, 3) end, 'Conversión de formato',
              format('%s: %s %s → %s (sin cambio físico)', r.matricula, _fmt(r.unidades), pr.unidad_contenido, despues_txt), '{}', r.equipo_id, r.vehiculo_id, d, u.id, u.nombre);
      vehs := vehs || jsonb_build_object('vehiculo', r.vehiculo_id, 'antes', r.unidades, 'despues', r.unidades + d);
    end loop;
  end if;
  insert into auditoria (usuario, operario, accion, detalle)
  values (u.id, u.nombre, 'cambiar_formato', jsonb_build_object('sku', pr.sku, 'modo', p_modo, 'antes', jsonb_build_object('formato', antes_txt, 'stock', pr.stock),
          'despues', jsonb_build_object('formato', despues_txt, 'stock', nuevo), 'vehiculos', vehs));
  return jsonb_build_object('estado', 'aplicado', 'stock', nuevo, 'vehiculos', vehs);
end $$;

insert into public.permisos_funcion (funcion, permiso) values ('cambiar_formato', 'inventario.modificar')
on conflict (funcion) do update set permiso = excluded.permiso;
revoke execute on function public._formato_txt(text, numeric, text) from public, anon, authenticated;
revoke execute on function public.cambiar_formato(text, text, numeric, text, text) from public, anon;
grant execute on function public.cambiar_formato(text, text, numeric, text, text) to authenticated;
