/* E-012 · Traducción de un cierre del wizard a consumos (sin base de datos) */
import { describe, expect, it } from 'vitest';
import { claveCierre, cumple, EQUIVALENCIAS_PROPUESTA as REGLAS, fijaciones, KITS_PROPUESTA as KITS, manguitos, normalizarCierre, traducirCierre, type Regla } from '../functions/_compartido/cierres';

const base = { numInst: 'INST-0001', esbrainUuid: 'uuid-1', cliente: 'Cliente de prueba', direccion: 'C/ Inventada 1', fechaCierreIso: '2026-10-02T10:00:00Z', equipo: 'Búfala 1' };
const cierre = (x: Record<string, unknown>) => normalizarCierre({ ...base, ...x });
const de = (lineas: ReturnType<typeof traducirCierre>, sku: string) => lineas.filter(l => l.sku === sku).reduce((a, l) => a + l.cantidad, 0);

describe('fórmulas del usuario', () => {
  it('manguitos floor(m/3)+1 por tramo de tubo rígido', () => {
    expect([0, 1, 2.9, 3, 4, 5.9, 6, 9].map(manguitos)).toEqual([0, 1, 1, 2, 2, 2, 3, 4]);
  });
  it('fijaciones ceil(m/0,5)', () => {
    expect([0, 0.2, 0.5, 1, 1.2, 4, 4.1].map(fijaciones)).toEqual([0, 1, 1, 2, 3, 8, 9]);
  });
});

describe('equivalencias con condiciones', () => {
  it('metrosLinea según tipo de línea, fase y sección', () => {
    const mono6 = traducirCierre(cierre({ tipoLinea: 'tubo', fase: 'mono', seccion: '6', metrosLinea: 12 }), REGLAS, KITS);
    expect(['6000650603', '6000650604', '6000650605'].map(s => de(mono6, s))).toEqual([12, 12, 12]);
    const trif6 = traducirCierre(cierre({ tipoLinea: 'tubo', fase: 'trif', seccion: '6', metrosLinea: 10 }), REGLAS, KITS);
    expect(trif6.filter(l => l.campo === 'metrosLinea' && l.estado === 'aplicable')).toHaveLength(5);
    const trif16 = traducirCierre(cierre({ tipoLinea: 'tubo', fase: 'trif', seccion: '16', metrosLinea: 10 }), REGLAS, KITS);
    expect(trif16.find(l => l.campo === 'metrosLinea')).toMatchObject({ estado: 'sin_equivalencia', sku: null });     // no descuenta hasta que se defina
    const mang = traducirCierre(cierre({ tipoLinea: 'manguera', fase: 'mono', seccion: '6', metrosLinea: 25 }), REGLAS, KITS);
    expect(de(mang, '6040610306')).toBe(25);
  });
  it('cable UTP según el cargador: V2C → U/UTP, Policharger → F/UTP, otro → Pendientes', () => {
    expect(de(traducirCierre(cierre({ hardware: 'V2C Trydan 7,4 kW', metrosUtp: 15 }), REGLAS, KITS), '7270020010')).toBe(15);
    expect(de(traducirCierre(cierre({ hardware: 'Policharger 22 kW', metrosUtp: 15 }), REGLAS, KITS), '7270021010')).toBe(15);
    const otro = traducirCierre(cierre({ hardware: 'Wallbox Pulsar', metrosUtp: 15 }), REGLAS, KITS);
    expect(otro.find(l => l.campo === 'metrosUtp')).toMatchObject({ estado: 'pendiente', sku: null });
  });
  it('condiciones: igual (sin mayúsculas), lista, contiene y "contiene todo"', () => {
    const c = cierre({ hardware: 'TRYDAN 22 kW', tipoLinea: 'Tubo' });
    expect(cumple(c, { tipoLinea: 'tubo' })).toBe(true);
    expect(cumple(c, { tipoLinea: ['manguera', 'tubo'] })).toBe(true);
    expect(cumple(c, { 'hardware~': 'trydan&22' })).toBe(true);
    expect(cumple(cierre({ hardware: 'Policharger 22 kW' }), { 'hardware~': 'trydan&22' })).toBe(false);
  });
  it('manguitos y fijaciones solo en tubo rígido (PVC y acero); el corrugado no cuenta', () => {
    const l = traducirCierre(cierre({ pvc32: 4, acero32: 2, corr32: 10 }), REGLAS, KITS);
    expect(de(l, '6201000032')).toBe(4);                                 // metros de tubo: los indica el técnico
    expect(de(l, '6200020032')).toBe(10);
    expect(de(l, '6201025023')).toBe(2);                                 // manguitos PVC: floor(4/3)+1
    expect(l.find(x => x.campo === 'acero32' && x.formula === 'manguitos')).toMatchObject({ estado: 'sin_equivalencia' });   // manguito de acero sin dar de alta
    expect(de(l, '5102012032')).toBe(12);                                // fijaciones: ceil(6/0,5) = 12 clips (kit A), sin los 10 m de corrugado
    expect(l.filter(x => x.formula === 'fijaciones').every(x => x.estimada)).toBe(true);
  });
  it('kits de fijación A, B y C', () => {
    const c = cierre({ pvc32: 1.5 });                                     // 3 fijaciones
    const a = traducirCierre(c, REGLAS, KITS, 'A');
    expect(a.filter(l => l.formula === 'fijaciones').map(l => [l.sku, l.cantidad, l.estado])).toEqual([['5102012032', 3, 'aplicable'], [null, 3, 'sin_equivalencia']]);   // el clavo aún no existe
    const b = traducirCierre(c, REGLAS, KITS, 'B');
    expect(['5102012032', '5301012054', '5150000106'].map(s => de(b, s))).toEqual([3, 3, 3]);   // el taco: 3 ud del bote de 1000
    const cc = traducirCierre(c, REGLAS, KITS, 'C');
    expect(['5101010032', '5108000003', '5150000106'].map(s => de(cc, s))).toEqual([3, 3, 3]);
    // una regla puede fijar su propio kit
    const conKit = REGLAS.map(r => (r.formula === 'fijaciones' ? { ...r, kit: 'C' } : r));
    expect(de(traducirCierre(c, conKit, KITS, 'A'), '5108000003')).toBe(3);
  });
  it('RJ45 en unidades del sobre (2 RJ45 = 2 ud de un sobre de 25)', () => {
    expect(de(traducirCierre(cierre({ rj45: 2 }), REGLAS, KITS), '7280040060')).toBe(2);
  });
  it('cargador de Esmove: 1 ud del modelo, sin n.º de serie; si no se reconoce, a Pendientes', () => {
    expect(de(traducirCierre(cierre({ hardware: 'Trydan 7,4 kW + Schuko' }), REGLAS, KITS), '8900500015')).toBe(1);
    expect(de(traducirCierre(cierre({ hardware: 'Trydan 22 kW' }), REGLAS, KITS), '8900500025')).toBe(1);
    expect(de(traducirCierre(cierre({ hardware: 'V2C Trydan 7.4kW' }), REGLAS, KITS), '8900590300')).toBe(1);
    const x = traducirCierre(cierre({ hardware: 'Marca desconocida' }), REGLAS, KITS);
    expect(x.find(l => l.campo === 'hardware')).toMatchObject({ estado: 'pendiente' });
    expect(JSON.stringify(x)).not.toMatch(/serie/i);
  });
  it('E-026: cargadores con el texto real del calendario (gana la primera regla que cumple)', () => {
    const sku = (hardware: string) => traducirCierre(cierre({ hardware }), REGLAS, KITS).filter(l => l.campo === 'hardware').map(l => l.sku);
    expect(sku('V2C TRYDAN MONOFÁSICO PROTECCIONES M5')).toEqual(['8900590300']);
    expect(sku('V2C TRYDAN MONOFÁSICO PROTECCIONES M5 + SCHUKO')).toEqual(['8900500015']);
    expect(sku('POLICHARGER NW MONOFÁSICO PROTECCIÓN REARME M5')).toEqual(['8906000665']);
    expect(sku('V2C TRYDAN MONOFÁSICO PROTECCIONES M10')).toEqual(['8900500020']);
    expect(sku('V2C TRYDAN TRIFÁSICO PROTECCIONES M5')).toEqual(['8900500025']);
    expect(sku('V2C TRYDAN TRIFÁSICO PROTECCIONES M10')).toEqual(['8900500030']);
    expect(traducirCierre(cierre({ hardware: 'WALLBOX PULSAR' }), REGLAS, KITS).find(l => l.campo === 'hardware')).toMatchObject({ estado: 'pendiente' });
  });
  it('desplazamiento fallido: sin consumo', () => {
    expect(traducirCierre(cierre({ despFallido: true, pvc32: 5, hardware: 'Trydan 22 kW' }), REGLAS, KITS)).toEqual([]);
    expect(normalizarCierre({ ...base, despFallido: 'true' }).despFallido).toBe(true);
  });
  it('reglas desactivadas o artículos que no están en el catálogo no descuentan', () => {
    const sinCanaleta: Regla[] = REGLAS.map(r => (r.campo === 'canaleta' ? { ...r, activa: false } : r));
    expect(traducirCierre(cierre({ canaleta: 3 }), sinCanaleta, KITS)[0]).toMatchObject({ campo: 'canaleta', estado: 'sin_equivalencia' });
    const l = traducirCierre(cierre({ canaleta: 3 }), REGLAS, KITS, 'A', new Set(['otra']));
    expect(l[0]).toMatchObject({ estado: 'sin_equivalencia', nota: expect.stringMatching(/no está en el catálogo/) });
  });
  it('E-026: la clave es la instalación (numInst), con o sin UUID y con cualquier fecha', () => {
    expect(claveCierre(cierre({}))).toBe('inst:INST-0001');
    expect(claveCierre(cierre({ esbrainUuid: '', fechaCierreIso: '2026-10-03T08:00:00Z' }))).toBe('inst:INST-0001');
    expect(claveCierre(cierre({ numInst: ' inst-0001 ' }))).toBe('inst:INST-0001');
    expect(claveCierre(cierre({ numInst: '' }))).toBe('uuid:uuid-1');
    expect(() => claveCierre(cierre({ esbrainUuid: '', numInst: '' }))).toThrow(/numInst/);
  });
});
