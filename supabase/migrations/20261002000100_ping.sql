-- Mantener activo el proyecto (el plan gratuito se pausa tras 7 días sin uso).
-- La tarea de copias llama a esta función sin sesión: no lee ni devuelve ningún dato, solo toca la base de datos.
create or replace function public.ping() returns boolean
language sql stable as $$ select true $$;
revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
