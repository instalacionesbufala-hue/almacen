import { describe, expect, it } from 'vitest';
import type { AlbaranIA } from '../data/tipos';
import { crearCola, esErrorDeRed, leerPorLotes, lotes, type AlmacenLecturas, type Lectura } from './lecturaAlbaran';

const pagina = (kb: number, n = 0) => new Blob([new Uint8Array(kb * 1024).fill(n)], { type: 'image/jpeg' });
function memoria(): AlmacenLecturas & { datos: Map<string, Lectura>; archivos: Map<string, Blob[]> } {
  const datos = new Map<string, Lectura>(), archivos = new Map<string, Blob[]>();
  return {
    datos, archivos,
    listar: async () => [...datos.values()],
    guardar: async (l, p) => { datos.set(l.id, { ...l }); if (p) archivos.set(l.id, p); },
    paginas: async id => archivos.get(id) || [],
    borrar: async id => { datos.delete(id); archivos.delete(id); },
  };
}

describe('E-024 · lotes de páginas', () => {
  it('reparte por número de páginas y por peso, sin cambiar el orden', () => {
    const ps = Array.from({ length: 8 }, (_, i) => ({ size: 1, i }));
    expect(lotes(ps, 6).map(l => l.map(p => p.i))).toEqual([[0, 1, 2, 3, 4, 5], [6, 7]]);
    expect(lotes([{ size: 5 }, { size: 5 }, { size: 5 }], 6, 10).map(l => l.length)).toEqual([2, 1]);
    expect(lotes([{ size: 50 }], 6, 10)).toHaveLength(1);              // una página grande va sola
  });

  it('8 páginas = 2 llamadas y una sola revisión unida', async () => {
    const llamadas: number[] = [];
    const r = await leerPorLotes(Array.from({ length: 8 }, () => pagina(1)), async b => {
      llamadas.push(b.length);
      return llamadas.length === 1
        ? { proveedor: 'Saltoki', numero: 'A-1', lineas: [{ codigo: 'X1', descripcion: 'Uno', cantidad: 2 }, { descripcion: 'SUMA Y SIGUE', cantidad: 2 }] }
        : { proveedor: 'Saltoki', numero: 'A-1', lineas: [{ descripcion: 'Suma anterior', cantidad: 2 }, { codigo: 'X2', descripcion: 'Dos', cantidad: 5 }] };
    });
    expect(llamadas).toEqual([6, 2]);
    expect(r).toMatchObject({ proveedor: 'Saltoki', numero: 'A-1', paginas: 8 });
    expect(r.lineas!.map(l => l.codigo)).toEqual(['X1', 'X2']);
  });
});

describe('E-024 · cola de lectura sin conexión', () => {
  const resultado: AlbaranIA = { proveedor: 'Saltoki', numero: 'B-7', lineas: [{ codigo: 'X1', descripcion: 'Uno', cantidad: 1 }] };
  let n = 0;
  const base = (alm: AlmacenLecturas, red: { on: boolean }, leidas: Blob[][] = []) => crearCola({
    almacen: alm, enLinea: () => red.on, id: () => `L${++n}`,
    leer: async p => { if (!red.on) throw new TypeError('Failed to fetch'); leidas.push(p); return resultado; },
  });

  it('sin cobertura: el albarán queda "pendiente de leer" con sus páginas y se lee al volver la conexión', async () => {
    const alm = memoria(), red = { on: false }, leidas: Blob[][] = [], cola = base(alm, red, leidas);
    const l = await cola.nueva([pagina(1, 1), pagina(1, 2)], 'Albarán de 2 hojas');
    expect(l.estado).toBe('pendiente');
    expect((await alm.paginas(l.id)).length).toBe(2);
    expect(await cola.procesar()).toEqual([]);                          // sigue sin red: no se intenta
    red.on = true;
    const [r] = await cola.procesar();
    expect(r).toMatchObject({ id: l.id, estado: 'leido', resultado: { numero: 'B-7' } });
    expect(leidas[0]).toHaveLength(2);
    expect(alm.datos.get(l.id)!.estado).toBe('leido');
  });

  it('si la red se cae a mitad, vuelve a "pendiente" (no a error) y no sigue con las demás', async () => {
    const alm = memoria(), red = { on: false }, cola = base(alm, red);
    const a = await cola.nueva([pagina(1)], 'a'), b = await cola.nueva([pagina(1)], 'b');
    red.on = true;
    const cola2 = crearCola({ almacen: alm, enLinea: () => true, id: () => 'x', leer: async () => { throw new TypeError('Load failed'); } });
    const r = await cola2.procesar();
    expect(r.map(x => x.estado)).toEqual(['pendiente']);
    expect([alm.datos.get(a.id)!.estado, alm.datos.get(b.id)!.estado]).toEqual(['pendiente', 'pendiente']);
  });

  it('un error de la IA queda a la vista para reintentar o descartar', async () => {
    const alm = memoria();
    let falla = true;
    const cola = crearCola({ almacen: alm, enLinea: () => true, id: () => 'E1', leer: async () => { if (falla) throw new Error('Se ha alcanzado el límite gratuito'); return resultado; } });
    const l = await cola.nueva([pagina(1)], 'x');
    expect(l).toMatchObject({ estado: 'error', error: 'Se ha alcanzado el límite gratuito' });
    falla = false;
    expect((await cola.reintentar('E1'))!.estado).toBe('leido');
    await cola.descartar('E1');
    expect(await alm.listar()).toEqual([]);
    expect(await alm.paginas('E1')).toEqual([]);
  });

  it('con conexión se lee en el momento', async () => {
    const alm = memoria(), cola = base(alm, { on: true });
    expect((await cola.nueva([pagina(1)], 'x')).estado).toBe('leido');
  });

  it('reconoce los fallos de red del navegador', () => {
    expect(esErrorDeRed(new TypeError('Failed to fetch'))).toBe(true);
    expect(esErrorDeRed(new Error('Load failed'))).toBe(true);
    expect(esErrorDeRed(new Error('Formato no admitido'))).toBe(false);
  });
});
