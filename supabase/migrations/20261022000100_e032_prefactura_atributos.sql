-- E-032 · La prefactura aprobada de Holded trae atributos (tipo de línea, fase, sección, cable de datos y, del calendario, equipo,
-- cargador, fecha y material especial). La precedencia se aplica al preparar la versión (módulo compartido _compartido/cierres.ts);
-- aquí, lo que tiene que cambiar en la base:
-- 1. Reglas "sin descuento": servicio (solo mano de obra) o material no gestionado en el almacén (la línea queda con su cantidad,
--    en estado no_gestionado: ni descuenta ni cuenta como pendiente ni "sin equivalencia").
-- 2. Mientras no haya llegado el cierre del wizard, la fecha del cierre es la que trae la versión (la del calendario), no la de la
--    aprobación; cuando llega el wizard, manda la suya.
-- 3. Una partida que una regla ya cubre sustituye su resolución manual (si no, se sumarían las dos: E2632263).
-- 4. En la base real: preinst → "material no gestionado" (decisión del usuario, 05/10) y el UTP según el cable de datos.

alter table public.equivalencias_cierre add column if not exists sin_descuento text check (sin_descuento in ('servicio', 'no_gestionado'));
alter table public.cierre_lineas drop constraint if exists cierre_lineas_estado_check;
alter table public.cierre_lineas add constraint cierre_lineas_estado_check
  check (estado in ('aplicada', 'discrepancia', 'sin_equivalencia', 'pendiente', 'resuelta', 'no_entregado', 'no_gestionado'));

-- Reescritura en el sitio (comprobando que cada texto aparece las veces esperadas)
create or replace function public._reescribir(p_fn text, p_cambios text[][]) returns void language plpgsql as $$
declare d text; i int; n int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = p_fn;
  if d is null then raise exception 'E-032: no existe %', p_fn; end if;
  for i in 1 .. array_length(p_cambios, 1) loop
    n := (length(d) - length(replace(d, p_cambios[i][1], ''))) / length(p_cambios[i][1]);
    if n <> 1 then raise exception 'E-032: en % el texto aparece % veces: %', p_fn, n, p_cambios[i][1]; end if;
    d := replace(d, p_cambios[i][1], p_cambios[i][2]);
  end loop;
  execute d;
end $$;

do $$
declare
  estado_a text := 'when (l->>''estado'') = ''pendiente'' then ''pendiente'' else ''sin_equivalencia'' end';
  estado_b text := 'when (l->>''estado'') = ''pendiente'' then ''pendiente'' when (l->>''estado'') = ''no_gestionado'' then ''no_gestionado'' else ''sin_equivalencia'' end';
  res_a text := 'select coalesce(array_agg(campo), ''{}'') into resueltos from cierre_lineas where cierre_id = ci.id and estado = ''resuelta'';';
  res_b text := 'delete from cierre_lineas where cierre_id = ci.id and estado = ''resuelta'' and campo in (select x->>''campo'' from jsonb_array_elements(coalesce(p_lineas, ''[]''::jsonb)) x '
             || 'where x->>''estado'' = ''aplicable'' and exists (select 1 from productos where sku = nullif(x->>''sku'', '''') and not borrador and not archivado)); '
             || 'select coalesce(array_agg(campo), ''{}'') into resueltos from cierre_lineas where cierre_id = ci.id and estado = ''resuelta'';';
begin
  perform _reescribir('_registrar_version_cierre', array[
    [estado_a, estado_b], [res_a, res_b],
    ['v_fecha := coalesce(ci.fecha_cierre, nullif(p->>''fechaCierreIso'', '''')::timestamptz, nullif(p->>''fechaIso'', '''')::timestamptz, now());',
     'v_fecha := case when existe and nullif(p->>''fechaCierreIso'', '''') is not null and not exists (select 1 from cierre_versiones where cierre_id = ci.id and origen in (''wizard'', ''historico'')) '
       || 'then (p->>''fechaCierreIso'')::timestamptz else coalesce(ci.fecha_cierre, nullif(p->>''fechaCierreIso'', '''')::timestamptz, nullif(p->>''fechaIso'', '''')::timestamptz, now()) end;'],
    ['update cierres set version = ci.version + 1, num_inst', 'update cierres set version = ci.version + 1, fecha_cierre = v_fecha, num_inst']]);
  perform _reescribir('recalcular_cierre_admin', array[[estado_a, estado_b], [res_a, res_b]]);
  perform _reescribir('guardar_equivalencia', array[
    ['kit, estimada, activa, orden, nota, confirmada)', 'kit, estimada, activa, orden, nota, confirmada, sin_descuento)'],
    ['coalesce((p->>''confirmada'')::boolean, true))', 'coalesce((p->>''confirmada'')::boolean, true), nullif(p->>''sin_descuento'', ''''))'],
    ['confirmada = excluded.confirmada, actualizado = now()', 'confirmada = excluded.confirmada, sin_descuento = excluded.sin_descuento, actualizado = now()']]);
end $$;
drop function public._reescribir(text, text[][]);

-- ---------- Base real (solo si ya tiene las reglas cargadas y confirmadas; una base nueva no se toca) ----------
do $$
declare o int;
begin
  if not exists (select 1 from public.equivalencias_cierre where confirmada) then return; end if;
  -- preinst: lleva material, pero aún no está en el almacén (decisión del usuario, 05/10)
  insert into public.equivalencias_historial (regla_id, version, operario)
    select id, to_jsonb(e), 'E-032 (decisión del usuario)' from public.equivalencias_cierre e where campo = 'preinst' and confirmada;
  update public.equivalencias_cierre set sin_descuento = 'no_gestionado', actualizado = now() where campo = 'preinst';
  if not exists (select 1 from public.equivalencias_cierre where campo = 'preinst') then
    insert into public.equivalencias_cierre (id, campo, formula, condiciones, articulos, estimada, activa, orden, nota, confirmada, sin_descuento)
    values ('E032-PREINST', 'preinst', 'directa', '{}', '[]', false, true, 500, 'Kit pre-instalación nuevo suministro: material aún no gestionado en el almacén (decisión del usuario, 05/10)', true, 'no_gestionado');
  end if;
  -- UTP según el cable de datos (antes que las reglas por el modelo del cargador)
  select coalesce(min(orden), 50) into o from public.equivalencias_cierre where campo = 'metrosUtp';
  insert into public.equivalencias_cierre (id, campo, formula, condiciones, articulos, estimada, activa, orden, nota, confirmada) values
    ('P-UTP-F', 'metrosUtp', 'directa', '{"cableDatos~": ["f/utp", "ftp"]}', '[{"sku": "7270021010", "factor": 1}]', false, true, o - 2, 'Cat6 F/UTP (lo dice el cable de datos)', true),
    ('P-UTP-U', 'metrosUtp', 'directa', '{"cableDatos~": "utp"}', '[{"sku": "7270020010", "factor": 1}]', false, true, o - 1, 'Cat6 U/UTP (lo dice el cable de datos)', true)
  on conflict (id) do nothing;
end $$;
