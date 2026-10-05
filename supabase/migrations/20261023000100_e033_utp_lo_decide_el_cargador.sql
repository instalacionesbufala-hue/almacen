-- E-033 · El cable de datos lo decide siempre el cargador (V2C/Trydan → U/UTP, Policharger → F/UTP). En Holded la tarifa dice
-- siempre "CABLE DATOS U/UTP CAT 6", así que las reglas por cableDatos de E-032 (P-UTP-F y P-UTP-U) pasan DETRÁS de las del
-- cargador: solo se usan si no hay un cargador reconocido. La prefactura ya no aporta cableDatos (módulo compartido).
-- Se guarda la versión anterior de cada regla en el historial.
do $$
declare o int;
begin
  if not exists (select 1 from public.equivalencias_cierre where id in ('P-UTP-F', 'P-UTP-U')) then return; end if;
  select coalesce(max(orden), 60) into o from public.equivalencias_cierre where campo = 'metrosUtp' and id not in ('P-UTP-F', 'P-UTP-U') and condiciones ? 'hardware~';
  insert into public.equivalencias_historial (regla_id, version, operario)
    select id, to_jsonb(e), 'E-033 (el cable de datos lo decide el cargador)' from public.equivalencias_cierre e where id in ('P-UTP-F', 'P-UTP-U');
  update public.equivalencias_cierre set orden = o + 5, nota = 'Cat6 F/UTP (sin cargador: lo dice el cable de datos)', actualizado = now() where id = 'P-UTP-F';
  update public.equivalencias_cierre set orden = o + 6, nota = 'Cat6 U/UTP (sin cargador: lo dice el cable de datos)', actualizado = now() where id = 'P-UTP-U';
end $$;
