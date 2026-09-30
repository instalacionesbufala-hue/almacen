import type { AlbaranIA, CatId, ConfigAvisos, Equipo, Producto, Propietario, Tecnico, TipoMov, Unidad, Vehiculo } from './tipos';

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
/** Formato de venta (E-013). En plural, ver unidadTxt() en domain/formato */
export const UNIT: Record<Unidad, string> = { m: 'm', ud: 'ud', bote: 'bote', sobre: 'sobre', bolsa: 'bolsa', pack: 'pack', caja: 'caja' };
export const UNIDADES: Unidad[] = ['ud', 'm', 'bote', 'sobre', 'bolsa', 'pack', 'caja'];

/* Motivos de movimiento */
export const REASONS: Record<TipoMov, string[]> = {
  entrada: ['Compra a proveedor', 'Recepción en custodia', 'Inventario de apertura'],
  salida:  ['Obra / instalación', 'Instalado en obra', 'Venta mostrador'],
  merma:   ['Rotura o daño', 'Defecto de fábrica', 'Corte sobrante', 'Pérdida o extravío'],
  ajuste:  ['Ajuste de inventario', 'Corrección de un error', 'Recuento de furgoneta'],
  // E-013: movimientos con vehículo
  traspaso:   ['Carga del vehículo', 'Entrega a equipo'],
  devolucion: ['Devolución de obra', 'Sobrante de furgoneta'],
  consumo:    ['Consumo en obra'],
};

/* Catálogo DE DEMOSTRACIÓN (decisión del usuario): las referencias reales se darán de alta con la cámara o a mano.
   Hay varios proveedores; el código de cada proveedor va en supplierRef. */
/* Catálogo. Ubicación = Pasillo-Estantería-Nivel. Precio = coste neto por unidad base (m o ud). */
export const SEED_PRODUCTS: Producto[] = [
  // Cables (códigos de albaranes Saltoki). E-013: sin precios, sin ubicación en estanterías y sin n.º de serie
  { sku: '6000650605', name: 'Cable H07Z1-K (AS) 6 mm² amarillo/verde flexible', cat: 'cables', unit: 'm', packLabel: 'rollo 100 m', stock: 420, min: 200, supplier: 'Saltoki Alcobendas' },
  { sku: '6000650604', name: 'Cable H07Z1-K (AS) 6 mm² azul flexible', cat: 'cables', unit: 'm', packLabel: 'rollo 100 m', stock: 180, min: 200, supplier: 'Saltoki Alcobendas' },
  { sku: '6000650601', name: 'Cable H07Z1-K (AS) 6 mm² negro flexible', cat: 'cables', unit: 'm', packLabel: 'rollo 100 m', stock: 350, min: 200, supplier: 'Saltoki Alcobendas' },
  { sku: '6040615306', name: 'Cable RZ1-K (AS) 3G6 mm² 0,6/1 kV bobina', cat: 'cables', unit: 'm', packLabel: 'bobina', stock: 265, min: 150, supplier: 'Saltoki Móstoles' },
  { sku: '6040615310', name: 'Cable RZ1-K (AS) 3G10 mm² 0,6/1 kV bobina', cat: 'cables', unit: 'm', packLabel: 'bobina', stock: 125, min: 100, supplier: 'Saltoki Móstoles' },
  { sku: '6040615316', name: 'Cable RZ1-K (AS) 3G16 mm² 0,6/1 kV bobina', cat: 'cables', unit: 'm', packLabel: 'bobina', stock: 305, min: 100, supplier: 'Saltoki Móstoles' },
  { sku: 'CAB-RZ1K-5G6', name: 'Manguera RZ1-K (AS) 5G6 mm² libre halógenos bobina 100 m', cat: 'cables', unit: 'm', packLabel: 'bobina 100 m', stock: 800, min: 200, supplier: 'Prysmian Cables Spain' },
  { sku: '7270020010', name: 'Cable Kommdata Cat6 U/UTP LSZH violeta caja 305 m', cat: 'cables', unit: 'm', packLabel: 'caja 305 m', stock: 915, min: 305, supplier: 'Saltoki Alcobendas' },
  // Tubos
  { sku: '6201020032', name: 'Tubo rígido enchufable M-32 gris', cat: 'tubos', unit: 'm', packLabel: 'tubo 3 m', stock: 240, min: 100, supplier: 'Saltoki Móstoles' },
  { sku: 'BF-TUB-CM20', name: 'Tubo corrugado forrado M-20 gris rollo 100 m', cat: 'tubos', unit: 'm', packLabel: 'rollo 100 m', stock: 600, min: 300, supplier: 'Saltoki Alcobendas' },
  { sku: 'UNX-CAN-60100', name: 'Canaleta aislante Unex 60×100 mm U23X tramo 2 m', cat: 'tubos', unit: 'm', packLabel: 'tramo 2 m', stock: 108, min: 40, supplier: 'Saltoki Móstoles' },
  // Fontanería
  { sku: 'BF-FON-MC16', name: 'Tubo multicapa PEX-AL-PEX 16×2 rollo 100 m', cat: 'fontaneria', unit: 'm', packLabel: 'rollo 100 m', stock: 260, min: 200, supplier: 'Saltoki Móstoles' },
  { sku: 'BF-FON-PX20', name: 'Tubo PEX-A 20×1,9 con barrera O₂ rollo 100 m', cat: 'fontaneria', unit: 'm', packLabel: 'rollo 100 m', stock: 400, min: 200, supplier: 'Saltoki Móstoles' },
  { sku: 'BF-FON-PR16', name: 'Racor prensar multicapa codo 90° 16 mm', cat: 'fontaneria', unit: 'ud', packLabel: 'bolsa 10 ud', stock: 64, min: 40, supplier: 'Saltoki Móstoles' },
  // Fijaciones y consumibles
  { sku: 'BF-FIX-SX8', ean: '4006209701234', name: 'Caja 100 tacos nylon SX 8×40', cat: 'fijaciones', unit: 'caja', contenido: 100, stock: 12, min: 2, supplier: 'Saltoki Alcobendas' },
  { sku: 'BF-FIX-SX6', ean: '4006209700985', name: 'Bote 1000 tacos nylon SX 6×30', cat: 'fijaciones', unit: 'bote', contenido: 1000, stock: 3, min: 2, supplier: 'Saltoki Alcobendas' },
  { sku: '5301012054', name: 'Caja 200 tornillos madera avellanado pozi 5×40', cat: 'fijaciones', unit: 'caja', contenido: 200, stock: 7, min: 3, supplier: 'Saltoki Alcobendas' },
  { sku: '6201025023', name: 'Manguito enchufable M-32 IP40 gris', cat: 'fijaciones', unit: 'ud', packLabel: 'bolsa 10 ud', stock: 85, min: 50, supplier: 'Saltoki Móstoles' },
  { sku: '5102012032', name: 'Clip cierre dientes gris 32-35 BTM', cat: 'fijaciones', unit: 'ud', packLabel: 'bolsa 50 ud', stock: 160, min: 100, supplier: 'Saltoki Móstoles' },
  { sku: '6611500005', name: 'Bolsa 100 bridas UNX 4,8×188 incoloras', cat: 'fijaciones', unit: 'bolsa', contenido: 100, stock: 14, min: 10, supplier: 'Saltoki Alcobendas' },
  { sku: '7280040020', name: 'Sobre 25 conectores RJ45 UTP Cat6 Kommdata', cat: 'fijaciones', unit: 'sobre', contenido: 25, stock: 3, min: 4, supplier: 'Saltoki Alcobendas' },
  // Aparamenta
  { sku: '7501013532', name: 'Magnetotérmico Hager 1P+N 32 A curva C 6 kA MN932V', cat: 'aparamenta', unit: 'ud', packLabel: 'unidad', stock: 6, min: 4, supplier: 'Saltoki Alcobendas' },
  { sku: 'SCH-IC60N-40', supplierRef: 'A9F74240', name: 'Magnetotérmico Schneider Acti9 iC60N 2P 40 A curva C', cat: 'aparamenta', unit: 'ud', packLabel: 'unidad', stock: 1, min: 12, supplier: 'Schneider Electric España' },
  { sku: '8909080510', name: 'Kit borna doble 16 mm² monofásico V.E. esquema 2', cat: 'aparamenta', unit: 'ud', packLabel: 'unidad', stock: 9, min: 5, supplier: 'Saltoki Alcobendas' },
  { sku: '7353541080', name: 'Caja registro FAM T-3203T tapa tornillo 200×131', cat: 'aparamenta', unit: 'ud', packLabel: 'unidad', stock: 22, min: 10, supplier: 'Saltoki Móstoles' },
  // Ropa de trabajo y EPIs en almacén, por modelo y talla (E-006): al entregar una prenda sale de aquí
  { sku: 'ROPA-PANT-42', name: 'Pantalón de trabajo multibolsillos · talla 42', cat: 'ropa', unit: 'ud', packLabel: 'Talla 42', stock: 4, min: 3, supplier: 'Vestuario Laboral Granada', modelo: 'Pantalón multibolsillos', talla: '42' },
  { sku: 'ROPA-PANT-44', name: 'Pantalón de trabajo multibolsillos · talla 44', cat: 'ropa', unit: 'ud', packLabel: 'Talla 44', stock: 2, min: 3, supplier: 'Vestuario Laboral Granada', modelo: 'Pantalón multibolsillos', talla: '44' },
  { sku: 'ROPA-POLO-M', name: 'Polo alta visibilidad · talla M', cat: 'ropa', unit: 'ud', packLabel: 'Talla M', stock: 6, min: 4, supplier: 'Vestuario Laboral Granada', modelo: 'Polo alta visibilidad', talla: 'M' },
  { sku: 'ROPA-POLO-L', name: 'Polo alta visibilidad · talla L', cat: 'ropa', unit: 'ud', packLabel: 'Talla L', stock: 5, min: 4, supplier: 'Vestuario Laboral Granada', modelo: 'Polo alta visibilidad', talla: 'L' },
  { sku: 'EPI-GUAN-9', name: 'Guantes dieléctricos clase 0 · talla 9', cat: 'epis', unit: 'ud', packLabel: 'Talla 9', stock: 3, min: 2, supplier: 'Suministros EPI Sur', modelo: 'Guantes dieléctricos clase 0', talla: '9' },
  { sku: 'EPI-GUAN-10', name: 'Guantes dieléctricos clase 0 · talla 10', cat: 'epis', unit: 'ud', packLabel: 'Talla 10', stock: 1, min: 2, supplier: 'Suministros EPI Sur', modelo: 'Guantes dieléctricos clase 0', talla: '10' },
  { sku: 'EPI-BOTA-42', name: 'Calzado de seguridad S3 · talla 42', cat: 'epis', unit: 'ud', packLabel: 'Talla 42', stock: 2, min: 1, supplier: 'Suministros EPI Sur', modelo: 'Calzado de seguridad S3', talla: '42' },
  // Cuadros de protecciones VE (en custodia de Esmove, sin precio y SIN n.º de serie: se controlan por modelo y cantidad;
  // supplierRef = código de la pegatina del modelo)
  { sku: 'ESM-CPVE-MONO', supplierRef: 'CP-VE-1F-40', name: 'Cuadro de protecciones VE monofásico 40 A (IGA + diferencial + protector sobretensiones)', cat: 'cuadros', unit: 'ud', packLabel: 'Monofásico · 40 A', stock: 3, min: 2, supplier: 'Esmove', propiedad: 'custodia', propietario: 'ESMOVE' },
  { sku: 'ESM-CPVE-TRI', supplierRef: 'CP-VE-3F-32', name: 'Cuadro de protecciones VE trifásico 32 A (IGA + diferencial + protector sobretensiones)', cat: 'cuadros', unit: 'ud', packLabel: 'Trifásico · 32 A', stock: 1, min: 2, supplier: 'Esmove', propiedad: 'custodia', propietario: 'ESMOVE' },
  // Cargadores VE (en custodia de Esmove): por modelo y cantidad, sin n.º de serie (E-013)
  { sku: 'BF-VE-POL74', supplierRef: 'POL-74-T2', name: 'Cargador Policharger 7,4 kW monofásico T2 cable 5 m', cat: 'cargadores', unit: 'ud', packLabel: '7,4 kW · Monofásico', stock: 2, min: 2, supplier: 'Policharger', propiedad: 'custodia', propietario: 'ESMOVE' },
  { sku: 'BF-VE-WBX74', supplierRef: 'PLP1-0-2-4', name: 'Cargador Wallbox Pulsar Plus 7,4 kW T2', cat: 'cargadores', unit: 'ud', packLabel: '7,4 kW · Monofásico', stock: 1, min: 2, supplier: 'Wallbox', propiedad: 'custodia', propietario: 'ESMOVE' },
  { sku: 'WBX-PULSAR-22', supplierRef: 'PLP2-0-2-3', name: 'Cargador Wallbox Pulsar Plus 22 kW T2 cable 5 m', cat: 'cargadores', unit: 'ud', packLabel: '22 kW · Trifásico', stock: 6, min: 2, supplier: 'Wallbox', propiedad: 'custodia', propietario: 'ESMOVE' },
  { sku: 'CIR-ENEXT-S', supplierRef: 'V20011', name: 'Cargador Circutor eNext S 7,4 kW con cable T2', cat: 'cargadores', unit: 'ud', packLabel: '7,4 kW · Monofásico', stock: 3, min: 2, supplier: 'Circutor S.A.', propiedad: 'custodia', propietario: 'ESMOVE' },
  { sku: 'BF-VE-VIA74', supplierRef: 'VIARIS-UNI-74', name: 'Cargador Orbis Viaris Uni 7,4 kW T2 con cable', cat: 'cargadores', unit: 'ud', packLabel: '7,4 kW · Monofásico', stock: 4, min: 2, supplier: 'Orbis', propiedad: 'custodia', propietario: 'ESMOVE' },
];

/* Técnicos (DNI enmascarado: solo se guardan los últimos dígitos) */
export const SEED_TECNICOS: Tecnico[] = [
  { id: 'T1', nombre: 'Luis Martín',   rol: 'Oficial 1ª (Líder)',        dni: '***4291-L', email: 'luis.martin@ejemplo.es', tallas: { camiseta: 'L', pantalon: '44', calzado: '42', guantes: '10' } },
  { id: 'T2', nombre: 'Jorge Ruiz',    rol: 'Técnico de apoyo',          dni: '***7730-K', tallas: { camiseta: 'M', pantalon: '42', calzado: '42', guantes: '9' } },
  { id: 'T3', nombre: 'Andrea Pardo',  rol: 'Instaladora especialista VE', dni: '***1188-P' },
  { id: 'T4', nombre: 'Sergio Molina', rol: 'Técnico electricista',      dni: '***5062-R' },
  { id: 'T5', nombre: 'Marta Gil',     rol: 'Oficial 1ª electricidad',   dni: '***9340-S' },
  { id: 'T6', nombre: 'Raúl Ortega',   rol: 'Instalador técnico',        dni: '***2817-B' },
];
export const OFICINA = 'Oficina';

/* E-006: configuración de avisos por defecto (app y push inmediatos; correo en resumen diario a las 8:00) */
export const CONFIG_AVISOS_DEFECTO: ConfigAvisos = { correoActivo: false, correoModo: 'resumen', correoHora: '08:00', correoRemitente: '', correoDestinatarios: [],
  pushActivo: true, pushModo: 'inmediato', pushHora: '08:00', telegramActivo: false, telegramModo: 'inmediato', telegramHora: '08:00', telegramChatId: '',
  diasRecordatorio: 7, custodiaEnvio: 'manual', informeCustodia: 'mensual', horasReserva: 48 };

/* E-008: depositantes de material en custodia */
export const SEED_PROPIETARIOS: Propietario[] = [{ id: 'ESMOVE', nombre: 'Esmove', contacto: '', correosReposicion: [], correosInformes: [] }];

/* Equipos / cuadrillas con su furgoneta */
/* E-013: equipos con el nombre que envía el wizard; los vehículos son una entidad aparte (datos inventados) */
export const SEED_EQUIPOS: Equipo[] = [
  { id: 'F01', nombre: 'Búfala 1', estado: 'ruta',  tecnicos: ['T1', 'T2'], vehiculo: 'V-F01' },
  { id: 'F02', nombre: 'Búfala 2', estado: 'depot', tecnicos: ['T3', 'T4'], vehiculo: 'V-F02' },
  { id: 'F03', nombre: 'Búfala 3', estado: 'ruta',  tecnicos: ['T5', 'T6'], vehiculo: 'V-F03' },
];
export const SEED_VEHICULOS: Vehiculo[] = [
  { id: 'V-F01', matricula: '0000-DEM', modelo: 'Furgoneta de ejemplo 1', equipo: 'F01' },
  { id: 'V-F02', matricula: '0000-DEN', modelo: 'Furgoneta de ejemplo 2', equipo: 'F02' },
  { id: 'V-F03', matricula: '0000-DEP', modelo: 'Furgoneta de ejemplo 3', equipo: 'F03' },
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
    { codigo: '7280040020', descripcion: 'KOMMDATA SOBRE 25 CONECTOR MACHO RJ45 UTP CAT 6 GOLD', cantidad: 2, confianza: .98, nota: 'En sobres de 25 ud' },
    { codigo: '6040615306724', descripcion: 'ML CABLE LHA RZ1-K(AS) 3G6MM 0,6/1KV (BOBINA)', cantidad: 40, confianza: .94 },
    { codigo: '9908000200', descripcion: 'BOLSA SALTOKI', cantidad: 1, confianza: .99, nota: 'Embalaje: normalmente no se ingresa' },
  ] },
  ve: { proveedor: 'Policharger', cif: 'B-98765432', numero: 'PC-26-0917', fecha: '22/09/2026', bultos: 10, lineas: [
    { codigo: 'POL-74-T2', descripcion: 'Cargador Policharger 7,4 kW monofásico T2 cable 5 m', cantidad: 10, confianza: .96 },
    { codigo: '', descripcion: 'Cable RZ1-K 3G6 mm² 0,6/1 kV bobina 500 m', cantidad: 500, confianza: .82 },
    { codigo: '', descripcion: 'Taco nylon SX 8x40 caja 100 (10 cajas)', cantidad: 10, confianza: .78, nota: 'En cajas de 100 ud' },
  ] },
  dist: { proveedor: 'Distribuciones Eléctricas S.L.', cif: 'B-82910492', numero: 'ALB-2026-8891', fecha: '29/09/2026', bultos: 4, lineas: [
    { codigo: 'PLP2-0-2-3', descripcion: 'Wallbox Pulsar Plus 22 kW cable 5 m blanco', cantidad: 2, confianza: .99 },
    { codigo: 'A9F74240', descripcion: 'Magnetotérmico Schneider iC60N 2P 40A curva C', cantidad: 25, confianza: .98 },
    { codigo: 'LOT-2026-CU09', descripcion: 'Manguera RZ1-K 5G6 mm² libre halógenos bobina 100 m', cantidad: 400, confianza: .91, nota: '4 bobinas × 100 m convertidas a metros' },
    { codigo: 'MEN-AMTRON-11', descripcion: 'Conector Mennekes AMTRON T2 11 kW con bloqueo inteligente', cantidad: 5, confianza: .88, nota: 'No figura en el catálogo' },
  ] },
};
