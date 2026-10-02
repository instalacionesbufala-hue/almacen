-- =====================================================================================================
-- E-024 · Las páginas escaneadas de cada albarán se guardan con él
-- - albaranes.paginas: nombres de sus páginas ("1.jpg", "2.jpg"… o "1.pdf"), fijados al aprobarlo (el albarán no cambia después).
-- - Bucket PRIVADO "albaranes-paginas", ruta <id del albarán>/<nombre>. Solo se lee con sesión (URL firmadas).
--   Se puede subir una página solo si el albarán existe, la declara y es reciente; sustituir o borrar, solo el administrador.
-- =====================================================================================================
alter table public.albaranes add column if not exists paginas text[] not null default '{}';

create or replace function public.aprobar_albaran(p_id uuid, p_cabecera jsonb, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p perfiles := perfil_actual(); l jsonb; n int := 0; u numeric := 0;
  v_paginas text[] := coalesce((select array_agg(x order by o) from jsonb_array_elements_text(coalesce(p_cabecera->'paginas', '[]')) with ordinality t(x, o)
                                 where x ~ '^[0-9]{1,2}\.(jpg|pdf)$'), '{}');
begin
  if exists (select 1 from albaranes where id = p_id) then return jsonb_build_object('estado', 'duplicado'); end if;
  if coalesce(array_length(v_paginas, 1), 0) > 30 then raise exception 'Demasiadas páginas en un albarán (máximo 30)'; end if;
  insert into albaranes (id, numero, proveedor, delegacion, cif, fecha, confianza, modo, usuario, operario, codigos, paginas)
  values (p_id, coalesce(p_cabecera->>'numero', ''), coalesce(p_cabecera->>'proveedor', ''), coalesce(p_cabecera->>'delegacion', ''), coalesce(p_cabecera->>'cif', ''),
          coalesce(p_cabecera->>'fecha', ''), nullif(p_cabecera->>'confianza', '')::numeric, coalesce(p_cabecera->>'modo', 'sim'), p.id, p.nombre,
          coalesce((select array_agg(distinct c) from (select upper(regexp_replace(coalesce(x->>'codigo', ''), '\s', '', 'g')) c from jsonb_array_elements(p_lineas) x) q where c <> ''), '{}'),
          v_paginas);
  for l in select * from jsonb_array_elements(p_lineas) loop
    perform _aplicar_movimiento(p, gen_random_uuid(), upper(l->>'sku'), 'entrada', (l->>'cantidad')::numeric, 'Compra a proveedor',
                                'Albarán ' || coalesce(p_cabecera->>'numero', ''), '{}', null, null, p_id, null);
    n := n + 1; u := u + (l->>'cantidad')::numeric;
  end loop;
  update albaranes set lineas = n, unidades = u where id = p_id;
  return jsonb_build_object('estado', 'aplicado', 'lineas', n);
end $$;

-- ¿Se puede subir esta página? El albarán existe, la declara entre sus páginas y es de los últimos 30 días
create or replace function public.puede_subir_pagina(p_ruta text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.es_usuario_activo()
     and p_ruta ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{1,2}\.(jpg|pdf)$'
     and exists (select 1 from albaranes a where a.id::text = split_part(p_ruta, '/', 1)
                   and split_part(p_ruta, '/', 2) = any(a.paginas) and a.ts > now() - interval '30 days')
$$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('albaranes-paginas', 'albaranes-paginas', false, 10485760, array['image/jpeg', 'application/pdf'])
    on conflict (id) do update set public = false;
    execute $p$drop policy if exists albaranes_paginas_leer on storage.objects$p$;
    execute $p$drop policy if exists albaranes_paginas_subir on storage.objects$p$;
    execute $p$drop policy if exists albaranes_paginas_sustituir on storage.objects$p$;
    execute $p$drop policy if exists albaranes_paginas_borrar on storage.objects$p$;
    execute $p$create policy albaranes_paginas_leer on storage.objects for select to authenticated using (bucket_id = 'albaranes-paginas' and public.es_usuario_activo())$p$;
    execute $p$create policy albaranes_paginas_subir on storage.objects for insert to authenticated with check (bucket_id = 'albaranes-paginas' and public.puede_subir_pagina(name))$p$;
    execute $p$create policy albaranes_paginas_sustituir on storage.objects for update to authenticated using (bucket_id = 'albaranes-paginas' and public.es_admin())$p$;
    execute $p$create policy albaranes_paginas_borrar on storage.objects for delete to authenticated using (bucket_id = 'albaranes-paginas' and public.es_admin())$p$;
  end if;
end $$;

revoke execute on function public.puede_subir_pagina(text) from public, anon;
grant execute on function public.puede_subir_pagina(text) to authenticated;
