/* Estado inicial de demostración (movimientos, entregas y albaranes de ejemplo) */
import type { Albaran, Entrega, Estado, Herramienta, Movimiento, TipoMov } from './tipos';
import { SEED_PLANTILLAS, CONFIG_AVISOS_DEFECTO, FIRMAS_DEMO, OFICINA, SEED_EQUIPOS, SEED_PRODUCTS, SEED_PROPIETARIOS, SEED_TECNICOS } from './catalogo';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

export function seedTs(days: number, h: number, m: number): number {
  const x = new Date(); x.setDate(x.getDate() - days); x.setHours(h, m, 0, 0); return x.getTime();
}

export function seedMovements(): Movimiento[] {
  let i = 0;
  const M = (ts: number, sku: string, type: TipoMov, qty: number, reason: string, ref: string, operator: string, serials: string[] = [], equipo?: string): Movimiento =>
    ({ id: 'S' + (++i), ts, sku, type, qty, reason, ref, operator, serials, equipo });
  return [
    M(seedTs(0, 8, 30), 'WBX-PULSAR-22', 'salida', 2, 'Entrega a equipo', 'ENT-2026-0412', OFICINA, ['WBX-22-899279', 'WBX-22-899280'], 'F01'),
    M(seedTs(0, 8, 30), 'CAB-RZ1K-5G6', 'salida', 150, 'Entrega a equipo', 'ENT-2026-0412', OFICINA, [], 'F01'),
    M(seedTs(0, 7, 50), 'BF-VE-VIA74', 'salida', 1, 'Entrega a equipo', 'ENT-2026-0410', OFICINA, ['OB-VU-26A0104'], 'F03'),
    M(seedTs(0, 7, 50), 'BF-TUB-CM20', 'salida', 80, 'Entrega a equipo', 'ENT-2026-0410', OFICINA, [], 'F03'),
    M(seedTs(0, 9, 5), 'BF-VE-POL74', 'salida', 1, 'Obra / instalación', 'Garaje C/ Eros 10', 'Jorge Ruiz', ['PCH74-26-0398']),
    M(seedTs(0, 10, 40), 'BF-FIX-SX6', 'salida', 120, 'Obra / instalación', 'Av. Monasterio de Silos 38', 'Andrea Pardo'),
    M(seedTs(1, 17, 45), 'CIR-ENEXT-S', 'salida', 2, 'Entrega a equipo', 'ENT-2026-0409', OFICINA, ['CC-9910', 'CC-9911'], 'F02'),
    M(seedTs(1, 17, 20), '6000650604', 'merma', 6, 'Corte sobrante', 'Final de rollo', 'Luis Martín'),
    M(seedTs(1, 12, 2), '7270020010', 'entrada', 305, 'Compra a proveedor', 'Alb. 2.793.496', OFICINA),
    M(seedTs(1, 8, 30), '7280040020', 'salida', 25, 'Obra / instalación', 'C/ Pilar Bardem 5', 'Jorge Ruiz'),
    M(seedTs(2, 16, 45), 'BF-VE-WBX74', 'salida', 1, 'Obra / instalación', 'Chalet Alcobendas', 'Andrea Pardo', ['WBX-PP-883118']),
    M(seedTs(2, 11, 0), '6201020032', 'salida', 120, 'Obra / instalación', 'C/ Eros 10', 'Luis Martín'),
    M(seedTs(3, 9, 15), '7501013532', 'entrada', 2, 'Compra a proveedor', 'Alb. 2.790.456', OFICINA),
    M(seedTs(4, 13, 30), '6040615316', 'entrada', 305, 'Compra a proveedor', 'Alb. 2.795.060', OFICINA),
    M(seedTs(5, 10, 10), 'BF-FON-MC16', 'salida', 60, 'Obra / instalación', 'Reforma baño C/ Zubeldia 8', 'Jorge Ruiz'),
    M(seedTs(6, 18, 0), '5301012054', 'merma', 50, 'Pérdida o extravío', 'Recuento semanal', 'Andrea Pardo'),
  ];
}

export function seedEntregas(): Entrega[] {
  return [
    { id: 'ENT-2026-0412', ts: seedTs(0, 8, 30), equipo: 'F01', receptor: 'T1', lineas: [{ sku: 'WBX-PULSAR-22', qty: 2, serials: ['WBX-22-899279', 'WBX-22-899280'] }, { sku: 'CAB-RZ1K-5G6', qty: 150, serials: [] }], firma: FIRMAS_DEMO[0], operator: OFICINA },
    { id: 'ENT-2026-0410', ts: seedTs(0, 7, 50), equipo: 'F03', receptor: 'T5', lineas: [{ sku: 'BF-VE-VIA74', qty: 1, serials: ['OB-VU-26A0104'] }, { sku: 'BF-TUB-CM20', qty: 80, serials: [] }], firma: FIRMAS_DEMO[1], operator: OFICINA },
    { id: 'ENT-2026-0409', ts: seedTs(1, 17, 45), equipo: 'F02', receptor: 'T3', lineas: [{ sku: 'CIR-ENEXT-S', qty: 2, serials: ['CC-9910', 'CC-9911'] }], firma: FIRMAS_DEMO[2], operator: OFICINA },
  ];
}

export function seedAlbaranes(): Albaran[] {
  return [
    { numero: '2.795.060', proveedor: 'Prysmian Cables Spain', fecha: '', lineas: 1, unidades: 305, ts: seedTs(4, 13, 30), operator: OFICINA, confianza: .99, modo: 'sim' },
    { numero: '2.793.496', proveedor: 'Saltoki Alcobendas', fecha: '', lineas: 1, unidades: 305, ts: seedTs(1, 12, 2), operator: OFICINA, confianza: .98, modo: 'sim' },
  ];
}

const fechaEn = (dias: number) => { const d = new Date(); d.setDate(d.getDate() + dias); return d.toISOString().slice(0, 10); };

export function seedHerramientas(): Herramienta[] {
  const H = (id: string, nombre: string, marca: string, serie: string, valor: number, equipo: string | undefined, tecnico: string | undefined, extra: Herramienta['historial'] = [], estado: Herramienta['estado'] = 'operativa', mas: Partial<Herramienta> = {}): Herramienta =>
    ({ id, clase: 'herramienta', cantidad: 1, nombre, marca, modelo: (mas.clase ?? 'herramienta') === 'herramienta' ? marca : undefined, serie, valor, estado, equipo, tecnico, ...mas, historial: [{ id: id + '-0', ts: seedTs(60, 9, 0), tipo: 'alta', nota: 'Alta en inventario de herramientas', operator: OFICINA }, ...extra] });
  return [
    H('H001', 'Comprobador de instalaciones VE (EVSE)', 'Metrel A1532', 'MT-1532-0091', 1450, 'F01', undefined),
    H('H002', 'Martillo perforador SDS-Plus', 'Hilti TE 30-A36', 'HI-TE30-5521', 890, 'F01', 'T1'),
    H('H003', 'Pinza amperimétrica', 'Fluke 376 FC', 'FL-376-22817', 520, 'F02', 'T3'),
    H('H004', 'Telurómetro', 'Chauvin Arnoux C.A 6417', 'CA-6417-1044', 1190, 'F02', undefined,
      [{ id: 'H004-1', ts: seedTs(3, 16, 20), tipo: 'deterioro', nota: 'Pantalla rayada y pinza floja', operator: 'Andrea Pardo' }], 'deteriorada'),
    H('H005', 'Crimpadora hidráulica 16–240 mm²', 'Klauke EK 60 VP', 'KL-EK60-7730', 1320, 'F03', 'T5'),
    H('H006', 'Taladro atornillador', 'Makita DDF484', 'MK-484-99102', 210, 'F03', 'T6',
      [{ id: 'H006-1', ts: seedTs(1, 12, 45), tipo: 'rotura', nota: 'Portabrocas roto en obra C/ Eros 10', operator: 'Raúl Ortega' }], 'rota'),
    // EPIs (con caducidad o revisión)
    H('E001', 'Guantes dieléctricos clase 0 (1000 V)', 'Catu CG-05', 'LOTE-2025-118', 64, 'F01', 'T1', [], 'operativa', { clase: 'epi', talla: '9', caduca: fechaEn(20) }),
    H('E002', 'Casco con pantalla facial arco eléctrico', 'Petzl Vertex + Catu', 'PZ-VX-44102', 145, 'F01', 'T2', [], 'operativa', { clase: 'epi', caduca: fechaEn(400) }),
    H('E003', 'Arnés anticaídas', 'Irudek 5000', 'IR-5000-2291', 180, 'F02', 'T4', [], 'operativa', { clase: 'epi', caduca: fechaEn(-12) }),
    H('E004', 'Calzado de seguridad S3', 'Bellota 72212', 'LOTE-B-7741', 79, 'F03', 'T5', [], 'operativa', { clase: 'epi', talla: '38', caduca: fechaEn(210) }),
    // Ropa de trabajo (por técnico y talla)
    H('R001', 'Pantalón de trabajo multibolsillos', 'Búfala (logo bordado)', '', 32, 'F01', 'T1', [], 'operativa', { clase: 'ropa', talla: '44', cantidad: 2 }),
    H('R002', 'Polo manga corta alta visibilidad', 'Búfala (logo bordado)', '', 18, 'F02', 'T3', [], 'operativa', { clase: 'ropa', talla: 'M', cantidad: 3 }),
    H('R003', 'Chaqueta softshell ignífuga', 'Búfala (logo bordado)', '', 69, 'F03', 'T6',
      [{ id: 'R003-1', ts: seedTs(5, 10, 0), tipo: 'deterioro', nota: 'Cremallera rota', operator: 'Raúl Ortega' }], 'deteriorada', { clase: 'ropa', talla: 'L' }),
  ];
}

export function fresh(): Estado {
  return {
    v: 3, products: clone(SEED_PRODUCTS), movements: seedMovements(), albaranes: seedAlbaranes(),
    equipos: clone(SEED_EQUIPOS), tecnicos: clone(SEED_TECNICOS), entregas: seedEntregas(), herramientas: seedHerramientas(), propietarios: clone(SEED_PROPIETARIOS), pendientes: [], perfiles: [], rol: 'admin', avisos: [], minimosHerramienta: [{ modelo: 'Makita DDF484', minimo: 1, proveedor: 'Saltoki Alcobendas' }], configAvisos: clone(CONFIG_AVISOS_DEFECTO), envios: [], actas: [], plantillas: clone(SEED_PLANTILLAS),
    operator: OFICINA, pedidos: {}, cesta: { equipo: 'F01', receptor: 'T1', lineas: [] }, seq: { ent: 412 },
  };
}
