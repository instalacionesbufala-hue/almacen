-- =====================================================================================================
-- E-018 · Ajuste de inventario
-- - ajustar_inventario: solo el administrador. Cantidad con signo, motivo obligatorio, en el almacén o en un vehículo.
--   Es un movimiento de tipo 'ajuste' (no cuenta como merma, ni como salida a obra, ni como consumo) y queda en la auditoría.
-- - proponer_ajuste: el personal de almacén lo propone; llega a la bandeja del administrador (pendientes, tipo 'ajuste').
-- - Albaranes: se guardan los códigos impresos en sus líneas, para avisar si se da de alta con stock inicial
--   un artículo cuyo código ya entró por un albarán.
-- =====================================================================================================
alter table public.pendientes drop constraint pendientes_tipo_check;
alter table public.pendientes add constraint pendientes_tipo_check check (tipo in ('merma', 'recuento', 'ajuste'));

alter table public.albaranes add column codigos text[] not null default '{}';
comment on column public.albaranes.codigos is 'E-018: códigos impresos en las líneas del albarán (aunque se emparejaran con otro artículo)';

-- Comprobaciones comunes del ajuste (y lo que hay antes, en formatos)
create or replace function public._antes_del_ajuste(p_sku text, p_cantidad numeric, p_motivo text, p_vehiculo text) returns numeric
language plpgsql security definer set search_path = public as $$
declare pr productos; v vehiculos; antes numeric;
begin
  if p_cantidad is null or p_cantidad = 0 then raise exception 'Indica una cantidad distinta de cero'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo del ajuste'; end if;
  select * into pr from productos where sku = upper(p_sku);
  if not found then raise exception 'Producto no encontrado: %', p_sku; end if;
  if pr.borrador then raise exception '% está en borrador: el administrador debe completarla antes de moverla', pr.sku; end if;
  if p_vehiculo is null then
    antes := pr.stock;
    if _es_formato_entero(pr.unidad) and p_cantidad <> trunc(p_cantidad) then
      raise exception 'En el almacén % se mueve por % entero: indica un número sin decimales', pr.nombre, pr.unidad;
    end if;
  else
    select * into v from vehiculos where id = p_vehiculo and activo;
    if not found then raise exception 'Vehículo no encontrado'; end if;
    antes := coalesce((select unidades from stock_vehiculo where vehiculo_id = v.id and sku = pr.sku), 0) / pr.contenido;
  end if;
  if antes + p_cantidad < 0 then
    raise exception 'No se puede dejar en negativo: % tiene % %', coalesce('el vehículo ' || v.matricula, 'el almacén'), _fmt(antes), pr.unidad;
  end if;
  return antes;
end $$;

create or replace function public.ajustar_inventario(p_id uuid, p_sku text, p_cantidad numeric, p_motivo text, p_vehiculo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := perfil_actual(); antes numeric; sku text := upper(p_sku);
begin
  if exists (select 1 from movimientos where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  if p.rol <> 'admin' then raise exception 'Solo el administrador puede hacer ajustes de inventario' using errcode = '42501'; end if;
  antes := _antes_del_ajuste(sku, p_cantidad, p_motivo, p_vehiculo);
  if p_vehiculo is null then
    perform _aplicar_movimiento(p, p_id, sku, 'ajuste', p_cantidad, trim(p_motivo), 'Ajuste de inventario', '{}', null, null, null, null);
  else
    perform _mover_vehiculo(p, p_id, sku, 'ajuste', p_vehiculo, p_cantidad, trim(p_motivo), 'Ajuste de inventario', null);
  end if;
  insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'ajuste_inventario', jsonb_build_object(
    'movimiento', p_id, 'sku', sku, 'cantidad', p_cantidad, 'de', antes, 'a', antes + p_cantidad, 'motivo', trim(p_motivo),
    'ubicacion', coalesce((select matricula from vehiculos where id = p_vehiculo), 'almacén')));
  return jsonb_build_object('estado', 'aplicado', 'de', antes, 'a', antes + p_cantidad);
end $$;

create or replace function public.proponer_ajuste(p_id uuid, p_sku text, p_cantidad numeric, p_motivo text, p_vehiculo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := perfil_actual();
begin
  if exists (select 1 from pendientes where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  perform _antes_del_ajuste(p_sku, p_cantidad, p_motivo, p_vehiculo);
  insert into pendientes (id, tipo, sku, cantidad, motivo, referencia, usuario, operario, vehiculo_id)
  values (p_id, 'ajuste', upper(p_sku), p_cantidad, trim(p_motivo), 'Ajuste propuesto por ' || p.nombre, p.id, p.nombre, p_vehiculo);
  return jsonb_build_object('estado', 'pendiente');
end $$;

-- La bandeja del administrador aplica los ajustes propuestos con su motivo (y quedan en la auditoría)
create or replace function public.validar_pendiente(p_pendiente uuid, p_aprobar boolean, p_nota text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); pe pendientes; mid uuid := gen_random_uuid(); antes numeric;
begin
  select * into pe from pendientes where id = p_pendiente for update;
  if not found then raise exception 'Pendiente no encontrado'; end if;
  if pe.estado <> 'pendiente' then return jsonb_build_object('estado', 'duplicado'); end if;
  if p_aprobar then
    if pe.tipo = 'ajuste' then
      antes := _antes_del_ajuste(pe.sku, pe.cantidad, pe.motivo, pe.vehiculo_id);
      if pe.vehiculo_id is not null then
        perform _mover_vehiculo(p, mid, pe.sku, 'ajuste', pe.vehiculo_id, pe.cantidad, pe.motivo, pe.referencia, null);
      else
        perform _aplicar_movimiento(p, mid, pe.sku, 'ajuste', pe.cantidad, pe.motivo, pe.referencia, '{}', null, null, null, null);
      end if;
      insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'ajuste_inventario', jsonb_build_object(
        'movimiento', mid, 'pendiente', pe.id, 'propuesto_por', pe.operario, 'sku', pe.sku, 'cantidad', pe.cantidad, 'de', antes, 'a', antes + pe.cantidad,
        'motivo', pe.motivo, 'ubicacion', coalesce((select matricula from vehiculos where id = pe.vehiculo_id), 'almacén')));
    elsif pe.vehiculo_id is not null then
      perform _mover_vehiculo(p, mid, pe.sku, 'ajuste', pe.vehiculo_id, pe.cantidad, 'Recuento de vehículo (validado)', pe.referencia, null);
    elsif pe.tipo = 'merma' then
      perform _aplicar_movimiento(p, mid, pe.sku, 'merma', pe.cantidad, pe.motivo, pe.referencia, pe.series, null, null, null, null);
    else
      perform _aplicar_movimiento(p, mid, pe.sku, 'ajuste', pe.cantidad, 'Ajuste de inventario (recuento validado)', pe.referencia, '{}', null, null, null, null);
    end if;
    update pendientes set estado = 'aprobado', resuelto_por = p.nombre, resuelto_ts = now(), nota_resolucion = coalesce(p_nota, ''), movimiento_id = mid where id = pe.id;
  else
    update pendientes set estado = 'rechazado', resuelto_por = p.nombre, resuelto_ts = now(), nota_resolucion = coalesce(p_nota, '') where id = pe.id;
  end if;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- Albaranes: además de las entradas, se guardan los códigos impresos en sus líneas
create or replace function public.aprobar_albaran(p_id uuid, p_cabecera jsonb, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := perfil_actual(); l jsonb; n int := 0; u numeric := 0;
begin
  if exists (select 1 from albaranes where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  insert into albaranes (id, numero, proveedor, delegacion, cif, fecha, confianza, modo, usuario, operario, codigos)
  values (p_id, coalesce(p_cabecera->>'numero', ''), coalesce(p_cabecera->>'proveedor', ''), coalesce(p_cabecera->>'delegacion', ''), coalesce(p_cabecera->>'cif', ''),
          coalesce(p_cabecera->>'fecha', ''), nullif(p_cabecera->>'confianza', '')::numeric, coalesce(p_cabecera->>'modo', 'sim'), p.id, p.nombre,
          coalesce((select array_agg(distinct c) from (select upper(regexp_replace(coalesce(x->>'codigo', ''), '\s', '', 'g')) c from jsonb_array_elements(p_lineas) x) q where c <> ''), '{}'));
  for l in select * from jsonb_array_elements(p_lineas) loop
    perform _aplicar_movimiento(p, gen_random_uuid(), upper(l->>'sku'), 'entrada', (l->>'cantidad')::numeric, 'Compra a proveedor',
                                'Albarán ' || coalesce(p_cabecera->>'numero', ''), '{}', null, null, p_id, null);
    n := n + 1; u := u + (l->>'cantidad')::numeric;
  end loop;
  update albaranes set lineas = n, unidades = u where id = p_id;
  return jsonb_build_object('estado', 'aplicado', 'lineas', n);
end $$;

revoke execute on function public._antes_del_ajuste(text, numeric, text, text) from public, anon, authenticated;
revoke execute on function public.ajustar_inventario(uuid, text, numeric, text, text), public.proponer_ajuste(uuid, text, numeric, text, text) from public, anon;
grant execute on function public.ajustar_inventario(uuid, text, numeric, text, text), public.proponer_ajuste(uuid, text, numeric, text, text) to authenticated;
