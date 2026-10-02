/* E-027 · Permisos en la app: qué ve y qué puede cada rol, el bloqueo en ejecutar() y "Probar como este rol" */
import { afterEach, describe, expect, it } from 'vitest';
import { fresh } from '../data/semilla';
import { aplicarLocal } from '../store/ops';
import { almacen, ejecutar } from '../store/almacen';
import { gestiona, motivoSinPermiso, puede, simularRol, soloLectura, vistaPermitida } from './permisos';

afterEach(() => simularRol(null));
const con = (rol: string) => { const S = fresh(); S.rol = rol; return S; };

describe('roles de sistema', () => {
  it('Solo lectura: ve y exporta; no modifica nada; no entra en configuración interna ni valida la bandeja', () => {
    const S = con('lectura');
    for (const a of ['inventario', 'movimientos', 'albaranes', 'entregas', 'equipos', 'cierres', 'custodia', 'bandeja', 'exportar']) expect(puede(S, a), a).toBe(true);
    for (const a of ['inventario', 'movimientos', 'albaranes', 'entregas', 'equipos', 'recuentos', 'dotacion', 'custodia', 'cierres', 'bandeja', 'configuracion']) expect(puede(S, a, 'modificar'), a).toBe(false);
    expect(puede(S, 'configuracion')).toBe(false);
    expect(soloLectura(S)).toBe(true);
    expect(motivoSinPermiso(S, 'movimiento')).toMatch(/Tu rol \(Solo lectura\) no permite modificar: Movimientos/);
    expect(motivoSinPermiso(S, 'prepararEntrega')).toMatch(/Entregas/);
    expect(vistaPermitida(S, 'movimientos')).toBe(true);
  });
  it('Almacén: lo de siempre (mueve, entrega, recuenta) pero no gestiona como el administrador', () => {
    const S = con('almacen');
    expect(['movimiento', 'prepararEntrega', 'recuentoVehiculo', 'borradorArticulo', 'acta', 'incidencia'].map(o => motivoSinPermiso(S, o))).toEqual([null, null, null, null, null, null]);
    expect(gestiona(S, 'inventario')).toBe(false);
    expect(motivoSinPermiso(S, 'validarPendiente')).toMatch(/Avisos y bandeja/);
    expect(motivoSinPermiso(S, 'perfil')).toMatch(/Usuarios y roles/);
    expect(soloLectura(S)).toBe(false);
  });
  it('Administrador: todo', () => {
    const S = con('admin');
    expect(motivoSinPermiso(S, 'perfil')).toBeNull();
    expect(gestiona(S, 'configuracion')).toBe(true);
  });
});

describe('roles propios', () => {
  it('"Ver custodia" sin modificar: entra en Custodia, no registra actas; sin "Ver movimientos" no entra en Movimientos', () => {
    const S = con('admin');
    aplicarLocal(S, { op: 'guardarRol', args: { id: 'socios', nombre: 'Consulta de socios', descripcion: '', sistema: false, permisos: { 'custodia.ver': true, 'inventario.ver': true } } });
    S.rol = 'socios';
    expect(vistaPermitida(S, 'custodia')).toBe(true);
    expect(vistaPermitida(S, 'movimientos')).toBe(false);
    expect(motivoSinPermiso(S, 'acta')).toMatch(/Custodia de socios/);
  });
  it('con "Modificar inventario" gestiona el catálogo (como el administrador en ese apartado) pero nunca usuarios', () => {
    const S = con('admin');
    aplicarLocal(S, { op: 'guardarRol', args: { id: 'catalogo', nombre: 'Catálogo', descripcion: '', sistema: false, permisos: { 'inventario.modificar': true, 'usuarios.modificar': true } } });
    expect(S.roles!.find(r => r.id === 'catalogo')!.permisos).toMatchObject({ 'inventario.ver': true, 'inventario.modificar': true, 'usuarios.modificar': false });
    S.rol = 'catalogo';
    expect(gestiona(S, 'inventario')).toBe(true);
    expect(motivoSinPermiso(S, 'perfil')).not.toBeNull();
  });
  it('los de sistema no se editan ni se borran; uno en uso no se borra; siempre queda un administrador', () => {
    const S = con('admin');
    expect(() => aplicarLocal(S, { op: 'guardarRol', args: { id: 'almacen', nombre: 'Almacén', descripcion: '', sistema: false, permisos: {} } })).toThrow(/no se modifican/);
    expect(() => aplicarLocal(S, { op: 'borrarRol', args: { id: 'lectura' } })).toThrow(/no se borran/);
    aplicarLocal(S, { op: 'guardarRol', args: { id: 'temporal', nombre: 'Temporal', descripcion: '', sistema: false, permisos: {} } });
    S.perfiles = [{ id: 'u1', nombre: 'Uno', email: null, rol: 'admin', activo: true }, { id: 'u2', nombre: 'Dos', email: null, rol: 'temporal', activo: true }];
    expect(() => aplicarLocal(S, { op: 'borrarRol', args: { id: 'temporal' } })).toThrow(/lo usa 1 usuario/);
    expect(() => aplicarLocal(S, { op: 'perfil', args: { id: 'u1', nombre: 'Uno', rol: 'lectura', activo: true } })).toThrow(/al menos un administrador/);
    expect(S.perfiles[0].rol).toBe('admin');                                          // no se cambió nada
  });
});

describe('probar como este rol', () => {
  it('el administrador ve la app como ese rol y ejecutar() no modifica nada', () => {
    const S = almacen.get(); S.rol = 'admin';
    simularRol('lectura');
    expect(vistaPermitida(S, 'stock')).toBe(true);
    expect(puede(S, 'configuracion')).toBe(false);
    const antes = S.movements.length;
    expect(ejecutar({ op: 'movimiento', args: { id: 'x', sku: 'CAB-RZ1K-5G6', type: 'salida', qty: 1, reason: 'Obra', ref: 'P', serials: [] } } as never)).toBe(false);
    expect(S.movements.length).toBe(antes);
    simularRol(null);
    expect(puede(S, 'configuracion', 'modificar')).toBe(true);
  });
});
