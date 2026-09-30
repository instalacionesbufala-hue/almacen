/* E-014 · Portal del técnico: token, hash, ruta y datos (demostración) */
import { describe, expect, it } from 'vitest';
import { fresh } from '../data/semilla';
import { aplicarLocal } from '../store/ops';
import { datosPortalLocal, enlacePortal, generarToken, hashToken, tokenDeRuta } from './portal';
import { conFotosFirmadas, fotosDelPortal, TOKEN_RE } from '../../supabase/functions/_compartido/portal';

describe('token del enlace', () => {
  it('32 bytes aleatorios (43 caracteres base64url), distintos cada vez', () => {
    const a = generarToken(), b = generarToken();
    expect(a).toMatch(TOKEN_RE);
    expect(a).not.toBe(b);
  });
  it('del token solo se guarda el SHA-256', async () => {
    expect(await hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await hashToken(generarToken())).toMatch(/^[0-9a-f]{64}$/);
  });
  it('ruta #/tecnico/<token> y enlace completo', () => {
    const t = generarToken();
    expect(tokenDeRuta(`#/tecnico/${t}`)).toBe(t);
    expect(tokenDeRuta('#/tecnico/corto')).toBeNull();
    expect(tokenDeRuta('#stock')).toBeNull();
    expect(enlacePortal(t, { origin: 'https://instalacionesbufala-hue.github.io', pathname: '/almacen/' })).toBe(`https://instalacionesbufala-hue.github.io/almacen/#/tecnico/${t}`);
  });
});

describe('datos del portal (demostración)', () => {
  it('solo las entregas firmadas de ESE técnico y el material del vehículo de su equipo', () => {
    const S = fresh();
    const d = datosPortalLocal(S, 'T1')!;
    expect(d.tecnico).toMatchObject({ id: 'T1', nombre: 'Luis Martín' });
    expect(d.entregas.length).toBeGreaterThan(0);
    const ids = new Set(S.entregas.filter(e => e.receptor === 'T1').map(e => e.id));
    expect(d.entregas.every(e => ids.has(e.id))).toBe(true);
    expect(d.vehiculo?.matricula).toBe('0000-DEM');
    expect(d.a_bordo.find(a => a.sku === 'CAB-RZ1K-5G6')).toMatchObject({ unidades: 150, unidad: 'm' });
    expect(JSON.stringify(d)).not.toMatch(/€|precio|price/i);
    const otro = datosPortalLocal(S, 'T3')!;
    expect(otro.entregas.some(e => ids.has(e.id))).toBe(false);
  });
  it('enlaces: se crean con el hash, el administrador los revoca y las copias solo son de entregas firmadas', async () => {
    const S = fresh(); S.rol = 'almacen';
    const hash = await hashToken(generarToken());
    aplicarLocal(S, { op: 'enlacePortal', args: { tecnico: 'T1', hash } });
    aplicarLocal(S, { op: 'enlacePortal', args: { tecnico: 'T1', hash } });        // reintento
    expect(S.portalEnlaces.filter(e => e.hash === hash)).toHaveLength(1);
    expect(() => aplicarLocal(S, { op: 'revocarPortal', args: { tecnico: 'T1' } })).toThrow(/administrador/);
    S.rol = 'admin';
    aplicarLocal(S, { op: 'revocarPortal', args: { tecnico: 'T1' } });
    expect(S.portalEnlaces.every(e => e.revocado)).toBe(true);
    const firmada = S.entregas.find(e => (e.estado ?? 'firmada') === 'firmada')!;
    aplicarLocal(S, { op: 'copiaEntrega', args: { id: 'c1', entrega: firmada.id, canal: 'whatsapp', destino: '+34600123456' } });
    expect(S.copias[0]).toMatchObject({ entrega: firmada.id, canal: 'whatsapp', destino: '+34600123456' });
    aplicarLocal(S, { op: 'telefonoTecnico', args: { tecnico: 'T2', telefono: '600 11 22 33' } });
    expect(S.tecnicos.find(t => t.id === 'T2')!.telefono).toBe('+34600112233');
    expect(() => aplicarLocal(S, { op: 'telefonoTecnico', args: { tecnico: 'T2', telefono: '123' } })).toThrow(/Teléfono no válido/);
  });
  it('las fotos se sustituyen por su URL firmada', () => {
    const d = { tecnico: { id: 'T1', nombre: 'x', equipo: null }, vehiculo: null,
      entregas: [{ id: 'e', numero: 'n', fecha: '', obra: '', equipo: null, vehiculo: null, lineas: [{ nombre: 'a', codigo: 'A', cantidad: 1, unidad: 'ud', foto: 'productos/A/1-mini.webp' }] }],
      a_bordo: [{ sku: 'A', nombre: 'a', unidad: 'ud', contenido: 1, unidades: 2, foto: 'productos/A/1-mini.webp' }, { sku: 'B', nombre: 'b', unidad: 'ud', contenido: 1, unidades: 1, foto: null }] };
    expect(fotosDelPortal(d)).toEqual(['productos/A/1-mini.webp']);
    const f = conFotosFirmadas(d, { 'productos/A/1-mini.webp': 'https://firmada' });
    expect(f.entregas[0].lineas[0].foto).toBe('https://firmada');
    expect(f.a_bordo.map(a => a.foto)).toEqual(['https://firmada', null]);
  });
});
