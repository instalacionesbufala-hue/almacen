-- E-042 · Recalcular todos los cierres desde una fecha (la app calcula la traducción con el PVC deducido de los metros de línea y
-- envía cada cierre que cambia a recalcular_cierre_admin). Cada cierre recalculado queda además en la auditoría, con su diferencia.
-- El PVC deducido no necesita nada en la base de datos: lo calcula el módulo compartido de cierres (función registrar-cierre y app).

create or replace function public._reescribir_e042(p_fn text, p_cambios text[][]) returns void language plpgsql as $$
declare d text; i int; n int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = p_fn;
  if d is null then raise exception 'E-042: no existe %', p_fn; end if;
  for i in 1 .. array_length(p_cambios, 1) loop
    n := (length(d) - length(replace(d, p_cambios[i][1], ''))) / length(p_cambios[i][1]);
    if n <> 1 then raise exception 'E-042: en % el texto aparece % veces: %', p_fn, n, p_cambios[i][1]; end if;
    d := replace(d, p_cambios[i][1], p_cambios[i][2]);
  end loop;
  execute d;
end $$;
do $$
begin
  perform _reescribir_e042('recalcular_cierre_admin', array[[
    $a$'admin', 'Recalculado por ' || u.nombre, '{}', dif);$a$,
    $b$'admin', 'Recalculado por ' || u.nombre, '{}', dif);
    insert into auditoria (usuario, operario, accion, detalle)
    values (u.id, u.nombre, 'recalcular_cierre', jsonb_build_object('cierre', ci.id, 'num_inst', ci.num_inst, 'version', ci.version, 'diferencia', dif));$b$]]);
end $$;
drop function public._reescribir_e042(text, text[][]);
