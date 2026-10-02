-- =====================================================================================================
-- E-024 · Socios de custodia (Esmove, Instant Box y los que vengan)
-- - Color de la etiqueta de cada socio.
-- - Alta de Instant Box si no existe.
-- - guardar_propietario: valida nombre y correos, no repite nombres, y desactiva solo si el socio no tiene artículos.
-- - No se puede poner material en custodia de un socio desactivado.
-- =====================================================================================================
alter table public.propietarios add column if not exists color text not null default 'violeta';

insert into public.propietarios (id, nombre, color)
select 'INSTANTBOX', 'Instant Box', 'naranja'
where not exists (select 1 from public.propietarios where id = 'INSTANTBOX' or lower(nombre) = 'instant box');

create or replace function public.guardar_propietario(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u perfiles := exigir_admin();
  v_id text := upper(trim(coalesce(p->>'id', '')));
  v_nombre text := trim(coalesce(p->>'nombre', ''));
  v_activo boolean := coalesce((p->>'activo')::boolean, true);
  v_repo text[] := coalesce(array(select trim(x) from jsonb_array_elements_text(coalesce(p->'correos_reposicion', '[]')) x where trim(x) <> ''), '{}');
  v_inf text[] := coalesce(array(select trim(x) from jsonb_array_elements_text(coalesce(p->'correos_informes', '[]')) x where trim(x) <> ''), '{}');
  v_color text := coalesce(nullif(p->>'color', ''), 'violeta');
  n int; malo text; nuevo boolean;
begin
  if v_id = '' then raise exception 'Falta el identificador del socio'; end if;
  if v_nombre = '' then raise exception 'Pon el nombre del socio'; end if;
  if exists (select 1 from propietarios where id <> v_id and lower(nombre) = lower(v_nombre)) then
    raise exception 'Ya hay un socio llamado %', v_nombre;
  end if;
  select x into malo from unnest(v_repo || v_inf) x where x !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' limit 1;
  if malo is not null then raise exception 'Correo no válido: %', malo; end if;
  if not v_activo then
    select count(*) into n from productos where propiedad = 'custodia' and propietario_id = v_id and not archivado;
    if n > 0 then
      raise exception 'Tiene % artículo% en custodia. Pásalos a otro socio o a material propio antes de desactivarlo.', n, case when n = 1 then '' else 's' end;
    end if;
  end if;
  nuevo := not exists (select 1 from propietarios where id = v_id);
  insert into propietarios (id, nombre, contacto, correos_reposicion, correos_informes, activo, color)
  values (v_id, v_nombre, coalesce(p->>'contacto', ''), v_repo, v_inf, v_activo, v_color)
  on conflict (id) do update set nombre = excluded.nombre, contacto = excluded.contacto, correos_reposicion = excluded.correos_reposicion,
    correos_informes = excluded.correos_informes, activo = excluded.activo, color = excluded.color;
  insert into auditoria (usuario, operario, accion, detalle) values (u.id, u.nombre, case when nuevo then 'alta_socio' else 'editar_socio' end,
    jsonb_build_object('id', v_id, 'nombre', v_nombre, 'activo', v_activo));
  return jsonb_build_object('estado', 'aplicado', 'id', v_id);
end $$;

-- Material en custodia solo de socios activos (al darlo de alta o cambiarlo de socio)
create or replace function public._socio_activo() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.propiedad = 'custodia' and new.propietario_id is not null
     and (tg_op = 'INSERT' or new.propietario_id is distinct from old.propietario_id or old.propiedad is distinct from 'custodia')
     and exists (select 1 from propietarios where id = new.propietario_id and not activo) then
    raise exception 'El socio % está desactivado: actívalo en Configuración → Socios de custodia o elige otro', (select nombre from propietarios where id = new.propietario_id);
  end if;
  return new;
end $$;
drop trigger if exists productos_socio_activo on public.productos;
create trigger productos_socio_activo before insert or update of propiedad, propietario_id on public.productos
  for each row execute function public._socio_activo();

-- Origen de la foto: además de Saltoki, fabricante y propia, cualquier socio (por su id; "Esmove" queda como valor antiguo válido)
alter table public.productos drop constraint if exists productos_foto_origen_check;
create or replace function public.poner_foto(p_sku text, p_foto text, p_mini text, p_origen text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u perfiles := perfil_actual(); n int;
begin
  if not exists (select 1 from productos where sku = upper(p_sku)) then raise exception 'Producto no encontrado'; end if;
  if p_origen is null or (p_origen not in ('Saltoki', 'Esmove', 'fabricante', 'propia') and not exists (select 1 from propietarios where id = p_origen)) then
    raise exception 'Origen de la foto no válido';
  end if;
  if _sku_de_ruta(p_foto) is distinct from upper(p_sku) or _sku_de_ruta(p_mini) is distinct from upper(p_sku) then raise exception 'Ruta de la foto no válida'; end if;
  -- reenviar la misma foto (reintento de la cola) no es sustituir
  if u.rol <> 'admin' and exists (select 1 from productos where sku in (select _grupo_foto(p_sku)) and foto is not null and foto <> p_foto) then
    raise exception 'Este artículo ya tiene foto: solo el administrador puede sustituirla' using errcode = '42501';
  end if;
  update productos set foto = p_foto, foto_mini = p_mini, foto_origen = p_origen, actualizado = now() where sku in (select _grupo_foto(p_sku));
  get diagnostics n = row_count;
  return jsonb_build_object('estado', 'aplicado', 'articulos', n);
end $$;
