/* Genera supabase/seed.sql a partir de los datos de demostración de la app (src/data).
   Uso: npm run seed:sql
   Solo datos maestros y stock actual: el historial (movimientos, entregas) empieza vacío en la nube. */
import { writeFileSync } from 'node:fs';
import { SEED_EQUIPOS, SEED_PRODUCTS, SEED_TECNICOS } from '../src/data/catalogo';
import { seedHerramientas } from '../src/data/semilla';

const q = (v: unknown): string => v === undefined || v === null || v === '' ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const filas = (xs: string[]) => xs.join(',\n') + ';\n';
const out: string[] = ['-- Generado por scripts/generar-seed.ts · datos de DEMOSTRACIÓN (se sustituirán por los reales)', 'begin;', ''];

out.push('insert into public.equipos (id, nombre, flota, matricula, estado) values');
out.push(filas(SEED_EQUIPOS.map(e => `(${q(e.id)}, ${q(e.nombre)}, ${q(e.flota)}, ${q(e.matricula)}, ${q(e.estado)})`)));

out.push('insert into public.tecnicos (id, nombre, rol, dni_mascara, equipo_id) values');
out.push(filas(SEED_TECNICOS.map(t => `(${q(t.id)}, ${q(t.nombre)}, ${q(t.rol)}, ${q(t.dni)}, ${q(SEED_EQUIPOS.find(e => e.tecnicos.includes(t.id))?.id)})`)));

out.push('insert into public.productos (sku, ean, ref_proveedor, nombre, categoria, unidad, formato, formato_texto, stock, minimo, ubicacion, proveedor, con_serie, propiedad, propietario_id, modelo, talla) values');
out.push(filas(SEED_PRODUCTS.map(p => `(${q(p.sku)}, ${q(p.ean)}, ${q(p.supplierRef)}, ${q(p.name)}, ${q(p.cat)}, ${q(p.unit)}, ${q(p.pack || 1)}, ${q(p.packLabel || '')}, ${q(p.stock)}, ${q(p.min)}, ${q(p.loc)}, ${q(p.supplier)}, ${q(!!p.serialized)}, ${q(p.propiedad || 'propia')}, ${q(p.propiedad === 'custodia' ? p.propietario : null)}, ${q(p.modelo)}, ${q(p.talla)})`)));

out.push('insert into public.costes_producto (sku, precio) values');
out.push(filas(SEED_PRODUCTS.map(p => `(${q(p.sku)}, ${p.propiedad === 'custodia' ? 'null' : q(p.price)})`)));

const series = SEED_PRODUCTS.flatMap(p => (p.serials || []).map(s => `(${q(p.sku)}, ${q(s)}, true)`));
if (series.length) { out.push('insert into public.series (sku, serie, en_stock) values'); out.push(filas(series)); }

const dot = seedHerramientas();
out.push('insert into public.dotacion (id, clase, nombre, marca, modelo, serie, talla, cantidad, caduca, estado, equipo_id, tecnico_id) values');
out.push(filas(dot.map(h => `(${q(h.id)}, ${q(h.clase)}, ${q(h.nombre)}, ${q(h.marca)}, ${q(h.modelo)}, ${q(h.serie) === 'null' ? "''" : q(h.serie)}, ${q(h.talla)}, ${q(h.cantidad)}, ${q(h.caduca)}, ${q(h.estado)}, ${q(h.equipo)}, ${q(h.tecnico)})`)));
out.push('insert into public.costes_dotacion (id, valor) values');
out.push(filas(dot.map(h => `(${q(h.id)}, ${q(h.valor)})`)));
out.push("insert into public.dotacion_historial (id, dotacion_id, tipo, nota, operario) select gen_random_uuid(), id, 'alta', 'Alta inicial (datos de demostración)', 'Sistema' from public.dotacion;");
out.push("insert into public.minimos_herramienta (modelo, minimo, proveedor) values ('Makita DDF484', 1, 'Saltoki Alcobendas');");
out.push('', 'commit;', '');

writeFileSync(new URL('../supabase/seed.sql', import.meta.url), out.join('\n'));
console.log('supabase/seed.sql generado');
