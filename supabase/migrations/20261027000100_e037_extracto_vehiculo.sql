-- E-037 · Extracto de un artículo en una furgoneta: todos sus movimientos con el saldo acumulado, el resumen y la comprobación
-- "saldo calculado = stock a bordo". Paginado y calculado aquí para no cargar todo el historial en la app.
-- Permisos: movimientos.ver (administrador, almacén y solo lectura). Un socio (E-034), solo para sus artículos en custodia y
-- sin nombres de personas ("Técnico del equipo" / "Búfala").

create or replace function public._tipo_extracto(m public.movimientos) returns text language sql immutable as $$
  select case
    when m.motivo = 'Retirada por el socio' or m.motivo like 'Anulación de retirada%' then 'retirada'
    when m.cierre_id is not null then case when m.motivo = 'Consumo en obra' then 'cierre' else 'correccion_cierre' end
    when m.entrega_id is not null or m.tipo = 'traspaso' then 'entrega'
    when m.motivo = 'Recuento de vehículo' then 'recuento'
    when m.motivo = 'Conversión de formato' or m.motivo like 'Corrección de conversión%' then 'conversion'
    when m.tipo = 'devolucion' then 'devolucion'
    when m.tipo = 'merma' then 'merma'
    when m.tipo = 'ajuste' then 'ajuste'
    else 'otro' end
$$;

create or replace function public.extracto_vehiculo(p_vehiculo text, p_sku text, p_desde timestamptz default null, p_hasta timestamptz default null,
                                                   p_tipo text default null, p_limite int default 200, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s text := _socio_actual(); pr productos; v_inicial numeric := 0; v_calc numeric; v_stock numeric; r jsonb;
        grupos text[] := case p_tipo when 'entregas' then array['entrega', 'devolucion', 'retirada'] when 'cierres' then array['cierre', 'correccion_cierre']
                                     when 'ajustes' then array['ajuste', 'recuento', 'conversion', 'merma'] else null end;
begin
  if s is null then perform perfil_actual();
  elsif not exists (select 1 from productos where sku = p_sku and propiedad = 'custodia' and propietario_id = s) then
    raise exception 'Solo puedes ver el material en custodia de tu empresa' using errcode = '42501';
  end if;
  select * into pr from productos where sku = p_sku;
  if not found then raise exception 'Producto no encontrado: %', p_sku; end if;
  select coalesce(unidades, 0) into v_stock from stock_vehiculo where vehiculo_id = p_vehiculo and sku = p_sku;
  select coalesce(sum(unidades), 0) into v_calc from movimientos where vehiculo_id = p_vehiculo and sku = p_sku and unidades is not null;
  if p_desde is not null then
    select coalesce(sum(unidades), 0) into v_inicial from movimientos where vehiculo_id = p_vehiculo and sku = p_sku and unidades is not null and ts < p_desde;
  end if;

  with todos as (
    select m.*, _tipo_extracto(m) tipo_x, sum(m.unidades) over (order by m.ts, m.id) saldo
    from movimientos m where m.vehiculo_id = p_vehiculo and m.sku = p_sku and m.unidades is not null
  ), rango as (
    select * from todos where (p_desde is null or ts >= p_desde) and (p_hasta is null or ts <= p_hasta)
  ), filtradas as (
    select * from rango where grupos is null or tipo_x = any(grupos)
  ), pagina as (
    select * from filtradas order by ts, id offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limite, 200), 1), 1000)
  )
  select jsonb_build_object(
    'saldoInicial', v_inicial,
    'total', (select count(*) from filtradas),
    'saldoFinal', coalesce((select saldo from rango order by ts desc, id desc limit 1), v_inicial),
    'stock', coalesce(v_stock, 0), 'saldoCalculado', v_calc,
    'resumen', jsonb_build_object(
      'entregado', (select coalesce(sum(unidades), 0) from rango where tipo_x = 'entrega'),
      'consumido', (select coalesce(sum(unidades), 0) from rango where tipo_x in ('cierre', 'correccion_cierre')),
      'ajustes', (select coalesce(sum(unidades), 0) from rango where tipo_x in ('ajuste', 'recuento', 'conversion', 'merma')),
      'otros', (select coalesce(sum(unidades), 0) from rango where tipo_x in ('devolucion', 'retirada', 'otro'))),
    'filas', coalesce((select jsonb_agg(f order by f->>'ts', f->>'id') from (
      select jsonb_strip_nulls(jsonb_build_object(
        'id', p.id, 'ts', p.ts, 'tipo', p.tipo_x, 'motivo', p.motivo, 'referencia', p.referencia, 'unidades', p.unidades, 'saldo', p.saldo,
        'quien', case when s is not null then case when p.tipo_x = 'entrega' then 'Técnico del equipo' else 'Búfala' end
                      else coalesce((select t.nombre from entregas e join tecnicos t on t.id = e.receptor_id where e.id = p.entrega_id), p.operario) end,
        'entrega', (select jsonb_build_object('id', e.id, 'numero', e.numero,
                      'firmo', case when s is not null then 'Técnico del equipo' else coalesce((select nombre from tecnicos where id = e.receptor_id), '') end)
                    from entregas e where e.id = p.entrega_id),
        'cierre', (select jsonb_build_object('id', c.id, 'numInst', c.num_inst, 'cliente', c.cliente, 'version', v.n, 'origen', coalesce(v.origen, c.origen), 'documento', coalesce(v.documento, ''))
                   from cierres c left join lateral (select n, origen, documento from cierre_versiones x where x.cierre_id = c.id and x.recibido <= p.ts + interval '5 seconds' order by n desc limit 1) v on true
                   where c.id = p.cierre_id),
        'pieza', (select jsonb_build_object('real', q.real, 'consumo', ceil(round(q.real / pr.contenido, 6)) * pr.contenido)
                  from (select sum(l.cantidad) real from cierre_lineas l where l.cierre_id = p.cierre_id and l.sku = p.sku and l.estado in ('aplicada', 'discrepancia', 'resuelta')) q
                  where p.tipo_x = 'cierre' and pr.pieza_entera and pr.contenido > 1 and q.real > 0 and ceil(round(q.real / pr.contenido, 6)) * pr.contenido <> q.real),
        'recuento', case when p.tipo_x = 'recuento' then jsonb_build_object('constaba', p.saldo - p.unidades, 'contado', p.saldo) end
      )) f from pagina p) x), '[]')
  ) into r;
  return r;
end $$;

-- Furgonetas cuyo stock a bordo no coincide con la suma de sus movimientos (para la comprobación de E-036)
create or replace function public.descuadres_a_bordo() returns table (vehiculo_id text, sku text, stock numeric, calculado numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform perfil_actual();
  return query
    select coalesce(s.vehiculo_id, m.vehiculo_id), coalesce(s.sku, m.sku), coalesce(s.unidades, 0), coalesce(m.u, 0)
    from stock_vehiculo s full join (select x.vehiculo_id, x.sku, sum(x.unidades) u from movimientos x where x.vehiculo_id is not null and x.unidades is not null group by 1, 2) m
      on m.vehiculo_id = s.vehiculo_id and m.sku = s.sku
    where abs(coalesce(s.unidades, 0) - coalesce(m.u, 0)) > 0.001;
end $$;

revoke execute on function public._tipo_extracto(public.movimientos) from public, anon, authenticated;
insert into public.permisos_funcion (funcion, permiso) values ('extracto_vehiculo', 'movimientos.ver'), ('descuadres_a_bordo', 'inventario.ver')
on conflict (funcion) do update set permiso = excluded.permiso;
revoke execute on function public.extracto_vehiculo(text, text, timestamptz, timestamptz, text, int, int), public.descuadres_a_bordo() from public, anon;
grant execute on function public.extracto_vehiculo(text, text, timestamptz, timestamptz, text, int, int), public.descuadres_a_bordo() to authenticated;
