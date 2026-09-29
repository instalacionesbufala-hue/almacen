/* Validaciones de las funciones de servidor (la parte que no depende de Deno) */
import { describe, expect, it } from 'vitest';
import { origenPermitido, validarAlta, validarBloqueo, validarClave } from '../functions/_compartido/validar';

describe('alta de usuarios', () => {
  it('exige correo, nombre, rol válido y contraseña segura', () => {
    expect(validarAlta({ email: 'mal', nombre: 'A', rol: 'almacen', clave: 'abcdefghij1' })).toMatch(/Correo/);
    expect(validarAlta({ email: 'a@b.es', nombre: ' ', rol: 'almacen', clave: 'abcdefghij1' })).toMatch(/nombre/);
    expect(validarAlta({ email: 'a@b.es', nombre: 'A', rol: 'jefe' as 'admin', clave: 'abcdefghij1' })).toMatch(/Rol/);
    expect(validarAlta({ email: 'a@b.es', nombre: 'A', rol: 'almacen', clave: 'abcdefghij1' })).toBeNull();
  });
  it('contraseñas de al menos 10 caracteres con letras y números', () => {
    expect(validarClave('corta1')).toMatch(/10/);
    expect(validarClave('soloLetrasLargas')).toMatch(/números/);
    expect(validarClave('almacen2026bufala')).toBeNull();
  });
});

describe('E-010 · bloqueo en Auth (misma regla que actualizar_perfil)', () => {
  const base = { llamante: 'A1', adminsActivos: ['A1', 'A2'] };
  it('rechaza bloquearse a sí mismo', () => {
    expect(validarBloqueo({ ...base, objetivo: 'A1', activar: false })).toMatch(/ti mismo/);
  });
  it('rechaza bloquear al último administrador activo', () => {
    expect(validarBloqueo({ llamante: 'A1', objetivo: 'A2', activar: false, adminsActivos: ['A2'] })).toMatch(/al menos un administrador/);
    // el perfil ya viene desactivado por actualizar_perfil: tampoco puede quedar sin nadie
    expect(validarBloqueo({ llamante: 'A1', objetivo: 'A2', activar: false, adminsActivos: [] })).toMatch(/al menos un administrador/);
  });
  it('permite bloquear a otro admin si queda alguno, a un usuario de almacén, y siempre desbloquear', () => {
    expect(validarBloqueo({ ...base, objetivo: 'A2', activar: false })).toBeNull();
    expect(validarBloqueo({ ...base, objetivo: 'U9', activar: false })).toBeNull();
    expect(validarBloqueo({ llamante: 'A1', objetivo: 'A1', activar: true, adminsActivos: [] })).toBeNull();
  });
});

describe('E-010 · CORS solo para el origen de la app', () => {
  const APP = 'https://instalacionesbufala-hue.github.io';
  it('acepta el origen configurado y localhost', () => {
    expect(origenPermitido(APP, APP + '/')).toBe(APP);
    expect(origenPermitido(APP, 'https://otro.es, ' + APP)).toBe(APP);
    expect(origenPermitido('http://localhost:5173', undefined)).toBe('http://localhost:5173');
    expect(origenPermitido('http://127.0.0.1:4173', APP)).toBe('http://127.0.0.1:4173');
  });
  it('rechaza cualquier otro origen', () => {
    expect(origenPermitido('https://malicioso.es', APP)).toBeNull();
    expect(origenPermitido('https://instalacionesbufala-hue.github.io.malicioso.es', APP)).toBeNull();
    expect(origenPermitido('http://localhost.malicioso.es', APP)).toBeNull();
    expect(origenPermitido(null, APP)).toBeNull();
  });
});
