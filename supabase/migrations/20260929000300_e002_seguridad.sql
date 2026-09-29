-- E-002 · Seguridad: RLS, permisos, historial inalterable y tiempo real.
-- La web y el repositorio son públicos y la clave "anon" va en la app: la seguridad depende de esto.

-- ---------- Historial inalterable (tampoco el administrador) ----------
create or replace function public._prohibir_cambios() returns trigger language plpgsql as $$
begin
  raise exception 'El historial no se puede modificar ni borrar: registra un ajuste con su motivo' using errcode = '42501';
end $$;

create trigger movimientos_inalterables before update or delete on public.movimientos for each row execute function public._prohibir_cambios();
create trigger movimientos_sin_truncate before truncate on public.movimientos execute function public._prohibir_cambios();
create trigger entrega_lineas_inalterables before update or delete on public.entrega_lineas for each row execute function public._prohibir_cambios();
create trigger entrega_lineas_sin_truncate before truncate on public.entrega_lineas execute function public._prohibir_cambios();
create trigger historial_inalterable before update or delete on public.dotacion_historial for each row execute function public._prohibir_cambios();
create trigger historial_sin_truncate before truncate on public.dotacion_historial execute function public._prohibir_cambios();
create trigger costes_incidencia_inalterables before update or delete on public.costes_incidencia for each row execute function public._prohibir_cambios();

-- Entregas: solo se permite rellenar la huella una vez, dentro de registrar_entrega
create or replace function public._entregas_inalterables() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.hash = '' and new.hash <> ''
     and (to_jsonb(new) - 'hash') = (to_jsonb(old) - 'hash') then
    return new;
  end if;
  raise exception 'Una entrega firmada no se puede modificar ni borrar: corrígela con una devolución' using errcode = '42501';
end $$;
create trigger entregas_inalterables before update or delete on public.entregas for each row execute function public._entregas_inalterables();
create trigger entregas_sin_truncate before truncate on public.entregas execute function public._prohibir_cambios();

-- Albaranes: solo se completa el resumen una vez, dentro de aprobar_albaran
create or replace function public._albaranes_inalterables() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.lineas = 0
     and (to_jsonb(new) - 'lineas' - 'unidades') = (to_jsonb(old) - 'lineas' - 'unidades') then
    return new;
  end if;
  raise exception 'Un albarán ingresado no se puede modificar ni borrar' using errcode = '42501';
end $$;
create trigger albaranes_inalterables before update or delete on public.albaranes for each row execute function public._albaranes_inalterables();

-- ---------- RLS: lectura para usuarios activos; importes solo para el administrador; nada de escritura directa ----------
alter table public.perfiles           enable row level security;
alter table public.propietarios       enable row level security;
alter table public.productos          enable row level security;
alter table public.costes_producto    enable row level security;
alter table public.series             enable row level security;
alter table public.equipos            enable row level security;
alter table public.tecnicos           enable row level security;
alter table public.movimientos        enable row level security;
alter table public.albaranes          enable row level security;
alter table public.entregas           enable row level security;
alter table public.entrega_lineas     enable row level security;
alter table public.dotacion           enable row level security;
alter table public.costes_dotacion    enable row level security;
alter table public.dotacion_historial enable row level security;
alter table public.costes_incidencia  enable row level security;
alter table public.pedidos_reposicion enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to authenticated;

create policy perfiles_lectura on public.perfiles for select to authenticated using (id = auth.uid() or public.es_admin());
create policy propietarios_lectura on public.propietarios for select to authenticated using (public.es_usuario_activo());
create policy productos_lectura on public.productos for select to authenticated using (public.es_usuario_activo());
create policy series_lectura on public.series for select to authenticated using (public.es_usuario_activo());
create policy equipos_lectura on public.equipos for select to authenticated using (public.es_usuario_activo());
create policy tecnicos_lectura on public.tecnicos for select to authenticated using (public.es_usuario_activo());
create policy movimientos_lectura on public.movimientos for select to authenticated using (public.es_usuario_activo());
create policy albaranes_lectura on public.albaranes for select to authenticated using (public.es_usuario_activo());
create policy entregas_lectura on public.entregas for select to authenticated using (public.es_usuario_activo());
create policy entrega_lineas_lectura on public.entrega_lineas for select to authenticated using (public.es_usuario_activo());
create policy dotacion_lectura on public.dotacion for select to authenticated using (public.es_usuario_activo());
create policy historial_lectura on public.dotacion_historial for select to authenticated using (public.es_usuario_activo());
create policy pedidos_lectura on public.pedidos_reposicion for select to authenticated using (public.es_usuario_activo());
create policy costes_producto_admin on public.costes_producto for select to authenticated using (public.es_admin());
create policy costes_dotacion_admin on public.costes_dotacion for select to authenticated using (public.es_admin());
create policy costes_incidencia_admin on public.costes_incidencia for select to authenticated using (public.es_admin());

-- ---------- Funciones: solo las públicas se pueden llamar, y solo con sesión ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.perfil_actual(), public.es_usuario_activo(), public.es_admin(),
  public.registrar_movimiento(uuid, text, text, numeric, text, text, text[], text, uuid),
  public.registrar_entrega(uuid, text, text, jsonb, text),
  public.verificar_entregas(),
  public.aprobar_albaran(uuid, jsonb, jsonb),
  public.guardar_producto(jsonb),
  public.marcar_pedido(text, numeric),
  public.guardar_equipo(jsonb), public.cambiar_estado_equipo(text, text), public.retirar_equipo(text, text),
  public.guardar_tecnico(jsonb), public.asignar_tecnico(text, text),
  public.alta_dotacion(jsonb), public.asignar_dotacion(uuid, text, text, text),
  public.registrar_incidencia(uuid, text, text, text, numeric, text, date)
to authenticated;

-- Las funciones y tablas que se creen en el futuro tampoco quedan abiertas por defecto
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    execute 'alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated';
    execute 'alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated';
  end if;
end $$;

-- ---------- Tiempo real (Supabase Realtime respeta RLS) ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.productos, public.series, public.movimientos, public.entregas, public.entrega_lineas, public.albaranes,
      public.equipos, public.tecnicos, public.dotacion, public.dotacion_historial, public.pedidos_reposicion,
      public.costes_producto, public.costes_dotacion, public.propietarios;
  end if;
end $$;
