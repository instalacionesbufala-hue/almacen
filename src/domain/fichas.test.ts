/* E-016 · Fusionar, cambiar código, reasignar líneas de albarán, actualizar fichas desde el CSV y categorías (lógica local) */
import { describe, expect, it } from 'vitest';
import { catDe, categoriasActivas } from '../data/catalogo';
import { fresh } from '../data/semilla';
import { aplicarLocal } from '../store/ops';
import { comprobarFusion, diferencias, pendienteDeReasignar } from './fichas';
import { find, resolveCode, unidadesABordo } from './reglas';

const admin = () => { const S = fresh(); S.rol = 'admin'; return S; };

describe('fusionar A en B', () => {
  it('el stock del almacén y de los vehículos pasa con ajustes enlazados; A queda archivado y su código lleva a B', () => {
    const S = admin();
    const a = find(S, 'CAB-RZ1K-5G6')!, antes = a.stock;
    aplicarLocal(S, { op: 'fusionar', args: { origen: 'CAB-RZ1K-5G6', destino: '6040615306', motivo: 'Era el mismo cable' } });
    expect(find(S, '6040615306')!.stock).toBe(265 + antes);
    expect(S.products.some(p => p.sku === 'CAB-RZ1K-5G6')).toBe(false);
    expect(find(S, 'CAB-RZ1K-5G6')).toMatchObject({ fusionadoEn: '6040615306' });                  // el historial lo sigue encontrando
    expect(unidadesABordo(S, 'V-F01', '6040615306')).toBe(150);
    expect(unidadesABordo(S, 'V-F01', 'CAB-RZ1K-5G6')).toBe(0);
    const [masB, menosA] = S.movements.filter(m => m.reason.startsWith('Fusión') && !m.vehiculo).slice(0, 2);
    expect(masB.corrige).toBe(menosA.id);
    expect(resolveCode(S, 'CAB-RZ1K-5G6')?.p.sku).toBe('6040615306');
    expect(() => aplicarLocal(S, { op: 'movimiento', args: { id: 'x', sku: 'CAB-RZ1K-5G6', tipo: 'salida', qty: 1, motivo: 'Obra', ref: '', series: [] } })).toThrow(/archivado/);
  });
  it('convierte por el contenido del formato y no deja formatos partidos', () => {
    const S = admin();
    // 12 cajas de 100 tacos → 1200 ud de un artículo por unidades
    S.products.push({ sku: 'TACO-UD', name: 'Taco suelto', cat: 'fijaciones', unit: 'ud', contenido: 1, stock: 0, min: 0, supplier: '' });
    expect(comprobarFusion(S, 'BF-FIX-SX8', 'TACO-UD').qb).toBe(1200);
    // 1 sobre de 25 no son cajas de 100 enteras
    expect(() => comprobarFusion(S, '7280040020', 'BF-FIX-SX8')).toThrow(/No cuadra el formato/);
    expect(() => aplicarLocal({ ...S, rol: 'almacen' }, { op: 'fusionar', args: { origen: 'BF-FIX-SX8', destino: 'TACO-UD', motivo: '' } })).toThrow(/administrador/);
  });
  it('cambiar el código: ficha nueva y la antigua fusionada en ella', () => {
    const S = admin(), stock = find(S, 'SCH-IC60N-40')!.stock;
    aplicarLocal(S, { op: 'cambiarCodigo', args: { sku: 'SCH-IC60N-40', nuevo: 'a9f74240' } });
    expect(find(S, 'A9F74240')).toMatchObject({ name: expect.stringMatching(/iC60N/), stock });
    expect(find(S, 'SCH-IC60N-40')!.fusionadoEn).toBe('A9F74240');
    expect(() => aplicarLocal(S, { op: 'cambiarCodigo', args: { sku: 'BF-FIX-SX8', nuevo: 'A9F74240' } })).toThrow(/Ya existe/);
  });
});

describe('reasignar una línea de un albarán ya ingresado', () => {
  it('baja A, sube B y el historial conserva la entrada original y los dos ajustes enlazados', () => {
    const S = admin();
    aplicarLocal(S, { op: 'albaran', args: { id: 'ALB-1', cabecera: { numero: '3.322.577', proveedor: 'Saltoki', delegacion: 'Centro', cif: '', fecha: '', confianza: .9, modo: 'ia' }, lineas: [{ sku: 'BF-TUB-CM20', cantidad: 20, series: [] }] } });
    const entrada = S.movements.find(m => m.albaran === 'ALB-1')!;
    const a0 = find(S, 'BF-TUB-CM20')!.stock, b0 = find(S, '6040615306')!.stock;
    aplicarLocal(S, { op: 'reasignarLinea', args: { id: 'R1', movimiento: entrada.id, destino: '6040615306', cantidad: 15 } });
    expect(find(S, 'BF-TUB-CM20')!.stock).toBe(a0 - 15);
    expect(find(S, '6040615306')!.stock).toBe(b0 + 15);
    expect(S.movements.find(m => m.id === entrada.id)).toMatchObject({ type: 'entrada', qty: 20 });           // la entrada no se toca
    const menos = S.movements.find(m => m.id === 'R1')!, mas = S.movements.find(m => m.corrige === 'R1')!;
    expect(menos).toMatchObject({ type: 'ajuste', qty: -15, corrige: entrada.id, ref: 'Albarán 3.322.577 · pasa a 6040615306' });
    expect(mas).toMatchObject({ type: 'ajuste', qty: 15, sku: '6040615306', ref: 'Albarán 3.322.577 · venía como BF-TUB-CM20' });
    expect(pendienteDeReasignar(S, entrada.id)).toBe(5);
    expect(() => aplicarLocal(S, { op: 'reasignarLinea', args: { id: 'R2', movimiento: entrada.id, destino: '6040615306', cantidad: 6 } })).toThrow(/quedan 5/);
    aplicarLocal(S, { op: 'reasignarLinea', args: { id: 'R1', movimiento: entrada.id, destino: '6040615306', cantidad: 15 } });   // reintento de la cola
    expect(find(S, '6040615306')!.stock).toBe(b0 + 15);
    expect(S.albaranes[0]).toMatchObject({ id: 'ALB-1', proveedor: 'Saltoki', delegacion: 'Centro' });
  });
});

describe('actualizar fichas desde el catálogo y categorías', () => {
  it('"Actualizar fichas existentes" cambia unidad, contenido, categoría y proveedor sin tocar el stock', () => {
    const S = admin();
    const p = find(S, 'BF-FIX-SX6')!; Object.assign(p, { unit: 'ud', contenido: 1 }); const stock = p.stock;
    const fila = { sku: 'BF-FIX-SX6', ref_proveedor: '', nombre: 'Bote 1000 tacos nylon SX 6×30', categoria: 'fijaciones', propiedad: 'propia' as const, propietario: '', proveedor: 'Saltoki', unidad: 'bote' as const, contenido: 1000, stock_inicial: 99, minimo: null, albaranes: 'A-1' };
    expect(diferencias(p, { unit: 'bote', contenido: 1000, supplier: 'Saltoki' }).map(d => d.campo)).toEqual(['supplier', 'unit', 'contenido']);
    aplicarLocal(S, { op: 'importarCatalogo', args: { filas: [fila] } });
    expect(find(S, 'BF-FIX-SX6')).toMatchObject({ unit: 'ud', stock });                                      // sin la casilla, no se toca
    aplicarLocal(S, { op: 'importarCatalogo', args: { filas: [fila], actualizar: true } });
    expect(find(S, 'BF-FIX-SX6')).toMatchObject({ unit: 'bote', contenido: 1000, supplier: 'Saltoki', stock });
  });
  it('categorías: Fontanería ya no existe; una categoría con artículos se desactiva moviéndolos a otra', () => {
    const S = admin();
    expect(categoriasActivas().map(([k]) => k)).not.toContain('fontaneria');
    expect(catDe('tubos').label).toBe('Tubos y canalización');
    expect(catDe('inventada').label).toBe('inventada');                                                     // una categoría desconocida no rompe nada
    expect(() => aplicarLocal(S, { op: 'desactivarCategoria', args: { id: 'tubos' } })).toThrow(/elige otra categoría/);
    aplicarLocal(S, { op: 'desactivarCategoria', args: { id: 'tubos', moverA: 'fijaciones' } });
    expect(S.products.some(p => p.cat === 'tubos')).toBe(false);
    expect(S.categorias.find(c => c.id === 'tubos')!.activa).toBe(false);
    aplicarLocal(S, { op: 'categoria', args: { cat: { id: 'solar', nombre: 'Fotovoltaica', icono: 'solar_power', color: 'ambar', orden: 110, activa: true } } });
    expect(S.categorias.at(-1)).toMatchObject({ id: 'solar', nombre: 'Fotovoltaica' });
    expect(() => aplicarLocal(S, { op: 'categoria', args: { cat: { id: 'Con Espacios', nombre: 'x', icono: '', color: 'gris', orden: 1, activa: true } } })).toThrow(/Identificador/);
  });
  it('el almacén propone cambios de ficha; el administrador los aplica o descarta', () => {
    const S = fresh(); S.rol = 'almacen';
    aplicarLocal(S, { op: 'proponerCambio', args: { id: 'P1', sku: 'BF-FIX-SX8', cambios: { name: 'Caja 100 tacos SX 8' } } });
    expect(S.propuestas[0]).toMatchObject({ sku: 'BF-FIX-SX8', estado: 'pendiente' });
    expect(() => aplicarLocal(S, { op: 'resolverPropuesta', args: { id: 'P1', aplicada: true } })).toThrow(/administrador/);
    S.rol = 'admin';
    aplicarLocal(S, { op: 'resolverPropuesta', args: { id: 'P1', aplicada: false } });
    expect(S.propuestas[0].estado).toBe('descartada');
  });
});
