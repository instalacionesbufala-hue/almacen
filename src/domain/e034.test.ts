/* E-034 · En la app: lo que ve un usuario de socio (el mismo filtro que datos_socio en el servidor, para "Probar como este usuario"),
   qué pantallas ve, qué roles valen para un socio y el alta/edición del usuario. */
import { afterEach, describe, expect, it } from 'vitest';
import { fresh } from '../data/semilla';
import type { Producto } from '../data/tipos';
import { aplicarLocal } from '../store/ops';
import { PERMISOS_SOCIO, rolValidoParaSocio } from '../../supabase/functions/_compartido/permisos';
import { filtrarParaSocio } from './socio';
import { puede, simularRol, socioEfectivo, vistaPermitida } from './permisos';

function estado() {
  const S = fresh(); S.rol = 'admin';
  if (!S.propietarios.some(o => o.id === 'INSTANTBOX')) S.propietarios.push({ id: 'INSTANTBOX', nombre: 'Instant Box', contacto: '', correosReposicion: [], correosInformes: [], activo: true, color: 'naranja' });
  S.products.push({ sku: 'IBX-TAQ-1', name: 'Taquilla', cat: 'aparamenta', unit: 'ud', contenido: 1, stock: 4, min: 0, supplier: '', propiedad: 'custodia', propietario: 'INSTANTBOX' } as Producto);
  return S;
}
afterEach(() => simularRol(null));

describe('lo que ve un socio', () => {
  it('Esmove: solo su material en custodia, sus movimientos (sin operario), nada de técnicos, entregas, firmas ni dotación', () => {
    const S = estado(), V = filtrarParaSocio(S, 'ESMOVE');
    expect(V.products.length).toBeGreaterThan(0);
    expect(V.products.every(p => p.propiedad === 'custodia' && p.propietario === 'ESMOVE')).toBe(true);
    expect(V.products.some(p => p.sku === 'IBX-TAQ-1')).toBe(false);
    const skus = new Set(V.products.map(p => p.sku));
    expect(V.movements.every(m => skus.has(m.sku) && m.operator === 'Búfala')).toBe(true);
    expect(V.aBordo.every(b => skus.has(b.sku))).toBe(true);
    expect([V.tecnicos, V.entregas, V.herramientas, V.perfiles, V.pendientes, V.equivalencias, V.albaranes].map(x => x.length)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(V.equipos.every(e => e.tecnicos.length === 0)).toBe(true);
    expect(V.actas.every(a => a.propietario === 'ESMOVE' && a.firma === '')).toBe(true);
    expect(V.propietarios.map(o => o.id)).toEqual(['ESMOVE']);
    expect(V.socio).toBe('ESMOVE');
    // el estado del administrador no se toca
    expect(S.tecnicos.length).toBeGreaterThan(0);
  });
  it('Instant Box no ve nada de Esmove', () => {
    const V = filtrarParaSocio(estado(), 'INSTANTBOX');
    expect(V.products.map(p => p.sku)).toEqual(['IBX-TAQ-1']);
  });
});

describe('pantallas y roles', () => {
  it('el rol de socio ve inventario, movimientos, custodia y exporta; nada más (ni configuración)', () => {
    const S = { ...estado(), rol: 'socio', socio: 'ESMOVE' };
    expect(['inventario', 'movimientos', 'custodia', 'exportar'].every(a => puede(S, a, 'ver'))).toBe(true);
    expect(['entregas', 'equipos', 'dotacion', 'cierres', 'bandeja', 'configuracion', 'albaranes'].some(a => puede(S, a, 'ver'))).toBe(false);
    expect(['inventario', 'custodia'].some(a => puede(S, a, 'modificar'))).toBe(false);
    expect(['stock', 'movimientos', 'custodia'].every(v => vistaPermitida(S, v))).toBe(true);
    expect(['config', 'equipos', 'entregas', 'dotacion', 'albaranes'].some(v => vistaPermitida(S, v))).toBe(false);
  });
  it('probar como un usuario de socio: su rol y su socio', () => {
    const S = estado();
    simularRol('socio', { propietario: 'ESMOVE', nombre: 'Esmove' });
    expect(socioEfectivo(S)).toBe('ESMOVE');
    expect(vistaPermitida(S, 'config')).toBe(false);
    simularRol(null);
    expect(socioEfectivo(S)).toBeUndefined();
  });
  it('roles válidos para un socio: "socio" o uno propio sin Modificar y solo de su custodia', () => {
    expect(rolValidoParaSocio('socio', PERMISOS_SOCIO, true)).toBe(true);
    expect(rolValidoParaSocio('lectura', {}, true)).toBe(false);
    expect(rolValidoParaSocio('x', { 'custodia.ver': true, 'exportar.ver': true }, false)).toBe(true);
    expect(rolValidoParaSocio('x', { 'custodia.modificar': true }, false)).toBe(false);
    expect(rolValidoParaSocio('x', { 'entregas.ver': true }, false)).toBe(false);
  });
  it('el usuario: socio ↔ rol de socio', () => {
    const S = estado();
    S.perfiles.push({ id: 'a1', nombre: 'Admin', email: null, rol: 'admin', activo: true }, { id: 'u1', nombre: 'Persona de Esmove', email: null, rol: 'almacen', activo: true });
    expect(() => aplicarLocal(S, { op: 'perfil', args: { id: 'u1', nombre: 'Persona de Esmove', rol: 'almacen', activo: true, propietario: 'ESMOVE' } })).toThrow(/solo puede tener el rol/);
    expect(() => aplicarLocal(S, { op: 'perfil', args: { id: 'u1', nombre: 'Persona de Esmove', rol: 'socio', activo: true } })).toThrow(/elige el socio/);
    aplicarLocal(S, { op: 'perfil', args: { id: 'u1', nombre: 'Persona de Esmove', rol: 'socio', activo: true, propietario: 'ESMOVE' } });
    expect(S.perfiles.find(p => p.id === 'u1')).toMatchObject({ rol: 'socio', propietario: 'ESMOVE' });
  });
});
