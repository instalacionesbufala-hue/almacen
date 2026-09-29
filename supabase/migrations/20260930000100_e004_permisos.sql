-- E-004 · Usuarios y permisos: pendientes de validar, borradores de referencia, recuentos y gestión de perfiles.
-- Roles: admin (todo) y almacen (operativa diaria). Las reglas se aplican aquí; la interfaz solo oculta.

-- ---------- Pendientes de validar (mermas > 50 € o de custodia, y diferencias de recuento del almacén) ----------
create table public.recuentos (
  id       uuid primary key,                         -- UUID del cliente (idempotencia)
  ts       timestamptz not null default now(),
  pasillo  text not null,
  usuario  uuid references public.perfiles(id),
  operario text not null
);

create table public.pendientes (
  id              uuid primary key,
  ts              timestamptz not null default now(),
  tipo            text not null check (tipo in ('merma', 'recuento')),
  sku             text not null references public.productos(sku),
  cantidad        numeric(14,3) not null check (cantidad <> 0),  -- merma: unidades (> 0); recuento: diferencia con signo
  motivo          text not null,
  referencia      text not null default '',
  series          text[] not null default '{}',
  valor_estimado  numeric(12,2),                                 -- solo lo ve el administrador (se lee con función)
  recuento_id     uuid references public.recuentos(id),
  usuario         uuid references public.perfiles(id),
  operario        text not null,
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  resuelto_por    text,
  resuelto_ts     timestamptz,
  nota_resolucion text,
  movimiento_id   uuid references public.movimientos(id)
);
create index pendientes_abiertos on public.pendientes (ts) where estado = 'pendiente';

-- Una vez resuelto, un pendiente no cambia
create or replace function public._pendientes_inalterables() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.estado = 'pendiente' and new.estado in ('aprobado', 'rechazado')
     and (to_jsonb(new) - 'estado' - 'resuelto_por' - 'resuelto_ts' - 'nota_resolucion' - 'movimiento_id')
       = (to_jsonb(old) - 'estado' - 'resuelto_por' - 'resuelto_ts' - 'nota_resolucion' - 'movimiento_id') then
    return new;
  end if;
  raise exception 'Un pendiente resuelto no se puede modificar ni borrar' using errcode = '42501';
end $$;
create trigger pendientes_inalterables before update or delete on public.pendientes for each row execute function public._pendientes_inalterables();
create trigger recuentos_inalterables before update or delete on public.recuentos for each row execute function public._prohibir_cambios();

-- ---------- registrar_movimiento: las mermas del almacén por encima de 50 € (o de custodia) quedan pendientes ----------
create or replace function public.registrar_movimiento(
  p_id uuid, p_sku text, p_tipo text, p_cantidad numeric, p_motivo text,
  p_referencia text default '', p_series text[] default '{}', p_equipo text default null, p_corrige uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := perfil_actual(); nuevo numeric; pr productos; v numeric;
begin
  if exists (select 1 from movimientos where id = p_id) or exists (select 1 from pendientes where id = p_id) then
    return jsonb_build_object('estado', 'duplicado');
  end if;
  if p_tipo = 'ajuste' and p.rol <> 'admin' then
    raise exception 'Solo el administrador puede hacer ajustes' using errcode = '42501';
  end if;
  if p_equipo is not null and not exists (select 1 from equipos where id = p_equipo) then raise exception 'Equipo no encontrado'; end if;

  if p_tipo = 'merma' and p.rol <> 'admin' then
    select * into pr from productos where sku = upper(p_sku);
    if not found then raise exception 'Producto no encontrado: %', p_sku; end if;
    if p_cantidad is null or p_cantidad <= 0 then raise exception 'Indica una cantidad mayor que cero'; end if;
    if p_cantidad > pr.stock then raise exception 'Solo hay % % de %', _fmt(pr.stock), pr.unidad, pr.nombre; end if;
    if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo del movimiento'; end if;
    v := p_cantidad * (select precio from costes_producto where sku = pr.sku);
    -- material en custodia: no tiene precio y el depositante debe saberlo → siempre lo valida el administrador
    if pr.propiedad = 'custodia' or coalesce(v, 0) > 50 then
      insert into pendientes (id, tipo, sku, cantidad, motivo, referencia, series, valor_estimado, usuario, operario)
      values (p_id, 'merma', pr.sku, p_cantidad, trim(p_motivo), coalesce(p_referencia, ''), coalesce(p_series, '{}'), v, p.id, p.nombre);
      return jsonb_build_object('estado', 'pendiente');
    end if;
  end if;

  nuevo := _aplicar_movimiento(p, p_id, upper(p_sku), p_tipo, p_cantidad, p_motivo, p_referencia, p_series, p_equipo, null, null, p_corrige);
  return jsonb_build_object('estado', 'aplicado', 'stock', nuevo);
end $$;

-- ---------- Recuento cíclico: el administrador ajusta; el almacén deja las diferencias pendientes ----------
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
      perform _aplicar_movimiento(p, gen_random_uuid(), pr.sku, 'ajuste', d, 'Ajuste de inventario', 'Recuento pasillo ' || p_pasillo, '{}', null, null, null, null);
    else
      insert into pendientes (id, tipo, sku, cantidad, motivo, referencia, valor_estimado, recuento_id, usuario, operario)
      values (gen_random_uuid(), 'recuento', pr.sku, d, 'Diferencia de recuento', 'Recuento pasillo ' || p_pasillo,
              d * (select precio from costes_producto where sku = pr.sku), p_id, p.id, p.nombre);
    end if;
  end loop;
  return jsonb_build_object('estado', case when p.rol = 'admin' then 'aplicado' else 'pendiente' end, 'diferencias', n);
end $$;

-- ---------- Validación de pendientes (administrador) ----------
create or replace function public.validar_pendiente(p_pendiente uuid, p_aprobar boolean, p_nota text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); pe pendientes; mid uuid := gen_random_uuid();
begin
  select * into pe from pendientes where id = p_pendiente for update;
  if not found then raise exception 'Pendiente no encontrado'; end if;
  if pe.estado <> 'pendiente' then return jsonb_build_object('estado', 'duplicado'); end if;
  if p_aprobar then
    if pe.tipo = 'merma' then
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

-- Importes de los pendientes: solo el administrador
create or replace function public.valores_pendientes() returns table (id uuid, valor numeric)
language sql stable security definer set search_path = public as $$
  select id, valor_estimado from pendientes where es_admin()
$$;

-- ---------- Referencias: borrador desde el escáner (cualquier usuario) y borrado (administrador) ----------
create or replace function public.crear_borrador_producto(p_sku text, p_ean text, p_nombre text, p_categoria text default 'aparamenta') returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := perfil_actual(); v text := upper(trim(coalesce(nullif(p_sku, ''), 'BORR-' || p_ean)));
begin
  if exists (select 1 from productos where sku = v or (nullif(p_ean, '') is not null and ean = p_ean)) then
    raise exception 'Ya existe una referencia con ese código';
  end if;
  insert into productos (sku, ean, nombre, categoria, unidad, con_serie, borrador)
  values (v, nullif(trim(p_ean), ''), coalesce(nullif(trim(p_nombre), ''), 'Borrador ' || v), coalesce(p_categoria, 'aparamenta'), 'ud',
          p_categoria = 'cargadores', true);
  return jsonb_build_object('estado', 'aplicado', 'sku', v);
end $$;

create or replace function public.borrar_producto(p_sku text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin();
begin
  if exists (select 1 from movimientos where sku = upper(p_sku)) or exists (select 1 from pendientes where sku = upper(p_sku)) then
    raise exception 'La referencia tiene historial: no se puede borrar (deja el mínimo a 0 si ya no se usa)';
  end if;
  if exists (select 1 from productos where sku = upper(p_sku) and stock <> 0) then raise exception 'Solo se puede borrar una referencia sin stock'; end if;
  delete from productos where sku = upper(p_sku);
  if not found then raise exception 'Producto no encontrado'; end if;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- ---------- Perfiles: rol y activación (el alta con contraseña la hace la función de servidor "usuarios") ----------
create or replace function public.actualizar_perfil(p_id uuid, p_nombre text, p_rol text, p_activo boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin();
begin
  if p_rol not in ('admin', 'almacen') then raise exception 'Rol no válido'; end if;
  if p_id = p.id and (p_rol <> 'admin' or not p_activo) then raise exception 'No puedes quitarte a ti mismo el acceso de administrador'; end if;
  update perfiles set nombre = coalesce(nullif(trim(p_nombre), ''), nombre), rol = p_rol, activo = p_activo where id = p_id;
  if not found then raise exception 'Usuario no encontrado'; end if;
  if not exists (select 1 from perfiles where rol = 'admin' and activo) then raise exception 'Tiene que quedar al menos un administrador activo'; end if;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- Los perfiles nunca se borran: su historial se conserva
create trigger perfiles_sin_borrado before delete on public.perfiles for each row execute function public._prohibir_cambios();

-- ---------- Seguridad de lo nuevo ----------
alter table public.pendientes enable row level security;
alter table public.recuentos enable row level security;
revoke all on public.pendientes, public.recuentos from anon, authenticated;
grant select (id, ts, tipo, sku, cantidad, motivo, referencia, series, recuento_id, usuario, operario, estado, resuelto_por, resuelto_ts, nota_resolucion, movimiento_id)
  on public.pendientes to authenticated;           -- valor_estimado queda fuera: se lee con valores_pendientes()
grant select on public.recuentos to authenticated;
create policy pendientes_lectura on public.pendientes for select to authenticated using (public.es_admin() or usuario = auth.uid());
create policy recuentos_lectura on public.recuentos for select to authenticated using (public.es_usuario_activo());

revoke execute on function public.registrar_recuento(uuid, text, jsonb), public.validar_pendiente(uuid, boolean, text), public.valores_pendientes(),
  public.crear_borrador_producto(text, text, text, text), public.borrar_producto(text), public.actualizar_perfil(uuid, text, text, boolean),
  public._pendientes_inalterables() from public, anon;
grant execute on function public.registrar_movimiento(uuid, text, text, numeric, text, text, text[], text, uuid),
  public.registrar_recuento(uuid, text, jsonb), public.validar_pendiente(uuid, boolean, text), public.valores_pendientes(),
  public.crear_borrador_producto(text, text, text, text), public.borrar_producto(text), public.actualizar_perfil(uuid, text, text, boolean)
to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.pendientes, public.perfiles;
  end if;
end $$;
