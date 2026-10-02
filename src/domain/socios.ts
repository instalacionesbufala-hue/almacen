/* E-024 · Socios de custodia (Esmove, Instant Box y los que vengan): material que no es nuestro, por socio */
import type { Estado, Producto, Propietario } from '../data/tipos';
import { norm } from './formato';
import { stockTotal } from './reglas';

/** Colores de la etiqueta de cada socio (clases de Tailwind ya usadas en la app) */
export const COLORES_SOCIO: Record<string, { t: string; c: string; barra: string }> = {
  violeta: { t: 'Violeta', c: 'bg-violet-100 text-violet-800', barra: 'bg-violet-500' },
  naranja: { t: 'Naranja', c: 'bg-orange-100 text-orange-800', barra: 'bg-orange-500' },
  verde: { t: 'Verde', c: 'bg-emerald-100 text-emerald-800', barra: 'bg-emerald-500' },
  azul: { t: 'Azul', c: 'bg-sky-100 text-sky-800', barra: 'bg-sky-500' },
  rosa: { t: 'Rosa', c: 'bg-pink-100 text-pink-800', barra: 'bg-pink-500' },
};
export const colorSocio = (o?: Pick<Propietario, 'color'>) => COLORES_SOCIO[o?.color || 'violeta'] || COLORES_SOCIO.violeta;

export const sociosActivos = (E: Pick<Estado, 'propietarios'>) => E.propietarios.filter(o => o.activo !== false);
export const socioDe = (E: Pick<Estado, 'propietarios'>, p: Pick<Producto, 'propiedad' | 'propietario'>) =>
  p.propiedad === 'custodia' ? E.propietarios.find(o => o.id === p.propietario) : undefined;
export const nombreSocio = (E: Pick<Estado, 'propietarios'>, id?: string) => E.propietarios.find(o => o.id === id)?.nombre || id || '';

/** Socio que se propone al dar de alta material en custodia: el que ya tenga, o el único activo; si hay varios, ninguno (se elige) */
export function socioInicial(E: Pick<Estado, 'propietarios'>, actual?: string) {
  if (actual && E.propietarios.some(o => o.id === actual)) return actual;
  const a = sociosActivos(E);
  return a.length === 1 ? a[0].id : '';
}

/** Identificador de un socio nuevo a partir de su nombre ("Instant Box" → INSTANTBOX), sin repetir */
export function idSocio(nombre: string, existentes: string[]) {
  const base = norm(nombre).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) || 'SOCIO';
  const usados = new Set(existentes.map(x => x.toUpperCase()));
  if (!usados.has(base)) return base;
  for (let i = 2; ; i++) if (!usados.has(`${base}${i}`)) return `${base}${i}`;
}

/** Se puede desactivar un socio solo si no le queda material: ningún artículo suyo en el catálogo */
export function motivoNoDesactivar(E: Pick<Estado, 'products'>, id: string) {
  const suyos = E.products.filter(p => p.propiedad === 'custodia' && p.propietario === id);
  return suyos.length ? `Tiene ${suyos.length} artículo${suyos.length === 1 ? '' : 's'} en custodia. Pásalos a otro socio o a material propio antes de desactivarlo.` : null;
}

/** Validación del socio antes de guardarlo (misma regla que el servidor) */
export function validarSocio(E: Pick<Estado, 'products' | 'propietarios'>, o: Propietario) {
  if (!o.id.trim()) throw new Error('Falta el identificador del socio');
  if (!o.nombre.trim()) throw new Error('Pon el nombre del socio');
  if (E.propietarios.some(x => x.id !== o.id && norm(x.nombre) === norm(o.nombre))) throw new Error(`Ya hay un socio llamado ${o.nombre.trim()}`);
  const malos = [...o.correosReposicion, ...o.correosInformes].filter(c => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c));
  if (malos.length) throw new Error(`Correo no válido: ${malos[0]}`);
  if (o.activo === false) { const m = motivoNoDesactivar(E, o.id); if (m) throw new Error(m); }
}

/** Total en custodia (almacén + vehículos) y desglose por socio, para el recuadro del inventario */
export function desgloseCustodia(E: Estado) {
  const filas = E.propietarios.map(o => {
    const ps = E.products.filter(p => p.propiedad === 'custodia' && p.propietario === o.id);
    return { id: o.id, nombre: o.nombre, color: o.color, activo: o.activo !== false, refs: ps.length, unidades: Math.round(ps.reduce((a, p) => a + stockTotal(E, p), 0) * 1000) / 1000 };
  }).filter(f => f.activo || f.refs);
  return { total: Math.round(filas.reduce((a, f) => a + f.unidades, 0) * 1000) / 1000, refs: filas.reduce((a, f) => a + f.refs, 0), socios: filas };
}

/** Material en custodia: hay que elegir el socio, y debe estar activo (salvo que ya lo tuviera de antes) */
export function exigirSocioActivo(E: Pick<Estado, 'propietarios'>, p: Pick<Producto, 'propiedad' | 'propietario'>, antes?: Pick<Producto, 'propiedad' | 'propietario'>) {
  if (p.propiedad !== 'custodia') return;
  if (!p.propietario) throw new Error('Elige de qué socio es el material en custodia');
  const o = E.propietarios.find(x => x.id === p.propietario);
  if (!o) throw new Error(`Socio de custodia desconocido: ${p.propietario}`);
  const igual = antes?.propiedad === 'custodia' && antes.propietario === p.propietario;
  if (o.activo === false && !igual) throw new Error(`El socio ${o.nombre} está desactivado: actívalo en Configuración → Socios de custodia o elige otro`);
}
