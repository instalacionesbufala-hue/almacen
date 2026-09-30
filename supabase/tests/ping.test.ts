/* Mantener activo el proyecto: ping() sin sesión, sin dar acceso a ningún dato */
import { beforeAll, describe, expect, it } from 'vitest';
import { anonimo, falla, nuevaBD, valor, type BD } from './pg';

describe('ping para la tarea de copias', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); await anonimo(db); });
  it('sin sesión responde true y sigue sin poder leer tablas', async () => {
    expect(await valor<boolean>(db, 'select public.ping()')).toBe(true);
    expect(await falla(db, 'select id from public.propietarios')).toMatch(/permission denied/);
  });
});
