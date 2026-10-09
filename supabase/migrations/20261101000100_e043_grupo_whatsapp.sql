-- E-043 · "Enviar al grupo de WhatsApp" del equipo (o del socio, en las retiradas), con el PDF del justificante.
-- WhatsApp no deja abrir un grupo con texto o archivo: en el móvil se comparte el PDF (el usuario elige el grupo) y en el
-- ordenador se descarga el PDF y se abre el enlace de invitación del grupo. Aquí: el grupo de cada equipo y de cada socio,
-- y la "copia enviada al grupo" (canal grupo_whatsapp) en el historial de entregas, devoluciones y retiradas.

-- ---------- Grupo de WhatsApp: nombre (para mostrarlo) y enlace de invitación ----------
alter table public.equipos add column if not exists grupo_whatsapp_nombre text;
alter table public.equipos add column if not exists grupo_whatsapp_enlace text;
alter table public.propietarios add column if not exists grupo_whatsapp_nombre text;
alter table public.propietarios add column if not exists grupo_whatsapp_enlace text;
alter table public.equipos add constraint equipos_grupo_whatsapp_check check (grupo_whatsapp_enlace is null or grupo_whatsapp_enlace ~ '^https://chat\.whatsapp\.com/[A-Za-z0-9]{10,40}$');
alter table public.propietarios add constraint propietarios_grupo_whatsapp_check check (grupo_whatsapp_enlace is null or grupo_whatsapp_enlace ~ '^https://chat\.whatsapp\.com/[A-Za-z0-9]{10,40}$');

-- Valida y normaliza lo que se escribe: "chat.whatsapp.com/ABC…" o con "?…" detrás → https://chat.whatsapp.com/ABC…; vacío → null
create or replace function public._enlace_grupo_whatsapp(p text) returns text language plpgsql immutable as $$
declare m text[];
begin
  if coalesce(trim(p), '') = '' then return null; end if;
  m := regexp_match(trim(p), '^(?:https?://)?chat\.whatsapp\.com/(?:invite/)?([A-Za-z0-9]{10,40})(?:[/?#].*)?$', 'i');
  if m is null then raise exception 'El enlace del grupo debe ser una invitación de WhatsApp (https://chat.whatsapp.com/…)'; end if;
  return 'https://chat.whatsapp.com/' || m[1];
end $$;

create or replace function public._reescribir_e043(p_fn text, p_cambios text[][]) returns void language plpgsql as $$
declare d text; i int; n int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = p_fn;
  if d is null then raise exception 'E-043: no existe %', p_fn; end if;
  for i in 1 .. array_length(p_cambios, 1) loop
    n := (length(d) - length(replace(d, p_cambios[i][1], ''))) / length(p_cambios[i][1]);
    if n <> 1 then raise exception 'E-043: en % el texto aparece % veces: %', p_fn, n, p_cambios[i][1]; end if;
    d := replace(d, p_cambios[i][1], p_cambios[i][2]);
  end loop;
  execute d;
end $$;
do $$
begin
  -- guardar_equipo: si llega "grupo_whatsapp" ({nombre, enlace} o null) se guarda; si no llega, se conserva
  perform _reescribir_e043('guardar_equipo', array[
    [$a$on conflict (id) do update set nombre = excluded.nombre, estado = excluded.estado, activo = true;$a$,
     $b$on conflict (id) do update set nombre = excluded.nombre, estado = excluded.estado, activo = true;
  if p_equipo ? 'grupo_whatsapp' then
    update equipos set grupo_whatsapp_enlace = _enlace_grupo_whatsapp(p_equipo->'grupo_whatsapp'->>'enlace'),
      grupo_whatsapp_nombre = case when _enlace_grupo_whatsapp(p_equipo->'grupo_whatsapp'->>'enlace') is null then null
        else coalesce(nullif(trim(p_equipo->'grupo_whatsapp'->>'nombre'), ''), trim(p_equipo->>'nombre')) end
    where id = p_equipo->>'id';
  end if;$b$]]);
  -- guardar_propietario: igual
  perform _reescribir_e043('guardar_propietario', array[
    [$a$    correos_informes = excluded.correos_informes, activo = excluded.activo, color = excluded.color;$a$,
     $b$    correos_informes = excluded.correos_informes, activo = excluded.activo, color = excluded.color;
  if p ? 'grupo_whatsapp' then
    update propietarios set grupo_whatsapp_enlace = _enlace_grupo_whatsapp(p->'grupo_whatsapp'->>'enlace'),
      grupo_whatsapp_nombre = case when _enlace_grupo_whatsapp(p->'grupo_whatsapp'->>'enlace') is null then null
        else coalesce(nullif(trim(p->'grupo_whatsapp'->>'nombre'), ''), v_nombre) end
    where id = v_id;
  end if;$b$]]);
end $$;
drop function public._reescribir_e043(text, text[][]);

-- ---------- Copias: también de devoluciones y retiradas, y el canal grupo_whatsapp ----------
alter table public.copias_entrega alter column entrega_id drop not null;
alter table public.copias_entrega add column if not exists devolucion_id uuid references public.devoluciones(id);
alter table public.copias_entrega add column if not exists retirada_id uuid references public.retiradas(id);
alter table public.copias_entrega drop constraint if exists copias_entrega_canal_check;
alter table public.copias_entrega add constraint copias_entrega_canal_check check (canal in ('whatsapp', 'compartir', 'correo', 'grupo_whatsapp'));
alter table public.copias_entrega add constraint copias_entrega_un_justificante check (num_nonnulls(entrega_id, devolucion_id, retirada_id) = 1);

-- Copia de una devolución (DEV-) o de una entrega por un canal nuevo: con permiso de entregas
create or replace function public.registrar_copia_justificante(p_id uuid, p_tipo text, p_ref uuid, p_canal text, p_destino text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare u perfiles := perfil_actual();
begin
  if exists (select 1 from copias_entrega where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  if p_canal not in ('compartir', 'grupo_whatsapp') then raise exception 'Canal no válido: %', p_canal; end if;
  if p_tipo = 'entrega' then
    if not exists (select 1 from entregas where id = p_ref and estado = 'firmada') then raise exception 'Solo se envían copias de entregas firmadas'; end if;
    insert into copias_entrega (id, entrega_id, canal, destino, usuario, operario) values (p_id, p_ref, p_canal, coalesce(p_destino, ''), u.id, u.nombre);
  elsif p_tipo = 'devolucion' then
    if not exists (select 1 from devoluciones where id = p_ref and estado = 'firmada') then raise exception 'Solo se envían copias de devoluciones firmadas'; end if;
    insert into copias_entrega (id, devolucion_id, canal, destino, usuario, operario) values (p_id, p_ref, p_canal, coalesce(p_destino, ''), u.id, u.nombre);
  else raise exception 'Tipo de justificante no válido: %', p_tipo;
  end if;
  return jsonb_build_object('estado', 'aplicado');
end $$;
-- Copia de una retirada (RET-): con el permiso de las retiradas (movimientos)
create or replace function public.registrar_copia_retirada(p_id uuid, p_retirada uuid, p_canal text, p_destino text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare u perfiles := perfil_actual();
begin
  if exists (select 1 from copias_entrega where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  if p_canal not in ('compartir', 'grupo_whatsapp') then raise exception 'Canal no válido: %', p_canal; end if;
  if not exists (select 1 from retiradas where id = p_retirada and estado = 'firmada') then raise exception 'Solo se envían copias de retiradas firmadas'; end if;
  insert into copias_entrega (id, retirada_id, canal, destino, usuario, operario) values (p_id, p_retirada, p_canal, coalesce(p_destino, ''), u.id, u.nombre);
  return jsonb_build_object('estado', 'aplicado');
end $$;
insert into permisos_funcion (funcion, permiso) values ('registrar_copia_justificante', 'entregas.modificar'), ('registrar_copia_retirada', 'movimientos.modificar')
  on conflict (funcion) do update set permiso = excluded.permiso;
revoke all on function public.registrar_copia_justificante(uuid, text, uuid, text, text) from public, anon;
revoke all on function public.registrar_copia_retirada(uuid, uuid, text, text) from public, anon;
grant execute on function public.registrar_copia_justificante(uuid, text, uuid, text, text) to authenticated;
grant execute on function public.registrar_copia_retirada(uuid, uuid, text, text) to authenticated;
