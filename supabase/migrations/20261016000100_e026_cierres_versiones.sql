-- =====================================================================================================
-- E-026 · Cierres: una instalación = un cierre, versiones (directo, histórico, prefactura de Holded), cargadores
--         entregados por el almacén hasta el 05/10, material especial y reglas de cargadores del calendario
-- - Identidad: numInst (n.º de presupuesto). Lo que llega después para la misma instalación es una VERSIÓN nueva:
--   se aplica solo la diferencia y nunca se duplica. La decisión (nueva / duplicado / obsoleto) y los datos efectivos
--   (wizard + partidas de la prefactura) los prepara el módulo _compartido/cierres.ts (prepararVersion), igual en la app.
-- - Cargadores (categoría "cargadores" o material en custodia) de cierres anteriores a config_app.cargadores_a_bordo_hasta:
--   se descuentan solo si constan a bordo del vehículo AL PROCESAR; si no, la línea queda "no_entregado" (sin movimiento
--   ni discrepancia) y sale en el informe de custodia como instalado antes de la gestión del almacén.
-- =====================================================================================================
alter table public.cierres
  add column if not exists datos_wizard jsonb,
  add column if not exists holded jsonb,
  add column if not exists material_especial text not null default '',
  add column if not exists material_revisado boolean not null default false;
alter table public.cierres drop constraint if exists cierres_origen_check;
alter table public.cierres add constraint cierres_origen_check check (origen in ('integracion', 'historico', 'holded'));
alter table public.cierre_lineas drop constraint if exists cierre_lineas_estado_check;
alter table public.cierre_lineas add constraint cierre_lineas_estado_check check (estado in ('aplicada', 'discrepancia', 'sin_equivalencia', 'pendiente', 'resuelta', 'no_entregado'));
alter table public.config_app add column if not exists cargadores_a_bordo_hasta timestamptz default (timestamp '2026-10-05 00:00' at time zone 'Europe/Madrid');

create table if not exists public.cierre_versiones (
  id          uuid primary key default gen_random_uuid(),
  cierre_id   uuid not null references public.cierres(id) on delete cascade,
  n           int not null,
  origen      text not null check (origen in ('wizard', 'historico', 'holded', 'admin')),
  documento   text not null default '',
  recibido    timestamptz not null default now(),
  entrada     jsonb not null default '{}',
  diferencia  jsonb not null default '[]',               -- [{sku, unidades}] consumo que añadió (+) o devolvió (−) esta versión
  unique (cierre_id, n)
);

-- Identidad nueva de lo que ya hubiera (en producción no hay cierres; en una base con datos, una sola fila por instalación)
update public.cierres c set clave = 'inst:' || upper(regexp_replace(c.num_inst, '\s+', '', 'g')), datos_wizard = coalesce(c.datos_wizard, c.datos)
where c.num_inst <> '' and not exists (select 1 from public.cierres o where o.id <> c.id and upper(regexp_replace(o.num_inst, '\s+', '', 'g')) = upper(regexp_replace(c.num_inst, '\s+', '', 'g')));
insert into public.cierre_versiones (cierre_id, n, origen, entrada, recibido)
select id, 1, case when origen = 'historico' then 'historico' else 'wizard' end, datos, recibido from public.cierres c
where not exists (select 1 from public.cierre_versiones v where v.cierre_id = c.id);
update public.cierres set version = 1 where version <> 1 and (select count(*) from public.cierre_versiones v where v.cierre_id = cierres.id) = 1;

-- ---------- Núcleo: consumo del vehículo hasta el objetivo (solo la diferencia), con la regla de los cargadores ----------
create or replace function public._sincronizar_cierre(p_cierre uuid) returns text
language plpgsql security definer set search_path = public as $$
declare ci cierres; r record; pr productos; u numeric; ref text; est text; hay_disc boolean := false; hasta timestamptz; disp numeric;
begin
  select * into ci from cierres where id = p_cierre for update;
  ref := concat_ws(' · ', nullif(ci.num_inst, ''), nullif(ci.cliente, ''), nullif(ci.direccion, ''));
  if ci.estado = 'ignorado' then return 'ignorado'; end if;
  if ci.vehiculo_id is not null then
    -- E-026: hasta la fecha configurada, un cargador solo se descuenta si consta a bordo (se mira ahora, al procesar)
    select cargadores_a_bordo_hasta into hasta from config_app where id = 1;
    if hasta is not null and ci.fecha_cierre < hasta and not ci.desp_fallido then
      for r in
        select l.id, l.sku, l.cantidad, l.estado from cierre_lineas l join productos p on p.sku = l.sku
        where l.cierre_id = ci.id and l.estado in ('aplicada', 'discrepancia', 'no_entregado') and (p.categoria = 'cargadores' or p.propiedad = 'custodia')
      loop
        -- lo que hay a bordo más lo que este mismo cierre ya consumió de ese artículo
        select coalesce((select unidades from stock_vehiculo where vehiculo_id = ci.vehiculo_id and sku = r.sku), 0)
             + coalesce((select -sum(unidades) from movimientos where cierre_id = ci.id and sku = r.sku), 0) into disp;
        update cierre_lineas set estado = case when disp >= r.cantidad then (case when r.estado = 'no_entregado' then 'aplicada' else r.estado end) else 'no_entregado' end
        where id = r.id;
      end loop;
    end if;
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

-- Consumo hecho por un cierre, por artículo (para calcular la diferencia de cada versión)
create or replace function public._consumo_cierre(p_cierre uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(sku, q), '{}') from (select sku, -sum(unidades) q from movimientos where cierre_id = p_cierre group by sku) x
$$;

-- ---------- Guardar una versión de un cierre ----------
-- p: datos EFECTIVOS (wizard + prefactura); p_lineas: su traducción; p_meta: {clave, accion, origen, documento, base, wizard, holded, entrada}
create or replace function public._registrar_version_cierre(p jsonb, p_lineas jsonb, p_meta jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_clave text := nullif(trim(coalesce(p_meta->>'clave', '')), ''); v_origen text := coalesce(p_meta->>'origen', 'wizard');
  v_base int := coalesce((p_meta->>'base')::int, 0); v_fecha timestamptz; ci cierres; existe boolean; ap timestamptz; eq text; veh text; l jsonb; v_sku text;
  est text; resueltos text[]; antes jsonb; despues jsonb; dif jsonb; v_n int; v_me text := coalesce(p->>'materialEspecial', '');
begin
  if v_clave is null then raise exception 'El cierre no trae numInst (n.º de instalación)'; end if;
  select * into ci from cierres where clave = v_clave for update;
  existe := found;
  if (p_meta->>'accion') in ('duplicado', 'obsoleto') then
    return jsonb_build_object('estado', p_meta->>'accion', 'cierre', ci.id, 'version', ci.version);
  end if;
  -- se preparó con una versión que ya no es la última (dos envíos a la vez): que se vuelva a enviar
  if coalesce(ci.version, 0) <> v_base then raise exception 'El cierre % ha cambiado mientras se procesaba: vuelve a enviarlo', p->>'numInst' using errcode = '40001'; end if;
  v_fecha := coalesce(ci.fecha_cierre, nullif(p->>'fechaCierreIso', '')::timestamptz, nullif(p->>'fechaIso', '')::timestamptz, now());
  select coalesce(apertura_cierres, demo_borrada) into ap from config_app where id = 1;
  select id into eq from equipos where activo and lower(trim(nombre)) = lower(trim(coalesce(p->>'equipo', '')));
  veh := case when eq is null then null else vehiculo_de_equipo(eq, v_fecha) end;
  if existe then
    if ci.estado = 'ignorado' then return jsonb_build_object('estado', 'ignorado', 'cierre', ci.id); end if;
    update cierres set version = ci.version + 1, num_inst = coalesce(p->>'numInst', ''), esbrain_uuid = coalesce(nullif(p->>'esbrainUuid', ''), ci.esbrain_uuid),
      cliente = coalesce(nullif(p->>'cliente', ''), ci.cliente), direccion = coalesce(nullif(p->>'direccion', ''), ci.direccion),
      equipo_wizard = coalesce(p->>'equipo', ''), equipo_id = eq, vehiculo_id = coalesce(ci.vehiculo_id, veh), hardware = coalesce(p->>'hardware', ''),
      desp_fallido = coalesce((p->>'despFallido')::boolean, false), datos = p, datos_wizard = coalesce(p_meta->'wizard', ci.datos_wizard), holded = coalesce(p_meta->'holded', ci.holded),
      material_especial = v_me, material_revisado = case when v_me = ci.material_especial then ci.material_revisado else v_me = '' end, actualizado = now()
    where id = ci.id returning * into ci;
  else
    insert into cierres (clave, version, num_inst, esbrain_uuid, cliente, direccion, fecha_cierre, equipo_wizard, equipo_id, vehiculo_id, hardware, desp_fallido, estado, origen, datos,
                         datos_wizard, holded, material_especial, material_revisado)
    values (v_clave, 1, coalesce(p->>'numInst', ''), coalesce(p->>'esbrainUuid', ''), coalesce(p->>'cliente', ''), coalesce(p->>'direccion', ''), v_fecha,
            coalesce(p->>'equipo', ''), eq, veh, coalesce(p->>'hardware', ''), coalesce((p->>'despFallido')::boolean, false),
            case when ap is not null and v_fecha < ap then 'ignorado' else 'aplicado' end,
            case v_origen when 'historico' then 'historico' when 'holded' then 'holded' else 'integracion' end, p, p_meta->'wizard', p_meta->'holded', v_me, v_me = '')
    returning * into ci;
  end if;
  v_n := ci.version;
  if ci.estado = 'ignorado' then
    insert into cierre_versiones (cierre_id, n, origen, documento, entrada) values (ci.id, v_n, v_origen, coalesce(p_meta->>'documento', ''), coalesce(p_meta->'entrada', p));
    return jsonb_build_object('estado', 'ignorado', 'cierre', ci.id, 'motivo', 'anterior a la apertura del inventario');
  end if;
  antes := _consumo_cierre(ci.id);
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
            l->>'regla', coalesce(l->>'nota', '') || case when (l->>'estado') = 'aplicable' and v_sku is null then ' · artículo no disponible en el catálogo' else '' end);
  end loop;
  est := _sincronizar_cierre(ci.id);
  despues := _consumo_cierre(ci.id);
  select coalesce(jsonb_agg(jsonb_build_object('sku', k, 'unidades', d) order by k), '[]') into dif
  from (select k, coalesce((despues->>k)::numeric, 0) - coalesce((antes->>k)::numeric, 0) d from (select jsonb_object_keys(antes) k union select jsonb_object_keys(despues)) ks) x where d <> 0;
  insert into cierre_versiones (cierre_id, n, origen, documento, entrada, diferencia) values (ci.id, v_n, v_origen, coalesce(p_meta->>'documento', ''), coalesce(p_meta->'entrada', p), dif);
  return jsonb_build_object('estado', est, 'cierre', ci.id, 'version', v_n, 'diferencia', dif,
    'pendientes', (select count(*) from cierre_lineas where cierre_id = ci.id and estado in ('pendiente', 'sin_equivalencia')));
end $$;

-- Lo que la función del servidor necesita para preparar la versión (con la clave de servicio)
create or replace function public.previo_cierre(p_clave text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when c.id is null then null else jsonb_build_object('version', c.version, 'wizard', c.datos_wizard, 'holded', c.holded,
    'origenes', (select coalesce(jsonb_agg(distinct origen), '[]') from cierre_versiones where cierre_id = c.id)) end
  from (select 1) x left join cierres c on c.clave = p_clave
$$;

-- Llamadas: integración (token por su hash) y administrador (histórico en CSV desde la app)
drop function if exists public.aplicar_cierre(text, jsonb, jsonb);
drop function if exists public.aplicar_cierre_admin(jsonb, jsonb);
create or replace function public.aplicar_cierre(p_hash text, p jsonb, p_lineas jsonb, p_meta jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i integraciones;
begin
  select * into i from integraciones where token_hash = p_hash and revocado is null;
  if not found then raise exception 'Integración no válida o revocada' using errcode = '28000'; end if;
  update integraciones set ultimo_uso = now() where id = i.id;
  return _registrar_version_cierre(p, p_lineas, p_meta);
end $$;
create or replace function public.aplicar_cierre_admin(p jsonb, p_lineas jsonb, p_meta jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin();
begin
  return _registrar_version_cierre(p, p_lineas, p_meta || jsonb_build_object('origen', coalesce(nullif(p_meta->>'origen', ''), 'historico')));
end $$;

-- Material especial revisado (el administrador ya añadió a mano lo que correspondía)
create or replace function public.revisar_material_especial(p_cierre uuid, p_nota text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin();
begin
  update cierres set material_revisado = true where id = p_cierre;
  if not found then raise exception 'Cierre no encontrado'; end if;
  insert into auditoria (usuario, operario, accion, detalle) values (u.id, u.nombre, 'revisar_material_especial', jsonb_build_object('cierre', p_cierre, 'nota', coalesce(p_nota, '')));
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- Configuración de los cierres: kit, apertura y fecha hasta la que los cargadores se descuentan solo si constan a bordo
drop function if exists public.config_cierres(text, timestamptz);
create or replace function public.config_cierres(p_kit text, p_apertura timestamptz, p_cargadores_hasta timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin();
begin
  update config_app set kit_fijacion = coalesce(nullif(p_kit, ''), kit_fijacion), apertura_cierres = p_apertura, cargadores_a_bordo_hasta = p_cargadores_hasta where id = 1;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- ---------- Reglas de cargadores con el texto real del calendario (se guarda la versión anterior, E-016) ----------
insert into public.equivalencias_historial (regla_id, version, operario)
select id, to_jsonb(e), 'Migración E-026' from public.equivalencias_cierre e where campo = 'hardware' and confirmada;
update public.equivalencias_cierre set activa = false, actualizado = now(), nota = trim(nota || ' · sustituida en E-026')
where campo = 'hardware' and id not in ('H1', 'H2', 'H3', 'H4', 'H5', 'H6');
-- solo donde ya hay reglas de cargadores (la base real); una base nueva recibe las de la propuesta, ya con estos textos
insert into public.equivalencias_cierre (id, campo, formula, condiciones, articulos, estimada, activa, orden, nota, confirmada)
select id, campo, formula, condiciones::jsonb, articulos::jsonb, estimada, activa, orden, nota, confirmada from (values
  ('H1', 'hardware', 'unidad', '{"hardware~": "trydan&schuko"}', '[{"sku": "8900500015", "factor": 1}]', false, true, 1010, 'Trydan 7,4 kW 5 m + Schuko', true),
  ('H2', 'hardware', 'unidad', '{"hardware~": ["trydan&trif&m10", "trydan&22&m10"]}', '[{"sku": "8900500030", "factor": 1}]', false, true, 1020, 'Trydan 22 kW 10 m', true),
  ('H3', 'hardware', 'unidad', '{"hardware~": ["trydan&trif", "trydan&22"]}', '[{"sku": "8900500025", "factor": 1}]', false, true, 1030, 'Trydan 22 kW 5 m', true),
  ('H4', 'hardware', 'unidad', '{"hardware~": "trydan&m10"}', '[{"sku": "8900500020", "factor": 1}]', false, true, 1040, 'Trydan 7,4 kW 10 m', true),
  ('H5', 'hardware', 'unidad', '{"hardware~": "trydan"}', '[{"sku": "8900590300", "factor": 1}]', false, true, 1050, 'Trydan 7,4 kW 5 m (el más habitual)', true),
  ('H6', 'hardware', 'unidad', '{"hardware~": "policharger"}', '[{"sku": "8906000665", "factor": 1}]', false, true, 1060, 'Policharger NW T2', true)
) v(id, campo, formula, condiciones, articulos, estimada, activa, orden, nota, confirmada)
where exists (select 1 from public.equivalencias_cierre where campo = 'hardware' and id not like 'H_')
on conflict (id) do nothing;

-- Recalcular un cierre con las reglas actuales: también queda como versión (origen administrador) con su diferencia
create or replace function public.recalcular_cierre_admin(p_cierre uuid, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); ci cierres; l jsonb; v_sku text; resueltos text[]; antes jsonb; despues jsonb; dif jsonb; est text;
begin
  select * into ci from cierres where id = p_cierre for update;
  if not found then raise exception 'Cierre no encontrado'; end if;
  if ci.estado = 'ignorado' then return jsonb_build_object('estado', 'ignorado'); end if;
  antes := _consumo_cierre(ci.id);
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
  est := _sincronizar_cierre(ci.id);
  despues := _consumo_cierre(ci.id);
  select coalesce(jsonb_agg(jsonb_build_object('sku', k, 'unidades', d) order by k), '[]') into dif
  from (select k, coalesce((despues->>k)::numeric, 0) - coalesce((antes->>k)::numeric, 0) d from (select jsonb_object_keys(antes) k union select jsonb_object_keys(despues)) ks) x where d <> 0;
  if dif <> '[]'::jsonb then
    update cierres set version = version + 1 where id = ci.id returning version into ci.version;
    insert into cierre_versiones (cierre_id, n, origen, documento, entrada, diferencia) values (ci.id, ci.version, 'admin', 'Recalculado por ' || u.nombre, '{}', dif);
  end if;
  return jsonb_build_object('estado', est, 'diferencia', dif);
end $$;
drop function if exists public._registrar_cierre(jsonb, jsonb, text);

-- El borrado de la demostración también vacía las versiones de los cierres
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
  truncate table cierre_versiones, codigos_articulo, propuestas_ficha, cierre_lineas, cierres, portal_enlaces, copias_entrega, envios_aviso, reservas, entrega_lineas, entregas, stock_vehiculo, movimientos, pendientes, recuentos, albaranes, avisos_reposicion,
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
alter table public.cierre_versiones enable row level security;
revoke all on public.cierre_versiones from anon, authenticated;
grant select on public.cierre_versiones to authenticated;
create policy cierre_versiones_lectura on public.cierre_versiones for select to authenticated using (public.es_usuario_activo());
revoke execute on function public._registrar_version_cierre(jsonb, jsonb, jsonb), public._consumo_cierre(uuid), public.previo_cierre(text) from public, anon, authenticated;
grant execute on function public.previo_cierre(text) to service_role;
revoke execute on function public.aplicar_cierre(text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.aplicar_cierre(text, jsonb, jsonb, jsonb) to service_role;
revoke execute on function public.aplicar_cierre_admin(jsonb, jsonb, jsonb), public.revisar_material_especial(uuid, text), public.config_cierres(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.aplicar_cierre_admin(jsonb, jsonb, jsonb), public.revisar_material_especial(uuid, text), public.config_cierres(text, timestamptz, timestamptz) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.cierre_versiones;
  end if;
end $$;
