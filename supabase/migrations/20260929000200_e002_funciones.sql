-- E-002 · Funciones de escritura. Es la ÚNICA vía para modificar datos desde la app:
-- todas son SECURITY DEFINER, comprueban el usuario y su rol y repiten las validaciones de src/domain.

-- ---------- Identidad y rol ----------
create or replace function public.perfil_actual() returns public.perfiles
language plpgsql stable security definer set search_path = public as $$
declare p public.perfiles;
begin
  select * into p from perfiles where id = auth.uid() and activo;
  if not found then raise exception 'Usuario sin acceso o desactivado' using errcode = '42501'; end if;
  return p;
end $$;

create or replace function public.es_usuario_activo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and activo)
$$;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and activo and rol = 'admin')
$$;

create or replace function public.exigir_admin() returns public.perfiles
language plpgsql stable security definer set search_path = public as $$
declare p public.perfiles := perfil_actual();
begin
  if p.rol <> 'admin' then raise exception 'Solo el administrador puede hacer esto' using errcode = '42501'; end if;
  return p;
end $$;

create or replace function public._fmt(n numeric) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(to_char(n, 'FM999999990.999'), '\.$', ''), '\.', ',')
$$;

-- ---------- Núcleo: aplicar un movimiento (interno, no expuesto) ----------
create or replace function public._aplicar_movimiento(
  p public.perfiles, p_id uuid, p_sku text, p_tipo text, p_cantidad numeric, p_motivo text,
  p_referencia text, p_series text[], p_equipo text, p_entrega uuid, p_albaran uuid, p_corrige uuid
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  pr productos;
  delta numeric;
  s text;
  n int := coalesce(array_length(p_series, 1), 0);
begin
  if p_tipo not in ('entrada', 'salida', 'merma', 'ajuste') then raise exception 'Tipo de movimiento no válido'; end if;
  if p_cantidad is null or p_cantidad = 0 then raise exception 'Indica una cantidad distinta de cero'; end if;
  if p_tipo <> 'ajuste' and p_cantidad < 0 then raise exception 'Indica una cantidad mayor que cero'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo del movimiento'; end if;

  select * into pr from productos where sku = p_sku for update;
  if not found then raise exception 'Producto no encontrado: %', p_sku; end if;
  if pr.borrador then raise exception '% está en borrador: el administrador debe completarla antes de moverla', pr.sku; end if;

  delta := case p_tipo when 'entrada' then p_cantidad when 'ajuste' then p_cantidad else -p_cantidad end;
  if pr.stock + delta < 0 then
    raise exception 'Solo hay % % de %', _fmt(pr.stock), pr.unidad, pr.nombre;
  end if;
  -- E-008: el depositante quiere saber dónde está cada equipo en custodia
  if pr.propiedad = 'custodia' and p_tipo = 'salida' and coalesce(trim(p_referencia), '') = '' then
    raise exception 'Indica la obra o instalación de destino: % está en custodia de %', pr.nombre, (select nombre from propietarios where id = pr.propietario_id);
  end if;

  if pr.con_serie then
    if abs(delta) <> trunc(abs(delta)) or abs(delta) <> n then
      raise exception '%: indica % n.º de serie (hay %)', pr.nombre, _fmt(abs(delta)), n;
    end if;
    if (select count(distinct x) from unnest(p_series) x) <> n then raise exception 'Hay números de serie repetidos'; end if;
    foreach s in array p_series loop
      if delta > 0 then
        if exists (select 1 from series where sku = pr.sku and serie = s and en_stock) then
          raise exception 'El n.º de serie % ya está en stock', s;
        end if;
        insert into series (sku, serie, en_stock, equipo_id) values (pr.sku, s, true, null)
          on conflict (sku, serie) do update set en_stock = true, equipo_id = null;
      else
        if not exists (select 1 from series where sku = pr.sku and serie = s and en_stock) then
          raise exception 'El n.º de serie % no está en stock', s;
        end if;
        update series set en_stock = false, equipo_id = p_equipo where sku = pr.sku and serie = s;
      end if;
    end loop;
  elsif n > 0 then
    raise exception '% no lleva control por n.º de serie', pr.nombre;
  end if;

  update productos set stock = stock + delta, actualizado = now() where sku = pr.sku;
  insert into movimientos (id, sku, tipo, cantidad, motivo, referencia, series, equipo_id, usuario, operario, corrige, entrega_id, albaran_id)
  values (p_id, pr.sku, p_tipo, p_cantidad, trim(p_motivo), coalesce(p_referencia, ''), coalesce(p_series, '{}'), p_equipo, p.id, p.nombre, p_corrige, p_entrega, p_albaran);

  -- una entrada que recupera el mínimo cierra el pedido de reposición
  if delta > 0 and pr.stock + delta >= pr.minimo then delete from pedidos_reposicion where sku = pr.sku; end if;
  return pr.stock + delta;
end $$;

-- ---------- Movimiento suelto (entrada, salida, merma o ajuste) ----------
create or replace function public.registrar_movimiento(
  p_id uuid, p_sku text, p_tipo text, p_cantidad numeric, p_motivo text,
  p_referencia text default '', p_series text[] default '{}', p_equipo text default null, p_corrige uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := perfil_actual(); nuevo numeric;
begin
  if exists (select 1 from movimientos where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  if p_tipo = 'ajuste' and p.rol <> 'admin' then
    raise exception 'Solo el administrador puede hacer ajustes' using errcode = '42501';
  end if;
  if p_equipo is not null and not exists (select 1 from equipos where id = p_equipo) then raise exception 'Equipo no encontrado'; end if;
  nuevo := _aplicar_movimiento(p, p_id, upper(p_sku), p_tipo, p_cantidad, p_motivo, p_referencia, p_series, p_equipo, null, null, p_corrige);
  return jsonb_build_object('estado', 'aplicado', 'stock', nuevo);
end $$;

-- ---------- Entregas con firma (huella calculada aquí, no en el navegador) ----------
create or replace function public._hash_entrega(p_id uuid) returns text
language sql stable security definer set search_path = public, extensions as $$
  select encode(extensions.digest(jsonb_build_object(
    'id', e.id, 'numero', e.numero, 'ts', floor(extract(epoch from e.ts) * 1000)::bigint,
    'equipo', e.equipo_id, 'receptor', e.receptor_id, 'dni', e.dni, 'firma', e.firma,
    'lineas', coalesce((select jsonb_agg(jsonb_build_object('sku', l.sku, 'qty', l.cantidad, 'serials', to_jsonb(l.series)) order by l.n)
                        from entrega_lineas l where l.entrega_id = e.id), '[]'::jsonb)
  )::text, 'sha256'), 'hex')
  from entregas e where e.id = p_id
$$;

create or replace function public.registrar_entrega(
  p_id uuid, p_equipo text, p_receptor text, p_lineas jsonb, p_firma text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p perfiles := perfil_actual();
  t tecnicos; e entregas; l jsonb; i int := 0; num text; h text;
  ser text[];
begin
  select * into e from entregas where id = p_id;
  if found then return jsonb_build_object('estado', 'duplicado', 'numero', e.numero, 'hash', e.hash); end if;
  if not exists (select 1 from equipos where id = p_equipo and activo) then raise exception 'Equipo no encontrado'; end if;
  select * into t from tecnicos where id = p_receptor and activo;
  if not found then raise exception 'Receptor no encontrado'; end if;
  if t.equipo_id is distinct from p_equipo then raise exception '% no pertenece a ese equipo', t.nombre; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'La entrega no tiene material'; end if;
  if coalesce(p_firma, '') = '' then raise exception 'Falta la firma del receptor'; end if;

  num := format('ENT-%s-%s', extract(year from now())::int, lpad(nextval('entregas_numero')::text, 4, '0'));
  insert into entregas (id, numero, equipo_id, receptor_id, dni, firma, hash, usuario, operario)
  values (p_id, num, p_equipo, p_receptor, t.dni_mascara, p_firma, '', p.id, p.nombre);

  for l in select * from jsonb_array_elements(p_lineas) loop
    i := i + 1;
    ser := coalesce(array(select jsonb_array_elements_text(l->'series')), '{}');
    insert into entrega_lineas (entrega_id, n, sku, cantidad, series) values (p_id, i, upper(l->>'sku'), (l->>'cantidad')::numeric, ser);
    perform _aplicar_movimiento(p, gen_random_uuid(), upper(l->>'sku'), 'salida', (l->>'cantidad')::numeric,
                                'Entrega a equipo', num, ser, p_equipo, p_id, null, null);
  end loop;

  h := _hash_entrega(p_id);
  update entregas set hash = h where id = p_id;
  return jsonb_build_object('estado', 'aplicado', 'numero', num, 'hash', h);
end $$;

create or replace function public.verificar_entregas() returns table (numero text, ok boolean)
language sql stable security definer set search_path = public as $$
  select e.numero, e.hash = _hash_entrega(e.id) from entregas e where es_usuario_activo() order by e.ts
$$;

-- ---------- Albaranes: el usuario confirma y se ingresa todo o nada ----------
create or replace function public.aprobar_albaran(p_id uuid, p_cabecera jsonb, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p perfiles := perfil_actual(); l jsonb; n int := 0; uds numeric := 0; num text := coalesce(nullif(trim(p_cabecera->>'numero'), ''), 's/n');
begin
  if exists (select 1 from albaranes where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'El albarán no tiene líneas que ingresar'; end if;
  insert into albaranes (id, numero, proveedor, cif, fecha, lineas, unidades, confianza, modo, usuario, operario)
  values (p_id, num, coalesce(p_cabecera->>'proveedor', ''), coalesce(p_cabecera->>'cif', ''), coalesce(p_cabecera->>'fecha', ''),
          0, 0, (p_cabecera->>'confianza')::numeric, coalesce(p_cabecera->>'modo', 'sim'), p.id, p.nombre);
  for l in select * from jsonb_array_elements(p_lineas) loop
    n := n + 1; uds := uds + (l->>'cantidad')::numeric;
    perform _aplicar_movimiento(p, gen_random_uuid(), upper(l->>'sku'), 'entrada', (l->>'cantidad')::numeric, 'Compra a proveedor',
      'Alb. ' || num, coalesce(array(select jsonb_array_elements_text(l->'series')), '{}'), null, null, p_id, null);
  end loop;
  -- el resumen se completa aquí (el trigger de inmutabilidad lo permite solo con lineas = 0)
  update albaranes set lineas = n, unidades = uds where id = p_id;
  return jsonb_build_object('estado', 'aplicado', 'lineas', n, 'unidades', uds);
end $$;

-- ---------- Catálogo (solo administrador) ----------
create or replace function public.guardar_producto(p_producto jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p perfiles := exigir_admin();
  v_sku text := upper(trim(p_producto->>'sku'));
  existe boolean;
  inicial numeric := coalesce((p_producto->>'stock_inicial')::numeric, 0);
begin
  if coalesce(v_sku, '') = '' then raise exception 'El SKU es obligatorio'; end if;
  select true into existe from productos where sku = v_sku;
  if coalesce(existe, false) and coalesce((p_producto->>'nuevo')::boolean, false) then raise exception 'Ya existe una referencia con el SKU %', v_sku; end if;
  if coalesce(p_producto->>'propiedad', 'propia') = 'custodia' and nullif(p_producto->>'propietario_id', '') is null then raise exception 'Indica de quién es el material en custodia'; end if;
  insert into productos (sku, ean, ref_proveedor, nombre, categoria, unidad, formato, formato_texto, minimo, ubicacion, proveedor, con_serie, borrador, propiedad, propietario_id)
  values (v_sku, nullif(trim(p_producto->>'ean'), ''), nullif(trim(p_producto->>'ref_proveedor'), ''), trim(p_producto->>'nombre'),
          p_producto->>'categoria', p_producto->>'unidad', coalesce((p_producto->>'formato')::numeric, 1), coalesce(p_producto->>'formato_texto', ''),
          coalesce((p_producto->>'minimo')::numeric, 0), p_producto->>'ubicacion', coalesce(p_producto->>'proveedor', ''),
          coalesce((p_producto->>'con_serie')::boolean, false) or p_producto->>'categoria' = 'cargadores', false,
          coalesce(p_producto->>'propiedad', 'propia'), case when p_producto->>'propiedad' = 'custodia' then p_producto->>'propietario_id' end)
  on conflict (sku) do update set ean = excluded.ean, ref_proveedor = excluded.ref_proveedor, nombre = excluded.nombre,
    categoria = excluded.categoria, unidad = excluded.unidad, formato = excluded.formato, formato_texto = excluded.formato_texto,
    minimo = excluded.minimo, ubicacion = excluded.ubicacion, proveedor = excluded.proveedor, con_serie = excluded.con_serie,
    borrador = false, propiedad = excluded.propiedad, propietario_id = excluded.propietario_id, actualizado = now();
  -- en custodia no hay precio: se guarda null, nunca 0
  insert into costes_producto (sku, precio) values (v_sku, case when p_producto->>'propiedad' = 'custodia' then null else nullif(p_producto->>'precio', '')::numeric end)
    on conflict (sku) do update set precio = excluded.precio;
  if not coalesce(existe, false) and inicial > 0 and not coalesce((p_producto->>'con_serie')::boolean, false) then
    perform _aplicar_movimiento(p, gen_random_uuid(), v_sku, 'ajuste', inicial, 'Alta de referencia', 'Stock inicial', '{}', null, null, null, null);
  end if;
  return jsonb_build_object('estado', 'aplicado', 'sku', v_sku);
end $$;

-- ---------- Reposición ----------
create or replace function public.marcar_pedido(p_sku text, p_cantidad numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := perfil_actual();
begin
  if not exists (select 1 from productos where sku = upper(p_sku)) then raise exception 'Producto no encontrado'; end if;
  insert into pedidos_reposicion (sku, cantidad, usuario) values (upper(p_sku), p_cantidad, p.id)
    on conflict (sku) do update set cantidad = excluded.cantidad, ts = now(), usuario = excluded.usuario;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- ---------- Equipos y técnicos ----------
create or replace function public.guardar_equipo(p_equipo jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin();
begin
  if coalesce(trim(p_equipo->>'matricula'), '') = '' then raise exception 'Indica la matrícula del vehículo'; end if;
  insert into equipos (id, nombre, flota, matricula, estado)
  values (p_equipo->>'id', trim(p_equipo->>'nombre'), coalesce(p_equipo->>'flota', ''), upper(trim(p_equipo->>'matricula')), coalesce(p_equipo->>'estado', 'depot'))
  on conflict (id) do update set nombre = excluded.nombre, flota = excluded.flota, matricula = excluded.matricula, estado = excluded.estado, activo = true;
  return jsonb_build_object('estado', 'aplicado');
end $$;

create or replace function public.cambiar_estado_equipo(p_equipo text, p_estado text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := perfil_actual();
begin
  update equipos set estado = p_estado where id = p_equipo and activo;
  if not found then raise exception 'Equipo no encontrado'; end if;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- Retira un vehículo: no puede llevar material a bordo ni técnicos; su dotación pasa a otro equipo o al almacén
create or replace function public.retirar_equipo(p_equipo text, p_destino text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin();
begin
  if exists (select 1 from series where equipo_id = p_equipo and not en_stock) then
    raise exception 'El vehículo aún lleva material con n.º de serie a bordo: devuélvelo antes de retirarlo';
  end if;
  if exists (select 1 from tecnicos where equipo_id = p_equipo and activo) then raise exception 'El equipo aún tiene técnicos asignados'; end if;
  update dotacion set equipo_id = p_destino where equipo_id = p_equipo;
  update equipos set activo = false where id = p_equipo;
  return jsonb_build_object('estado', 'aplicado');
end $$;

create or replace function public.guardar_tecnico(p_tecnico jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin();
begin
  -- solo se admite el DNI enmascarado (***1234-X): el completo nunca sale del navegador
  if coalesce(p_tecnico->>'dni_mascara', '') !~ '^(\*\*\*[0-9A-Z]{0,8}-?[A-Z]?|—)$' then raise exception 'DNI no válido: solo se guarda enmascarado'; end if;
  insert into tecnicos (id, nombre, rol, dni_mascara, equipo_id)
  values (p_tecnico->>'id', trim(p_tecnico->>'nombre'), coalesce(p_tecnico->>'rol', 'Técnico'), p_tecnico->>'dni_mascara', nullif(p_tecnico->>'equipo_id', ''))
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, dni_mascara = excluded.dni_mascara, activo = true;
  return jsonb_build_object('estado', 'aplicado');
end $$;

create or replace function public.asignar_tecnico(p_tecnico text, p_equipo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin();
begin
  if p_equipo is not null and not exists (select 1 from equipos where id = p_equipo and activo) then raise exception 'Equipo no encontrado'; end if;
  update tecnicos set equipo_id = p_equipo where id = p_tecnico;
  if not found then raise exception 'Técnico no encontrado'; end if;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- ---------- Dotación ----------
create or replace function public.alta_dotacion(p_dotacion jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); v_id text := p_dotacion->>'id';
begin
  if exists (select 1 from dotacion where id = v_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  insert into dotacion (id, clase, nombre, marca, serie, talla, cantidad, caduca, equipo_id, tecnico_id)
  values (v_id, p_dotacion->>'clase', trim(p_dotacion->>'nombre'), coalesce(p_dotacion->>'marca', ''), coalesce(p_dotacion->>'serie', ''),
          nullif(p_dotacion->>'talla', ''), coalesce((p_dotacion->>'cantidad')::int, 1), nullif(p_dotacion->>'caduca', '')::date,
          nullif(p_dotacion->>'equipo_id', ''), nullif(p_dotacion->>'tecnico_id', ''));
  insert into costes_dotacion (id, valor) values (v_id, coalesce((p_dotacion->>'valor')::numeric, 0));
  insert into dotacion_historial (id, dotacion_id, tipo, nota, usuario, operario) values (gen_random_uuid(), v_id, 'alta', 'Alta en la dotación', p.id, p.nombre);
  return jsonb_build_object('estado', 'aplicado');
end $$;

create or replace function public.asignar_dotacion(p_id uuid, p_dotacion text, p_equipo text, p_tecnico text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); d dotacion; eq text := p_equipo; quien text;
begin
  if exists (select 1 from dotacion_historial where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  select * into d from dotacion where id = p_dotacion for update;
  if not found then raise exception 'Ficha no encontrada'; end if;
  if d.estado = 'baja' then raise exception 'Una herramienta de baja no se puede asignar'; end if;
  if p_tecnico is not null then
    if not exists (select 1 from tecnicos where id = p_tecnico) then raise exception 'Técnico no encontrado'; end if;
    eq := coalesce(p_equipo, (select equipo_id from tecnicos where id = p_tecnico));
  end if;
  update dotacion set equipo_id = eq, tecnico_id = p_tecnico where id = d.id;
  quien := coalesce(nullif(concat_ws(' · ', (select nombre from equipos where id = eq), (select nombre from tecnicos where id = p_tecnico)), ''), 'Almacén (sin asignar)');
  insert into dotacion_historial (id, dotacion_id, tipo, nota, usuario, operario) values (p_id, d.id, 'asignacion', 'Asignada a ' || quien, p.id, p.nombre);
  return jsonb_build_object('estado', 'aplicado');
end $$;

create or replace function public.registrar_incidencia(
  p_id uuid, p_dotacion text, p_tipo text, p_nota text default '', p_coste numeric default null,
  p_serie_nueva text default null, p_caduca_nueva date default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p perfiles := perfil_actual(); d dotacion; posibles text[]; destino text; anterior text;
begin
  if exists (select 1 from dotacion_historial where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  select * into d from dotacion where id = p_dotacion for update;
  if not found then raise exception 'Ficha no encontrada'; end if;
  posibles := case d.estado
    when 'operativa' then array['deterioro', 'rotura', 'perdida', 'baja']
    when 'deteriorada' then array['reparacion', 'rotura', 'perdida', 'reposicion', 'baja']
    when 'rota' then array['reparacion', 'reposicion', 'baja']
    when 'perdida' then array['reposicion', 'baja']
    else array[]::text[] end;
  if not (p_tipo = any(posibles)) then raise exception 'No se puede registrar % en una ficha %', p_tipo, d.estado; end if;
  -- el almacén registra roturas, pérdidas y deterioro; reparar, reponer y dar de baja es cosa del administrador
  if p_tipo in ('reparacion', 'reposicion', 'baja') and p.rol <> 'admin' then
    raise exception 'Solo el administrador puede registrar %', p_tipo using errcode = '42501';
  end if;
  if p_coste is not null and p_coste < 0 then raise exception 'El coste no puede ser negativo'; end if;
  destino := case p_tipo when 'deterioro' then 'deteriorada' when 'rotura' then 'rota' when 'perdida' then 'perdida' when 'baja' then 'baja' else 'operativa' end;
  if p_tipo = 'reposicion' then
    if nullif(trim(p_serie_nueva), '') = d.serie then raise exception 'La unidad nueva debe tener otro n.º de serie'; end if;
    anterior := d.serie;
    update dotacion set serie = coalesce(nullif(trim(p_serie_nueva), ''), serie), caduca = coalesce(p_caduca_nueva, caduca) where id = d.id;
  end if;
  update dotacion set estado = destino,
    equipo_id = case when p_tipo = 'baja' then null else equipo_id end,
    tecnico_id = case when p_tipo = 'baja' then null else tecnico_id end
  where id = d.id;
  insert into dotacion_historial (id, dotacion_id, tipo, nota, serie_anterior, usuario, operario)
  values (p_id, d.id, p_tipo, coalesce(trim(p_nota), ''), anterior, p.id, p.nombre);
  if p_coste is not null and p.rol = 'admin' then insert into costes_incidencia (incidencia_id, coste) values (p_id, p_coste); end if;
  return jsonb_build_object('estado', 'aplicado', 'estado_ficha', destino);
end $$;
