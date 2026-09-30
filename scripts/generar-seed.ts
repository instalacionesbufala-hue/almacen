/* Genera supabase/seed.sql a partir de los datos de demostración de la app (src/data).
   Uso: npm run seed:sql
   Solo datos maestros y stock actual: el historial (movimientos, entregas) empieza vacío en la nube. */
import { writeFileSync } from 'node:fs';
import { SEED_EQUIPOS, SEED_PRODUCTS, SEED_TECNICOS, SEED_VEHICULOS } from '../src/data/catalogo';
import { seedABordo, seedHerramientas } from '../src/data/semilla';

const q = (v: unknown): string => v === undefined || v === null || v === '' ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const filas = (xs: string[]) => xs.join(',\n') + ';\n';
const out: string[] = ['-- Generado por scripts/generar-seed.ts · datos de DEMOSTRACIÓN inventados (E-013: sin precios ni n.º de serie; se borran con "Borrar datos de ejemplo")', 'begin;', ''];

out.push('insert into public.equipos (id, nombre, estado) values');
out.push(filas(SEED_EQUIPOS.map(e => `(${q(e.id)}, ${q(e.nombre)}, ${q(e.estado)})`)));
out.push('insert into public.vehiculos (id, matricula, modelo, equipo_id) values');
out.push(filas(SEED_VEHICULOS.map(v => `(${q(v.id)}, ${q(v.matricula)}, ${q(v.modelo)}, ${q(v.equipo)})`)));
out.push("insert into public.asignaciones_vehiculo (vehiculo_id, equipo_id, desde) select id, equipo_id, now() - interval '90 days' from public.vehiculos where equipo_id is not null;");

out.push('insert into public.tecnicos (id, nombre, rol, dni_mascara, equipo_id, email) values');
out.push(filas(SEED_TECNICOS.map(t => `(${q(t.id)}, ${q(t.nombre)}, ${q(t.rol)}, ${q(t.dni)}, ${q(SEED_EQUIPOS.find(e => e.tecnicos.includes(t.id))?.id)}, ${q(t.email)})`)));
out.push("insert into public.asignaciones_tecnico (tecnico_id, equipo_id, desde) select id, equipo_id, now() - interval '90 days' from public.tecnicos where equipo_id is not null;");

out.push('insert into public.productos (sku, ean, ref_proveedor, nombre, categoria, unidad, contenido, formato_texto, stock, minimo, proveedor, propiedad, propietario_id, modelo, talla) values');
out.push(filas(SEED_PRODUCTS.map(p => `(${q(p.sku)}, ${q(p.ean)}, ${q(p.supplierRef)}, ${q(p.name)}, ${q(p.cat)}, ${q(p.unit)}, ${q(p.contenido || 1)}, ${p.packLabel ? q(p.packLabel) : "''"}, ${q(p.stock)}, ${q(p.min)}, ${q(p.supplier)}, ${q(p.propiedad || 'propia')}, ${q(p.propiedad === 'custodia' ? p.propietario : null)}, ${q(p.modelo)}, ${q(p.talla)})`)));
out.push('update public.config_app set modo_demo = true where id = 1;   -- datos de ejemplo: se pueden borrar una vez desde Configuración');
out.push('insert into public.stock_vehiculo (vehiculo_id, sku, unidades) values');
out.push(filas(seedABordo().map(x => `(${q(x.vehiculo)}, ${q(x.sku)}, ${q(x.unidades)})`)));

const dot = seedHerramientas();
out.push('insert into public.dotacion (id, clase, nombre, marca, modelo, serie, talla, cantidad, caduca, estado, equipo_id, tecnico_id) values');
out.push(filas(dot.map(h => `(${q(h.id)}, ${q(h.clase)}, ${q(h.nombre)}, ${q(h.marca)}, ${q(h.modelo)}, ${q(h.serie) === 'null' ? "''" : q(h.serie)}, ${q(h.talla)}, ${q(h.cantidad)}, ${q(h.caduca)}, ${q(h.estado)}, ${q(h.equipo)}, ${q(h.tecnico)})`)));
out.push("insert into public.dotacion_historial (id, dotacion_id, tipo, nota, operario) select gen_random_uuid(), id, 'alta', 'Alta inicial (datos de demostración)', 'Sistema' from public.dotacion;");
out.push("insert into public.minimos_herramienta (modelo, minimo, proveedor) values ('Makita DDF484', 1, 'Saltoki Alcobendas');");
out.push('', 'commit;', '');

writeFileSync(new URL('../supabase/seed.sql', import.meta.url), out.join('\n'));
console.log('supabase/seed.sql generado');
