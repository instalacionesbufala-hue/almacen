-- E-007 · Plantillas de entrega a técnicos: preparar (reserva el stock), firmar y confirmar en el servidor (todo o nada).

-- ---------- Tallas de cada técnico (la talla NO va en la plantilla) ----------
create table public.tallas_tecnico (
  tecnico_id text primary key references public.tecnicos(id),
  camiseta   text,
  pantalon   text,
  calzado    text,
  guantes    text
);

-- ---------- Plantillas ----------
create table public.plantillas_entrega (
  id          uuid primary key,
  nombre      text not null check (length(trim(nombre)) > 0),
  descripcion text not null default '',
  modo_kit    boolean not null default false,   -- contenido objetivo de la furgoneta: se entrega solo la diferencia
  activa      boolean not null default true,
  actualizada timestamptz not null default now()
);
create table public.plantilla_lineas (
  plantilla_id uuid not null references public.plantillas_entrega(id) on delete cascade,
  n            int not null,
  tipo         text not null check (tipo in ('stock', 'modelo', 'herramienta')),
  sku          text references public.productos(sku),          -- tipo stock: una referencia concreta
  modelo       text,                                            -- tipo modelo (ropa/EPI por talla) o herramienta (modelo de dotación)
  tipo_talla   text check (tipo_talla in ('camiseta', 'pantalon', 'calzado', 'guantes')),
  cantidad     numeric(14,3) not null check (cantidad > 0),
  editable     boolean not null default true,
  primary key (plantilla_id, n),
  check ((tipo = 'stock' and sku is not null) or (tipo = 'modelo' and modelo is not null and tipo_talla is not null) or (tipo = 'herramienta' and modelo is not null))
);

-- ---------- Entregas: preparada → firmada | anulada ----------
alter table public.config_avisos add column horas_reserva int not null default 48 check (horas_reserva between 1 and 720);
alter table public.entregas
  add column estado       text not null default 'firmada' check (estado in ('preparada', 'firmada', 'anulada')),
  add column plantilla_id uuid references public.plantillas_entrega(id),
  add column obra         text not null default '',
  add column caduca       timestamptz,
  add column firmada_ts   timestamptz,
  add column anulada_ts   timestamptz,
  add column anulada_por  text,
  alter column firma drop not null,
  alter column hash drop not null;
update public.entregas set firmada_ts = ts where firmada_ts is null;
alter table public.entrega_lineas
  add column tipo        text not null default 'stock' check (tipo in ('stock', 'herramienta')),
  add column dotacion_id text references public.dotacion(id),
  alter column sku drop not null;
alter table public.entrega_lineas add constraint entrega_lineas_tipo_check2
  check ((tipo = 'stock' and sku is not null) or (tipo = 'herramienta' and dotacion_id is not null));

-- Reservas: lo apartado para una entrega preparada que aún no se ha firmado
create table public.reservas (
  entrega_id  uuid not null references public.entregas(id),
  n           int not null,
  sku         text references public.productos(sku),
  cantidad    numeric(14,3) not null default 0,
  series      text[] not null default '{}',
  dotacion_id text references public.dotacion(id),
  caduca      timestamptz not null,
  primary key (entrega_id, n)
);
create index reservas_sku on public.reservas (sku);

-- Una entrega preparada solo puede firmarse o anularse; una firmada o anulada no cambia
create or replace function public._entregas_inalterables() returns trigger language plpgsql as $$
declare fijo text[] := array['id', 'numero', 'equipo_id', 'receptor_id', 'dni', 'plantilla_id', 'obra', 'usuario', 'operario'];
begin
  if tg_op = 'UPDATE' then
    -- relleno de la huella al registrar (E-002)
    if coalesce(old.hash, '') = '' and old.estado = new.estado and new.hash <> '' and (to_jsonb(new) - 'hash') = (to_jsonb(old) - 'hash') then return new; end if;
    if old.estado = 'preparada' and new.estado in ('firmada', 'anulada')
       and (select bool_and(to_jsonb(new) -> k = to_jsonb(old) -> k) from unnest(fijo) k) then return new; end if;
  end if;
  raise exception 'Una entrega firmada no se puede modificar ni borrar: corrígela con una devolución' using errcode = '42501';
end $$;

-- ---------- Disponible = stock − reservado por otras entregas preparadas y vigentes ----------
create or replace function public.reservado(p_sku text, p_excepto uuid default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(cantidad), 0) from reservas where sku = p_sku and caduca > now() and entrega_id is distinct from p_excepto
$$;

-- _aplicar_movimiento respeta las reservas (una salida no puede llevarse lo apartado para otra entrega)
create or replace function public._comprobar_reservas(p_sku text, p_stock_final numeric, p_series text[], p_entrega uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare r numeric := reservado(p_sku, p_entrega); s text;
begin
  if p_stock_final < r then
    raise exception 'Hay % reservadas para entregas preparadas de %: no se pueden usar', _fmt(r), (select nombre from productos where sku = p_sku);
  end if;
  foreach s in array coalesce(p_series, '{}') loop
    if exists (select 1 from reservas where sku = p_sku and s = any(series) and caduca > now() and entrega_id is distinct from p_entrega) then
      raise exception 'El n.º de serie % está reservado para otra entrega preparada', s;
    end if;
  end loop;
end $$;

create or replace function public._trg_reservas_movimiento() returns trigger language plpgsql security definer set search_path = public as $$
declare pr productos;
begin
  if new.tipo in ('salida', 'merma') or (new.tipo = 'ajuste' and new.cantidad < 0) then
    select * into pr from productos where sku = new.sku;
    perform _comprobar_reservas(new.sku, pr.stock, new.series, new.entrega_id);   -- el stock ya está descontado
  end if;
  return new;
end $$;
create trigger movimientos_respetan_reservas after insert on public.movimientos for each row execute function public._trg_reservas_movimiento();

-- ---------- Preparar: guarda la entrega y reserva el stock (todo o nada) ----------
create or replace function public.preparar_entrega(
  p_id uuid, p_equipo text, p_receptor text, p_obra text, p_plantilla uuid, p_lineas jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u perfiles := perfil_actual(); t tecnicos; e entregas; l jsonb; i int := 0; num text; hasta timestamptz; pr productos; d dotacion; ser text[];
begin
  select * into e from entregas where id = p_id;
  if found then return jsonb_build_object('estado', 'duplicado', 'numero', e.numero); end if;
  if not exists (select 1 from equipos where id = p_equipo and activo) then raise exception 'Equipo no encontrado'; end if;
  select * into t from tecnicos where id = p_receptor and activo;
  if not found then raise exception 'Receptor no encontrado'; end if;
  if t.equipo_id is distinct from p_equipo then raise exception '% no pertenece a ese equipo', t.nombre; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'La entrega no tiene material'; end if;
  hasta := now() + make_interval(hours => (select horas_reserva from config_avisos where id = 1));
  num := format('ENT-%s-%s', extract(year from now())::int, lpad(nextval('entregas_numero')::text, 4, '0'));
  insert into entregas (id, numero, equipo_id, receptor_id, dni, firma, hash, usuario, operario, estado, plantilla_id, obra, caduca)
  values (p_id, num, p_equipo, p_receptor, t.dni_mascara, null, null, u.id, u.nombre, 'preparada', p_plantilla, coalesce(p_obra, ''), hasta);
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
      ser := coalesce(array(select jsonb_array_elements_text(l->'series')), '{}');
      if (l->>'cantidad')::numeric <= 0 then raise exception 'Cantidad no válida en %', pr.nombre; end if;
      if pr.stock - reservado(pr.sku) < (l->>'cantidad')::numeric then
        raise exception 'Solo hay % disponibles de % (el resto está reservado o no hay stock)', _fmt(greatest(pr.stock - reservado(pr.sku), 0)), pr.nombre;
      end if;
      if pr.con_serie then
        if coalesce(array_length(ser, 1), 0) <> (l->>'cantidad')::numeric then raise exception '%: indica los n.º de serie', pr.nombre; end if;
        if exists (select 1 from unnest(ser) s where not exists (select 1 from series where sku = pr.sku and serie = s and en_stock)) then raise exception 'Algún n.º de serie de % no está en stock', pr.nombre; end if;
        perform _comprobar_reservas(pr.sku, pr.stock, ser, null);
      end if;
      insert into entrega_lineas (entrega_id, n, tipo, sku, cantidad, series) values (p_id, i, 'stock', pr.sku, (l->>'cantidad')::numeric, ser);
      insert into reservas (entrega_id, n, sku, cantidad, series, caduca) values (p_id, i, pr.sku, (l->>'cantidad')::numeric, ser, hasta);
    end if;
  end loop;
  return jsonb_build_object('estado', 'aplicado', 'numero', num, 'caduca', hasta);
end $$;

-- ---------- Confirmar: movimientos, dotación, huella; si falla algo, no se aplica nada ----------
create or replace function public.confirmar_entrega(p_id uuid, p_firma text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := perfil_actual(); e entregas; l entrega_lineas; pr productos; nuevo_id text; h text; eq text; tec text;
begin
  select * into e from entregas where id = p_id for update;
  if not found then raise exception 'Entrega no encontrada'; end if;
  if e.estado = 'firmada' then return jsonb_build_object('estado', 'duplicado', 'numero', e.numero, 'hash', e.hash); end if;
  if e.estado <> 'preparada' then raise exception 'La entrega % está anulada', e.numero; end if;
  if e.caduca <= now() then raise exception 'La reserva de % ha caducado: prepárala de nuevo', e.numero; end if;
  if coalesce(p_firma, '') = '' then raise exception 'Falta la firma del receptor'; end if;
  eq := e.equipo_id; tec := e.receptor_id;
  delete from reservas where entrega_id = p_id;   -- lo reservado pasa a ser suyo
  for l in select * from entrega_lineas where entrega_id = p_id order by n loop
    if l.tipo = 'herramienta' then
      update dotacion set equipo_id = eq, tecnico_id = tec where id = l.dotacion_id and estado = 'operativa';
      if not found then raise exception 'Una herramienta de la entrega ya no está disponible'; end if;
      insert into dotacion_historial (id, dotacion_id, tipo, nota, usuario, operario)
      values (gen_random_uuid(), l.dotacion_id, 'asignacion', 'Entregada en ' || e.numero || ' a ' || (select nombre from tecnicos where id = tec), u.id, u.nombre);
    else
      perform _aplicar_movimiento(u, gen_random_uuid(), l.sku, 'salida', l.cantidad, 'Entrega a equipo',
                                  e.numero || case when e.obra <> '' then ' · ' || e.obra else '' end, l.series, eq, p_id, null, null);
      -- ropa y EPIs entregados pasan a la dotación del técnico (con su talla)
      select * into pr from productos where sku = l.sku;
      if pr.categoria in ('ropa', 'epis') then
        nuevo_id := (case when pr.categoria = 'epis' then 'E' else 'R' end) || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
        insert into dotacion (id, clase, nombre, marca, serie, talla, cantidad, equipo_id, tecnico_id)
        values (nuevo_id, case when pr.categoria = 'epis' then 'epi' else 'ropa' end, coalesce(pr.modelo, pr.nombre), pr.proveedor, '', pr.talla, ceil(l.cantidad)::int, eq, tec);
        insert into costes_dotacion (id, valor) values (nuevo_id, coalesce((select precio from costes_producto where sku = pr.sku), 0));
        insert into dotacion_historial (id, dotacion_id, tipo, nota, usuario, operario)
        values (gen_random_uuid(), nuevo_id, 'alta', 'Entregada en ' || e.numero, u.id, u.nombre);
      end if;
    end if;
  end loop;
  update entregas set estado = 'firmada', firma = p_firma, firmada_ts = now() where id = p_id;
  h := _hash_entrega(p_id);
  update entregas set hash = h where id = p_id;
  return jsonb_build_object('estado', 'aplicado', 'numero', e.numero, 'hash', h);
end $$;

create or replace function public.anular_entrega(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := perfil_actual(); e entregas;
begin
  select * into e from entregas where id = p_id for update;
  if not found then raise exception 'Entrega no encontrada'; end if;
  if e.estado = 'anulada' then return jsonb_build_object('estado', 'duplicado'); end if;
  if e.estado <> 'preparada' then raise exception 'Una entrega firmada no se anula: corrígela con una devolución'; end if;
  delete from reservas where entrega_id = p_id;
  update entregas set estado = 'anulada', anulada_ts = now(), anulada_por = u.nombre where id = p_id;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- Limpieza de reservas caducadas (la llama pg_cron; las caducadas ya no cuentan aunque sigan en la tabla)
create or replace function public.limpiar_reservas() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from reservas where caduca <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- La huella incluye ahora el tipo de línea y la herramienta entregada
create or replace function public._hash_entrega(p_id uuid) returns text
language sql stable security definer set search_path = public, extensions as $$
  select encode(extensions.digest(jsonb_build_object(
    'id', e.id, 'numero', e.numero, 'ts', floor(extract(epoch from e.ts) * 1000)::bigint,
    'equipo', e.equipo_id, 'receptor', e.receptor_id, 'dni', e.dni, 'firma', e.firma, 'obra', e.obra,
    'lineas', coalesce((select jsonb_agg(jsonb_build_object('sku', l.sku, 'qty', l.cantidad, 'serials', to_jsonb(l.series))
                                         || case when l.tipo = 'herramienta' then jsonb_build_object('dotacion', l.dotacion_id) else '{}'::jsonb end order by l.n)
                        from entrega_lineas l where l.entrega_id = e.id), '[]'::jsonb)
  )::text, 'sha256'), 'hex')
  from entregas e where e.id = p_id
$$;
create or replace function public.verificar_entregas() returns table (numero text, ok boolean)
language sql stable security definer set search_path = public as $$
  select e.numero, e.hash = _hash_entrega(e.id) from entregas e where es_usuario_activo() and e.estado = 'firmada' order by e.ts
$$;

-- ---------- Plantillas y tallas (administrador) ----------
create or replace function public.guardar_plantilla(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); v_id uuid := (p->>'id')::uuid; l jsonb; i int := 0;
begin
  if coalesce(trim(p->>'nombre'), '') = '' then raise exception 'Indica el nombre de la plantilla'; end if;
  insert into plantillas_entrega (id, nombre, descripcion, modo_kit, activa, actualizada)
  values (v_id, trim(p->>'nombre'), coalesce(p->>'descripcion', ''), coalesce((p->>'modo_kit')::boolean, false), coalesce((p->>'activa')::boolean, true), now())
  on conflict (id) do update set nombre = excluded.nombre, descripcion = excluded.descripcion, modo_kit = excluded.modo_kit, activa = excluded.activa, actualizada = now();
  delete from plantilla_lineas where plantilla_id = v_id;
  for l in select * from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) loop
    i := i + 1;
    insert into plantilla_lineas (plantilla_id, n, tipo, sku, modelo, tipo_talla, cantidad, editable)
    values (v_id, i, l->>'tipo', nullif(upper(l->>'sku'), ''), nullif(l->>'modelo', ''), nullif(l->>'tipo_talla', ''), (l->>'cantidad')::numeric, coalesce((l->>'editable')::boolean, true));
  end loop;
  return jsonb_build_object('estado', 'aplicado');
end $$;

create or replace function public.guardar_tallas(p_tecnico text, p_camiseta text, p_pantalon text, p_calzado text, p_guantes text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin();
begin
  if not exists (select 1 from tecnicos where id = p_tecnico) then raise exception 'Técnico no encontrado'; end if;
  insert into tallas_tecnico (tecnico_id, camiseta, pantalon, calzado, guantes) values (p_tecnico, nullif(p_camiseta, ''), nullif(p_pantalon, ''), nullif(p_calzado, ''), nullif(p_guantes, ''))
  on conflict (tecnico_id) do update set camiseta = excluded.camiseta, pantalon = excluded.pantalon, calzado = excluded.calzado, guantes = excluded.guantes;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- ---------- Justificantes en PDF (Supabase Storage) ----------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public) values ('justificantes', 'justificantes', false) on conflict (id) do nothing;
    execute $p$create policy justificantes_subir on storage.objects for insert to authenticated with check (bucket_id = 'justificantes' and public.es_usuario_activo())$p$;
    execute $p$create policy justificantes_leer on storage.objects for select to authenticated using (bucket_id = 'justificantes' and public.es_usuario_activo())$p$;
  end if;
end $$;

-- ---------- Seguridad ----------
alter table public.tallas_tecnico enable row level security;
alter table public.plantillas_entrega enable row level security;
alter table public.plantilla_lineas enable row level security;
alter table public.reservas enable row level security;
revoke all on public.tallas_tecnico, public.plantillas_entrega, public.plantilla_lineas, public.reservas from anon, authenticated;
grant select on public.tallas_tecnico, public.plantillas_entrega, public.plantilla_lineas, public.reservas to authenticated;
create policy tallas_lectura on public.tallas_tecnico for select to authenticated using (public.es_usuario_activo());
create policy plantillas_lectura on public.plantillas_entrega for select to authenticated using (public.es_usuario_activo());
create policy plantilla_lineas_lectura on public.plantilla_lineas for select to authenticated using (public.es_usuario_activo());
create policy reservas_lectura on public.reservas for select to authenticated using (public.es_usuario_activo());
create trigger reservas_inalterables before update on public.reservas for each row execute function public._prohibir_cambios();

revoke execute on all functions in schema public from public, anon;
grant execute on function public.preparar_entrega(uuid, text, text, text, uuid, jsonb), public.confirmar_entrega(uuid, text), public.anular_entrega(uuid),
  public.guardar_plantilla(jsonb), public.guardar_tallas(text, text, text, text, text), public.verificar_entregas(), public.reservado(text, uuid)
to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.plantillas_entrega, public.plantilla_lineas, public.tallas_tecnico, public.reservas;
  end if;
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('almacen-reservas', '*/15 * * * *', 'select public.limpiar_reservas()');
  end if;
end $$;
