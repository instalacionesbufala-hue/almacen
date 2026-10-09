-- E-045 · El medidor bidireccional (la pinza) solo se instala siempre con cargadores V2C (Trydan). Con Policharger u otro cargador,
-- en una instalación SOLAR no siempre: el cierre queda "por revisar" ("¿se instaló medidor bidireccional?") hasta que el
-- administrador lo añade (Sí: línea fijada a mano con corregir_cierre, E-035) o dice que no (revisar_medidor_solar).

-- ---------- Reglas S1-S5: solo con cargador V2C o Trydan (la versión anterior queda en el historial) ----------
insert into public.equivalencias_historial (regla_id, version, operario)
select id, to_jsonb(e), 'E-045 (migración)' from public.equivalencias_cierre e where id in ('S1', 'S2', 'S3', 'S4', 'S5') and confirmada;
update public.equivalencias_cierre set condiciones = condiciones || '{"hardware~": ["v2c", "trydan"]}'::jsonb,
  nota = case id when 'S5' then 'Instalación SOLAR con V2C, sin fase: elige el medidor bidireccional' else nota || ' (con cargador V2C)' end
where id in ('S1', 'S2', 'S3', 'S4', 'S5') and not condiciones ? 'hardware~';

-- ---------- "No se instaló medidor": revisado ----------
alter table public.cierres add column if not exists medidor_revisado boolean not null default false;

create or replace function public.revisar_medidor_solar(p_cierre uuid, p_nota text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := exigir_admin();
begin
  update cierres set medidor_revisado = true where id = p_cierre;
  if not found then raise exception 'Cierre no encontrado'; end if;
  insert into auditoria (usuario, operario, accion, detalle) values (u.id, u.nombre, 'revisar_medidor_solar', jsonb_build_object('cierre', p_cierre, 'nota', coalesce(p_nota, '')));
  return jsonb_build_object('estado', 'aplicado');
end $$;
insert into public.permisos_funcion (funcion, permiso) values ('revisar_medidor_solar', 'cierres.modificar') on conflict (funcion) do update set permiso = excluded.permiso;
revoke execute on function public.revisar_medidor_solar(uuid, text) from public, anon;
grant execute on function public.revisar_medidor_solar(uuid, text) to authenticated;
