-- E-044 · Medidor bidireccional en las instalaciones "SOLAR". La descripción de la instalación (descInstalacion, del enlace del
-- wizard en el calendario) llega en el cierre, en los atributos de la prefactura o, para un cierre que ya existe, con
-- { origen: 'calendario', numInst, atributos } (versión nueva solo con esos datos; se aplica la diferencia). La función
-- registrar-cierre traduce; aquí: el origen "calendario" en las versiones y las reglas de los medidores (1 ud por instalación).

alter table public.cierre_versiones drop constraint if exists cierre_versiones_origen_check;
alter table public.cierre_versiones add constraint cierre_versiones_origen_check check (origen in ('wizard', 'historico', 'holded', 'admin', 'calendario'));

-- Reglas de los medidores (artículos en custodia de Esmove): monofásico V2C con pinza y trifásico CHINT V2C. La fase del cierre
-- manda; si no viene, la de la descripción; sin fase, "sin equivalencia" para elegirlo a mano. Solo donde ya hay reglas confirmadas.
do $$
begin
  if not exists (select 1 from public.equivalencias_cierre where confirmada) then return; end if;
  insert into public.equivalencias_cierre (id, campo, formula, condiciones, articulos, estimada, activa, orden, nota, confirmada) values
    ('S1', 'descInstalacion', 'unidad', '{"descInstalacion~": "solar", "fase": "mono"}', '[{"sku": "8900500101", "factor": 1}]', false, true, 1200, 'Instalación SOLAR: medidor bidireccional monofásico', true),
    ('S2', 'descInstalacion', 'unidad', '{"descInstalacion~": "solar", "fase": "trif"}', '[{"sku": "WIH24YJX185551", "factor": 1}]', false, true, 1201, 'Instalación SOLAR: medidor bidireccional trifásico', true),
    ('S3', 'descInstalacion', 'unidad', '{"descInstalacion~": "solar&monofas"}', '[{"sku": "8900500101", "factor": 1}]', false, true, 1202, 'Instalación SOLAR (monofásica según la descripción): medidor bidireccional monofásico', true),
    ('S4', 'descInstalacion', 'unidad', '{"descInstalacion~": "solar&trifas"}', '[{"sku": "WIH24YJX185551", "factor": 1}]', false, true, 1203, 'Instalación SOLAR (trifásica según la descripción): medidor bidireccional trifásico', true),
    ('S5', 'descInstalacion', 'unidad', '{"descInstalacion~": "solar"}', '[]', false, true, 1204, 'Instalación SOLAR sin fase: elige el medidor bidireccional', true)
  on conflict (id) do nothing;
end $$;
