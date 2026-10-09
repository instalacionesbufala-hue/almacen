-- E-046 · El técnico confirma en el wizard (v1.4.0, instalaciones SOLAR) si se instaló medidor bidireccional:
-- medidorBidireccional = 'mono' | 'trif' | 'no' (vacío si no es SOLAR o la visita es fallida). Lo traduce registrar-cierre.
-- Reglas en el mismo grupo que S1-S5 (campo descInstalacion, fórmula "1 ud") y antes por orden: si el técnico lo dice, manda,
-- sea cual sea el cargador; "no" no descuenta ni deja aviso. Si no lo dice, siguen S1-S5 (E-045). Lo corregido a mano (E-035),
-- por encima de todo. Editables en Equivalencias como las demás.
do $$
begin
  if not exists (select 1 from public.equivalencias_cierre where confirmada) then return; end if;
  insert into public.equivalencias_cierre (id, campo, formula, condiciones, articulos, estimada, activa, orden, nota, confirmada, sin_descuento) values
    ('M1', 'descInstalacion', 'unidad', '{"medidorBidireccional": "mono"}', '[{"sku": "8900500101", "factor": 1}]', false, true, 1190, 'Medidor bidireccional monofásico (confirmado por el técnico)', true, null),
    ('M2', 'descInstalacion', 'unidad', '{"medidorBidireccional": "trif"}', '[{"sku": "WIH24YJX185551", "factor": 1}]', false, true, 1191, 'Medidor bidireccional trifásico (confirmado por el técnico)', true, null),
    ('M0', 'descInstalacion', 'unidad', '{"medidorBidireccional": "no"}', '[]', false, true, 1192, 'Sin medidor bidireccional (lo dice el técnico)', true, 'servicio')
  on conflict (id) do nothing;
end $$;
