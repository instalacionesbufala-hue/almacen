-- =====================================================================================================
-- E-012 · Consumos de los cierres de instalación (wizard "bufala") desde el stock del VEHÍCULO del equipo
-- - El Apps Script del wizard envía cada cierre a la función "registrar-cierre" con la cabecera X-Integracion.
--   Del token solo se guarda el hash; se revoca desde Configuración → Integraciones. El token no lee nada.
-- - La traducción partidas → artículos (equivalencias, manguitos, fijaciones con kit, UTP según cargador) la hace el módulo
--   _compartido/cierres.ts; aquí se guarda el cierre, se aplica de forma idempotente (esbrainUuid o numInst + fecha) y, si llega
--   una versión nueva, solo la DIFERENCIA. Los consumos pueden dejar el vehículo en negativo: se marcan como discrepancia.
-- =====================================================================================================
alter table public.movimientos add column cierre_id uuid;
create index movimientos_cierre on public.movimientos (cierre_id) where cierre_id is not null;
alter table public.config_app
  add column kit_fijacion text not null default 'A' check (kit_fijacion in ('A', 'B', 'C')),
  add column apertura_cierres timestamptz;                    -- los cierres anteriores se ignoran (por defecto: el borrado de la demo)
alter table public.pendientes add column vehiculo_id text references public.vehiculos(id);   -- recuento de un vehículo

create table public.integraciones (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (length(trim(nombre)) > 0),
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  creado      timestamptz not null default now(),
  creado_por  text not null,
  revocado    timestamptz,
  ultimo_uso  timestamptz
);

create table public.equivalencias_cierre (
  id          text primary key,
  campo       text not null check (length(trim(campo)) > 0),
  formula     text not null check (formula in ('directa', 'manguitos', 'fijaciones', 'unidad')),
  condiciones jsonb not null default '{}',
  articulos   jsonb not null default '[]',                   -- [{sku, factor, nombre?}] en unidades de contenido por unidad de la partida
  kit         text check (kit in ('A', 'B', 'C')),
  estimada    boolean not null default false,
  activa      boolean not null default true,
  orden       int not null default 100,
  nota        text not null default '',
  confirmada  boolean not null default false,                 -- la propuesta llega como borrador; solo las confirmadas se aplican
  actualizado timestamptz not null default now()
);
create table public.kits_fijacion (
  kit       text primary key check (kit in ('A', 'B', 'C')),
  articulos jsonb not null default '[]'
);

create table public.cierres (
  id            uuid primary key default gen_random_uuid(),
  clave         text not null unique,
  version       int not null default 1,
  num_inst      text not null default '',
  esbrain_uuid  text not null default '',
  cliente       text not null default '',
  direccion     text not null default '',
  fecha_cierre  timestamptz not null,
  equipo_wizard text not null default '',
  equipo_id     text references public.equipos(id),
  vehiculo_id   text references public.vehiculos(id),
  hardware      text not null default '',
  desp_fallido  boolean not null default false,
  estado        text not null check (estado in ('aplicado', 'parcial', 'discrepancia', 'fallido', 'ignorado', 'sin_vehiculo')),
  origen        text not null default 'integracion' check (origen in ('integracion', 'historico')),
  datos         jsonb not null default '{}',
  recibido      timestamptz not null default now(),
  actualizado   timestamptz not null default now()
);
create index cierres_fecha on public.cierres (fecha_cierre desc);
create table public.cierre_lineas (
  id        uuid primary key default gen_random_uuid(),
  cierre_id uuid not null references public.cierres(id) on delete cascade,
  campo     text not null,
  formula   text not null default 'directa',
  valor     numeric(14,3) not null default 0,
  sku       text references public.productos(sku),
  cantidad  numeric(14,3) not null default 0,                 -- unidades de contenido
  estimada  boolean not null default false,
  estado    text not null check (estado in ('aplicada', 'discrepancia', 'sin_equivalencia', 'pendiente', 'resuelta')),
  regla     text,
  nota      text not null default ''
);
create index cierre_lineas_cierre on public.cierre_lineas (cierre_id);

-- ---------- Núcleo: consumo del vehículo hasta el objetivo de cada artículo (solo la diferencia) ----------
create or replace function public._sincronizar_cierre(p_cierre uuid) returns text
language plpgsql security definer set search_path = public as $$
declare ci cierres; r record; pr productos; u numeric; ref text; est text; hay_disc boolean := false;
begin
  select * into ci from cierres where id = p_cierre for update;
  ref := concat_ws(' · ', nullif(ci.num_inst, ''), nullif(ci.cliente, ''), nullif(ci.direccion, ''));
  if ci.estado = 'ignorado' then return 'ignorado'; end if;
  if ci.vehiculo_id is not null then
    for r in
      with objetivo as (select sku, sum(cantidad) q from cierre_lineas where cierre_id = ci.id and sku is not null and estado in ('aplicada', 'discrepancia', 'resuelta') and not ci.desp_fallido group by sku),
           hecho as (select sku, -sum(unidades) q from movimientos where cierre_id = ci.id group by sku)
      select coalesce(o.sku, h.sku) sku, coalesce(o.q, 0) - coalesce(h.q, 0) d from objetivo o full join hecho h on h.sku = o.sku
    loop
      continue when r.d = 0;
      select * into pr from productos where sku = r.sku;
      u := r.d;
      insert into stock_vehiculo (vehiculo_id, sku, unidades) values (ci.vehiculo_id, r.sku, -u)
        on conflict (vehiculo_id, sku) do update set unidades = stock_vehiculo.unidades - u;
      insert into movimientos (id, sku, tipo, cantidad, motivo, referencia, series, equipo_id, vehiculo_id, unidades, usuario, operario, cierre_id)
      values (gen_random_uuid(), r.sku, case when u > 0 then 'consumo' else 'ajuste' end, greatest(round(abs(u) / pr.contenido, 3), 0.001),
              case when u > 0 then 'Consumo en obra' else 'Corrección de cierre' end, ref, '{}', ci.equipo_id, ci.vehiculo_id, -u, null,
              'Cierre ' || coalesce(nullif(ci.equipo_wizard, ''), 'del wizard'), ci.id);
    end loop;
    -- lo que deja el vehículo en negativo: discrepancia (se registra igual)
    update cierre_lineas l set estado = case when exists (select 1 from stock_vehiculo s where s.vehiculo_id = ci.vehiculo_id and s.sku = l.sku and s.unidades < 0)
                                             then 'discrepancia' when l.estado = 'discrepancia' then 'aplicada' else l.estado end
    where l.cierre_id = ci.id and l.estado in ('aplicada', 'discrepancia');
    select exists (select 1 from cierre_lineas where cierre_id = ci.id and estado = 'discrepancia') into hay_disc;
  end if;
  est := case when ci.desp_fallido then 'fallido'
              when ci.vehiculo_id is null then 'sin_vehiculo'
              when hay_disc then 'discrepancia'
              when exists (select 1 from cierre_lineas where cierre_id = ci.id and estado in ('sin_equivalencia', 'pendiente')) then 'parcial'
              else 'aplicado' end;
  update cierres set estado = est, actualizado = now() where id = ci.id;
  return est;
end $$;

-- Guarda (o actualiza con una versión nueva) un cierre y sus líneas traducidas, y aplica los consumos
create or replace function public._registrar_cierre(p jsonb, p_lineas jsonb, p_origen text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_clave text; v_version int := greatest(1, coalesce(nullif(p->>'version', '')::int, 1)); v_fecha timestamptz;
  ci cierres; existe boolean; ap timestamptz; eq text; veh text; l jsonb; v_sku text; est text; resueltos text[];
begin
  v_clave := coalesce('uuid:' || nullif(trim(coalesce(p->>'esbrainUuid', '')), ''),
                      case when nullif(trim(coalesce(p->>'numInst', '')), '') is not null and nullif(trim(coalesce(p->>'fechaCierreIso', '')), '') is not null
                           then 'inst:' || trim(p->>'numInst') || '|' || trim(p->>'fechaCierreIso') end);
  if v_clave is null then raise exception 'El cierre no trae esbrainUuid ni numInst + fechaCierreIso'; end if;
  v_fecha := coalesce(nullif(p->>'fechaCierreIso', '')::timestamptz, nullif(p->>'fechaIso', '')::timestamptz, now());
  select * into ci from cierres where clave = v_clave for update;
  existe := found;
  if existe and ci.version >= v_version then return jsonb_build_object('estado', 'duplicado', 'cierre', ci.id, 'version', ci.version); end if;
  select coalesce(apertura_cierres, demo_borrada) into ap from config_app where id = 1;
  select id into eq from equipos where activo and lower(trim(nombre)) = lower(trim(coalesce(p->>'equipo', '')));
  veh := case when eq is null then null else vehiculo_de_equipo(eq, v_fecha) end;
  if existe then
    update cierres set version = v_version, num_inst = coalesce(p->>'numInst', ''), cliente = coalesce(p->>'cliente', ''), direccion = coalesce(p->>'direccion', ''),
      fecha_cierre = v_fecha, equipo_wizard = coalesce(p->>'equipo', ''), equipo_id = eq, vehiculo_id = coalesce(ci.vehiculo_id, veh), hardware = coalesce(p->>'hardware', ''),
      desp_fallido = coalesce((p->>'despFallido')::boolean, false), datos = p, actualizado = now()
    where id = ci.id returning * into ci;
  else
    insert into cierres (clave, version, num_inst, esbrain_uuid, cliente, direccion, fecha_cierre, equipo_wizard, equipo_id, vehiculo_id, hardware, desp_fallido, estado, origen, datos)
    values (v_clave, v_version, coalesce(p->>'numInst', ''), coalesce(p->>'esbrainUuid', ''), coalesce(p->>'cliente', ''), coalesce(p->>'direccion', ''), v_fecha,
            coalesce(p->>'equipo', ''), eq, veh, coalesce(p->>'hardware', ''), coalesce((p->>'despFallido')::boolean, false),
            case when ap is not null and v_fecha < ap then 'ignorado' else 'aplicado' end, p_origen, p)
    returning * into ci;
    if ci.estado = 'ignorado' then return jsonb_build_object('estado', 'ignorado', 'cierre', ci.id, 'motivo', 'anterior a la apertura del inventario'); end if;
  end if;
  -- líneas nuevas (las que el administrador ya resolvió a mano se conservan)
  select coalesce(array_agg(campo), '{}') into resueltos from cierre_lineas where cierre_id = ci.id and estado = 'resuelta';
  delete from cierre_lineas where cierre_id = ci.id and estado <> 'resuelta';
  for l in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) loop
    continue when (l->>'estado') <> 'aplicable' and (l->>'campo') = any(resueltos);
    v_sku := nullif(l->>'sku', '');
    if v_sku is not null and not exists (select 1 from productos where sku = v_sku and not borrador) then v_sku := null; end if;
    insert into cierre_lineas (cierre_id, campo, formula, valor, sku, cantidad, estimada, estado, regla, nota)
    values (ci.id, l->>'campo', coalesce(l->>'formula', 'directa'), coalesce((l->>'valor')::numeric, 0), v_sku, coalesce((l->>'cantidad')::numeric, 0),
            coalesce((l->>'estimada')::boolean, false),
            case when (l->>'estado') = 'aplicable' and v_sku is not null then 'aplicada' when (l->>'estado') = 'pendiente' then 'pendiente' else 'sin_equivalencia' end,
            l->>'regla', coalesce(l->>'nota', '') || case when (l->>'estado') = 'aplicable' and v_sku is null then ' · artículo no disponible en el catálogo' else '' end);
  end loop;
  est := _sincronizar_cierre(ci.id);
  return jsonb_build_object('estado', est, 'cierre', ci.id, 'version', v_version,
    'pendientes', (select count(*) from cierre_lineas where cierre_id = ci.id and estado in ('pendiente', 'sin_equivalencia')));
end $$;

-- Llamada de la función "registrar-cierre" (servidor): valida el token de la integración por su hash
create or replace function public.aplicar_cierre(p_hash text, p jsonb, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i integraciones;
begin
  select * into i from integraciones where token_hash = p_hash and revocado is null;
  if not found then raise exception 'Integración no válida o revocada' using errcode = '28000'; end if;
  update integraciones set ultimo_uso = now() where id = i.id;
  return _registrar_cierre(p, p_lineas, 'integracion');
end $$;

-- Carga del histórico (CSV exportado de "Registro") o reproceso: el administrador desde la app
create or replace function public.aplicar_cierre_admin(p jsonb, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin();
begin
  return _registrar_cierre(p, p_lineas, 'historico');
end $$;

-- Una línea pendiente (cable de datos con otro cargador, modelo no reconocido…) o sin equivalencia: el administrador elige el artículo
create or replace function public.resolver_linea_cierre(p_linea uuid, p_sku text, p_cantidad numeric default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); l cierre_lineas;
begin
  select * into l from cierre_lineas where id = p_linea for update;
  if not found then raise exception 'Línea no encontrada'; end if;
  if l.estado not in ('pendiente', 'sin_equivalencia') then return jsonb_build_object('estado', 'duplicado'); end if;
  if not exists (select 1 from productos where sku = upper(p_sku) and not borrador) then raise exception 'Artículo no encontrado: %', p_sku; end if;
  update cierre_lineas set sku = upper(p_sku), cantidad = coalesce(p_cantidad, cantidad), estado = 'resuelta', nota = trim(nota || ' · resuelta por ' || u.nombre) where id = l.id;
  return jsonb_build_object('estado', _sincronizar_cierre(l.cierre_id));
end $$;

-- Si el equipo no tenía vehículo (o no casaba el nombre) y ya se ha corregido: vuelve a buscar el vehículo y aplica
create or replace function public.reprocesar_cierre(p_cierre uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); ci cierres; eq text;
begin
  select * into ci from cierres where id = p_cierre for update;
  if not found then raise exception 'Cierre no encontrado'; end if;
  if ci.vehiculo_id is null then
    select id into eq from equipos where activo and lower(trim(nombre)) = lower(trim(ci.equipo_wizard));
    update cierres set equipo_id = eq, vehiculo_id = case when eq is null then null else vehiculo_de_equipo(eq, ci.fecha_cierre) end where id = ci.id;
  end if;
  return jsonb_build_object('estado', _sincronizar_cierre(ci.id));
end $$;

-- ---------- Integraciones (token del Apps Script) ----------
create or replace function public.crear_integracion(p_nombre text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); tok text; nid uuid;
begin
  tok := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into integraciones (nombre, token_hash, creado_por) values (coalesce(nullif(trim(p_nombre), ''), 'Wizard de cierres'), encode(extensions.digest(tok, 'sha256'), 'hex'), u.nombre)
  returning id into nid;
  insert into auditoria (usuario, operario, accion, detalle) values (u.id, u.nombre, 'crear_integracion', jsonb_build_object('id', nid, 'nombre', p_nombre));
  return jsonb_build_object('estado', 'aplicado', 'id', nid, 'token', tok);     -- el token solo se enseña esta vez
end $$;
create or replace function public.revocar_integracion(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin();
begin
  update integraciones set revocado = now() where id = p_id and revocado is null;
  insert into auditoria (usuario, operario, accion, detalle) values (u.id, u.nombre, 'revocar_integracion', jsonb_build_object('id', p_id));
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- ---------- Equivalencias, kits y configuración (administrador) ----------
create or replace function public.guardar_equivalencia(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin();
begin
  insert into equivalencias_cierre (id, campo, formula, condiciones, articulos, kit, estimada, activa, orden, nota, confirmada)
  values (p->>'id', trim(p->>'campo'), p->>'formula', coalesce(p->'condiciones', '{}'), coalesce(p->'articulos', '[]'), nullif(p->>'kit', ''),
          coalesce((p->>'estimada')::boolean, false), coalesce((p->>'activa')::boolean, true), coalesce((p->>'orden')::int, 100), coalesce(p->>'nota', ''),
          coalesce((p->>'confirmada')::boolean, true))
  on conflict (id) do update set campo = excluded.campo, formula = excluded.formula, condiciones = excluded.condiciones, articulos = excluded.articulos,
    kit = excluded.kit, estimada = excluded.estimada, activa = excluded.activa, orden = excluded.orden, nota = excluded.nota, confirmada = excluded.confirmada, actualizado = now();
  return jsonb_build_object('estado', 'aplicado');
end $$;
create or replace function public.cargar_propuesta_equivalencias(p_reglas jsonb, p_kits jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); r jsonb; n int := 0; k text;
begin
  for r in select * from jsonb_array_elements(coalesce(p_reglas, '[]'::jsonb)) loop
    insert into equivalencias_cierre (id, campo, formula, condiciones, articulos, kit, estimada, activa, orden, nota, confirmada)
    values (r->>'id', r->>'campo', r->>'formula', coalesce(r->'condiciones', '{}'), coalesce(r->'articulos', '[]'), nullif(r->>'kit', ''),
            coalesce((r->>'estimada')::boolean, false), coalesce((r->>'activa')::boolean, true), coalesce((r->>'orden')::int, 100), coalesce(r->>'nota', ''), false)
    on conflict (id) do nothing;
    if found then n := n + 1; end if;
  end loop;
  for k in select * from jsonb_object_keys(coalesce(p_kits, '{}'::jsonb)) loop
    insert into kits_fijacion (kit, articulos) values (k, p_kits->k) on conflict (kit) do nothing;
  end loop;
  return jsonb_build_object('estado', 'aplicado', 'nuevas', n);
end $$;
create or replace function public.confirmar_equivalencias() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); n int;
begin
  update equivalencias_cierre set confirmada = true, actualizado = now() where not confirmada;
  get diagnostics n = row_count;
  insert into auditoria (usuario, operario, accion, detalle) values (u.id, u.nombre, 'confirmar_equivalencias', jsonb_build_object('reglas', n));
  return jsonb_build_object('estado', 'aplicado', 'confirmadas', n);
end $$;
create or replace function public.guardar_kit_fijacion(p_kit text, p_articulos jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin();
begin
  insert into kits_fijacion (kit, articulos) values (p_kit, coalesce(p_articulos, '[]')) on conflict (kit) do update set articulos = excluded.articulos;
  return jsonb_build_object('estado', 'aplicado');
end $$;
create or replace function public.config_cierres(p_kit text, p_apertura timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin();
begin
  update config_app set kit_fijacion = coalesce(nullif(p_kit, ''), kit_fijacion), apertura_cierres = p_apertura where id = 1;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- ---------- Recuento de un vehículo: el almacén cuenta (queda pendiente); el administrador ajusta o valida ----------
create or replace function public.registrar_recuento_vehiculo(p_id uuid, p_vehiculo text, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := perfil_actual(); v vehiculos; l jsonb; pr productos; abordo numeric; d numeric; n int := 0;
begin
  if exists (select 1 from recuentos where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  select * into v from vehiculos where id = p_vehiculo and activo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  insert into recuentos (id, pasillo, usuario, operario) values (p_id, 'Vehículo ' || v.matricula, p.id, p.nombre);
  for l in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) loop
    select * into pr from productos where sku = upper(l->>'sku');
    if not found then raise exception 'Producto no encontrado: %', l->>'sku'; end if;
    if (l->>'contado')::numeric < 0 then raise exception 'La cantidad contada no puede ser negativa'; end if;
    select coalesce(unidades, 0) into abordo from stock_vehiculo where vehiculo_id = v.id and sku = pr.sku;
    d := round((l->>'contado')::numeric - coalesce(abordo, 0) / pr.contenido, 3);        -- en formatos (puede tener decimales: un sobre empezado)
    continue when d = 0;
    n := n + 1;
    if p.rol = 'admin' then
      perform _mover_vehiculo(p, gen_random_uuid(), pr.sku, 'ajuste', v.id, d, 'Recuento de vehículo', 'Recuento ' || v.matricula, null);
    else
      insert into pendientes (id, tipo, sku, cantidad, motivo, referencia, recuento_id, usuario, operario, vehiculo_id)
      values (gen_random_uuid(), 'recuento', pr.sku, d, 'Diferencia de recuento del vehículo', 'Recuento ' || v.matricula, p_id, p.id, p.nombre, v.id);
    end if;
  end loop;
  return jsonb_build_object('estado', case when p.rol = 'admin' then 'aplicado' else 'pendiente' end, 'diferencias', n);
end $$;

create or replace function public.validar_pendiente(p_pendiente uuid, p_aprobar boolean, p_nota text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); pe pendientes; mid uuid := gen_random_uuid();
begin
  select * into pe from pendientes where id = p_pendiente for update;
  if not found then raise exception 'Pendiente no encontrado'; end if;
  if pe.estado <> 'pendiente' then return jsonb_build_object('estado', 'duplicado'); end if;
  if p_aprobar then
    if pe.vehiculo_id is not null then
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

-- El borrado de la demostración también vacía los cierres (las equivalencias, los kits y las integraciones se conservan)
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
  truncate table cierre_lineas, cierres, portal_enlaces, copias_entrega, envios_aviso, reservas, entrega_lineas, entregas, stock_vehiculo, movimientos, pendientes, recuentos, albaranes, avisos_reposicion,
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


-- ---------- Seguridad ----------
alter table public.integraciones enable row level security;
alter table public.equivalencias_cierre enable row level security;
alter table public.kits_fijacion enable row level security;
alter table public.cierres enable row level security;
alter table public.cierre_lineas enable row level security;
revoke all on public.integraciones, public.equivalencias_cierre, public.kits_fijacion, public.cierres, public.cierre_lineas from anon, authenticated;
grant select (id, nombre, creado, creado_por, revocado, ultimo_uso) on public.integraciones to authenticated;
grant select on public.equivalencias_cierre, public.kits_fijacion, public.cierres, public.cierre_lineas to authenticated;
create policy integraciones_lectura on public.integraciones for select to authenticated using (public.es_admin());
create policy equivalencias_lectura on public.equivalencias_cierre for select to authenticated using (public.es_usuario_activo());
create policy kits_lectura on public.kits_fijacion for select to authenticated using (public.es_usuario_activo());
create policy cierres_lectura on public.cierres for select to authenticated using (public.es_usuario_activo());
create policy cierre_lineas_lectura on public.cierre_lineas for select to authenticated using (public.es_usuario_activo());
-- el pendiente de un vehículo lo ve el almacén como los demás
grant select (vehiculo_id) on public.pendientes to authenticated;

revoke execute on function public._sincronizar_cierre(uuid), public._registrar_cierre(jsonb, jsonb, text) from public, anon, authenticated;
revoke execute on function public.aplicar_cierre(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.aplicar_cierre(text, jsonb, jsonb) to service_role;
revoke execute on function public.aplicar_cierre_admin(jsonb, jsonb), public.resolver_linea_cierre(uuid, text, numeric), public.reprocesar_cierre(uuid),
  public.crear_integracion(text), public.revocar_integracion(uuid), public.guardar_equivalencia(jsonb), public.cargar_propuesta_equivalencias(jsonb, jsonb),
  public.confirmar_equivalencias(), public.guardar_kit_fijacion(text, jsonb), public.config_cierres(text, timestamptz), public.registrar_recuento_vehiculo(uuid, text, jsonb) from public, anon;
grant execute on function public.aplicar_cierre_admin(jsonb, jsonb), public.resolver_linea_cierre(uuid, text, numeric), public.reprocesar_cierre(uuid),
  public.crear_integracion(text), public.revocar_integracion(uuid), public.guardar_equivalencia(jsonb), public.cargar_propuesta_equivalencias(jsonb, jsonb),
  public.confirmar_equivalencias(), public.guardar_kit_fijacion(text, jsonb), public.config_cierres(text, timestamptz), public.registrar_recuento_vehiculo(uuid, text, jsonb) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.cierres, public.cierre_lineas, public.equivalencias_cierre, public.kits_fijacion;
  end if;
end $$;
