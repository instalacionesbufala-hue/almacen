-- E-011 · Entregas libres con firma y copia por correo al técnico.
-- Sustituye el flujo de plantillas de E-007 (decisión del usuario: nada predeterminado). Se conserva todo lo demás de E-007:
-- preparar con reserva de stock, caducidad, firma en pantalla grande, confirmar_entrega atómica, huella y PDF.

-- ---------- Plantillas: sin uso (las tablas se conservan con sus datos, no se borran) ----------
comment on table public.plantillas_entrega is 'SIN USO desde E-011 (30/09/2026): el usuario no quiere entregas predeterminadas. Se conserva por los datos; la app ya no la lee ni la escribe.';
comment on table public.plantilla_lineas is 'SIN USO desde E-011 (30/09/2026). Ver plantillas_entrega.';
comment on column public.entregas.plantilla_id is 'SIN USO desde E-011: las entregas nuevas no llevan plantilla.';
revoke execute on function public.guardar_plantilla(jsonb) from authenticated;

-- ---------- Correo del técnico (opcional, validado) ----------
alter table public.tecnicos add column email text
  check (email is null or email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');

create or replace function public._email_valido(p text) returns boolean language sql immutable as $$
  select p ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
$$;

-- El personal de almacén puede escribir el correo del técnico al firmar: es la única edición de la ficha que se le permite
create or replace function public.guardar_email_tecnico(p_tecnico text, p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := perfil_actual(); e text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if e is not null and not _email_valido(e) then raise exception 'Correo no válido: %', e; end if;
  update tecnicos set email = e where id = p_tecnico;
  if not found then raise exception 'Técnico no encontrado'; end if;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- La ficha completa (administrador) también guarda el correo
create or replace function public.guardar_tecnico(p_tecnico jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); e text := nullif(lower(trim(coalesce(p_tecnico->>'email', ''))), '');
begin
  if coalesce(p_tecnico->>'dni_mascara', '') !~ '^(\*\*\*[0-9A-Z]{0,8}-?[A-Z]?|—)$' then raise exception 'DNI no válido: solo se guarda enmascarado'; end if;
  if e is not null and not _email_valido(e) then raise exception 'Correo no válido: %', e; end if;
  insert into tecnicos (id, nombre, rol, dni_mascara, equipo_id, email)
  values (p_tecnico->>'id', trim(p_tecnico->>'nombre'), coalesce(p_tecnico->>'rol', 'Técnico'), p_tecnico->>'dni_mascara', nullif(p_tecnico->>'equipo_id', ''), e)
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, dni_mascara = excluded.dni_mascara, activo = true,
    email = case when p_tecnico ? 'email' then excluded.email else tecnicos.email end;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- ---------- Copia de la entrega por correo ----------
alter table public.config_avisos add column copia_entregas_admin boolean not null default false;
alter table public.envios_aviso add column entrega_id uuid references public.entregas(id);
alter table public.envios_aviso drop constraint envios_aviso_tipo_check;
alter table public.envios_aviso add constraint envios_aviso_tipo_check
  check (tipo in ('critico', 'resumen', 'recordatorio', 'prueba', 'solicitud', 'informe', 'incidencia_custodia', 'entrega'));
create index envios_por_entrega on public.envios_aviso (entrega_id) where entrega_id is not null;

-- Encola la copia: al técnico y, si está configurado, al administrador. El PDF lo genera la función "notificar" al enviar.
create or replace function public._encolar_copia_entrega(p_entrega uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare e entregas; t tecnicos; c config_avisos; dest text[] := '{}'; v_id uuid;
begin
  select * into e from entregas where id = p_entrega;
  select * into t from tecnicos where id = e.receptor_id;
  select * into c from config_avisos where id = 1;
  if t.email is not null then dest := array[t.email]; end if;
  if c.copia_entregas_admin then dest := dest || coalesce(c.correo_destinatarios, '{}'); end if;
  if coalesce(array_length(dest, 1), 0) = 0 then return null; end if;   -- sin correo: la app ofrece descargar o compartir el PDF
  insert into envios_aviso (canal, tipo, entrega_id, asunto, cuerpo, destinatarios)
  values ('correo', 'entrega', p_entrega,
          format('Entrega de material n.º %s · %s', e.numero, to_char(coalesce(e.firmada_ts, now()) at time zone 'Europe/Madrid', 'DD/MM/YYYY')),
          format(E'Hola %s:\n\nTe enviamos la copia del material que has recibido y firmado (entrega %s). La tienes en el PDF adjunto.\n\nSi algo no cuadra, avisa al almacén.\n\nAlmacén Búfala', t.nombre, e.numero),
          (select array_agg(distinct x) from unnest(dest) x))
  returning id into v_id;
  return v_id;
end $$;

-- confirmar_entrega de E-007, igual que antes (todo o nada) y encolando la copia al final, dentro de la misma transacción
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
  perform _encolar_copia_entrega(p_id);
  return jsonb_build_object('estado', 'aplicado', 'numero', e.numero, 'hash', h);
end $$;

-- Reenviar la copia (p. ej. tras corregir el correo). Cualquier usuario activo.
create or replace function public.reenviar_copia_entrega(p_entrega uuid, p_email text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := perfil_actual(); e entregas; v_id uuid;
begin
  select * into e from entregas where id = p_entrega;
  if not found then raise exception 'Entrega no encontrada'; end if;
  if e.estado <> 'firmada' then raise exception 'Solo se envía copia de una entrega firmada'; end if;
  if nullif(trim(coalesce(p_email, '')), '') is not null then perform guardar_email_tecnico(e.receptor_id, p_email); end if;
  -- los intentos anteriores fallidos dejan de reintentarse
  update envios_aviso set estado = 'descartado' where entrega_id = p_entrega and estado in ('pendiente', 'error');
  v_id := _encolar_copia_entrega(p_entrega);
  if v_id is null then raise exception 'El técnico no tiene correo: escríbelo para enviar la copia'; end if;
  return jsonb_build_object('estado', 'aplicado', 'envio', v_id);
end $$;

-- Configuración: copia al administrador y horas de reserva
create or replace function public.guardar_config_avisos(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin();
begin
  update config_avisos set
    correo_activo = coalesce((p->>'correo_activo')::boolean, correo_activo), correo_modo = coalesce(p->>'correo_modo', correo_modo),
    correo_hora = coalesce((p->>'correo_hora')::time, correo_hora), correo_remitente = coalesce(p->>'correo_remitente', correo_remitente),
    correo_destinatarios = coalesce(array(select jsonb_array_elements_text(p->'correo_destinatarios')), correo_destinatarios),
    push_activo = coalesce((p->>'push_activo')::boolean, push_activo), push_modo = coalesce(p->>'push_modo', push_modo), push_hora = coalesce((p->>'push_hora')::time, push_hora),
    telegram_activo = coalesce((p->>'telegram_activo')::boolean, telegram_activo), telegram_modo = coalesce(p->>'telegram_modo', telegram_modo),
    telegram_hora = coalesce((p->>'telegram_hora')::time, telegram_hora), telegram_chat_id = coalesce(p->>'telegram_chat_id', telegram_chat_id),
    dias_recordatorio = coalesce((p->>'dias_recordatorio')::int, dias_recordatorio), custodia_envio = coalesce(p->>'custodia_envio', custodia_envio),
    informe_custodia = coalesce(p->>'informe_custodia', informe_custodia),
    horas_reserva = coalesce((p->>'horas_reserva')::int, horas_reserva),
    copia_entregas_admin = coalesce((p->>'copia_entregas_admin')::boolean, copia_entregas_admin),
    actualizado = now()
  where id = 1;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- ---------- Seguridad ----------
-- Todos los usuarios activos ven el estado de las copias de las entregas (para saber si llegó y reenviar)
create policy envios_entregas on public.envios_aviso for select to authenticated using (entrega_id is not null and public.es_usuario_activo());

revoke execute on function public._email_valido(text), public._encolar_copia_entrega(uuid) from public, anon, authenticated;
revoke execute on function public.guardar_email_tecnico(text, text), public.reenviar_copia_entrega(uuid, text) from public, anon;
grant execute on function public.guardar_email_tecnico(text, text), public.reenviar_copia_entrega(uuid, text), public.guardar_tecnico(jsonb),
  public.confirmar_entrega(uuid, text), public.guardar_config_avisos(jsonb) to authenticated;
