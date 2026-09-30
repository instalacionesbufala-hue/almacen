/* E-013 · Importación del catálogo real desde CSV (datos/catalogo-stock-real.csv).
   Cabecera: sku;ref_proveedor;nombre;categoria;propiedad;propietario;proveedor;unidad;contenido_unidad;stock_inicial;minimo;albaranes
   La vista previa separa lo nuevo de lo que ya existe y marca los errores (unidad o categoría desconocida…) antes de importar nada. */
import { CATS, UNIDADES } from '../data/catalogo';
import type { CatId, Estado, Unidad } from '../data/tipos';
import type { FilaCatalogo } from '../store/ops';

export const CABECERA_CATALOGO = ['sku', 'ref_proveedor', 'nombre', 'categoria', 'propiedad', 'propietario', 'proveedor', 'unidad', 'contenido_unidad', 'stock_inicial', 'minimo', 'albaranes'] as const;

export interface FilaVista { linea: number; fila: FilaCatalogo; estado: 'nuevo' | 'existe'; errores: string[] }
export interface VistaCatalogo { filas: FilaVista[]; errorGeneral?: string; nuevos: number; existentes: number; conError: number }

/** Divide una línea CSV respetando comillas ("a;b" es un solo campo) */
function campos(linea: string, sep: string): string[] {
  const out: string[] = []; let cur = '', q = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (q) { if (c === '"' && linea[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

/** "1000 ud" → 1000 · "10 bolsas" → 10 · "2,5" → 2.5 · "" → null */
export function cifraCsv(v: string): number | null {
  const m = v.replace(/\s/g, '').match(/^-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  return Number(m[0].replace(',', '.'));
}

export function parsearCatalogo(texto: string, S: Pick<Estado, 'products' | 'propietarios'>): VistaCatalogo {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/);
  const primera = lineas.findIndex(l => l.trim());
  if (primera < 0) return { filas: [], errorGeneral: 'El archivo está vacío', nuevos: 0, existentes: 0, conError: 0 };
  const sep = lineas[primera].includes(';') ? ';' : ',';
  const cab = campos(lineas[primera], sep).map(c => c.toLowerCase());
  const falta = CABECERA_CATALOGO.filter(c => !cab.includes(c));
  if (falta.length) return { filas: [], errorGeneral: `Faltan columnas en la cabecera: ${falta.join(', ')}`, nuevos: 0, existentes: 0, conError: 0 };
  const col = (vals: string[], k: typeof CABECERA_CATALOGO[number]) => vals[cab.indexOf(k)] ?? '';
  const existentes = new Set(S.products.map(p => p.sku.toUpperCase()));
  const vistos = new Set<string>();
  const filas: FilaVista[] = [];
  for (let i = primera + 1; i < lineas.length; i++) {
    if (!lineas[i].trim()) continue;
    const v = campos(lineas[i], sep), errores: string[] = [];
    const sku = col(v, 'sku').toUpperCase();
    const unidad = (col(v, 'unidad').toLowerCase() || 'ud') as Unidad;
    const categoria = col(v, 'categoria').toLowerCase() as CatId;
    const propiedad = col(v, 'propiedad').toLowerCase() === 'custodia' ? 'custodia' : 'propia';
    const propietario = col(v, 'propietario');
    const contenido = cifraCsv(col(v, 'contenido_unidad')) ?? 1;
    const stock = cifraCsv(col(v, 'stock_inicial')) ?? 0;
    const minimo = cifraCsv(col(v, 'minimo'));
    if (!sku) errores.push('Falta el SKU');
    else if (vistos.has(sku)) errores.push('SKU repetido en el archivo');
    if (!col(v, 'nombre')) errores.push('Falta el nombre');
    if (!UNIDADES.includes(unidad)) errores.push(`Unidad desconocida: ${unidad}`);
    if (!(categoria in CATS)) errores.push(`Categoría desconocida: ${categoria || '(vacía)'}`);
    if (propiedad === 'custodia' && !S.propietarios.some(o => o.id.toUpperCase() === propietario.toUpperCase() || o.nombre.toLowerCase() === propietario.toLowerCase()))
      errores.push(`Propietario desconocido: ${propietario || '(vacío)'}`);
    if (!(contenido > 0)) errores.push('El contenido debe ser mayor que cero');
    if (stock < 0 || (minimo !== null && minimo < 0)) errores.push('Cantidades negativas');
    if (unidad !== 'm' && stock !== Math.trunc(stock)) errores.push(`El stock inicial va en ${unidad} enteros`);
    if (sku) vistos.add(sku);
    filas.push({
      linea: i + 1, estado: existentes.has(sku) ? 'existe' : 'nuevo', errores,
      fila: { sku, ref_proveedor: col(v, 'ref_proveedor'), nombre: col(v, 'nombre'), categoria, propiedad, propietario, proveedor: col(v, 'proveedor'), unidad,
        contenido: unidad === 'm' || unidad === 'ud' ? 1 : contenido, stock_inicial: stock, minimo, albaranes: col(v, 'albaranes') },
    });
  }
  return { filas, nuevos: filas.filter(f => f.estado === 'nuevo' && !f.errores.length).length, existentes: filas.filter(f => f.estado === 'existe' && !f.errores.length).length,
    conError: filas.filter(f => f.errores.length).length };
}
