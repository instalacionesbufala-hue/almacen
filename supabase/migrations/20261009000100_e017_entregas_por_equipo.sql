-- =====================================================================================================
-- E-017 · Las salidas de material se hacen AL EQUIPO. El técnico solo firma la recogida ("recogido por").
-- - La entrega se prepara para el equipo (sin técnico). Al firmar se elige, entre los técnicos ACTUALES del equipo
--   (historial de asignaciones), quién recoge y firma: queda en receptor_id ("recogido por") y su DNI.
-- - La dotación personal (ropa, EPIs, herramientas) sigue siendo de la persona: pasa al técnico que firma.
-- - Copia por correo al que firma y, si se marca, a los demás técnicos del equipo.
-- - Portal del técnico: ve las entregas de su equipo mientras pertenece a él (según las fechas del historial).
-- - Entregas antiguas: conservan su equipo y su técnico, que pasa a ser "recogido por". No se toca ninguna huella.
-- =====================================================================================================
alter table public.entregas alter column receptor_id drop not null;
comment on column public.entregas.receptor_id is 'E-017: "recogido por": técnico del equipo que recoge y firma (se elige al firmar)';
comment on column public.entregas.equipo_id is 'E-017: destinatario de la entrega';

-- Al firmar se fija quién recoge (y su DNI); lo demás de la entrega preparada sigue fijo
create or replace function public._entregas_inalterables() returns trigger language plpgsql as $$
declare fijo text[] := array['id', 'numero', 'equipo_id', 'plantilla_id', 'obra', 'usuario', 'operario'];
begin
  if _limpiando() then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' then
    if coalesce(old.hash, '') = '' and old.estado = new.estado and new.hash <> '' and (to_jsonb(new) - 'hash') = (to_jsonb(old) - 'hash') then return new; end if;
    if old.estado = 'preparada' and new.estado in ('firmada', 'anulada')
       and (select bool_and(to_jsonb(new) -> k = to_jsonb(old) -> k) from unnest(fijo) k)
       and (new.estado = 'firmada' or (new.receptor_id is not distinct from old.receptor_id and new.dni = old.dni)) then return new; end if;
  end if;
  raise exception 'Una entrega firmada no se puede modificar ni borrar: corrígela con una devolución' using errcode = '42501';
end $$;

-- ¿Pertenece ahora mismo ese técnico al equipo? (historial de asignaciones, no solo la ficha)
create or replace function public._tecnico_del_equipo(p_tecnico text, p_equipo text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from asignaciones_tecnico a join tecnicos t on t.id = a.tecnico_id
                 where a.tecnico_id = p_tecnico and a.equipo_id = p_equipo and a.hasta is null and t.activo)
$$;

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
  -- E-017: se prepara para el equipo; quién recoge se elige al firmar (si ya se indica, tiene que ser del equipo)
  if nullif(p_receptor, '') is not null then
    select * into t from tecnicos where id = p_receptor and activo;
    if not found then raise exception 'Técnico no encontrado'; end if;
    if not _tecnico_del_equipo(t.id, p_equipo) then raise exception '% no pertenece a ese equipo', t.nombre; end if;
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'La entrega no tiene material'; end if;
  veh := (select id from vehiculos where equipo_id = p_equipo and activo);
  hasta := now() + make_interval(hours => (select horas_reserva from config_avisos where id = 1));
  num := format('ENT-%s-%s', extract(year from now())::int, lpad(nextval('entregas_numero')::text, 4, '0'));
  insert into entregas (id, numero, equipo_id, receptor_id, dni, firma, hash, usuario, operario, estado, plantilla_id, obra, caduca, vehiculo_id)
  values (p_id, num, p_equipo, nullif(p_receptor, ''), coalesce(t.dni_mascara, ''), null, null, u.id, u.nombre, 'preparada', null, coalesce(p_obra, ''), hasta, veh);
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

-- Copia por correo: al técnico que firma y, si se pide, a los demás técnicos actuales del equipo
drop function public._encolar_copia_entrega(uuid);
create or replace function public._encolar_copia_entrega(p_entrega uuid, p_equipo boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare e entregas; t tecnicos; c config_avisos; dest text[] := '{}'; v_id uuid; eq text;
begin
  select * into e from entregas where id = p_entrega;
  select * into t from tecnicos where id = e.receptor_id;
  select * into c from config_avisos where id = 1;
  select nombre into eq from equipos where id = e.equipo_id;
  if t.email is not null then dest := array[t.email]; end if;
  if p_equipo then
    dest := dest || coalesce((select array_agg(tc.email) from asignaciones_tecnico a join tecnicos tc on tc.id = a.tecnico_id
                              where a.equipo_id = e.equipo_id and a.hasta is null and tc.activo and tc.email is not null and tc.id is distinct from e.receptor_id), '{}');
  end if;
  if c.copia_entregas_admin then dest := dest || coalesce(c.correo_destinatarios, '{}'); end if;
  if coalesce(array_length(dest, 1), 0) = 0 then return null; end if;
  insert into envios_aviso (canal, tipo, entrega_id, asunto, cuerpo, destinatarios)
  values ('correo', 'entrega', p_entrega,
          format('Entrega de material n.º %s · %s', e.numero, to_char(coalesce(e.firmada_ts, now()) at time zone 'Europe/Madrid', 'DD/MM/YYYY')),
          format(E'Hola:\n\nTe enviamos la copia del material entregado al equipo %s (entrega %s), recogido y firmado por %s. La tienes en el PDF adjunto.\n\nSi algo no cuadra, avisa al almacén.\n\nAlmacén Búfala',
                 coalesce(eq, e.equipo_id), e.numero, coalesce(t.nombre, '—')),
          (select array_agg(distinct x) from unnest(dest) x))
  returning id into v_id;
  return v_id;
end $$;

drop function public.confirmar_entrega(uuid, text);
create or replace function public.confirmar_entrega(p_id uuid, p_firma text, p_recoge text default null, p_copia_equipo boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := perfil_actual(); e entregas; l entrega_lineas; pr productos; nuevo_id text; h text; tec text; veh text; ref text; t tecnicos;
begin
  select * into e from entregas where id = p_id for update;
  if not found then raise exception 'Entrega no encontrada'; end if;
  if e.estado = 'firmada' then return jsonb_build_object('estado', 'duplicado', 'numero', e.numero, 'hash', e.hash); end if;
  if e.estado <> 'preparada' then raise exception 'La entrega % está anulada', e.numero; end if;
  if e.caduca <= now() then raise exception 'La reserva de % ha caducado: prepárala de nuevo', e.numero; end if;
  if coalesce(p_firma, '') = '' then raise exception 'Falta la firma de quien recoge'; end if;
  -- E-017: firma un técnico del equipo (el que recoge), según el historial de asignaciones en este momento
  tec := coalesce(nullif(p_recoge, ''), e.receptor_id);
  if tec is null then raise exception 'Elige qué técnico del equipo recoge y firma'; end if;
  select * into t from tecnicos where id = tec;
  if not found or not _tecnico_del_equipo(tec, e.equipo_id) then
    raise exception '% no pertenece al equipo %: firma uno de sus técnicos', coalesce(t.nombre, tec), (select nombre from equipos where id = e.equipo_id);
  end if;
  veh := (select id from vehiculos where equipo_id = e.equipo_id and activo);
  ref := e.numero || case when e.obra <> '' then ' · ' || e.obra else '' end;
  delete from reservas where entrega_id = p_id;
  for l in select * from entrega_lineas where entrega_id = p_id order by n loop
    if l.tipo = 'herramienta' then
      update dotacion set equipo_id = e.equipo_id, tecnico_id = tec where id = l.dotacion_id and estado = 'operativa';
      if not found then raise exception 'Una herramienta de la entrega ya no está disponible'; end if;
      insert into dotacion_historial (id, dotacion_id, tipo, nota, usuario, operario)
      values (gen_random_uuid(), l.dotacion_id, 'asignacion', 'Entregada en ' || e.numero || ' a ' || t.nombre, u.id, u.nombre);
      continue;
    end if;
    select * into pr from productos where sku = l.sku;
    if _es_personal(pr) then
      -- dotación personal: sale del almacén y pasa al técnico que firma
      perform _aplicar_movimiento(u, gen_random_uuid(), l.sku, 'salida', l.cantidad, 'Entrega de dotación personal', ref, '{}', e.equipo_id, p_id, null, null);
      nuevo_id := (case when pr.categoria = 'epis' then 'E' else 'R' end) || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      insert into dotacion (id, clase, nombre, marca, serie, talla, cantidad, equipo_id, tecnico_id)
      values (nuevo_id, case when pr.categoria = 'epis' then 'epi' else 'ropa' end, coalesce(pr.modelo, pr.nombre), pr.proveedor, '', pr.talla, ceil(l.cantidad)::int, e.equipo_id, tec);
      insert into dotacion_historial (id, dotacion_id, tipo, nota, usuario, operario) values (gen_random_uuid(), nuevo_id, 'alta', 'Entregada en ' || e.numero || ' a ' || t.nombre, u.id, u.nombre);
    else
      if veh is null then raise exception 'El equipo ya no tiene vehículo asignado: asígnale uno antes de firmar'; end if;
      perform _mover_vehiculo(u, gen_random_uuid(), l.sku, 'traspaso', veh, l.cantidad, 'Entrega a equipo', ref, p_id);
    end if;
  end loop;
  update entregas set estado = 'firmada', firma = p_firma, firmada_ts = now(), vehiculo_id = veh, receptor_id = tec, dni = t.dni_mascara where id = p_id;
  h := _hash_entrega(p_id);
  update entregas set hash = h where id = p_id;
  perform _encolar_copia_entrega(p_id, coalesce(p_copia_equipo, false));
  return jsonb_build_object('estado', 'aplicado', 'numero', e.numero, 'hash', h, 'recoge', tec);
end $$;

-- ---------- Portal: las entregas del equipo mientras el técnico pertenece a él ----------
create or replace function public.portal_datos(p_hash text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t tecnicos; v vehiculos; eq equipos;
begin
  select tc.* into t from portal_enlaces pe join tecnicos tc on tc.id = pe.tecnico_id
  where pe.hash = p_hash and pe.revocado is null and tc.activo;
  if not found then return null; end if;
  select * into eq from equipos where id = t.equipo_id and activo;
  select * into v from vehiculos where equipo_id = t.equipo_id and activo;
  return jsonb_build_object(
    'tecnico', jsonb_build_object('id', t.id, 'nombre', t.nombre, 'equipo', eq.nombre),
    'entregas', coalesce((
      select jsonb_agg(x order by x->>'fecha' desc) from (
        select jsonb_build_object('id', e.id, 'numero', e.numero, 'fecha', coalesce(e.firmada_ts, e.ts), 'obra', coalesce(e.obra, ''),
          'equipo', (select nombre from equipos where id = e.equipo_id), 'vehiculo', (select matricula from vehiculos where id = e.vehiculo_id),
          'recoge', (select nombre from tecnicos where id = e.receptor_id),
          'lineas', coalesce((select jsonb_agg(jsonb_build_object(
              'nombre', coalesce(pr.nombre, d.nombre, l.sku), 'codigo', coalesce(l.sku, d.serie, ''), 'cantidad', l.cantidad,
              'unidad', case when l.tipo = 'herramienta' then 'ud' else coalesce(pr.unidad, 'ud') end, 'foto', pr.foto_mini) order by l.n)
            from entrega_lineas l left join productos pr on pr.sku = l.sku left join dotacion d on d.id = l.dotacion_id where l.entrega_id = e.id), '[]'::jsonb)) as x
        from entregas e
        where e.estado = 'firmada' and exists (select 1 from asignaciones_tecnico a where a.tecnico_id = t.id and a.equipo_id = e.equipo_id
                                                 and coalesce(e.firmada_ts, e.ts) >= a.desde and (a.hasta is null or coalesce(e.firmada_ts, e.ts) < a.hasta))
        order by coalesce(e.firmada_ts, e.ts) desc limit 100) q), '[]'::jsonb),
    'vehiculo', case when v.id is null then null else jsonb_build_object('matricula', v.matricula, 'modelo', v.modelo) end,
    'a_bordo', case when v.id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('sku', s.sku, 'nombre', pr.nombre, 'unidad', pr.unidad, 'contenido', pr.contenido, 'unidades', s.unidades, 'foto', pr.foto_mini) order by pr.nombre)
      from stock_vehiculo s join productos pr on pr.sku = s.sku where s.vehiculo_id = v.id and s.unidades <> 0), '[]'::jsonb) end
  );
end $$;
create or replace function public.portal_entrega_permitida(p_hash text, p_entrega uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from portal_enlaces pe join tecnicos tc on tc.id = pe.tecnico_id join entregas e on e.id = p_entrega
                 join asignaciones_tecnico a on a.tecnico_id = tc.id and a.equipo_id = e.equipo_id
                 where pe.hash = p_hash and pe.revocado is null and tc.activo and e.estado = 'firmada'
                   and coalesce(e.firmada_ts, e.ts) >= a.desde and (a.hasta is null or coalesce(e.firmada_ts, e.ts) < a.hasta))
$$;

revoke execute on function public._tecnico_del_equipo(text, text), public._encolar_copia_entrega(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.confirmar_entrega(uuid, text, text, boolean) from public, anon;
grant execute on function public.confirmar_entrega(uuid, text, text, boolean) to authenticated;
revoke execute on function public.portal_datos(text), public.portal_entrega_permitida(text, uuid) from public, anon, authenticated;
grant execute on function public.portal_datos(text), public.portal_entrega_permitida(text, uuid) to service_role;
