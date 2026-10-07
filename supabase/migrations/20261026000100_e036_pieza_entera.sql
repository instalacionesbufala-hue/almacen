-- E-036 · El material se ve en la unidad en que se gasta (m o ud) y el consumo por pieza entera.
-- - mostrar_formato: el artículo se ve en su formato ("3 cajas") en lugar de en la unidad base ("300 m"). Por defecto, no.
--   (Solo cambia cómo lo muestra la app; el almacén sigue guardando formatos y los vehículos, unidades de contenido.)
-- - pieza_entera: cada cierre descuenta piezas enteras redondeando hacia arriba (62 m de tubo en barras de 3 m → 21 barras = 63 m).
--   Activada por defecto en los formatos "barra" (decisión del usuario, 07/10: PVC rígido y acero).
--   Los cierres ya aplicados no cambian solos: recalcular_consumo_piezas(sku, desde) los vuelve a sincronizar, con versión.

alter table public.productos
  add column if not exists mostrar_formato boolean not null default false,
  add column if not exists pieza_entera boolean not null default false;
update public.productos set pieza_entera = true where unidad = 'barra' and not pieza_entera;

-- guardar_producto: guarda las dos opciones (si no vienen, se conservan; en un alta, pieza entera por defecto en las barras)
do $$
declare d text; r record;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'guardar_producto';
  for r in select * from (values
      ('modelo, talla, notas, unidad_contenido, metros_sueltos)', 'modelo, talla, notas, unidad_contenido, metros_sueltos, mostrar_formato, pieza_entera)'),
      ('coalesce((p_producto->>''metros_sueltos'')::boolean, false))', 'coalesce((p_producto->>''metros_sueltos'')::boolean, false), coalesce((p_producto->>''mostrar_formato'')::boolean, false), coalesce((p_producto->>''pieza_entera'')::boolean, coalesce(p_producto->>''unidad'', '''') = ''barra''))'),
      ('metros_sueltos = case when p_producto ? ''metros_sueltos'' then excluded.metros_sueltos else productos.metros_sueltos end,',
       'metros_sueltos = case when p_producto ? ''metros_sueltos'' then excluded.metros_sueltos else productos.metros_sueltos end, mostrar_formato = case when p_producto ? ''mostrar_formato'' then excluded.mostrar_formato else productos.mostrar_formato end, pieza_entera = case when p_producto ? ''pieza_entera'' then excluded.pieza_entera else productos.pieza_entera end,'),
      ('''unidad_contenido'', ''metros_sueltos'']', '''unidad_contenido'', ''metros_sueltos'', ''mostrar_formato'', ''pieza_entera'']')
    ) t(a, b) loop
    if (length(d) - length(replace(d, r.a, ''))) / length(r.a) <> 1 then raise exception 'E-036: guardar_producto no tiene una sola vez: %', r.a; end if;
    d := replace(d, r.a, r.b);
  end loop;
  execute d;
end $$;

-- _sincronizar_cierre: el objetivo de un artículo "por pieza entera" se redondea hacia arriba a piezas enteras, por cierre
do $$
declare d text; a text := 'with objetivo as (select sku, sum(cantidad) q from cierre_lineas where cierre_id = ci.id and sku is not null and estado in (''aplicada'', ''discrepancia'', ''resuelta'') and not ci.desp_fallido group by sku)';
        b text := 'with objetivo as (select l.sku, case when p.pieza_entera and p.contenido > 1 then ceil(round(sum(l.cantidad) / p.contenido, 6)) * p.contenido else sum(l.cantidad) end q
                      from cierre_lineas l join productos p on p.sku = l.sku
                      where l.cierre_id = ci.id and l.sku is not null and l.estado in (''aplicada'', ''discrepancia'', ''resuelta'') and not ci.desp_fallido group by l.sku, p.pieza_entera, p.contenido)';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = '_sincronizar_cierre';
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'E-036: _sincronizar_cierre no tiene el objetivo esperado'; end if;
  execute replace(d, a, b);
end $$;

-- Recalcular los cierres ya aplicados de un artículo desde una fecha (tras activar o quitar "pieza entera")
create or replace function public.recalcular_consumo_piezas(p_sku text, p_desde timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); pr productos; ci cierres; antes jsonb; dif jsonb; n int := 0; total numeric := 0;
begin
  select * into pr from productos where sku = upper(trim(coalesce(p_sku, '')));
  if not found then raise exception 'Producto no encontrado: %', p_sku; end if;
  for ci in select c.* from cierres c where c.fecha_cierre >= coalesce(p_desde, '-infinity') and c.vehiculo_id is not null and c.estado not in ('ignorado', 'fallido', 'sin_vehiculo')
              and exists (select 1 from cierre_lineas l where l.cierre_id = c.id and l.sku = pr.sku) order by c.fecha_cierre for update loop
    antes := _consumo_cierre(ci.id);
    perform _sincronizar_cierre(ci.id);
    continue when _consumo_cierre(ci.id) = antes;
    dif := _version_admin_cierre(ci.id, antes, format('Consumo de %s recalculado por %s (%s)', pr.nombre, u.nombre, case when pr.pieza_entera then 'por pieza entera' else 'sin redondear' end));
    n := n + 1;
    total := total + coalesce((select sum((x->>'unidades')::numeric) from jsonb_array_elements(dif) x where x->>'sku' = pr.sku), 0);
  end loop;
  insert into auditoria (usuario, operario, accion, detalle)
  values (u.id, u.nombre, 'recalcular_consumo_piezas', jsonb_build_object('sku', pr.sku, 'desde', p_desde, 'pieza_entera', pr.pieza_entera, 'cierres', n, 'unidades', total));
  return jsonb_build_object('estado', 'aplicado', 'cierres', n, 'unidades', total);
end $$;

insert into public.permisos_funcion (funcion, permiso) values ('recalcular_consumo_piezas', 'cierres.modificar')
on conflict (funcion) do update set permiso = excluded.permiso;
revoke execute on function public.recalcular_consumo_piezas(text, timestamptz) from public, anon;
grant execute on function public.recalcular_consumo_piezas(text, timestamptz) to authenticated;
