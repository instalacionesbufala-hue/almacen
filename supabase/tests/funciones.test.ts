/* Validaciones de las funciones de servidor (la parte que no depende de Deno) */
import { describe, expect, it } from 'vitest';
import { validarAlta, validarClave } from '../functions/_compartido/validar';

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
