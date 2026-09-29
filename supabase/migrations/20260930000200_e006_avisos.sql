-- E-006 · Mínimos y avisos de reposición (+ E-008: reposición de custodia agrupada por propietario, informes y actas)
-- El aviso nace en el servidor, con un trigger, cuando el stock CRUZA el mínimo hacia abajo. Un solo aviso abierto por artículo.
-- Los envíos (correo, push, Telegram) salen de una cola (envios_aviso) que procesa la función de servidor "notificar".

-- ---------- Mínimos, objetivo de reposición y variantes de ropa y EPIs ----------
alter table public.productos drop constraint productos_categoria_check;
alter table public.productos add constraint productos_categoria_check
  check (categoria in ('cargadores', 'cuadros', 'cables', 'tubos', 'fijaciones', 'aparamenta', 'fontaneria', 'epis', 'ropa'));
alter table public.productos
  add column objetivo numeric(14,3) check (objetivo >= 0),            -- stock al que se repone (por defecto 2 × mínimo)
  add column proveedor_habitual text,
  add column modelo text,                                             -- ropa y EPIs: agrupa las tallas de un mismo modelo
  add column talla text;

-- Herramientas de repuesto: mínimo de unidades operativas y sin asignar por modelo
alter table public.dotacion add column modelo text;
create table public.minimos_herramienta (
  modelo    text primary key,
  minimo    int not null check (minimo >= 0),
  objetivo  int check (objetivo >= 0),
  proveedor text not null default ''
);

-- ---------- Avisos de reposición ----------
create table public.avisos_reposicion (
  id                  uuid primary key default gen_random_uuid(),
  sku                 text references public.productos(sku) on delete cascade,
  modelo_herramienta  text,
  destino             text not null check (destino in ('proveedor', 'propietario')),   -- E-008: la custodia se pide al propietario
  grupo               text not null,                                                   -- proveedor habitual o id del propietario
  estado              text not null default 'abierto' check (estado in ('abierto', 'pedido', 'cerrado')),
  creado              timestamptz not null default now(),
  stock_al_crear      numeric(14,3),
  minimo              numeric(14,3),
  cantidad_pedida     numeric(14,3),
  proveedor_pedido    text,
  pedido_ts           timestamptz,
  pedido_por          text,
  ultimo_recordatorio timestamptz,
  cerrado_ts          timestamptz,
  check (sku is not null or modelo_herramienta is not null)
);
create unique index avisos_uno_abierto_sku on public.avisos_reposicion (sku) where estado <> 'cerrado' and sku is not null;
create unique index avisos_uno_abierto_modelo on public.avisos_reposicion (modelo_herramienta) where estado <> 'cerrado' and modelo_herramienta is not null;

-- ---------- Configuración de canales (una sola fila) ----------
create table public.config_avisos (
  id                  int primary key default 1 check (id = 1),
  correo_activo       boolean not null default false,
  correo_modo         text not null default 'resumen' check (correo_modo in ('inmediato', 'resumen')),
  correo_hora         time not null default '08:00',
  correo_remitente    text not null default '',
  correo_destinatarios text[] not null default '{}',
  push_activo         boolean not null default true,
  push_modo           text not null default 'inmediato' check (push_modo in ('inmediato', 'resumen')),
  push_hora           time not null default '08:00',
  telegram_activo     boolean not null default false,
  telegram_modo       text not null default 'inmediato' check (telegram_modo in ('inmediato', 'resumen')),
  telegram_hora       time not null default '08:00',
  telegram_chat_id    text not null default '',
  dias_recordatorio   int not null default 7 check (dias_recordatorio between 1 and 90),
  custodia_envio      text not null default 'manual' check (custodia_envio in ('manual', 'automatico')),  -- E-008
  informe_custodia    text not null default 'mensual' check (informe_custodia in ('semanal', 'mensual', 'ninguno')),
  zona_horaria        text not null default 'Europe/Madrid',
  actualizado         timestamptz not null default now()
);
insert into public.config_avisos (id) values (1);

-- ---------- Cola y registro de envíos ----------
create table public.envios_aviso (
  id            uuid primary key default gen_random_uuid(),
  ts            timestamptz not null default now(),
  canal         text not null check (canal in ('correo', 'push', 'telegram')),
  tipo          text not null check (tipo in ('critico', 'resumen', 'recordatorio', 'prueba', 'solicitud', 'informe', 'incidencia_custodia')),
  aviso_id      uuid references public.avisos_reposicion(id) on delete set null,
  asunto        text not null default '',
  cuerpo        text not null default '',
  destinatarios text[] not null default '{}',
  adjunto_csv   text,
  estado        text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'error', 'descartado')),
  error         text,
  reintentos    int not null default 0,
  enviado_ts    timestamptz
);
create index envios_pendientes on public.envios_aviso (ts) where estado in ('pendiente', 'error');

-- Suscripciones de notificaciones push (Web Push) de cada dispositivo
create table public.suscripciones_push (
  endpoint text primary key,
  usuario  uuid not null references public.perfiles(id),
  p256dh   text not null,
  auth     text not null,
  creado   timestamptz not null default now()
);

-- E-008: acta de recuento de custodia firmada por el representante del propietario
create table public.actas_custodia (
  id            uuid primary key,
  numero        text not null unique,
  ts            timestamptz not null default now(),
  propietario_id text not null references public.propietarios(id),
  representante text not null check (length(trim(representante)) > 0),
  firma         text not null,
  lineas        jsonb not null,                      -- [{sku, sistema, contado}]
  hash          text not null,
  usuario       uuid references public.perfiles(id),
  operario      text not null
);
create sequence public.actas_numero start 1;
create trigger actas_inalterables before update or delete on public.actas_custodia for each row execute function public._prohibir_cambios();

-- ---------- Cantidad sugerida: objetivo − stock, redondeada al formato de compra ----------
create or replace function public.cantidad_sugerida(p_stock numeric, p_minimo numeric, p_objetivo numeric, p_formato numeric) returns numeric
language sql immutable as $$
  select case when coalesce(p_objetivo, p_minimo * 2) - p_stock <= 0 then 0
    else greatest(coalesce(nullif(p_formato, 0), 1), ceil((coalesce(p_objetivo, p_minimo * 2) - p_stock) / coalesce(nullif(p_formato, 0), 1)) * coalesce(nullif(p_formato, 0), 1)) end
$$;

-- ---------- Encolar los envíos inmediatos de un aviso ----------
create or replace function public._encolar_inmediatos(p_aviso uuid, p_tipo text, p_asunto text, p_cuerpo text) returns void
language plpgsql security definer set search_path = public as $$
declare c config_avisos;
begin
  select * into c from config_avisos where id = 1;
  if c.correo_activo and c.correo_modo = 'inmediato' then
    insert into envios_aviso (canal, tipo, aviso_id, asunto, cuerpo, destinatarios) values ('correo', p_tipo, p_aviso, p_asunto, p_cuerpo, c.correo_destinatarios);
  end if;
  if c.push_activo and c.push_modo = 'inmediato' then
    insert into envios_aviso (canal, tipo, aviso_id, asunto, cuerpo) values ('push', p_tipo, p_aviso, p_asunto, p_cuerpo);
  end if;
  if c.telegram_activo and c.telegram_modo = 'inmediato' then
    insert into envios_aviso (canal, tipo, aviso_id, asunto, cuerpo) values ('telegram', p_tipo, p_aviso, p_asunto, p_cuerpo);
  end if;
end $$;

-- ---------- Trigger: crear el aviso al cruzar el mínimo y cerrarlo al reponer ----------
create or replace function public._aviso_reposicion() returns trigger
language plpgsql security definer set search_path = public as $$
declare aid uuid; custodia boolean := new.propiedad = 'custodia'; grupo text; quien text;
begin
  if new.borrador then return new; end if;
  if new.stock < new.minimo and (tg_op = 'INSERT' or not (old.stock < old.minimo)) then
    grupo := case when custodia then new.propietario_id else coalesce(nullif(new.proveedor_habitual, ''), nullif(new.proveedor, ''), 'Sin proveedor') end;
    insert into avisos_reposicion (sku, destino, grupo, stock_al_crear, minimo)
    values (new.sku, case when custodia then 'propietario' else 'proveedor' end, grupo, new.stock, new.minimo)
    on conflict (sku) where estado <> 'cerrado' and sku is not null do nothing
    returning id into aid;
    if aid is not null then
      quien := case when custodia then 'Solicitar a ' || coalesce((select nombre from propietarios where id = new.propietario_id), 'el propietario') else 'Pedir a ' || grupo end;
      perform _encolar_inmediatos(aid, 'critico', 'Stock bajo mínimo: ' || new.nombre,
        format('%s: quedan %s %s (mínimo %s). %s.', new.nombre, _fmt(new.stock), new.unidad, _fmt(new.minimo), quien));
    end if;
  elsif new.stock >= new.minimo then
    update avisos_reposicion set estado = 'cerrado', cerrado_ts = now() where sku = new.sku and estado <> 'cerrado';
  end if;
  return new;
end $$;
create trigger productos_aviso_reposicion after insert or update of stock, minimo on public.productos for each row execute function public._aviso_reposicion();

-- Herramientas de repuesto: se revisa el modelo afectado tras cada cambio de la dotación o de su mínimo
create or replace function public._revisar_repuesto(p_modelo text) returns void
language plpgsql security definer set search_path = public as $$
declare m minimos_herramienta; libres int; aid uuid;
begin
  if p_modelo is null then return; end if;
  select * into m from minimos_herramienta where modelo = p_modelo;
  if not found then update avisos_reposicion set estado = 'cerrado', cerrado_ts = now() where modelo_herramienta = p_modelo and estado <> 'cerrado'; return; end if;
  select count(*) into libres from dotacion where clase = 'herramienta' and modelo = p_modelo and estado = 'operativa' and equipo_id is null and tecnico_id is null;
  if libres < m.minimo then
    insert into avisos_reposicion (modelo_herramienta, destino, grupo, stock_al_crear, minimo)
    values (p_modelo, 'proveedor', coalesce(nullif(m.proveedor, ''), 'Sin proveedor'), libres, m.minimo)
    on conflict (modelo_herramienta) where estado <> 'cerrado' and modelo_herramienta is not null do nothing
    returning id into aid;
    if aid is not null then
      perform _encolar_inmediatos(aid, 'critico', 'Faltan herramientas de repuesto: ' || p_modelo, format('%s: %s de repuesto (mínimo %s).', p_modelo, libres, m.minimo));
    end if;
  else
    update avisos_reposicion set estado = 'cerrado', cerrado_ts = now() where modelo_herramienta = p_modelo and estado <> 'cerrado';
  end if;
end $$;
create or replace function public._trg_repuesto_dotacion() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform _revisar_repuesto(new.modelo);
  if tg_op = 'UPDATE' and old.modelo is distinct from new.modelo then perform _revisar_repuesto(old.modelo); end if;
  return new;
end $$;
create trigger dotacion_repuesto after insert or update on public.dotacion for each row execute function public._trg_repuesto_dotacion();
create or replace function public._trg_repuesto_minimo() returns trigger language plpgsql security definer set search_path = public as $$
begin perform _revisar_repuesto(coalesce(new.modelo, old.modelo)); return coalesce(new, old); end $$;
create trigger minimos_herramienta_repuesto after insert or update or delete on public.minimos_herramienta for each row execute function public._trg_repuesto_minimo();

-- ---------- Los pedidos pasan a los avisos: se retira la tabla provisional de E-002 ----------
drop function public.marcar_pedido(text, numeric);
drop table public.pedidos_reposicion;

-- _aplicar_movimiento ya no cierra pedidos (lo hace el trigger de avisos)
create or replace function public._aplicar_movimiento(
  p public.perfiles, p_id uuid, p_sku text, p_tipo text, p_cantidad numeric, p_motivo text,
  p_referencia text, p_series text[], p_equipo text, p_entrega uuid, p_albaran uuid, p_corrige uuid
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  pr productos; delta numeric; s text; n int := coalesce(array_length(p_series, 1), 0);
begin
  if p_tipo not in ('entrada', 'salida', 'merma', 'ajuste') then raise exception 'Tipo de movimiento no válido'; end if;
  if p_cantidad is null or p_cantidad = 0 then raise exception 'Indica una cantidad distinta de cero'; end if;
  if p_tipo <> 'ajuste' and p_cantidad < 0 then raise exception 'Indica una cantidad mayor que cero'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo del movimiento'; end if;
  select * into pr from productos where sku = p_sku for update;
  if not found then raise exception 'Producto no encontrado: %', p_sku; end if;
  if pr.borrador then raise exception '% está en borrador: el administrador debe completarla antes de moverla', pr.sku; end if;
  delta := case p_tipo when 'entrada' then p_cantidad when 'ajuste' then p_cantidad else -p_cantidad end;
  if pr.stock + delta < 0 then raise exception 'Solo hay % % de %', _fmt(pr.stock), pr.unidad, pr.nombre; end if;
  if pr.propiedad = 'custodia' and p_tipo = 'salida' and coalesce(trim(p_referencia), '') = '' then
    raise exception 'Indica la obra o instalación de destino: % está en custodia de %', pr.nombre, (select nombre from propietarios where id = pr.propietario_id);
  end if;
  if pr.con_serie then
    if abs(delta) <> trunc(abs(delta)) or abs(delta) <> n then raise exception '%: indica % n.º de serie (hay %)', pr.nombre, _fmt(abs(delta)), n; end if;
    if (select count(distinct x) from unnest(p_series) x) <> n then raise exception 'Hay números de serie repetidos'; end if;
    foreach s in array p_series loop
      if delta > 0 then
        if exists (select 1 from series where sku = pr.sku and serie = s and en_stock) then raise exception 'El n.º de serie % ya está en stock', s; end if;
        insert into series (sku, serie, en_stock, equipo_id) values (pr.sku, s, true, null) on conflict (sku, serie) do update set en_stock = true, equipo_id = null;
      else
        if not exists (select 1 from series where sku = pr.sku and serie = s and en_stock) then raise exception 'El n.º de serie % no está en stock', s; end if;
        update series set en_stock = false, equipo_id = p_equipo where sku = pr.sku and serie = s;
      end if;
    end loop;
  elsif n > 0 then raise exception '% no lleva control por n.º de serie', pr.nombre;
  end if;
  update productos set stock = stock + delta, actualizado = now() where sku = pr.sku;
  insert into movimientos (id, sku, tipo, cantidad, motivo, referencia, series, equipo_id, usuario, operario, corrige, entrega_id, albaran_id)
  values (p_id, pr.sku, p_tipo, p_cantidad, trim(p_motivo), coalesce(p_referencia, ''), coalesce(p_series, '{}'), p_equipo, p.id, p.nombre, p_corrige, p_entrega, p_albaran);
  -- E-008: daños y pérdidas de material en custodia avisan al propietario (no son coste propio)
  if pr.propiedad = 'custodia' and p_tipo = 'merma' then
    perform _encolar_incidencia_custodia(pr, p_cantidad, p_motivo, p_referencia, p_series);
  end if;
  return pr.stock + delta;
end $$;

create or replace function public._encolar_incidencia_custodia(pr productos, p_cantidad numeric, p_motivo text, p_referencia text, p_series text[]) returns void
language plpgsql security definer set search_path = public as $$
declare c config_avisos; o propietarios; texto text;
begin
  select * into c from config_avisos where id = 1;
  select * into o from propietarios where id = pr.propietario_id;
  texto := format('Incidencia de custodia: %s · %s %s · %s%s%s', pr.nombre, _fmt(p_cantidad), pr.unidad, p_motivo,
                  case when coalesce(p_referencia, '') <> '' then ' · ' || p_referencia else '' end,
                  case when coalesce(array_length(p_series, 1), 0) > 0 then ' · S/N ' || array_to_string(p_series, ', ') else '' end);
  -- el administrador lo recibe por sus canales; al propietario, solo si el envío automático está activado
  perform _encolar_inmediatos(null, 'incidencia_custodia', 'Incidencia en material de ' || o.nombre, texto);
  if c.custodia_envio = 'automatico' and c.correo_activo and array_length(o.correos_reposicion, 1) > 0 then
    insert into envios_aviso (canal, tipo, asunto, cuerpo, destinatarios) values ('correo', 'incidencia_custodia', 'Incidencia en material en custodia', texto, o.correos_reposicion);
  end if;
end $$;

-- ---------- Acciones del administrador sobre los avisos ----------
create or replace function public.marcar_pedido(p_sku text, p_cantidad numeric, p_proveedor text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); pr productos; aid uuid;
begin
  select * into pr from productos where sku = upper(p_sku);
  if not found then raise exception 'Producto no encontrado'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'Indica la cantidad pedida'; end if;
  select id into aid from avisos_reposicion where sku = pr.sku and estado <> 'cerrado';
  if aid is null then  -- pedido anticipado, antes de llegar al mínimo
    insert into avisos_reposicion (sku, destino, grupo, stock_al_crear, minimo)
    values (pr.sku, case when pr.propiedad = 'custodia' then 'propietario' else 'proveedor' end,
            case when pr.propiedad = 'custodia' then pr.propietario_id else coalesce(nullif(pr.proveedor_habitual, ''), nullif(pr.proveedor, ''), 'Sin proveedor') end, pr.stock, pr.minimo)
    returning id into aid;
  end if;
  update avisos_reposicion set estado = 'pedido', cantidad_pedida = p_cantidad, proveedor_pedido = coalesce(nullif(p_proveedor, ''), grupo),
    pedido_ts = now(), pedido_por = p.nombre where id = aid;
  return jsonb_build_object('estado', 'aplicado', 'aviso', aid);
end $$;

create or replace function public.marcar_pedido_herramienta(p_modelo text, p_cantidad int, p_proveedor text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin();
begin
  update avisos_reposicion set estado = 'pedido', cantidad_pedida = p_cantidad, proveedor_pedido = coalesce(nullif(p_proveedor, ''), grupo), pedido_ts = now(), pedido_por = p.nombre
  where modelo_herramienta = p_modelo and estado <> 'cerrado';
  if not found then raise exception 'No hay aviso abierto para ese modelo'; end if;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- Mínimos y objetivos: individuales o en bloque (solo administrador)
create or replace function public.fijar_minimos(p_cambios jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); c jsonb; n int := 0;
begin
  for c in select * from jsonb_array_elements(coalesce(p_cambios, '[]'::jsonb)) loop
    if (c->>'minimo')::numeric < 0 or coalesce((c->>'objetivo')::numeric, 0) < 0 then raise exception 'Los mínimos y objetivos no pueden ser negativos'; end if;
    update productos set minimo = coalesce((c->>'minimo')::numeric, minimo),
      objetivo = case when c ? 'objetivo' then (c->>'objetivo')::numeric else objetivo end,
      proveedor_habitual = case when c ? 'proveedor_habitual' then nullif(c->>'proveedor_habitual', '') else proveedor_habitual end
    where sku = upper(c->>'sku');
    if found then n := n + 1; end if;
  end loop;
  return jsonb_build_object('estado', 'aplicado', 'cambiados', n);
end $$;

create or replace function public.fijar_minimo_herramienta(p_modelo text, p_minimo int, p_objetivo int default null, p_proveedor text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin();
begin
  if p_minimo is null or p_minimo <= 0 then delete from minimos_herramienta where modelo = p_modelo;
  else insert into minimos_herramienta (modelo, minimo, objetivo, proveedor) values (p_modelo, p_minimo, p_objetivo, coalesce(p_proveedor, ''))
       on conflict (modelo) do update set minimo = excluded.minimo, objetivo = excluded.objetivo, proveedor = excluded.proveedor;
  end if;
  return jsonb_build_object('estado', 'aplicado');
end $$;

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
    informe_custodia = coalesce(p->>'informe_custodia', informe_custodia), actualizado = now()
  where id = 1;
  return jsonb_build_object('estado', 'aplicado');
end $$;

create or replace function public.guardar_propietario(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin();
begin
  insert into propietarios (id, nombre, contacto, correos_reposicion, correos_informes)
  values (upper(p->>'id'), trim(p->>'nombre'), coalesce(p->>'contacto', ''),
          coalesce(array(select jsonb_array_elements_text(p->'correos_reposicion')), '{}'), coalesce(array(select jsonb_array_elements_text(p->'correos_informes')), '{}'))
  on conflict (id) do update set nombre = excluded.nombre, contacto = excluded.contacto, correos_reposicion = excluded.correos_reposicion, correos_informes = excluded.correos_informes;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- Cambiar la propiedad de un artículo (propio ↔ custodia): solo administrador
create or replace function public.cambiar_propiedad(p_sku text, p_propiedad text, p_propietario text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin();
begin
  update productos set propiedad = p_propiedad, propietario_id = case when p_propiedad = 'custodia' then p_propietario end where sku = upper(p_sku);
  if not found then raise exception 'Producto no encontrado'; end if;
  if p_propiedad = 'custodia' then update costes_producto set precio = null where sku = upper(p_sku); end if;
  return jsonb_build_object('estado', 'aplicado');
end $$;

create or replace function public.guardar_suscripcion_push(p_endpoint text, p_p256dh text, p_auth text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := perfil_actual();
begin
  insert into suscripciones_push (endpoint, usuario, p256dh, auth) values (p_endpoint, u.id, p_p256dh, p_auth)
  on conflict (endpoint) do update set usuario = excluded.usuario, p256dh = excluded.p256dh, auth = excluded.auth;
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- Envíos manuales desde la app (prueba de canal, solicitud a Esmove, pedido a proveedor, informe)
create or replace function public.encolar_envio(p_canal text, p_tipo text, p_asunto text, p_cuerpo text, p_destinatarios text[] default '{}', p_adjunto_csv text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin(); c config_avisos; dest text[];
begin
  if p_tipo not in ('prueba', 'solicitud', 'informe') then raise exception 'Tipo de envío no permitido'; end if;
  select * into c from config_avisos where id = 1;
  dest := case when coalesce(array_length(p_destinatarios, 1), 0) > 0 then p_destinatarios else c.correo_destinatarios end;
  if p_canal = 'correo' and coalesce(array_length(dest, 1), 0) = 0 then raise exception 'No hay destinatarios de correo configurados'; end if;
  insert into envios_aviso (canal, tipo, asunto, cuerpo, destinatarios, adjunto_csv) values (p_canal, p_tipo, p_asunto, p_cuerpo, dest, p_adjunto_csv);
  return jsonb_build_object('estado', 'aplicado');
end $$;

-- ---------- Resúmenes diarios y recordatorios de pedidos sin recibir (los llama pg_cron) ----------
create or replace function public.encolar_programados(p_ahora timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare c config_avisos; local timestamp; n int := 0; v_canal text; activo boolean; modo text; hora time; texto text; a record;
begin
  select * into c from config_avisos where id = 1;
  local := p_ahora at time zone c.zona_horaria;
  texto := (select string_agg(format('• %s: %s %s (mín. %s)%s', pr.nombre, _fmt(pr.stock), pr.unidad, _fmt(pr.minimo),
                    case when av.estado = 'pedido' then ' · pedido' else '' end), E'\n' order by av.destino, av.grupo, pr.nombre)
            from avisos_reposicion av join productos pr on pr.sku = av.sku where av.estado <> 'cerrado');
  foreach v_canal in array array['correo', 'push', 'telegram'] loop
    activo := case v_canal when 'correo' then c.correo_activo when 'push' then c.push_activo else c.telegram_activo end;
    modo := case v_canal when 'correo' then c.correo_modo when 'push' then c.push_modo else c.telegram_modo end;
    hora := case v_canal when 'correo' then c.correo_hora when 'push' then c.push_hora else c.telegram_hora end;
    if activo and modo = 'resumen' and local::time >= hora and texto is not null
       and not exists (select 1 from envios_aviso e where e.canal = v_canal and e.tipo = 'resumen' and (e.ts at time zone c.zona_horaria)::date = local::date) then
      insert into envios_aviso (ts, canal, tipo, asunto, cuerpo, destinatarios)
      values (p_ahora, v_canal, 'resumen', 'Resumen diario de reposición', texto, case when v_canal = 'correo' then c.correo_destinatarios else '{}' end);
      n := n + 1;
    end if;
  end loop;
  -- pedidos que llevan más de X días sin recibirse: se reenvía el aviso
  for a in select av.*, pr.nombre from avisos_reposicion av left join productos pr on pr.sku = av.sku
           where av.estado = 'pedido' and av.pedido_ts < p_ahora - make_interval(days => c.dias_recordatorio)
             and (av.ultimo_recordatorio is null or av.ultimo_recordatorio < p_ahora - make_interval(days => c.dias_recordatorio)) loop
    perform _encolar_inmediatos(a.id, 'recordatorio', 'Pedido sin recibir: ' || coalesce(a.nombre, a.modelo_herramienta),
      format('%s se pidió el %s a %s y aún no ha llegado.', coalesce(a.nombre, a.modelo_herramienta), to_char(a.pedido_ts at time zone c.zona_horaria, 'DD/MM/YYYY'), a.proveedor_pedido));
    update avisos_reposicion set ultimo_recordatorio = p_ahora where id = a.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- E-008: acta de recuento de custodia (firma del representante del propietario) ----------
create or replace function public.registrar_acta_custodia(p_id uuid, p_propietario text, p_representante text, p_firma text, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u perfiles := perfil_actual(); a actas_custodia; num text; lin jsonb;
begin
  select * into a from actas_custodia where id = p_id;
  if found then return jsonb_build_object('estado', 'duplicado', 'numero', a.numero, 'hash', a.hash); end if;
  if coalesce(trim(p_representante), '') = '' then raise exception 'Indica el nombre del representante'; end if;
  if coalesce(p_firma, '') = '' then raise exception 'Falta la firma del representante'; end if;
  -- el stock del sistema se toma aquí, en el servidor, en el momento de firmar
  select jsonb_agg(jsonb_build_object('sku', pr.sku, 'sistema', pr.stock, 'contado', (l->>'contado')::numeric) order by pr.sku) into lin
  from jsonb_array_elements(p_lineas) l join productos pr on pr.sku = upper(l->>'sku') and pr.propiedad = 'custodia' and pr.propietario_id = p_propietario;
  if lin is null then raise exception 'El acta no tiene artículos de ese propietario'; end if;
  num := format('ACTA-%s-%s', extract(year from now())::int, lpad(nextval('actas_numero')::text, 3, '0'));
  insert into actas_custodia (id, numero, propietario_id, representante, firma, lineas, hash, usuario, operario)
  values (p_id, num, p_propietario, trim(p_representante), p_firma, lin,
          encode(extensions.digest(jsonb_build_object('id', p_id, 'numero', num, 'propietario', p_propietario, 'representante', trim(p_representante), 'firma', p_firma, 'lineas', lin)::text, 'sha256'), 'hex'),
          u.id, u.nombre);
  return jsonb_build_object('estado', 'aplicado', 'numero', num);
end $$;

-- ---------- Estado inicial: avisos de lo que ya está por debajo del mínimo ----------
insert into public.avisos_reposicion (sku, destino, grupo, stock_al_crear, minimo)
select sku, case when propiedad = 'custodia' then 'propietario' else 'proveedor' end,
       case when propiedad = 'custodia' then propietario_id else coalesce(nullif(proveedor_habitual, ''), nullif(proveedor, ''), 'Sin proveedor') end, stock, minimo
from public.productos where stock < minimo and not borrador;

-- ---------- Seguridad ----------
alter table public.minimos_herramienta enable row level security;
alter table public.avisos_reposicion enable row level security;
alter table public.config_avisos enable row level security;
alter table public.envios_aviso enable row level security;
alter table public.suscripciones_push enable row level security;
alter table public.actas_custodia enable row level security;
revoke all on public.minimos_herramienta, public.avisos_reposicion, public.config_avisos, public.envios_aviso, public.suscripciones_push, public.actas_custodia from anon, authenticated;
grant select on public.minimos_herramienta, public.avisos_reposicion, public.config_avisos, public.envios_aviso, public.actas_custodia to authenticated;
create policy minimos_herr_lectura on public.minimos_herramienta for select to authenticated using (public.es_usuario_activo());
create policy avisos_lectura on public.avisos_reposicion for select to authenticated using (public.es_usuario_activo());
create policy config_avisos_admin on public.config_avisos for select to authenticated using (public.es_admin());
create policy envios_admin on public.envios_aviso for select to authenticated using (public.es_admin());
create policy actas_lectura on public.actas_custodia for select to authenticated using (public.es_usuario_activo());

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.marcar_pedido(text, numeric, text), public.marcar_pedido_herramienta(text, int, text), public.fijar_minimos(jsonb),
  public.fijar_minimo_herramienta(text, int, int, text), public.guardar_config_avisos(jsonb), public.guardar_propietario(jsonb),
  public.cambiar_propiedad(text, text, text), public.guardar_suscripcion_push(text, text, text), public.encolar_envio(text, text, text, text, text[], text),
  public.registrar_acta_custodia(uuid, text, text, text, jsonb), public.cantidad_sugerida(numeric, numeric, numeric, numeric)
to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.avisos_reposicion, public.minimos_herramienta, public.config_avisos, public.envios_aviso, public.actas_custodia;
  end if;
end $$;

-- ---------- Programación con pg_cron + pg_net (solo en Supabase; la guía explica cómo guardar las claves en Vault) ----------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net with schema extensions;
    -- cada minuto: encola resúmenes y recordatorios y pide a "notificar" que vacíe la cola
    perform cron.schedule('almacen-avisos', '* * * * *', $cron$
      select public.encolar_programados();
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'url_notificar'),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-clave-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'clave_cron')),
        body := '{"accion":"procesar"}'::jsonb)
      where exists (select 1 from public.envios_aviso where estado in ('pendiente', 'error') and reintentos < 5)
        and exists (select 1 from vault.decrypted_secrets where name = 'url_notificar');
    $cron$);
    -- informe de custodia programado (el día 1 de cada mes a las 7:00 UTC; la función comprueba la configuración)
    perform cron.schedule('almacen-informe-custodia', '0 7 1 * *', $cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'url_notificar'),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-clave-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'clave_cron')),
        body := '{"accion":"informe_programado"}'::jsonb)
      where exists (select 1 from vault.decrypted_secrets where name = 'url_notificar');
    $cron$);
  end if;
end $$;

-- ---------- Alta y edición de referencias y dotación con los campos nuevos (objetivo, proveedor habitual, modelo, talla) ----------
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
  insert into productos (sku, ean, ref_proveedor, nombre, categoria, unidad, formato, formato_texto, minimo, objetivo, ubicacion, proveedor, proveedor_habitual,
                         con_serie, borrador, propiedad, propietario_id, modelo, talla)
  values (v_sku, nullif(trim(p_producto->>'ean'), ''), nullif(trim(p_producto->>'ref_proveedor'), ''), trim(p_producto->>'nombre'),
          p_producto->>'categoria', p_producto->>'unidad', coalesce((p_producto->>'formato')::numeric, 1), coalesce(p_producto->>'formato_texto', ''),
          coalesce((p_producto->>'minimo')::numeric, 0), nullif(p_producto->>'objetivo', '')::numeric, p_producto->>'ubicacion', coalesce(p_producto->>'proveedor', ''),
          nullif(trim(p_producto->>'proveedor_habitual'), ''),
          coalesce((p_producto->>'con_serie')::boolean, false) or p_producto->>'categoria' = 'cargadores', false,
          case when custodia then 'custodia' else 'propia' end, case when custodia then p_producto->>'propietario_id' end,
          nullif(trim(p_producto->>'modelo'), ''), nullif(trim(p_producto->>'talla'), ''))
  on conflict (sku) do update set ean = excluded.ean, ref_proveedor = excluded.ref_proveedor, nombre = excluded.nombre,
    categoria = excluded.categoria, unidad = excluded.unidad, formato = excluded.formato, formato_texto = excluded.formato_texto,
    minimo = excluded.minimo, objetivo = excluded.objetivo, ubicacion = excluded.ubicacion, proveedor = excluded.proveedor,
    proveedor_habitual = excluded.proveedor_habitual, con_serie = excluded.con_serie, borrador = false,
    propiedad = excluded.propiedad, propietario_id = excluded.propietario_id, modelo = excluded.modelo, talla = excluded.talla, actualizado = now();
  insert into costes_producto (sku, precio) values (v_sku, case when custodia then null else nullif(p_producto->>'precio', '')::numeric end)
    on conflict (sku) do update set precio = excluded.precio;
  if not coalesce(existe, false) and inicial > 0 and not coalesce((p_producto->>'con_serie')::boolean, false) then
    perform _aplicar_movimiento(p, gen_random_uuid(), v_sku, 'ajuste', inicial, 'Alta de referencia', 'Stock inicial', '{}', null, null, null, null);
  end if;
  return jsonb_build_object('estado', 'aplicado', 'sku', v_sku);
end $$;

create or replace function public.alta_dotacion(p_dotacion jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := exigir_admin(); v_id text := p_dotacion->>'id';
begin
  if exists (select 1 from dotacion where id = v_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  insert into dotacion (id, clase, nombre, marca, modelo, serie, talla, cantidad, caduca, equipo_id, tecnico_id)
  values (v_id, p_dotacion->>'clase', trim(p_dotacion->>'nombre'), coalesce(p_dotacion->>'marca', ''),
          nullif(trim(coalesce(p_dotacion->>'modelo', case when p_dotacion->>'clase' = 'herramienta' then p_dotacion->>'marca' end)), ''),
          coalesce(p_dotacion->>'serie', ''), nullif(p_dotacion->>'talla', ''), coalesce((p_dotacion->>'cantidad')::int, 1), nullif(p_dotacion->>'caduca', '')::date,
          nullif(p_dotacion->>'equipo_id', ''), nullif(p_dotacion->>'tecnico_id', ''));
  insert into costes_dotacion (id, valor) values (v_id, coalesce((p_dotacion->>'valor')::numeric, 0));
  insert into dotacion_historial (id, dotacion_id, tipo, nota, usuario, operario) values (gen_random_uuid(), v_id, 'alta', 'Alta en la dotación', p.id, p.nombre);
  return jsonb_build_object('estado', 'aplicado');
end $$;
grant execute on function public.guardar_producto(jsonb), public.alta_dotacion(jsonb) to authenticated;

-- E-008: lo que llega de un depositante se registra como "Recepción en custodia" (sin precios)
create or replace function public.aprobar_albaran(p_id uuid, p_cabecera jsonb, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p perfiles := perfil_actual(); l jsonb; n int := 0; uds numeric := 0; num text := coalesce(nullif(trim(p_cabecera->>'numero'), ''), 's/n');
  motivo text;
begin
  if exists (select 1 from albaranes where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'El albarán no tiene líneas que ingresar'; end if;
  insert into albaranes (id, numero, proveedor, cif, fecha, lineas, unidades, confianza, modo, usuario, operario)
  values (p_id, num, coalesce(p_cabecera->>'proveedor', ''), coalesce(p_cabecera->>'cif', ''), coalesce(p_cabecera->>'fecha', ''),
          0, 0, (p_cabecera->>'confianza')::numeric, coalesce(p_cabecera->>'modo', 'sim'), p.id, p.nombre);
  for l in select * from jsonb_array_elements(p_lineas) loop
    n := n + 1; uds := uds + (l->>'cantidad')::numeric;
    motivo := case when (select propiedad from productos where sku = upper(l->>'sku')) = 'custodia' then 'Recepción en custodia' else 'Compra a proveedor' end;
    perform _aplicar_movimiento(p, gen_random_uuid(), upper(l->>'sku'), 'entrada', (l->>'cantidad')::numeric, motivo,
      'Alb. ' || num, coalesce(array(select jsonb_array_elements_text(l->'series')), '{}'), null, null, p_id, null);
  end loop;
  update albaranes set lineas = n, unidades = uds where id = p_id;
  return jsonb_build_object('estado', 'aplicado', 'lineas', n, 'unidades', uds);
end $$;
grant execute on function public.aprobar_albaran(uuid, jsonb, jsonb) to authenticated;
