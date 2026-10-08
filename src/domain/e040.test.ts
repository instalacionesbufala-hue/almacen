/* E-040 · Barra inferior del móvil personalizable: se guarda y se lee por usuario (aquí, modo local: en el dispositivo), se filtra
   por los permisos del rol, se restablece, y el menú lateral del escritorio no cambia. */
import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fresh } from '../data/semilla';
import { BARRA_DEFECTO, accesosDisponibles, barraEfectiva, normalizarBarra, type ConfigBarra } from './barra';

// el entorno de pruebas es Node: un localStorage mínimo para la copia en el dispositivo
beforeAll(() => {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k) };
});
const como = (rol: string, socio?: string) => { const S = fresh(); S.rol = rol as never; if (socio) S.socio = socio; return S; };

describe('barra inferior del móvil', () => {
  it('se filtra por los permisos del rol', () => {
    const mia: ConfigBarra = { accesos: ['retirada', 'escanear', 'custodia', 'dotacion', 'mas'], central: 'retirada' };
    expect(barraEfectiva(como('admin'), mia)).toEqual(mia);
    // solo lectura no registra retiradas: ese acceso (y su botón central) desaparecen
    expect(barraEfectiva(como('lectura'), mia)).toEqual({ accesos: ['escanear', 'custodia', 'dotacion', 'mas'], central: null });
    expect(accesosDisponibles(como('lectura')).map(a => a.id)).not.toContain('retirada');
    // un usuario de socio: solo lo que puede ver
    const socio = accesosDisponibles(como('socio', 'ESMOVE')).map(a => a.id);
    expect(socio).toContain('custodia');
    expect(socio).not.toContain('entrega');
    expect(socio).not.toContain('camara');
    // si no le queda nada de lo suyo, la de siempre (también filtrada)
    expect(barraEfectiva(como('lectura'), { accesos: ['retirada'], central: null }).accesos).toEqual(barraEfectiva(como('lectura'), null).accesos);
  });

  it('normaliza lo guardado: ids conocidos, sin repetir, como mucho 5, central dentro', () => {
    expect(normalizarBarra({ accesos: ['inventario', 'x', 'inventario', 'entrega', 'equipos', 'custodia', 'cierres', 'mas'], central: 'mas' }))
      .toEqual({ accesos: ['inventario', 'entrega', 'equipos', 'custodia', 'cierres'], central: null });
    expect(normalizarBarra(null)).toBeNull();
    expect(normalizarBarra({ accesos: [] })).toBeNull();
  });

  it('guardar, leer y restablecer (copia del dispositivo en modo local); el escritorio no cambia', async () => {
    const { guardarBarra, barraGuardada } = await import('../store/barra');
    const { Sidebar, BarraInferior } = await import('../features/shell/Shell');
    const lateral = renderToStaticMarkup(createElement(Sidebar, { vista: 'stock' }));
    const antes = renderToStaticMarkup(createElement(BarraInferior, { vista: 'stock' }));
    expect(antes).toContain('lg:hidden');
    expect(antes).toContain('grid-cols-4');
    const mia: ConfigBarra = { accesos: ['inventario', 'retirada', 'escanear', 'movimientos', 'mas'], central: 'escanear' };
    expect(await guardarBarra(mia)).toBe(true);
    expect(barraGuardada()).toEqual(mia);
    const despues = renderToStaticMarkup(createElement(BarraInferior, { vista: 'stock' }));
    expect(despues).toContain('grid-cols-5');
    expect(despues).toContain('Retirada');
    expect(despues).toContain('Movimientos');
    expect(renderToStaticMarkup(createElement(Sidebar, { vista: 'stock' }))).toBe(lateral);      // el menú lateral, igual
    await guardarBarra(null);
    expect(barraGuardada()).toBeNull();
    expect(barraEfectiva(como('admin'), barraGuardada())).toEqual(BARRA_DEFECTO);
  });
});
