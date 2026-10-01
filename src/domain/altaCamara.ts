/* E-015 · Alta de artículos con la cámara: reglas puras (duplicados, parecidos, formulario desde la propuesta de la IA y operación que se guarda).
   El administrador crea el artículo directamente; el almacén lo crea como borrador con su stock contado, que se aplica al aprobarlo. */
import type { CatId, ClaseDotacion, Estado, Herramienta, Producto, Rol, Unidad } from '../data/tipos';
import type { Op } from '../store/ops';
import { norm } from './formato';
import { resolveCode } from './reglas';
import { esUrl, motivoSkuNoValido, skuValido } from './codigos';

/** Lo que devuelve la función de servidor "leer-articulo" (supabase/functions/_compartido/articulo.ts) */
export interface PropuestaIA {
  tipo: 'material' | 'herramienta' | 'epi' | 'ropa';
  nombre: string; marca: string; modelo: string; referencia: string; ean: string;
  categoria: CatId | null; unidad: Unidad; contenido: number; talla: string; confianza: number; nota: string;
}

export type TipoAlta = 'material' | 'herramienta' | 'epi' | 'ropa';
export interface FormAlta {
  tipo: TipoAlta;
  sku: string; ean: string; supplierRef: string; name: string; cat: CatId; unit: Unidad; contenido: string;
  stock: string; min: string; supplier: string; marca: string; modelo: string; talla: string; serie: string;
  propiedad: 'propia' | 'custodia'; propietario: string;
}

const EAN = /^\d{8}$|^\d{12,14}$/;
const may = (v?: string) => String(v || '').toUpperCase().replace(/\s/g, '');

/** ¿Ese código ya está en el catálogo? SKU, EAN, código del proveedor, QR BUF: o el código del proveedor con sufijo (etiquetas de Saltoki) */
export function buscarExistente(S: Pick<Estado, 'products'>, codigo: string): Producto | null {
  const c = may(codigo); if (!c) return null;
  const r = resolveCode(S as Estado, codigo); if (r) return r.p;
  return S.products.find(p => [p.sku, p.supplierRef].some(v => v && v.length >= 6 && c.startsWith(may(v)))) ?? null;
}

const palabras = (s: string) => norm(s).replace(/[(),.;:/×x²+-]/g, ' ').split(/\s+/).filter(t => t.length >= 2);
/** Artículos con un nombre parecido ("¿Es alguno de estos?"): comparten al menos la mitad de las palabras */
export function parecidos(S: Pick<Estado, 'products'>, nombre: string, max = 3): Producto[] {
  const a = new Set(palabras(nombre)); if (a.size < 2) return [];
  return S.products.map(p => { const b = palabras(p.name); const comunes = b.filter(t => a.has(t)).length; return { p, sc: comunes / Math.max(3, Math.min(a.size, b.length)) }; })
    .filter(x => x.sc >= 0.5).sort((x, y) => y.sc - x.sc).slice(0, max).map(x => x.p);
}

const aleatorio = () => Math.random().toString(36).slice(2, 7).toUpperCase();

/** Formulario precargado: con la propuesta de la IA, o vacío (alta a mano) con el código leído */
export function formularioInicial(o: { codigo?: string; propuesta?: PropuestaIA | null; tipo?: TipoAlta; propietario?: string; id?: string; skuInterno?: string }): FormAlta {
  const p = o.propuesta, codigo = (o.codigo || '').trim();
  const esEan = EAN.test(codigo);
  const tipo: TipoAlta = o.tipo ?? p?.tipo ?? 'material';
  const cat: CatId = p?.categoria ?? (tipo === 'ropa' ? 'ropa' : tipo === 'epi' ? 'epis' : 'fijaciones');
  // E-021: un código que no sirve como SKU (la URL del QR del fabricante…) no se usa ni como SKU ni como referencia: SKU interno
  const usable = !!codigo && !esUrl(codigo) && skuValido(codigo.toUpperCase().replace(/\s/g, ''));
  const ref = !esEan && usable ? codigo : p?.referencia || '';
  const sku = (ref || (esEan ? codigo : '') || p?.ean || o.skuInterno || `ART-${o.id || aleatorio()}`).toUpperCase().replace(/\s/g, '');
  return {
    tipo, sku, ean: esEan ? codigo : p?.ean || '', supplierRef: ref, name: p?.nombre || '', cat, unit: p?.unidad || (cat === 'cables' || cat === 'tubos' ? 'm' : 'ud'),
    contenido: String(p?.contenido || 1), stock: '0', min: '', supplier: '', marca: p?.marca || '', modelo: p?.modelo || '', talla: p?.talla || '', serie: '',
    propiedad: 'propia', propietario: o.propietario || '',
  };
}

const num = (v: string) => Number(String(v || '').replace(',', '.'));

/** Operación que guarda el alta según el rol. Lanza un error legible si algo no cuadra. */
export type OpAlta = Extract<Op, { op: 'producto' | 'borradorArticulo' | 'altaDotacion' }>;
export function opDeAlta(rol: Rol, f: FormAlta, id: string, operador = ''): OpAlta {
  const nombre = f.name.trim();
  if (!nombre) throw new Error('Indica el nombre del artículo');
  if (f.tipo === 'herramienta') {
    // Herramientas: son fichas de dotación (una por unidad, con su n.º de serie), no stock del catálogo
    if (rol !== 'admin') throw new Error('Las herramientas las da de alta el administrador (fichas de dotación)');
    const h: Herramienta = { id, clase: 'herramienta' as ClaseDotacion, nombre, marca: f.marca.trim(), modelo: [f.marca.trim(), f.modelo.trim()].filter(Boolean).join(' ') || undefined,
      serie: f.serie.trim(), cantidad: 1, valor: 0, estado: 'operativa', historial: [{ id: 'I' + id, ts: Date.now(), tipo: 'alta', nota: 'Alta con la cámara', operator: operador }] };
    return { op: 'altaDotacion', args: h };
  }
  const sku = may(f.sku);
  if (!sku) throw new Error('Falta el código del artículo');
  const malo = motivoSkuNoValido(sku); if (malo) throw new Error(malo);
  const conContenido = f.unit !== 'm' && f.unit !== 'ud';
  const contenido = conContenido ? num(f.contenido) : 1, stock = num(f.stock) || 0;
  if (!(contenido > 0)) throw new Error('Indica cuántas unidades trae cada formato (bote de 1000 → 1000)');
  if (stock < 0) throw new Error('El stock inicial no puede ser negativo');
  if (f.unit !== 'm' && stock !== Math.trunc(stock)) throw new Error(`El stock inicial va en ${f.unit} enteros`);
  const min = f.min.trim() === '' ? null : num(f.min);
  if (min !== null && !(min >= 0)) throw new Error('El mínimo no puede ser negativo');
  const custodia = f.propiedad === 'custodia';
  if (custodia && !f.propietario) throw new Error('Indica de quién es el material en custodia');
  const producto: Producto = {
    sku, name: nombre, cat: f.cat, unit: f.unit, contenido, stock: 0, min: rol === 'admin' ? min ?? 0 : 0, minimoDefinido: rol === 'admin' && min !== null,
    supplier: f.supplier.trim(), ean: f.ean.trim() || undefined, supplierRef: f.supplierRef.trim() || undefined,
    modelo: (f.cat === 'ropa' || f.cat === 'epis') ? f.modelo.trim() || nombre : undefined, talla: f.talla.trim() || undefined,
    propiedad: f.propiedad, propietario: custodia ? f.propietario : undefined,
  };
  return rol === 'admin' ? { op: 'producto', args: { producto, nuevo: true, stockInicial: stock } } : { op: 'borradorArticulo', args: { producto, stockInicial: stock } };
}
