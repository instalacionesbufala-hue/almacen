/* Banco de pruebas de la base de datos: Postgres real (PGlite) con las migraciones de supabase/migrations
   y un "auth" mínimo como el de Supabase (roles anon/authenticated y auth.uid()). */
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const DIR = new URL('../', import.meta.url);
const leer = (rel: string) => readFileSync(new URL(rel, DIR), 'utf8');

const AUTH_SUPABASE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

export const ADMIN = '00000000-0000-4000-8000-000000000001';
export const ALMACEN = '00000000-0000-4000-8000-000000000002';
export const INACTIVO = '00000000-0000-4000-8000-000000000003';

/** intercalar: ejecuta un SQL (p. ej. datos de una versión anterior) justo antes de la primera migración >= antesDe,
    para probar una migración sobre una base que ya estaba en uso */
export async function nuevaBD({ seed = true, intercalar }: { seed?: boolean; intercalar?: { antesDe: string; sql: string } } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(AUTH_SUPABASE);
  let pendiente = intercalar;
  for (const f of readdirSync(new URL('migrations/', DIR)).filter(f => f.endsWith('.sql')).sort()) {
    if (pendiente && f >= pendiente.antesDe) { await db.exec(pendiente.sql); pendiente = undefined; }
    try { await db.exec(leer(`migrations/${f}`)); }
    catch (e) { throw new Error(`Error en la migración ${f}: ${(e as Error).message}`); }
  }
  if (seed) await db.exec(leer('seed.sql'));
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'admin@x.es'), ('${ALMACEN}', 'almacen@x.es'), ('${INACTIVO}', 'baja@x.es');
    insert into public.perfiles (id, nombre, rol, activo) values
      ('${ADMIN}', 'Admin Pruebas', 'admin', true), ('${ALMACEN}', 'Operario Pruebas', 'almacen', true), ('${INACTIVO}', 'De Baja', 'almacen', false);
  `);
  return db;
}

export type BD = Awaited<ReturnType<typeof nuevaBD>>;
export { leer };

/** Actúa como un usuario con sesión (rol authenticated de Supabase) */
export async function como(db: BD, uid: string) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
}
/** Actúa como visitante sin sesión (clave anon) */
export async function anonimo(db: BD) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`);
}
/** Vuelve a superusuario (panel de Supabase / migraciones) */
export async function superusuario(db: BD) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}

export async function valor<T = unknown>(db: BD, sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<Record<string, T>>(sql, params);
  const fila = r.rows[0]; return fila ? Object.values(fila)[0] : (undefined as T);
}
export async function falla(db: BD, sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); } catch (e) { return (e as Error).message; }
  throw new Error(`Se esperaba un error y no lo hubo: ${sql}`);
}
export const uuid = () => crypto.randomUUID();
