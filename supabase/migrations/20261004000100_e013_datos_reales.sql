-- E-013 · Simplificar y pasar a datos reales (decisiones del usuario del 30/09/2026, prevalecen sobre E-002, E-006, E-008 y E-009):
-- 1. Sin precios en la app (las tablas costes_* quedan sin uso). Las mermas se aplican al momento y se informa al administrador.
-- 2. Formatos de venta: unidad (m, ud, bote, sobre, bolsa, pack, caja) con su contenido. En el almacén se mueven formatos enteros.
-- 3. Sin números de serie: cargadores y medidores por modelo y cantidad.
-- 4. Sin pasillo/estantería: el material está en el ALMACÉN o en el VEHÍCULO de un equipo. Entregar es un traspaso almacén → vehículo.
--    Técnico, equipo y vehículo son independientes, con historial de asignaciones.
-- Además: borrado único de la demostración e importación del catálogo real.

-- =====================================================================================================
-- 0. Configuración de la instalación y auditoría
-- =====================================================================================================
create table public.config_app (
  id               int primary key default 1 check (id = 1),
  modo_demo        boolean not null default true,     -- mientras sea true, se pueden borrar los datos de ejemplo (una vez)
  demo_borrada     timestamptz,
  demo_borrada_por text
);
-- Solo hay "datos de ejemplo" que borrar si la base ya tenía artículos (la demo); una instalación nueva empieza vacía
insert into public.config_app (id, modo_demo) values (1, exists (select 1 from public.productos));

create table public.auditoria (
  id       uuid primary key default gen_random_uuid(),
  ts       timestamptz not null default now(),
  usuario  uuid references public.perfiles(id),
  operario text not null,
  accion   text not null,
  detalle  jsonb not null default '{}'
);

-- Las tablas de historial solo se pueden vaciar dentro de limpiar_demostracion(): la marca vive solo en esa transacción
create or replace function public._limpiando() returns boolean language sql stable as $$
  select coalesce(current_setting('almacen.limpieza_demo', true), '') = 'si'
$$;
create or replace function public._prohibir_cambios() returns trigger language plpgsql as $$
begin
  if _limpiando() then return coalesce(new, old); end if;
  raise exception 'El historial no se puede modificar ni borrar: registra un ajuste con su motivo' using errcode = '42501';
end $$;
create or replace function public._albaranes_inalterables() returns trigger language plpgsql as $$
begin
  if _limpiando() then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and old.lineas = 0 and (to_jsonb(new) - 'lineas' - 'unidades') = (to_jsonb(old) - 'lineas' - 'unidades') then return new; end if;
  raise exception 'Un albarán ingresado no se puede modificar ni borrar' using errcode = '42501';
end $$;

-- =====================================================================================================
-- 1. Sin precios · mermas al momento con aviso al administrador
-- =====================================================================================================
comment on table public.costes_producto is 'SIN USO desde E-013 (30/09/2026): la app no maneja precios. Se conserva por los datos.';
comment on table public.costes_dotacion is 'SIN USO desde E-013 (30/09/2026).';
comment on table public.costes_incidencia is 'SIN USO desde E-013 (30/09/2026).';

-- Las mermas quedan en la bandeja del administrador como aviso informativo ("aplicada"), que marca como vista
alter table public.pendientes drop constraint pendientes_estado_check;
alter table public.pendientes add constraint pendientes_estado_check check (estado in ('pendiente', 'aprobado', 'rechazado', 'aplicada', 'vista'));
create or replace function public._pendientes_inalterables() returns trigger language plpgsql as $$
begin
  if _limpiando() then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and ((old.estado = 'pendiente' and new.estado in ('aprobado', 'rechazado')) or (old.estado = 'aplicada' and new.estado = 'vista'))
     and (to_jsonb(new) - 'estado' - 'resuelto_por' - 'resuelto_ts' - 'nota_resolucion' - 'movimiento_id')
       = (to_jsonb(old) - 'estado' - 'resuelto_por' - 'resuelto_ts' - 'nota_resolucion' - 'movimiento_id') then
    return new;
  end if;
  raise exception 'Un pendiente resuelto no se puede modificar ni borrar' using errcode = '42501';
end $$;

alter table public.envios_aviso drop constraint envios_aviso_tipo_check;
alter table public.envios_aviso add constraint envios_aviso_tipo_check
  check (tipo in ('critico', 'resumen', 'recordatorio', 'prueba', 'solicitud', 'informe', 'incidencia_custodia', 'entrega', 'merma'));

-- =====================================================================================================
-- 2. Formatos de venta y 3. sin números de serie
-- =====================================================================================================
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.productos'::regclass and contype = 'c'
           and (pg_get_constraintdef(oid) like '%con_serie%' or pg_get_constraintdef(oid) like '%unidad%') loop
    execute format('alter table public.productos drop constraint %I', c.conname);
  end loop;
end $$;
update public.productos set con_serie = false;
alter table public.productos
  add constraint productos_unidad_check check (unidad in ('m', 'ud', 'bote', 'sobre', 'bolsa', 'pack', 'caja')),
  add constraint productos_sin_serie check (not con_serie),
  add column contenido numeric(12,3) not null default 1 check (contenido > 0),   -- unidades por formato (bote de 1000 tacos → 1000)
  add column minimo_definido boolean not null default true;                      -- false: tarea "Completar mínimo" del administrador
comment on column public.productos.ubicacion is 'SIN USO desde E-013: el material está en el almacén o en un vehículo (stock_vehiculo).';
comment on column public.productos.stock is 'Stock del ALMACÉN, en formatos de venta (enteros salvo en metros). Lo de los vehículos está en stock_vehiculo.';

-- El "formato de compra" antiguo (rollo de 100 m…) deja de contar: ahora la unidad ES el formato
update public.productos set formato = 1;
comment on column public.productos.formato is 'SIN USO desde E-013: la unidad (bote, sobre…) es el formato y su contenido va en "contenido".';

create or replace function public._es_formato_entero(p_unidad text) returns boolean language sql immutable as $$ select p_unidad <> 'm' $$;

-- =====================================================================================================
-- 4. Vehículos, asignaciones con historial y stock por vehículo
-- =====================================================================================================
alter table public.equipos alter column matricula drop not null, alter column flota set default '';
comment on column public.equipos.flota is 'SIN USO desde E-013: el vehículo es una entidad propia (vehiculos).';
comment on column public.equipos.matricula is 'SIN USO desde E-013: ver vehiculos.';
alter table public.tecnicos add column codigo text, add column telefono text;

create table public.vehiculos (
  id        text primary key,
  matricula text not null unique check (length(trim(matricula)) > 0),
  modelo    text not null default '',
  equipo_id text references public.equipos(id),     -- asignación actual (el historial está en asignaciones_vehiculo)
  activo    boolean not null default true
);
create unique index vehiculos_un_equipo on public.vehiculos (equipo_id) where equipo_id is not null and activo;

create table public.asignaciones_tecnico (
  id         uuid primary key default gen_random_uuid(),
  tecnico_id text not null references public.tecnicos(id),
  equipo_id  text not null references public.equipos(id),
  desde      timestamptz not null default now(),
  hasta      timestamptz,
  check (hasta is null or hasta >= desde)
);
create table public.asignaciones_vehiculo (
  id          uuid primary key default gen_random_uuid(),
  vehiculo_id text not null references public.vehiculos(id),
  equipo_id   text not null references public.equipos(id),
  desde       timestamptz not null default now(),
  hasta       timestamptz,
  check (hasta is null or hasta >= desde)
);
create index asig_vehiculo_equipo on public.asignaciones_vehiculo (equipo_id, desde);

-- Stock a bordo: en UNIDADES de contenido (un sobre de 25 RJ45 con 2 gastados son 23 ud). Puede quedar negativo (discrepancia).
create table public.stock_vehiculo (
  vehiculo_id text not null references public.vehiculos(id),
  sku         text not null references public.productos(sku),
  unidades    numeric(14,3) not null default 0,
  primary key (vehiculo_id, sku)
);

-- Lo que había: la matrícula de cada equipo pasa a ser un vehículo asignado a ese equipo; los técnicos, al historial
insert into public.vehiculos (id, matricula, modelo, equipo_id)
  select 'V-' || id, matricula, flota, id from public.equipos where coalesce(matricula, '') <> '' and activo;
insert into public.asignaciones_vehiculo (vehiculo_id, equipo_id, desde) select id, equipo_id, now() from public.vehiculos where equipo_id is not null;
insert into public.asignaciones_tecnico (tecnico_id, equipo_id, desde) select id, equipo_id, now() from public.tecnicos where equipo_id is not null and activo;

-- Vehículo de un equipo en una fecha (los cierres de E-012 usan la fecha del cierre, no la de hoy)
create or replace function public.vehiculo_de_equipo(p_equipo text, p_fecha timestamptz default now()) returns text
language sql stable security definer set search_path = public as $$
  select vehiculo_id from asignaciones_vehiculo
  where equipo_id = p_equipo and desde <= p_fecha and (hasta is null or hasta > p_fecha)
  order by desde desc limit 1
$$;

-- Movimientos con vehículo: traspaso (almacén → vehículo), devolución (vehículo → almacén) y consumo (E-012, desde el vehículo)
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.movimientos'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%tipo%' loop
    execute format('alter table public.movimientos drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.movimientos
  add constraint movimientos_tipo_check check (tipo in ('entrada', 'salida', 'merma', 'ajuste', 'traspaso', 'devolucion', 'consumo')),
  add constraint movimientos_signo_check check (tipo = 'ajuste' or cantidad > 0),
  add column vehiculo_id text references public.vehiculos(id),
  add column unidades numeric(14,3);   -- efecto en el vehículo, en unidades de contenido
create index movimientos_vehiculo on public.movimientos (vehiculo_id, ts desc) where vehiculo_id is not null;

-- ---------- Núcleo de movimientos del ALMACÉN (misma firma que antes; ahora exige formatos enteros y no usa series) ----------
create or replace function public._aplicar_movimiento(
  p public.perfiles, p_id uuid, p_sku text, p_tipo text, p_cantidad numeric, p_motivo text,
  p_referencia text, p_series text[], p_equipo text, p_entrega uuid, p_albaran uuid, p_corrige uuid
) returns numeric
language plpgsql security definer set search_path = public as $$
declare pr productos; delta numeric;
begin
  if p_tipo not in ('entrada', 'salida', 'merma', 'ajuste') then raise exception 'Tipo de movimiento no válido'; end if;
  if p_cantidad is null or p_cantidad = 0 then raise exception 'Indica una cantidad distinta de cero'; end if;
  if p_tipo <> 'ajuste' and p_cantidad < 0 then raise exception 'Indica una cantidad mayor que cero'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo del movimiento'; end if;
  select * into pr from productos where sku = p_sku for update;
  if not found then raise exception 'Producto no encontrado: %', p_sku; end if;
  if pr.borrador then raise exception '% está en borrador: el administrador debe completarla antes de moverla', pr.sku; end if;
  if _es_formato_entero(pr.unidad) and p_cantidad <> trunc(p_cantidad) then
    raise exception 'En el almacén % se mueve por % entero: indica un número sin decimales', pr.nombre, pr.unidad;
  end if;
  delta := case p_tipo when 'entrada' then p_cantidad when 'ajuste' then p_cantidad else -p_cantidad end;
  if pr.stock + delta < 0 then raise exception 'Solo hay % % de % en el almacén', _fmt(pr.stock), pr.unidad, pr.nombre; end if;
  if pr.propiedad = 'custodia' and p_tipo = 'salida' and coalesce(trim(p_referencia), '') = '' then
    raise exception 'Indica la obra o instalación de destino: % está en custodia de %', pr.nombre, (select nombre from propietarios where id = pr.propietario_id);
  end if;
  update productos set stock = stock + delta, actualizado = now() where sku = pr.sku;
  insert into movimientos (id, sku, tipo, cantidad, motivo, referencia, series, equipo_id, usuario, operario, corrige, entrega_id, albaran_id)
  values (p_id, pr.sku, p_tipo, p_cantidad, trim(p_motivo), coalesce(p_referencia, ''), '{}', p_equipo, p.id, p.nombre, p_corrige, p_entrega, p_albaran);
  if pr.propiedad = 'custodia' and p_tipo = 'merma' then perform _encolar_incidencia_custodia(pr, p_cantidad, p_motivo, p_referencia, '{}'); end if;
  return pr.stock + delta;
end $$;

-- ---------- Movimientos con VEHÍCULO ----------
-- traspaso: almacén −cantidad (formatos enteros) · vehículo +cantidad×contenido
-- devolucion: vehículo −cantidad×contenido · almacén +cantidad
-- merma / ajuste en el vehículo: solo el vehículo (cantidad en formatos, puede tener decimales: un sobre abierto)
create or replace function public._mover_vehiculo(
  p public.perfiles, p_id uuid, p_sku text, p_tipo text, p_vehiculo text, p_cantidad numeric, p_motivo text, p_referencia text, p_entrega uuid
) returns numeric
language plpgsql security definer set search_path = public as $$
declare pr productos; v vehiculos; u numeric; abordo numeric;
begin
  if p_tipo not in ('traspaso', 'devolucion', 'merma', 'ajuste') then raise exception 'Tipo de movimiento de vehículo no válido'; end if;
  if p_cantidad is null or p_cantidad = 0 or (p_tipo <> 'ajuste' and p_cantidad < 0) then raise exception 'Indica una cantidad mayor que cero'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo del movimiento'; end if;
  select * into v from vehiculos where id = p_vehiculo and activo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  select * into pr from productos where sku = upper(p_sku) for update;
  if not found then raise exception 'Producto no encontrado: %', p_sku; end if;
  if pr.borrador then raise exception '% está en borrador', pr.sku; end if;
  if p_tipo in ('traspaso', 'devolucion') and _es_formato_entero(pr.unidad) and p_cantidad <> trunc(p_cantidad) then
    raise exception '% se entrega y se devuelve por % entero', pr.nombre, pr.unidad;
  end if;
  u := p_cantidad * pr.contenido;
  select coalesce(unidades, 0) into abordo from stock_vehiculo where vehiculo_id = v.id and sku = pr.sku;
  abordo := coalesce(abordo, 0);
  if p_tipo = 'traspaso' then
    if pr.stock < p_cantidad then raise exception 'Solo hay % % de % en el almacén', _fmt(pr.stock), pr.unidad, pr.nombre; end if;
    if pr.stock - p_cantidad < reservado(pr.sku, p_entrega) then raise exception 'Hay % reservadas para entregas preparadas de %', _fmt(reservado(pr.sku, p_entrega)), pr.nombre; end if;
    update productos set stock = stock - p_cantidad, actualizado = now() where sku = pr.sku;
  elsif p_tipo = 'devolucion' then
    if abordo < u then raise exception 'El vehículo % solo lleva % % de %', v.matricula, _fmt(abordo / pr.contenido), pr.unidad, pr.nombre; end if;
    update productos set stock = stock + p_cantidad, actualizado = now() where sku = pr.sku;
    u := -u;
  elsif p_tipo = 'merma' then
    if abordo < u then raise exception 'El vehículo % solo lleva % % de %', v.matricula, _fmt(abordo / pr.contenido), pr.unidad, pr.nombre; end if;
    u := -u;
  end if;
  insert into stock_vehiculo (vehiculo_id, sku, unidades) values (v.id, pr.sku, u)
    on conflict (vehiculo_id, sku) do update set unidades = stock_vehiculo.unidades + excluded.unidades;
  insert into movimientos (id, sku, tipo, cantidad, motivo, referencia, series, equipo_id, vehiculo_id, unidades, usuario, operario, entrega_id)
  values (p_id, pr.sku, p_tipo, p_cantidad, trim(p_motivo), coalesce(p_referencia, ''), '{}', v.equipo_id, v.id, u, p.id, p.nombre, p_entrega);
  if pr.propiedad = 'custodia' and p_tipo = 'merma' then perform _encolar_incidencia_custodia(pr, p_cantidad, p_motivo, p_referencia, '{}'); end if;
  return abordo + u;
end $$;

-- Aviso al administrador de una merma: bandeja (informativo) + sus canales inmediatos
create or replace function public._avisar_merma(p public.perfiles, p_mov uuid, pr productos, p_cantidad numeric, p_motivo text, p_referencia text, p_donde text) returns void
language plpgsql security definer set search_path = public as $$
declare texto text;
begin
  texto := format('%s ha registrado una merma: %s %s de %s (%s). Motivo: %s%s.', p.nombre, _fmt(p_cantidad), pr.unidad, pr.nombre, p_donde, p_motivo,
                  case when coalesce(p_referencia, '') <> '' then ' · ' || p_referencia else '' end);
  insert into pendientes (id, tipo, sku, cantidad, motivo, referencia, usuario, operario, estado, movimiento_id)
  values (gen_random_uuid(), 'merma', pr.sku, p_cantidad, trim(p_motivo), coalesce(p_referencia, '') || case when p_donde <> 'almacén' then ' · ' || p_donde else '' end,
          p.id, p.nombre, 'aplicada', p_mov);
  if p.rol <> 'admin' then perform _encolar_inmediatos(null, 'merma', 'Merma registrada: ' || pr.nombre, texto); end if;
end $$;

drop function public.registrar_movimiento(uuid, text, text, numeric, text, text, text[], text, uuid);
create or replace function public.registrar_movimiento(
  p_id uuid, p_sku text, p_tipo text, p_cantidad numeric, p_motivo text,
  p_referencia text default '', p_series text[] default '{}', p_equipo text default null, p_corrige uuid default null, p_vehiculo text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := perfil_actual(); nuevo numeric; pr productos; v vehiculos;
begin
  if exists (select 1 from movimientos where id = p_id) or exists (select 1 from pendientes where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  if p_tipo = 'ajuste' and p.rol <> 'admin' then raise exception 'Solo el administrador puede hacer ajustes' using errcode = '42501'; end if;
  if p_tipo in ('traspaso', 'devolucion') and p_vehiculo is null then raise exception 'Indica el vehículo'; end if;
  select * into pr from productos where sku = upper(p_sku);
  if not found then raise exception 'Producto no encontrado: %', p_sku; end if;
  if p_vehiculo is not null then
    select * into v from vehiculos where id = p_vehiculo;
    nuevo := _mover_vehiculo(p, p_id, pr.sku, p_tipo, p_vehiculo, p_cantidad, p_motivo, p_referencia, null);
  else
    nuevo := _aplicar_movimiento(p, p_id, pr.sku, p_tipo, p_cantidad, p_motivo, p_referencia, '{}', p_equipo, null, null, p_corrige);
  end if;
  -- E-013: las mermas se aplican al momento, las registre quien las registre, y se informa al administrador
  if p_tipo = 'merma' then perform _avisar_merma(p, p_id, pr, p_cantidad, p_motivo, p_referencia, case when v.id is null then 'almacén' else 'vehículo ' || v.matricula end); end if;
  return jsonb_build_object('estado', 'aplicado', 'stock', nuevo);
end $$;

create or replace function public.marcar_merma_vista(p_pendiente uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin();
begin
  update pendientes set estado = 'vista', resuelto_por = p.nombre, resuelto_ts = now() where id = p_pendiente and estado = 'aplicada';
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- Recuento del almacén: sin importes (el campo "pasillo" pasa a ser la zona o categoría contada)
create or replace function public.registrar_recuento(p_id uuid, p_pasillo text, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := perfil_actual(); l jsonb; pr productos; d numeric; n int := 0;
begin
  if exists (select 1 from recuentos where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  insert into recuentos (id, pasillo, usuario, operario) values (p_id, p_pasillo, p.id, p.nombre);
  for l in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) loop
    select * into pr from productos where sku = upper(l->>'sku');
    if not found then raise exception 'Producto no encontrado: %', l->>'sku'; end if;
    if (l->>'contado')::numeric < 0 then raise exception 'La cantidad contada no puede ser negativa'; end if;
    d := (l->>'contado')::numeric - pr.stock;
    continue when d = 0;
    n := n + 1;
    if p.rol = 'admin' then
      perform _aplicar_movimiento(p, gen_random_uuid(), pr.sku, 'ajuste', d, 'Ajuste de inventario', 'Recuento ' || p_pasillo, '{}', null, null, null, null);
    else
      insert into pendientes (id, tipo, sku, cantidad, motivo, referencia, recuento_id, usuario, operario)
      values (gen_random_uuid(), 'recuento', pr.sku, d, 'Diferencia de recuento', 'Recuento ' || p_pasillo, p_id, p.id, p.nombre);
    end if;
  end loop;
  return jsonb_build_object('estado', case when p.rol = 'admin' then 'aplicado' else 'pendiente' end, 'diferencias', n);
end $$;

-- ---------- Equipos, vehículos y técnicos ----------
create or replace function public.guardar_equipo(p_equipo jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin();
begin
  if coalesce(trim(p_equipo->>'nombre'), '') = '' then raise exception 'Indica el nombre del equipo (como lo envía el wizard: "Búfala 1")'; end if;
  insert into equipos (id, nombre, flota, matricula, estado) values (p_equipo->>'id', trim(p_equipo->>'nombre'), '', null, coalesce(p_equipo->>'estado', 'depot'))
  on conflict (id) do update set nombre = excluded.nombre, estado = excluded.estado, activo = true;
  return jsonb_build_object('estado', 'aplicado');
end $$;

create or replace function public.guardar_vehiculo(p_vehiculo jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin();
begin
  if coalesce(trim(p_vehiculo->>'matricula'), '') = '' then raise exception 'Indica la matrícula'; end if;
  insert into vehiculos (id, matricula, modelo) values (p_vehiculo->>'id', upper(trim(p_vehiculo->>'matricula')), coalesce(trim(p_vehiculo->>'modelo'), ''))
  on conflict (id) do update set matricula = excluded.matricula, modelo = excluded.modelo, activo = true;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- Vehículo → equipo (o sin equipo, p. ej. en taller). Cierra la asignación anterior; el material va con el vehículo.
create or replace function public.asignar_vehiculo(p_vehiculo text, p_equipo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); v vehiculos; otro text;
begin
  select * into v from vehiculos where id = p_vehiculo and activo for update;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  if p_equipo is not null and not exists (select 1 from equipos where id = p_equipo and activo) then raise exception 'Equipo no encontrado'; end if;
  if v.equipo_id is not distinct from p_equipo then return jsonb_build_object('estado', 'duplicado'); end if;
  -- un equipo lleva un solo vehículo: si ya tenía otro, ese queda sin equipo
  select id into otro from vehiculos where equipo_id = p_equipo and activo and id <> v.id;
  if otro is not null then
    update asignaciones_vehiculo set hasta = now() where vehiculo_id = otro and hasta is null;
    update vehiculos set equipo_id = null where id = otro;
  end if;
  update asignaciones_vehiculo set hasta = now() where vehiculo_id = v.id and hasta is null;
  update vehiculos set equipo_id = p_equipo where id = v.id;
  if p_equipo is not null then insert into asignaciones_vehiculo (vehiculo_id, equipo_id) values (v.id, p_equipo); end if;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- Técnico → equipo con historial. Cambiar de equipo NO mueve material (el material es del vehículo).
create or replace function public.asignar_tecnico(p_tecnico text, p_equipo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); t tecnicos;
begin
  select * into t from tecnicos where id = p_tecnico for update;
  if not found then raise exception 'Técnico no encontrado'; end if;
  if p_equipo is not null and not exists (select 1 from equipos where id = p_equipo and activo) then raise exception 'Equipo no encontrado'; end if;
  if t.equipo_id is not distinct from p_equipo then return jsonb_build_object('estado', 'duplicado'); end if;
  update asignaciones_tecnico set hasta = now() where tecnico_id = t.id and hasta is null;
  update tecnicos set equipo_id = p_equipo where id = t.id;
  if p_equipo is not null then insert into asignaciones_tecnico (tecnico_id, equipo_id) values (t.id, p_equipo); end if;
  return jsonb_build_object('estado', 'aplicado');
end $$;

create or replace function public.guardar_tecnico(p_tecnico jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); e text := nullif(lower(trim(coalesce(p_tecnico->>'email', ''))), '');
begin
  if coalesce(trim(p_tecnico->>'nombre'), '') = '' then raise exception 'Indica el nombre'; end if;
  if coalesce(p_tecnico->>'dni_mascara', '—') !~ '^(\*\*\*[0-9A-Z]{0,8}-?[A-Z]?|—)$' then raise exception 'DNI no válido: solo se guarda enmascarado'; end if;
  if e is not null and not _email_valido(e) then raise exception 'Correo no válido: %', e; end if;
  insert into tecnicos (id, nombre, rol, dni_mascara, email, codigo, telefono)
  values (p_tecnico->>'id', trim(p_tecnico->>'nombre'), coalesce(nullif(trim(p_tecnico->>'rol'), ''), 'Técnico'), coalesce(p_tecnico->>'dni_mascara', '—'), e,
          nullif(upper(trim(coalesce(p_tecnico->>'codigo', ''))), ''), nullif(trim(coalesce(p_tecnico->>'telefono', '')), ''))
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, dni_mascara = excluded.dni_mascara, activo = true,
    email = case when p_tecnico ? 'email' then excluded.email else tecnicos.email end,
    codigo = case when p_tecnico ? 'codigo' then excluded.codigo else tecnicos.codigo end,
    telefono = case when p_tecnico ? 'telefono' then excluded.telefono else tecnicos.telefono end;
  if nullif(p_tecnico->>'equipo_id', '') is not null then perform asignar_tecnico(p_tecnico->>'id', p_tecnico->>'equipo_id'); end if;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- Dar de baja no borra el historial: cierra sus asignaciones
create or replace function public.baja_tecnico(p_tecnico text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin();
begin
  perform asignar_tecnico(p_tecnico, null);
  update tecnicos set activo = false where id = p_tecnico;
  return jsonb_build_object('estado', 'aplicado');
end $$;
create or replace function public.baja_vehiculo(p_vehiculo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin();
begin
  if exists (select 1 from stock_vehiculo where vehiculo_id = p_vehiculo and unidades > 0) then raise exception 'El vehículo aún lleva material: devuélvelo al almacén antes de darlo de baja'; end if;
  perform asignar_vehiculo(p_vehiculo, null);
  update vehiculos set activo = false where id = p_vehiculo;
  return jsonb_build_object('estado', 'aplicado');
end $$;
create or replace function public.retirar_equipo(p_equipo text, p_destino text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); v text;
begin
  if exists (select 1 from tecnicos where equipo_id = p_equipo and activo) then raise exception 'El equipo aún tiene técnicos asignados'; end if;
  select id into v from vehiculos where equipo_id = p_equipo and activo;
  if v is not null then perform asignar_vehiculo(v, null); end if;
  update dotacion set equipo_id = p_destino where equipo_id = p_equipo;
  update equipos set activo = false where id = p_equipo;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- ---------- Entregas: el material de instalación entra en el vehículo del equipo; la dotación personal va al técnico ----------
alter table public.entregas add column vehiculo_id text references public.vehiculos(id);
create or replace function public._es_personal(pr productos) returns boolean language sql immutable as $$ select pr.categoria in ('ropa', 'epis') $$;

create or replace function public.preparar_entrega(
  p_id uuid, p_equipo text, p_receptor text, p_obra text, p_plantilla uuid, p_lineas jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u perfiles := perfil_actual(); t tecnicos; e entregas; l jsonb; i int := 0; num text; hasta timestamptz; pr productos; d dotacion; cant numeric; veh text;
begin
  select * into e from entregas where id = p_id;
  if found then return jsonb_build_object('estado', 'duplicado', 'numero', e.numero); end if;
  if not exists (select 1 from equipos where id = p_equipo and activo) then raise exception 'Equipo no encontrado'; end if;
  select * into t from tecnicos where id = p_receptor and activo;
  if not found then raise exception 'Receptor no encontrado'; end if;
  if t.equipo_id is distinct from p_equipo then raise exception '% no pertenece a ese equipo', t.nombre; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'La entrega no tiene material'; end if;
  veh := (select id from vehiculos where equipo_id = p_equipo and activo);
  hasta := now() + make_interval(hours => (select horas_reserva from config_avisos where id = 1));
  num := format('ENT-%s-%s', extract(year from now())::int, lpad(nextval('entregas_numero')::text, 4, '0'));
  insert into entregas (id, numero, equipo_id, receptor_id, dni, firma, hash, usuario, operario, estado, plantilla_id, obra, caduca, vehiculo_id)
  values (p_id, num, p_equipo, p_receptor, t.dni_mascara, null, null, u.id, u.nombre, 'preparada', null, coalesce(p_obra, ''), hasta, veh);
  for l in select * from jsonb_array_elements(p_lineas) loop
    i := i + 1;
    if coalesce(l->>'tipo', 'stock') = 'herramienta' then
      select * into d from dotacion where id = l->>'dotacion_id' for update;
      if not found then raise exception 'Herramienta no encontrada'; end if;
      if d.estado <> 'operativa' or d.equipo_id is not null or d.tecnico_id is not null then raise exception '% (%) no está libre en el almacén', d.nombre, d.serie; end if;
      if exists (select 1 from reservas where dotacion_id = d.id and caduca > now()) then raise exception '% (%) ya está reservada para otra entrega', d.nombre, d.serie; end if;
      insert into entrega_lineas (entrega_id, n, tipo, dotacion_id, cantidad) values (p_id, i, 'herramienta', d.id, 1);
      insert into reservas (entrega_id, n, dotacion_id, cantidad, caduca) values (p_id, i, d.id, 0, hasta);
    else
      select * into pr from productos where sku = upper(l->>'sku');
      if not found then raise exception 'Producto no encontrado: %', l->>'sku'; end if;
      if pr.borrador then raise exception '% está en borrador', pr.sku; end if;
      cant := (l->>'cantidad')::numeric;
      if cant is null or cant <= 0 then raise exception 'Cantidad no válida en %', pr.nombre; end if;
      if _es_formato_entero(pr.unidad) and cant <> trunc(cant) then raise exception '% se entrega por % entero', pr.nombre, pr.unidad; end if;
      if not _es_personal(pr) and veh is null then
        raise exception 'El equipo % no tiene vehículo asignado: asígnale uno en Equipos para entregarle material de instalación', (select nombre from equipos where id = p_equipo);
      end if;
      if pr.stock - reservado(pr.sku) < cant then
        raise exception 'Solo hay % disponibles de % (el resto está reservado o no hay stock)', _fmt(greatest(pr.stock - reservado(pr.sku), 0)), pr.nombre;
      end if;
      insert into entrega_lineas (entrega_id, n, tipo, sku, cantidad, series) values (p_id, i, 'stock', pr.sku, cant, '{}');
      insert into reservas (entrega_id, n, sku, cantidad, series, caduca) values (p_id, i, pr.sku, cant, '{}', hasta);
    end if;
  end loop;
  return jsonb_build_object('estado', 'aplicado', 'numero', num, 'caduca', hasta);
end $$;

create or replace function public.confirmar_entrega(p_id uuid, p_firma text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := perfil_actual(); e entregas; l entrega_lineas; pr productos; nuevo_id text; h text; tec text; veh text; ref text;
begin
  select * into e from entregas where id = p_id for update;
  if not found then raise exception 'Entrega no encontrada'; end if;
  if e.estado = 'firmada' then return jsonb_build_object('estado', 'duplicado', 'numero', e.numero, 'hash', e.hash); end if;
  if e.estado <> 'preparada' then raise exception 'La entrega % está anulada', e.numero; end if;
  if e.caduca <= now() then raise exception 'La reserva de % ha caducado: prepárala de nuevo', e.numero; end if;
  if coalesce(p_firma, '') = '' then raise exception 'Falta la firma del receptor'; end if;
  tec := e.receptor_id;
  veh := (select id from vehiculos where equipo_id = e.equipo_id and activo);   -- el vehículo que el equipo tiene al firmar
  ref := e.numero || case when e.obra <> '' then ' · ' || e.obra else '' end;
  delete from reservas where entrega_id = p_id;
  for l in select * from entrega_lineas where entrega_id = p_id order by n loop
    if l.tipo = 'herramienta' then
      update dotacion set equipo_id = e.equipo_id, tecnico_id = tec where id = l.dotacion_id and estado = 'operativa';
      if not found then raise exception 'Una herramienta de la entrega ya no está disponible'; end if;
      insert into dotacion_historial (id, dotacion_id, tipo, nota, usuario, operario)
      values (gen_random_uuid(), l.dotacion_id, 'asignacion', 'Entregada en ' || e.numero || ' a ' || (select nombre from tecnicos where id = tec), u.id, u.nombre);
      continue;
    end if;
    select * into pr from productos where sku = l.sku;
    if _es_personal(pr) then
      -- dotación personal: sale del almacén y pasa al técnico
      perform _aplicar_movimiento(u, gen_random_uuid(), l.sku, 'salida', l.cantidad, 'Entrega de dotación personal', ref, '{}', e.equipo_id, p_id, null, null);
      nuevo_id := (case when pr.categoria = 'epis' then 'E' else 'R' end) || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      insert into dotacion (id, clase, nombre, marca, serie, talla, cantidad, equipo_id, tecnico_id)
      values (nuevo_id, case when pr.categoria = 'epis' then 'epi' else 'ropa' end, coalesce(pr.modelo, pr.nombre), pr.proveedor, '', pr.talla, ceil(l.cantidad)::int, e.equipo_id, tec);
      insert into dotacion_historial (id, dotacion_id, tipo, nota, usuario, operario) values (gen_random_uuid(), nuevo_id, 'alta', 'Entregada en ' || e.numero, u.id, u.nombre);
    else
      if veh is null then raise exception 'El equipo ya no tiene vehículo asignado: asígnale uno antes de firmar'; end if;
      perform _mover_vehiculo(u, gen_random_uuid(), l.sku, 'traspaso', veh, l.cantidad, 'Entrega a equipo', ref, p_id);
    end if;
  end loop;
  update entregas set estado = 'firmada', firma = p_firma, firmada_ts = now(), vehiculo_id = veh where id = p_id;
  h := _hash_entrega(p_id);
  update entregas set hash = h where id = p_id;
  perform _encolar_copia_entrega(p_id);
  return jsonb_build_object('estado', 'aplicado', 'numero', e.numero, 'hash', h);
end $$;
-- El vehículo se fija al firmar: se permite rellenarlo junto con la firma
create or replace function public._entregas_inalterables() returns trigger language plpgsql as $$
declare fijo text[] := array['id', 'numero', 'equipo_id', 'receptor_id', 'dni', 'plantilla_id', 'obra', 'usuario', 'operario'];
begin
  if _limpiando() then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' then
    if coalesce(old.hash, '') = '' and old.estado = new.estado and new.hash <> '' and (to_jsonb(new) - 'hash') = (to_jsonb(old) - 'hash') then return new; end if;
    if old.estado = 'preparada' and new.estado in ('firmada', 'anulada')
       and (select bool_and(to_jsonb(new) -> k = to_jsonb(old) -> k) from unnest(fijo) k) then return new; end if;
  end if;
  raise exception 'Una entrega firmada no se puede modificar ni borrar: corrígela con una devolución' using errcode = '42501';
end $$;
-- La entrega directa antigua (sin traspaso al vehículo) ya no se usa
revoke execute on function public.registrar_entrega(uuid, text, text, jsonb, text) from authenticated;

-- ---------- Productos: sin precio, sin serie, sin ubicación; unidad con contenido ----------
create or replace function public.guardar_producto(p_producto jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p perfiles := exigir_admin();
  v_sku text := upper(trim(p_producto->>'sku'));
  existe boolean;
  inicial numeric := coalesce((p_producto->>'stock_inicial')::numeric, 0);
  custodia boolean := coalesce(p_producto->>'propiedad', 'propia') = 'custodia';
begin
  if coalesce(v_sku, '') = '' then raise exception 'El SKU es obligatorio'; end if;
  select true into existe from productos where sku = v_sku;
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
    proveedor_habitual = excluded.proveedor_habitual, borrador = false,
    propiedad = excluded.propiedad, propietario_id = excluded.propietario_id, modelo = excluded.modelo, talla = excluded.talla, actualizado = now();
  if not coalesce(existe, false) and inicial > 0 then
    perform _aplicar_movimiento(p, gen_random_uuid(), v_sku, 'entrada', inicial, 'Alta de artículo', 'Stock inicial', '{}', null, null, null, null);
  end if;
  return jsonb_build_object('estado', 'aplicado', 'sku', v_sku);
end $$;

create or replace function public.fijar_minimos(p_cambios jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); c jsonb;
begin
  for c in select * from jsonb_array_elements(coalesce(p_cambios, '[]'::jsonb)) loop
    update productos set minimo = coalesce((c->>'minimo')::numeric, minimo), minimo_definido = true,
      objetivo = case when c ? 'objetivo' then nullif(c->>'objetivo', '')::numeric else objetivo end,
      proveedor_habitual = case when c ? 'proveedor_habitual' then nullif(trim(c->>'proveedor_habitual'), '') else proveedor_habitual end
    where sku = upper(c->>'sku');
  end loop;
  return jsonb_build_object('estado', 'aplicado');
end $$;

create or replace function public.crear_borrador_producto(p_sku text, p_ean text, p_nombre text, p_categoria text default 'aparamenta') returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := perfil_actual(); v text := upper(trim(coalesce(nullif(p_sku, ''), 'BORR-' || p_ean)));
begin
  if exists (select 1 from productos where sku = v or (nullif(p_ean, '') is not null and ean = p_ean)) then raise exception 'Ya existe una referencia con ese código'; end if;
  insert into productos (sku, ean, nombre, categoria, unidad, con_serie, borrador, minimo_definido)
  values (v, nullif(trim(p_ean), ''), coalesce(nullif(trim(p_nombre), ''), 'Borrador ' || v), coalesce(p_categoria, 'aparamenta'), 'ud', false, true, false);
  return jsonb_build_object('estado', 'aplicado', 'sku', v);
end $$;

-- ---------- Albaranes: sin series ----------
create or replace function public.aprobar_albaran(p_id uuid, p_cabecera jsonb, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := perfil_actual(); l jsonb; n int := 0; u numeric := 0;
begin
  if exists (select 1 from albaranes where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  insert into albaranes (id, numero, proveedor, cif, fecha, confianza, modo, usuario, operario)
  values (p_id, coalesce(p_cabecera->>'numero', ''), coalesce(p_cabecera->>'proveedor', ''), coalesce(p_cabecera->>'cif', ''), coalesce(p_cabecera->>'fecha', ''),
          nullif(p_cabecera->>'confianza', '')::numeric, coalesce(p_cabecera->>'modo', 'sim'), p.id, p.nombre);
  for l in select * from jsonb_array_elements(p_lineas) loop
    perform _aplicar_movimiento(p, gen_random_uuid(), upper(l->>'sku'), 'entrada', (l->>'cantidad')::numeric, 'Compra a proveedor',
                                'Albarán ' || coalesce(p_cabecera->>'numero', ''), '{}', null, null, p_id, null);
    n := n + 1; u := u + (l->>'cantidad')::numeric;
  end loop;
  update albaranes set lineas = n, unidades = u where id = p_id;
  return jsonb_build_object('estado', 'aplicado', 'lineas', n);
end $$;

-- =====================================================================================================
-- 5. Borrado de la demostración (una sola vez)
-- =====================================================================================================
create or replace function public.limpiar_demostracion() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); c config_app; fotos text[]; n jsonb;
begin
  select * into c from config_app where id = 1 for update;
  if not c.modo_demo then raise exception 'Los datos de ejemplo ya se borraron el % (por %)', to_char(c.demo_borrada at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'), c.demo_borrada_por; end if;
  select coalesce(array_agg(r), '{}') into fotos from (select unnest(array[foto, foto_mini]) r from productos) x where r is not null;
  n := jsonb_build_object('productos', (select count(*) from productos), 'movimientos', (select count(*) from movimientos), 'entregas', (select count(*) from entregas),
                          'equipos', (select count(*) from equipos), 'tecnicos', (select count(*) from tecnicos), 'dotacion', (select count(*) from dotacion));
  -- los bloqueos del historial se desactivan SOLO dentro de esta transacción
  perform set_config('almacen.limpieza_demo', 'si', true);
  truncate table envios_aviso, reservas, entrega_lineas, entregas, stock_vehiculo, movimientos, pendientes, recuentos, albaranes, avisos_reposicion,
    actas_custodia, series, costes_producto, costes_incidencia, dotacion_historial, costes_dotacion, dotacion, minimos_herramienta,
    plantilla_lineas, plantillas_entrega, tallas_tecnico, asignaciones_tecnico, asignaciones_vehiculo, vehiculos, tecnicos, equipos, productos;
  perform set_config('almacen.limpieza_demo', '', true);
  alter sequence entregas_numero restart with 1;
  alter sequence actas_numero restart with 1;
  update config_app set modo_demo = false, demo_borrada = now(), demo_borrada_por = p.nombre where id = 1;
  insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'limpiar_demostracion', n || jsonb_build_object('fotos', coalesce(array_length(fotos, 1), 0)));
  -- la app borra estas fotos del bucket (el administrador tiene permiso de borrado)
  return jsonb_build_object('estado', 'aplicado', 'borrado', n, 'fotos', to_jsonb(fotos));
end $$;

-- =====================================================================================================
-- 6. Importación del catálogo (CSV) · idempotente por SKU y albaranes
-- =====================================================================================================
create or replace function public.importar_catalogo(p_filas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); f jsonb; v_sku text; prop text; nuevos int := 0; existentes int := 0; aperturas int := 0; ref text; inicial numeric; un text;
begin
  for f in select * from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) loop
    v_sku := upper(trim(f->>'sku'));
    if coalesce(v_sku, '') = '' then raise exception 'Hay una fila sin SKU'; end if;
    un := lower(coalesce(nullif(trim(f->>'unidad'), ''), 'ud'));
    if un not in ('m', 'ud', 'bote', 'sobre', 'bolsa', 'pack', 'caja') then raise exception 'Unidad desconocida en %: %', v_sku, un; end if;
    prop := null;
    if coalesce(f->>'propiedad', 'propia') = 'custodia' then
      select id into prop from propietarios where upper(id) = upper(trim(f->>'propietario')) or lower(nombre) = lower(trim(f->>'propietario'));
      if prop is null then raise exception 'Propietario desconocido en %: %', v_sku, f->>'propietario'; end if;
    end if;
    if exists (select 1 from productos where sku = v_sku) then
      existentes := existentes + 1;
    else
      insert into productos (sku, ref_proveedor, nombre, categoria, unidad, contenido, minimo, minimo_definido, proveedor, propiedad, propietario_id, con_serie, borrador)
      values (v_sku, nullif(trim(f->>'ref_proveedor'), ''), trim(f->>'nombre'), f->>'categoria', un, coalesce(nullif(f->>'contenido', '')::numeric, 1),
              coalesce(nullif(f->>'minimo', '')::numeric, 0), nullif(f->>'minimo', '') is not null, coalesce(f->>'proveedor', ''),
              case when prop is null then 'propia' else 'custodia' end, prop, false, false);
      nuevos := nuevos + 1;
    end if;
    inicial := coalesce(nullif(f->>'stock_inicial', '')::numeric, 0);
    ref := 'Albaranes ' || coalesce(nullif(trim(f->>'albaranes'), ''), 'sin albarán');
    if inicial > 0 and not exists (select 1 from movimientos where sku = v_sku and motivo = 'Inventario de apertura' and referencia = ref) then
      perform _aplicar_movimiento(p, gen_random_uuid(), v_sku, 'entrada', inicial, 'Inventario de apertura', ref, '{}', null, null, null, null);
      aperturas := aperturas + 1;
    end if;
  end loop;
  insert into auditoria (usuario, operario, accion, detalle) values (p.id, p.nombre, 'importar_catalogo', jsonb_build_object('nuevos', nuevos, 'existentes', existentes, 'aperturas', aperturas));
  return jsonb_build_object('estado', 'aplicado', 'nuevos', nuevos, 'existentes', existentes, 'aperturas', aperturas);
end $$;

-- =====================================================================================================
-- Seguridad y tiempo real
-- =====================================================================================================
alter table public.config_app enable row level security;
alter table public.auditoria enable row level security;
alter table public.vehiculos enable row level security;
alter table public.asignaciones_tecnico enable row level security;
alter table public.asignaciones_vehiculo enable row level security;
alter table public.stock_vehiculo enable row level security;
revoke all on public.config_app, public.auditoria, public.vehiculos, public.asignaciones_tecnico, public.asignaciones_vehiculo, public.stock_vehiculo from anon, authenticated;
grant select on public.config_app, public.vehiculos, public.asignaciones_tecnico, public.asignaciones_vehiculo, public.stock_vehiculo to authenticated;
grant select on public.auditoria to authenticated;
create policy config_app_lectura on public.config_app for select to authenticated using (public.es_usuario_activo());
create policy auditoria_admin on public.auditoria for select to authenticated using (public.es_admin());
create policy vehiculos_lectura on public.vehiculos for select to authenticated using (public.es_usuario_activo());
create policy asig_tecnico_lectura on public.asignaciones_tecnico for select to authenticated using (public.es_usuario_activo());
create policy asig_vehiculo_lectura on public.asignaciones_vehiculo for select to authenticated using (public.es_usuario_activo());
create policy stock_vehiculo_lectura on public.stock_vehiculo for select to authenticated using (public.es_usuario_activo());
create trigger asig_tecnico_sin_borrado before delete on public.asignaciones_tecnico for each row execute function public._prohibir_cambios();
create trigger asig_vehiculo_sin_borrado before delete on public.asignaciones_vehiculo for each row execute function public._prohibir_cambios();

revoke execute on all functions in schema public from public, anon;
grant execute on function public.registrar_movimiento(uuid, text, text, numeric, text, text, text[], text, uuid, text), public.marcar_merma_vista(uuid),
  public.guardar_vehiculo(jsonb), public.asignar_vehiculo(text, text), public.asignar_tecnico(text, text), public.guardar_tecnico(jsonb),
  public.baja_tecnico(text), public.baja_vehiculo(text), public.retirar_equipo(text, text), public.guardar_equipo(jsonb),
  public.preparar_entrega(uuid, text, text, text, uuid, jsonb), public.confirmar_entrega(uuid, text), public.guardar_producto(jsonb),
  public.fijar_minimos(jsonb), public.crear_borrador_producto(text, text, text, text), public.aprobar_albaran(uuid, jsonb, jsonb),
  public.registrar_recuento(uuid, text, jsonb), public.limpiar_demostracion(), public.importar_catalogo(jsonb), public.vehiculo_de_equipo(text, timestamptz)
to authenticated;
revoke execute on function public._mover_vehiculo(perfiles, uuid, text, text, text, numeric, text, text, uuid), public._avisar_merma(perfiles, uuid, productos, numeric, text, text, text),
  public._es_formato_entero(text), public._es_personal(productos) from authenticated;
grant execute on function public.ping() to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.vehiculos, public.stock_vehiculo, public.asignaciones_tecnico, public.asignaciones_vehiculo, public.config_app;
  end if;
end $$;
