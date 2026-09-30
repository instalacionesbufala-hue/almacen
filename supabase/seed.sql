-- Generado por scripts/generar-seed.ts · datos de DEMOSTRACIÓN inventados (E-013: sin precios ni n.º de serie; se borran con "Borrar datos de ejemplo")
begin;

insert into public.equipos (id, nombre, estado) values
('F01', 'Búfala 1', 'ruta'),
('F02', 'Búfala 2', 'depot'),
('F03', 'Búfala 3', 'ruta');

insert into public.vehiculos (id, matricula, modelo, equipo_id) values
('V-F01', '0000-DEM', 'Furgoneta de ejemplo 1', 'F01'),
('V-F02', '0000-DEN', 'Furgoneta de ejemplo 2', 'F02'),
('V-F03', '0000-DEP', 'Furgoneta de ejemplo 3', 'F03');

insert into public.asignaciones_vehiculo (vehiculo_id, equipo_id, desde) select id, equipo_id, now() - interval '90 days' from public.vehiculos where equipo_id is not null;
insert into public.tecnicos (id, nombre, rol, dni_mascara, equipo_id, email) values
('T1', 'Luis Martín', 'Oficial 1ª (Líder)', '***4291-L', 'F01', 'luis.martin@ejemplo.es'),
('T2', 'Jorge Ruiz', 'Técnico de apoyo', '***7730-K', 'F01', null),
('T3', 'Andrea Pardo', 'Instaladora especialista VE', '***1188-P', 'F02', null),
('T4', 'Sergio Molina', 'Técnico electricista', '***5062-R', 'F02', null),
('T5', 'Marta Gil', 'Oficial 1ª electricidad', '***9340-S', 'F03', null),
('T6', 'Raúl Ortega', 'Instalador técnico', '***2817-B', 'F03', null);

insert into public.asignaciones_tecnico (tecnico_id, equipo_id, desde) select id, equipo_id, now() - interval '90 days' from public.tecnicos where equipo_id is not null;
insert into public.productos (sku, ean, ref_proveedor, nombre, categoria, unidad, contenido, formato_texto, stock, minimo, proveedor, propiedad, propietario_id, modelo, talla) values
('6000650605', null, null, 'Cable H07Z1-K (AS) 6 mm² amarillo/verde flexible', 'cables', 'm', 1, 'rollo 100 m', 420, 200, 'Saltoki Alcobendas', 'propia', null, null, null),
('6000650604', null, null, 'Cable H07Z1-K (AS) 6 mm² azul flexible', 'cables', 'm', 1, 'rollo 100 m', 180, 200, 'Saltoki Alcobendas', 'propia', null, null, null),
('6000650601', null, null, 'Cable H07Z1-K (AS) 6 mm² negro flexible', 'cables', 'm', 1, 'rollo 100 m', 350, 200, 'Saltoki Alcobendas', 'propia', null, null, null),
('6040615306', null, null, 'Cable RZ1-K (AS) 3G6 mm² 0,6/1 kV bobina', 'cables', 'm', 1, 'bobina', 265, 150, 'Saltoki Móstoles', 'propia', null, null, null),
('6040615310', null, null, 'Cable RZ1-K (AS) 3G10 mm² 0,6/1 kV bobina', 'cables', 'm', 1, 'bobina', 125, 100, 'Saltoki Móstoles', 'propia', null, null, null),
('6040615316', null, null, 'Cable RZ1-K (AS) 3G16 mm² 0,6/1 kV bobina', 'cables', 'm', 1, 'bobina', 305, 100, 'Saltoki Móstoles', 'propia', null, null, null),
('CAB-RZ1K-5G6', null, null, 'Manguera RZ1-K (AS) 5G6 mm² libre halógenos bobina 100 m', 'cables', 'm', 1, 'bobina 100 m', 800, 200, 'Prysmian Cables Spain', 'propia', null, null, null),
('7270020010', null, null, 'Cable Kommdata Cat6 U/UTP LSZH violeta caja 305 m', 'cables', 'm', 1, 'caja 305 m', 915, 305, 'Saltoki Alcobendas', 'propia', null, null, null),
('6201020032', null, null, 'Tubo rígido enchufable M-32 gris', 'tubos', 'm', 1, 'tubo 3 m', 240, 100, 'Saltoki Móstoles', 'propia', null, null, null),
('BF-TUB-CM20', null, null, 'Tubo corrugado forrado M-20 gris rollo 100 m', 'tubos', 'm', 1, 'rollo 100 m', 600, 300, 'Saltoki Alcobendas', 'propia', null, null, null),
('UNX-CAN-60100', null, null, 'Canaleta aislante Unex 60×100 mm U23X tramo 2 m', 'tubos', 'm', 1, 'tramo 2 m', 108, 40, 'Saltoki Móstoles', 'propia', null, null, null),
('BF-FIX-SX8', '4006209701234', null, 'Caja 100 tacos nylon SX 8×40', 'fijaciones', 'caja', 100, '', 12, 2, 'Saltoki Alcobendas', 'propia', null, null, null),
('BF-FIX-SX6', '4006209700985', null, 'Bote 1000 tacos nylon SX 6×30', 'fijaciones', 'bote', 1000, '', 3, 2, 'Saltoki Alcobendas', 'propia', null, null, null),
('5301012054', null, null, 'Caja 200 tornillos madera avellanado pozi 5×40', 'fijaciones', 'caja', 200, '', 7, 3, 'Saltoki Alcobendas', 'propia', null, null, null),
('6201025023', null, null, 'Manguito enchufable M-32 IP40 gris', 'fijaciones', 'ud', 1, 'bolsa 10 ud', 85, 50, 'Saltoki Móstoles', 'propia', null, null, null),
('5102012032', null, null, 'Clip cierre dientes gris 32-35 BTM', 'fijaciones', 'ud', 1, 'bolsa 50 ud', 160, 100, 'Saltoki Móstoles', 'propia', null, null, null),
('6611500005', null, null, 'Bolsa 100 bridas UNX 4,8×188 incoloras', 'fijaciones', 'bolsa', 100, '', 14, 10, 'Saltoki Alcobendas', 'propia', null, null, null),
('7280040020', null, null, 'Sobre 25 conectores RJ45 UTP Cat6 Kommdata', 'fijaciones', 'sobre', 25, '', 3, 4, 'Saltoki Alcobendas', 'propia', null, null, null),
('7501013532', null, null, 'Magnetotérmico Hager 1P+N 32 A curva C 6 kA MN932V', 'aparamenta', 'ud', 1, 'unidad', 6, 4, 'Saltoki Alcobendas', 'propia', null, null, null),
('SCH-IC60N-40', null, 'A9F74240', 'Magnetotérmico Schneider Acti9 iC60N 2P 40 A curva C', 'aparamenta', 'ud', 1, 'unidad', 1, 12, 'Schneider Electric España', 'propia', null, null, null),
('8909080510', null, null, 'Kit borna doble 16 mm² monofásico V.E. esquema 2', 'aparamenta', 'ud', 1, 'unidad', 9, 5, 'Saltoki Alcobendas', 'propia', null, null, null),
('7353541080', null, null, 'Caja registro FAM T-3203T tapa tornillo 200×131', 'aparamenta', 'ud', 1, 'unidad', 22, 10, 'Saltoki Móstoles', 'propia', null, null, null),
('ROPA-PANT-42', null, null, 'Pantalón de trabajo multibolsillos · talla 42', 'ropa', 'ud', 1, 'Talla 42', 4, 3, 'Vestuario Laboral Granada', 'propia', null, 'Pantalón multibolsillos', '42'),
('ROPA-PANT-44', null, null, 'Pantalón de trabajo multibolsillos · talla 44', 'ropa', 'ud', 1, 'Talla 44', 2, 3, 'Vestuario Laboral Granada', 'propia', null, 'Pantalón multibolsillos', '44'),
('ROPA-POLO-M', null, null, 'Polo alta visibilidad · talla M', 'ropa', 'ud', 1, 'Talla M', 6, 4, 'Vestuario Laboral Granada', 'propia', null, 'Polo alta visibilidad', 'M'),
('ROPA-POLO-L', null, null, 'Polo alta visibilidad · talla L', 'ropa', 'ud', 1, 'Talla L', 5, 4, 'Vestuario Laboral Granada', 'propia', null, 'Polo alta visibilidad', 'L'),
('EPI-GUAN-9', null, null, 'Guantes dieléctricos clase 0 · talla 9', 'epis', 'ud', 1, 'Talla 9', 3, 2, 'Suministros EPI Sur', 'propia', null, 'Guantes dieléctricos clase 0', '9'),
('EPI-GUAN-10', null, null, 'Guantes dieléctricos clase 0 · talla 10', 'epis', 'ud', 1, 'Talla 10', 1, 2, 'Suministros EPI Sur', 'propia', null, 'Guantes dieléctricos clase 0', '10'),
('EPI-BOTA-42', null, null, 'Calzado de seguridad S3 · talla 42', 'epis', 'ud', 1, 'Talla 42', 2, 1, 'Suministros EPI Sur', 'propia', null, 'Calzado de seguridad S3', '42'),
('ESM-CPVE-MONO', null, 'CP-VE-1F-40', 'Cuadro de protecciones VE monofásico 40 A (IGA + diferencial + protector sobretensiones)', 'cuadros', 'ud', 1, 'Monofásico · 40 A', 3, 2, 'Esmove', 'custodia', 'ESMOVE', null, null),
('ESM-CPVE-TRI', null, 'CP-VE-3F-32', 'Cuadro de protecciones VE trifásico 32 A (IGA + diferencial + protector sobretensiones)', 'cuadros', 'ud', 1, 'Trifásico · 32 A', 1, 2, 'Esmove', 'custodia', 'ESMOVE', null, null),
('BF-VE-POL74', null, 'POL-74-T2', 'Cargador Policharger 7,4 kW monofásico T2 cable 5 m', 'cargadores', 'ud', 1, '7,4 kW · Monofásico', 2, 2, 'Policharger', 'custodia', 'ESMOVE', null, null),
('BF-VE-WBX74', null, 'PLP1-0-2-4', 'Cargador Wallbox Pulsar Plus 7,4 kW T2', 'cargadores', 'ud', 1, '7,4 kW · Monofásico', 1, 2, 'Wallbox', 'custodia', 'ESMOVE', null, null),
('WBX-PULSAR-22', null, 'PLP2-0-2-3', 'Cargador Wallbox Pulsar Plus 22 kW T2 cable 5 m', 'cargadores', 'ud', 1, '22 kW · Trifásico', 6, 2, 'Wallbox', 'custodia', 'ESMOVE', null, null),
('CIR-ENEXT-S', null, 'V20011', 'Cargador Circutor eNext S 7,4 kW con cable T2', 'cargadores', 'ud', 1, '7,4 kW · Monofásico', 3, 2, 'Circutor S.A.', 'custodia', 'ESMOVE', null, null),
('BF-VE-VIA74', null, 'VIARIS-UNI-74', 'Cargador Orbis Viaris Uni 7,4 kW T2 con cable', 'cargadores', 'ud', 1, '7,4 kW · Monofásico', 4, 2, 'Orbis', 'custodia', 'ESMOVE', null, null);

update public.config_app set modo_demo = true where id = 1;   -- datos de ejemplo: se pueden borrar una vez desde Configuración
insert into public.stock_vehiculo (vehiculo_id, sku, unidades) values
('V-F01', 'WBX-PULSAR-22', 2),
('V-F01', 'CAB-RZ1K-5G6', 150),
('V-F03', 'BF-VE-VIA74', 1),
('V-F03', 'BF-TUB-CM20', 80),
('V-F02', 'CIR-ENEXT-S', 2);

insert into public.dotacion (id, clase, nombre, marca, modelo, serie, talla, cantidad, caduca, estado, equipo_id, tecnico_id) values
('H001', 'herramienta', 'Comprobador de instalaciones VE (EVSE)', 'Metrel A1532', 'Metrel A1532', 'MT-1532-0091', null, 1, null, 'operativa', 'F01', null),
('H002', 'herramienta', 'Martillo perforador SDS-Plus', 'Hilti TE 30-A36', 'Hilti TE 30-A36', 'HI-TE30-5521', null, 1, null, 'operativa', 'F01', 'T1'),
('H003', 'herramienta', 'Pinza amperimétrica', 'Fluke 376 FC', 'Fluke 376 FC', 'FL-376-22817', null, 1, null, 'operativa', 'F02', 'T3'),
('H004', 'herramienta', 'Telurómetro', 'Chauvin Arnoux C.A 6417', 'Chauvin Arnoux C.A 6417', 'CA-6417-1044', null, 1, null, 'deteriorada', 'F02', null),
('H005', 'herramienta', 'Crimpadora hidráulica 16–240 mm²', 'Klauke EK 60 VP', 'Klauke EK 60 VP', 'KL-EK60-7730', null, 1, null, 'operativa', 'F03', 'T5'),
('H006', 'herramienta', 'Taladro atornillador', 'Makita DDF484', 'Makita DDF484', 'MK-484-99102', null, 1, null, 'rota', 'F03', 'T6'),
('E001', 'epi', 'Guantes dieléctricos clase 0 (1000 V)', 'Catu CG-05', null, 'LOTE-2025-118', '9', 1, '2026-10-20', 'operativa', 'F01', 'T1'),
('E002', 'epi', 'Casco con pantalla facial arco eléctrico', 'Petzl Vertex + Catu', null, 'PZ-VX-44102', null, 1, '2027-11-04', 'operativa', 'F01', 'T2'),
('E003', 'epi', 'Arnés anticaídas', 'Irudek 5000', null, 'IR-5000-2291', null, 1, '2026-09-18', 'operativa', 'F02', 'T4'),
('E004', 'epi', 'Calzado de seguridad S3', 'Bellota 72212', null, 'LOTE-B-7741', '38', 1, '2027-04-28', 'operativa', 'F03', 'T5'),
('R001', 'ropa', 'Pantalón de trabajo multibolsillos', 'Búfala (logo bordado)', null, '', '44', 2, null, 'operativa', 'F01', 'T1'),
('R002', 'ropa', 'Polo manga corta alta visibilidad', 'Búfala (logo bordado)', null, '', 'M', 3, null, 'operativa', 'F02', 'T3'),
('R003', 'ropa', 'Chaqueta softshell ignífuga', 'Búfala (logo bordado)', null, '', 'L', 1, null, 'deteriorada', 'F03', 'T6');

insert into public.dotacion_historial (id, dotacion_id, tipo, nota, operario) select gen_random_uuid(), id, 'alta', 'Alta inicial (datos de demostración)', 'Sistema' from public.dotacion;
insert into public.minimos_herramienta (modelo, minimo, proveedor) values ('Makita DDF484', 1, 'Saltoki Alcobendas');

commit;
