import type { AlbaranIA, CatId, ConfigAvisos, Equipo, Producto, Propietario, Tecnico, TipoMov, Unidad } from './tipos';

/* =========================================================
   Almacén Búfala · datos de prueba y catálogos fijos
   Todo lo que hay aquí se copia al estado la primera vez
   (o al pulsar "Restaurar datos de prueba" en Configuración).
   ========================================================= */

export const MARCA = { nombre: 'Almacén Búfala', sub: 'Intelligent Warehouse', nave: 'Nave Central' };

/* Categorías: unidad base, icono (Material Symbols) y color para gráficos */
export const CATS: Record<CatId, { label: string; icon: string; color: string; tile: string }> = {
  cargadores: { label: 'Cargadores VE', icon: 'ev_charger',     color: '#0037b0', tile: 'bg-primary-fixed text-primary' },
  cuadros:    { label: 'Cuadros de protecciones', icon: 'electrical_services', color: '#7c3aed', tile: 'bg-violet-100 text-violet-800' },
  epis:       { label: 'EPIs (almacén)', icon: 'health_and_safety', color: '#b45309', tile: 'bg-orange-100 text-orange-800' },
  ropa:       { label: 'Ropa de trabajo', icon: 'apparel', color: '#475569', tile: 'bg-slate-200 text-slate-700' },
  cables:     { label: 'Cables',        icon: 'cable',          color: '#b45309', tile: 'bg-amber-100 text-amber-800' },
  tubos:      { label: 'Tubos',         icon: 'straighten',     color: '#565e74', tile: 'bg-secondary-container text-secondary' },
  fijaciones: { label: 'Fijaciones',    icon: 'hardware',       color: '#213145', tile: 'bg-surface-container-high text-on-surface' },
  aparamenta: { label: 'Aparamenta',    icon: 'electric_bolt',  color: '#006a48', tile: 'bg-tertiary-fixed/40 text-tertiary' },
  fontaneria: { label: 'Fontanería',    icon: 'plumbing',       color: '#0e7490', tile: 'bg-cyan-100 text-cyan-800' },
};
export const UNIT: Record<Unidad, string> = { m: 'm', ud: 'ud' };

/* Motivos de movimiento */
export const REASONS: Record<TipoMov, string[]> = {
  entrada: ['Compra a proveedor', 'Recepción en custodia', 'Devolución de obra'],
  salida:  ['Obra / instalación', 'Instalado en obra', 'Entrega a equipo', 'Traspaso a furgoneta', 'Venta mostrador'],
  merma:   ['Rotura o daño', 'Defecto de fábrica', 'Corte sobrante', 'Pérdida o extravío'],
  ajuste:  ['Ajuste de inventario', 'Corrección de un error', 'Alta de referencia'],
};

/* Catálogo DE DEMOSTRACIÓN (decisión del usuario): las referencias reales se darán de alta con la cámara o a mano.
   Hay varios proveedores; el código de cada proveedor va en supplierRef. */
/* Catálogo. Ubicación = Pasillo-Estantería-Nivel. Precio = coste neto por unidad base (m o ud). */
export const SEED_PRODUCTS: Producto[] = [
  // Cables (códigos y precios netos de albaranes Saltoki)
  { sku: '6000650605', name: 'Cable H07Z1-K (AS) 6 mm² amarillo/verde flexible', cat: 'cables', unit: 'm', pack: 100, packLabel: 'rollo 100 m', stock: 420, min: 200, loc: 'P01-E01-N1', supplier: 'Saltoki Alcobendas', price: 0.806 },
  { sku: '6000650604', name: 'Cable H07Z1-K (AS) 6 mm² azul flexible', cat: 'cables', unit: 'm', pack: 100, packLabel: 'rollo 100 m', stock: 180, min: 200, loc: 'P01-E01-N2', supplier: 'Saltoki Alcobendas', price: 0.806 },
  { sku: '6000650601', name: 'Cable H07Z1-K (AS) 6 mm² negro flexible', cat: 'cables', unit: 'm', pack: 100, packLabel: 'rollo 100 m', stock: 350, min: 200, loc: 'P01-E01-N3', supplier: 'Saltoki Alcobendas', price: 0.806 },
  { sku: '6040615306', name: 'Cable RZ1-K (AS) 3G6 mm² 0,6/1 kV bobina', cat: 'cables', unit: 'm', pack: 100, packLabel: 'bobina', stock: 265, min: 150, loc: 'P01-E02-N1', supplier: 'Saltoki Móstoles', price: 2.803 },
  { sku: '6040615310', name: 'Cable RZ1-K (AS) 3G10 mm² 0,6/1 kV bobina', cat: 'cables', unit: 'm', pack: 100, packLabel: 'bobina', stock: 125, min: 100, loc: 'P01-E02-N2', supplier: 'Saltoki Móstoles', price: 4.596 },
  { sku: '6040615316', name: 'Cable RZ1-K (AS) 3G16 mm² 0,6/1 kV bobina', cat: 'cables', unit: 'm', pack: 100, packLabel: 'bobina', stock: 305, min: 100, loc: 'P01-E03-N1', supplier: 'Saltoki Móstoles', price: 6.969 },
  { sku: 'CAB-RZ1K-5G6', name: 'Manguera RZ1-K (AS) 5G6 mm² libre halógenos bobina 100 m', cat: 'cables', unit: 'm', pack: 100, packLabel: 'bobina 100 m', stock: 800, min: 200, loc: 'P01-E03-N2', supplier: 'Prysmian Cables Spain', price: 5.42 },
  { sku: '7270020010', name: 'Cable Kommdata Cat6 U/UTP LSZH violeta caja 305 m', cat: 'cables', unit: 'm', pack: 305, packLabel: 'caja 305 m', stock: 915, min: 305, loc: 'P01-E04-N1', supplier: 'Saltoki Alcobendas', price: 0.338 },
  // Tubos
  { sku: '6201020032', name: 'Tubo rígido enchufable M-32 gris', cat: 'tubos', unit: 'm', pack: 3, packLabel: 'tubo 3 m', stock: 240, min: 100, loc: 'P02-E01-N1', supplier: 'Saltoki Móstoles', price: 2.21 },
  { sku: 'BF-TUB-CM20', name: 'Tubo corrugado forrado M-20 gris rollo 100 m', cat: 'tubos', unit: 'm', pack: 100, packLabel: 'rollo 100 m', stock: 600, min: 300, loc: 'P02-E02-N1', supplier: 'Saltoki Alcobendas', price: 0.32 },
  { sku: 'UNX-CAN-60100', name: 'Canaleta aislante Unex 60×100 mm U23X tramo 2 m', cat: 'tubos', unit: 'm', pack: 2, packLabel: 'tramo 2 m', stock: 108, min: 40, loc: 'P02-E03-N1', supplier: 'Saltoki Móstoles', price: 6.85 },
  // Fontanería
  { sku: 'BF-FON-MC16', name: 'Tubo multicapa PEX-AL-PEX 16×2 rollo 100 m', cat: 'fontaneria', unit: 'm', pack: 100, packLabel: 'rollo 100 m', stock: 260, min: 200, loc: 'P05-E01-N1', supplier: 'Saltoki Móstoles', price: 1.35 },
  { sku: 'BF-FON-PX20', name: 'Tubo PEX-A 20×1,9 con barrera O₂ rollo 100 m', cat: 'fontaneria', unit: 'm', pack: 100, packLabel: 'rollo 100 m', stock: 400, min: 200, loc: 'P05-E01-N2', supplier: 'Saltoki Móstoles', price: 0.98 },
  { sku: 'BF-FON-PR16', name: 'Racor prensar multicapa codo 90° 16 mm', cat: 'fontaneria', unit: 'ud', pack: 10, packLabel: 'bolsa 10 ud', stock: 64, min: 40, loc: 'P05-E02-N1', supplier: 'Saltoki Móstoles', price: 3.10 },
  // Fijaciones y consumibles
  { sku: 'BF-FIX-SX8', ean: '4006209701234', name: 'Taco nylon SX 8×40 (caja 100)', cat: 'fijaciones', unit: 'ud', pack: 100, packLabel: 'caja 100 ud', stock: 1200, min: 100, loc: 'P03-E01-N1', supplier: 'Saltoki Alcobendas', price: 0.052 },
  { sku: 'BF-FIX-SX6', ean: '4006209700985', name: 'Taco nylon SX 6×30 (caja 100)', cat: 'fijaciones', unit: 'ud', pack: 100, packLabel: 'caja 100 ud', stock: 80, min: 100, loc: 'P03-E01-N2', supplier: 'Saltoki Alcobendas', price: 0.034 },
  { sku: '5301012054', name: 'Tornillo madera avellanado pozi 5×40 bicromatado', cat: 'fijaciones', unit: 'ud', pack: 200, packLabel: 'caja 200 ud', stock: 1400, min: 500, loc: 'P03-E02-N1', supplier: 'Saltoki Alcobendas', price: 0.045 },
  { sku: '6201025023', name: 'Manguito enchufable M-32 IP40 gris', cat: 'fijaciones', unit: 'ud', pack: 10, packLabel: 'bolsa 10 ud', stock: 85, min: 50, loc: 'P02-E01-N2', supplier: 'Saltoki Móstoles', price: 0.76 },
  { sku: '5102012032', name: 'Clip cierre dientes gris 32-35 BTM', cat: 'fijaciones', unit: 'ud', pack: 50, packLabel: 'bolsa 50 ud', stock: 160, min: 100, loc: 'P03-E03-N1', supplier: 'Saltoki Móstoles', price: 0.39 },
  { sku: '6611500005', name: 'Bridas UNX 4,8×188 incoloras (bolsa 100)', cat: 'fijaciones', unit: 'ud', pack: 1, packLabel: 'bolsa', stock: 14, min: 10, loc: 'P03-E03-N2', supplier: 'Saltoki Alcobendas', price: 3.77 },
  { sku: '7280040020', name: 'Conector macho RJ45 UTP Cat6 Kommdata gold', cat: 'fijaciones', unit: 'ud', pack: 25, packLabel: 'bolsa 25 ud', stock: 75, min: 100, loc: 'P03-E04-N1', supplier: 'Saltoki Alcobendas', price: 0.62 },
  // Aparamenta
  { sku: '7501013532', name: 'Magnetotérmico Hager 1P+N 32 A curva C 6 kA MN932V', cat: 'aparamenta', unit: 'ud', pack: 1, packLabel: 'unidad', stock: 6, min: 4, loc: 'P04-E01-N1', supplier: 'Saltoki Alcobendas', price: 19.50 },
  { sku: 'SCH-IC60N-40', supplierRef: 'A9F74240', name: 'Magnetotérmico Schneider Acti9 iC60N 2P 40 A curva C', cat: 'aparamenta', unit: 'ud', pack: 1, packLabel: 'unidad', stock: 1, min: 12, loc: 'P04-E01-N3', supplier: 'Schneider Electric España', price: 38.90 },
  { sku: '8909080510', name: 'Kit borna doble 16 mm² monofásico V.E. esquema 2', cat: 'aparamenta', unit: 'ud', pack: 1, packLabel: 'unidad', stock: 9, min: 5, loc: 'P04-E01-N2', supplier: 'Saltoki Alcobendas', price: 7.90 },
  { sku: '7353541080', name: 'Caja registro FAM T-3203T tapa tornillo 200×131', cat: 'aparamenta', unit: 'ud', pack: 1, packLabel: 'unidad', stock: 22, min: 10, loc: 'P04-E02-N1', supplier: 'Saltoki Móstoles', price: 2.36 },
  // Ropa de trabajo y EPIs en almacén, por modelo y talla (E-006): al entregar una prenda sale de aquí
  { sku: 'ROPA-PANT-42', name: 'Pantalón de trabajo multibolsillos · talla 42', cat: 'ropa', unit: 'ud', pack: 1, packLabel: 'Talla 42', stock: 4, min: 3, loc: 'P07-E01-N1', supplier: 'Vestuario Laboral Granada', price: 32, modelo: 'Pantalón multibolsillos', talla: '42' },
  { sku: 'ROPA-PANT-44', name: 'Pantalón de trabajo multibolsillos · talla 44', cat: 'ropa', unit: 'ud', pack: 1, packLabel: 'Talla 44', stock: 2, min: 3, loc: 'P07-E01-N1', supplier: 'Vestuario Laboral Granada', price: 32, modelo: 'Pantalón multibolsillos', talla: '44' },
  { sku: 'ROPA-POLO-M', name: 'Polo alta visibilidad · talla M', cat: 'ropa', unit: 'ud', pack: 1, packLabel: 'Talla M', stock: 6, min: 4, loc: 'P07-E01-N2', supplier: 'Vestuario Laboral Granada', price: 18, modelo: 'Polo alta visibilidad', talla: 'M' },
  { sku: 'ROPA-POLO-L', name: 'Polo alta visibilidad · talla L', cat: 'ropa', unit: 'ud', pack: 1, packLabel: 'Talla L', stock: 5, min: 4, loc: 'P07-E01-N2', supplier: 'Vestuario Laboral Granada', price: 18, modelo: 'Polo alta visibilidad', talla: 'L' },
  { sku: 'EPI-GUAN-9', name: 'Guantes dieléctricos clase 0 · talla 9', cat: 'epis', unit: 'ud', pack: 1, packLabel: 'Talla 9', stock: 3, min: 2, loc: 'P07-E02-N1', supplier: 'Suministros EPI Sur', price: 64, modelo: 'Guantes dieléctricos clase 0', talla: '9' },
  { sku: 'EPI-GUAN-10', name: 'Guantes dieléctricos clase 0 · talla 10', cat: 'epis', unit: 'ud', pack: 1, packLabel: 'Talla 10', stock: 1, min: 2, loc: 'P07-E02-N1', supplier: 'Suministros EPI Sur', price: 64, modelo: 'Guantes dieléctricos clase 0', talla: '10' },
  { sku: 'EPI-BOTA-42', name: 'Calzado de seguridad S3 · talla 42', cat: 'epis', unit: 'ud', pack: 1, packLabel: 'Talla 42', stock: 2, min: 1, loc: 'P07-E02-N2', supplier: 'Suministros EPI Sur', price: 79, modelo: 'Calzado de seguridad S3', talla: '42' },
  // Cuadros de protecciones VE (en custodia de Esmove, sin precio y SIN n.º de serie: se controlan por modelo y cantidad;
  // supplierRef = código de la pegatina del modelo)
  { sku: 'ESM-CPVE-MONO', supplierRef: 'CP-VE-1F-40', name: 'Cuadro de protecciones VE monofásico 40 A (IGA + diferencial + protector sobretensiones)', cat: 'cuadros', unit: 'ud', pack: 1, packLabel: 'Monofásico · 40 A', stock: 3, min: 2, loc: 'P06-E04-N1', supplier: 'Esmove', price: 0, propiedad: 'custodia', propietario: 'ESMOVE' },
  { sku: 'ESM-CPVE-TRI', supplierRef: 'CP-VE-3F-32', name: 'Cuadro de protecciones VE trifásico 32 A (IGA + diferencial + protector sobretensiones)', cat: 'cuadros', unit: 'ud', pack: 1, packLabel: 'Trifásico · 32 A', stock: 1, min: 2, loc: 'P06-E04-N2', supplier: 'Esmove', price: 0, propiedad: 'custodia', propietario: 'ESMOVE' },
  // Cargadores VE (en custodia de Esmove, con número de serie, sin precio)
  { sku: 'BF-VE-POL74', supplierRef: 'POL-74-T2', name: 'Cargador Policharger 7,4 kW monofásico T2 cable 5 m', cat: 'cargadores', unit: 'ud', pack: 1, packLabel: '7,4 kW · Monofásico', stock: 2, min: 2, loc: 'P06-E01-N1', supplier: 'Policharger', price: 0, propiedad: 'custodia', propietario: 'ESMOVE', serialized: true, serials: ['PCH74-26-0412', 'PCH74-26-0419'] },
  { sku: 'BF-VE-WBX74', supplierRef: 'PLP1-0-2-4', name: 'Cargador Wallbox Pulsar Plus 7,4 kW T2', cat: 'cargadores', unit: 'ud', pack: 1, packLabel: '7,4 kW · Monofásico', stock: 1, min: 2, loc: 'P06-E01-N2', supplier: 'Wallbox', price: 0, propiedad: 'custodia', propietario: 'ESMOVE', serialized: true, serials: ['WBX-PP-883120'] },
  { sku: 'WBX-PULSAR-22', supplierRef: 'PLP2-0-2-3', name: 'Cargador Wallbox Pulsar Plus 22 kW T2 cable 5 m', cat: 'cargadores', unit: 'ud', pack: 1, packLabel: '22 kW · Trifásico', stock: 6, min: 2, loc: 'P06-E02-N1', supplier: 'Wallbox', price: 0, propiedad: 'custodia', propietario: 'ESMOVE', serialized: true, serials: ['WBX-22-899281', 'WBX-22-899282', 'WBX-22-899283', 'WBX-22-899284', 'WBX-22-899285', 'WBX-22-899286'] },
  { sku: 'CIR-ENEXT-S', supplierRef: 'V20011', name: 'Cargador Circutor eNext S 7,4 kW con cable T2', cat: 'cargadores', unit: 'ud', pack: 1, packLabel: '7,4 kW · Monofásico', stock: 3, min: 2, loc: 'P06-E02-N2', supplier: 'Circutor S.A.', price: 0, propiedad: 'custodia', propietario: 'ESMOVE', serialized: true, serials: ['CC-9914', 'CC-9915', 'CC-9921'] },
  { sku: 'BF-VE-VIA74', supplierRef: 'VIARIS-UNI-74', name: 'Cargador Orbis Viaris Uni 7,4 kW T2 con cable', cat: 'cargadores', unit: 'ud', pack: 1, packLabel: '7,4 kW · Monofásico', stock: 4, min: 2, loc: 'P06-E03-N1', supplier: 'Orbis', price: 0, propiedad: 'custodia', propietario: 'ESMOVE', serialized: true, serials: ['OB-VU-26A0107', 'OB-VU-26A0108', 'OB-VU-26A0111', 'OB-VU-26A0112'] },
];

/* Técnicos (DNI enmascarado: solo se guardan los últimos dígitos) */
export const SEED_TECNICOS: Tecnico[] = [
  { id: 'T1', nombre: 'Luis Martín',   rol: 'Oficial 1ª (Líder)',        dni: '***4291-L' },
  { id: 'T2', nombre: 'Jorge Ruiz',    rol: 'Técnico de apoyo',          dni: '***7730-K' },
  { id: 'T3', nombre: 'Andrea Pardo',  rol: 'Instaladora especialista VE', dni: '***1188-P' },
  { id: 'T4', nombre: 'Sergio Molina', rol: 'Técnico electricista',      dni: '***5062-R' },
  { id: 'T5', nombre: 'Marta Gil',     rol: 'Oficial 1ª electricidad',   dni: '***9340-S' },
  { id: 'T6', nombre: 'Raúl Ortega',   rol: 'Instalador técnico',        dni: '***2817-B' },
];
export const OFICINA = 'Oficina';

/* E-006: configuración de avisos por defecto (app y push inmediatos; correo en resumen diario a las 8:00) */
export const CONFIG_AVISOS_DEFECTO: ConfigAvisos = { correoActivo: false, correoModo: 'resumen', correoHora: '08:00', correoRemitente: '', correoDestinatarios: [],
  pushActivo: true, pushModo: 'inmediato', pushHora: '08:00', telegramActivo: false, telegramModo: 'inmediato', telegramHora: '08:00', telegramChatId: '',
  diasRecordatorio: 7, custodiaEnvio: 'manual', informeCustodia: 'mensual' };

/* E-008: depositantes de material en custodia */
export const SEED_PROPIETARIOS: Propietario[] = [{ id: 'ESMOVE', nombre: 'Esmove', contacto: '', correosReposicion: [], correosInformes: [] }];

/* Equipos / cuadrillas con su furgoneta */
export const SEED_EQUIPOS: Equipo[] = [
  { id: 'F01', nombre: 'Equipo Alfa',  flota: 'Furgoneta 01', matricula: '4821-LXB', estado: 'ruta',  tecnicos: ['T1', 'T2'] },
  { id: 'F02', nombre: 'Equipo Bravo', flota: 'Furgoneta 02', matricula: '9014-MKZ', estado: 'depot', tecnicos: ['T3', 'T4'] },
  { id: 'F03', nombre: 'Equipo Gamma', flota: 'Furgoneta 03', matricula: '3381-NZT', estado: 'ruta',  tecnicos: ['T5', 'T6'] },
];

/* Rúbricas de ejemplo (trazos SVG) para las entregas sembradas */
export const FIRMAS_DEMO = [
  'M8 38 C 18 8, 26 52, 38 26 S 56 8, 62 30 S 84 46, 96 22 L 118 30',
  'M6 30 C 20 18, 30 40, 44 28 C 56 18, 64 36, 78 26 S 104 20, 120 32',
  'M10 34 C 24 30, 30 14, 42 22 S 60 40, 74 24 S 98 16, 118 28',
];

/* Albaranes de ejemplo para probar la lectura IA sin tener uno a mano */
export const DEMOS: Record<string, AlbaranIA> = {
  saltoki: { proveedor: 'Saltoki Alcobendas', cif: 'B-31354547', numero: '2.824.560', fecha: '24/09/2026', bultos: 3, lineas: [
    { codigo: '8909080510', descripcion: 'PNX KIT BORNA DOBLE 16 MM2 MONOFASICO V.E. ESQUEMA 2', cantidad: 7, confianza: .97 },
    { codigo: '7280040020', descripcion: 'KOMMDATA CONECTOR MACHO RJ45 UTP CAT 6 GOLD', cantidad: 25, confianza: .98 },
    { codigo: '6040615306724', descripcion: 'ML CABLE LHA RZ1-K(AS) 3G6MM 0,6/1KV (BOBINA)', cantidad: 40, confianza: .94 },
    { codigo: '9908000200', descripcion: 'BOLSA SALTOKI', cantidad: 1, confianza: .99, nota: 'Embalaje: normalmente no se ingresa' },
  ] },
  ve: { proveedor: 'Policharger', cif: 'B-98765432', numero: 'PC-26-0917', fecha: '22/09/2026', bultos: 10, lineas: [
    { codigo: 'POL-74-T2', descripcion: 'Cargador Policharger 7,4 kW monofásico T2 cable 5 m', cantidad: 10, confianza: .96,
      series: Array.from({ length: 10 }, (_, i) => `PCH74-26-05${String(i + 1).padStart(2, '0')}`) },
    { codigo: '', descripcion: 'Cable RZ1-K 3G6 mm² 0,6/1 kV bobina 500 m', cantidad: 500, confianza: .82 },
    { codigo: '', descripcion: 'Taco nylon SX 8x40 caja 100 (10 cajas)', cantidad: 1000, confianza: .78, nota: '10 cajas × 100 ud convertidas a unidades' },
  ] },
  dist: { proveedor: 'Distribuciones Eléctricas S.L.', cif: 'B-82910492', numero: 'ALB-2026-8891', fecha: '29/09/2026', bultos: 4, lineas: [
    { codigo: 'PLP2-0-2-3', descripcion: 'Wallbox Pulsar Plus 22 kW cable 5 m blanco', cantidad: 2, confianza: .99, series: ['WBX-22-899301', 'WBX-22-899302'] },
    { codigo: 'A9F74240', descripcion: 'Magnetotérmico Schneider iC60N 2P 40A curva C', cantidad: 25, confianza: .98 },
    { codigo: 'LOT-2026-CU09', descripcion: 'Manguera RZ1-K 5G6 mm² libre halógenos bobina 100 m', cantidad: 400, confianza: .91, nota: '4 bobinas × 100 m convertidas a metros' },
    { codigo: 'MEN-AMTRON-11', descripcion: 'Conector Mennekes AMTRON T2 11 kW con bloqueo inteligente', cantidad: 5, confianza: .88, nota: 'No figura en el catálogo' },
  ] },
};
