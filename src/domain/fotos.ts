/* E-009 · Fotos de los artículos: reglas puras (sin navegador), probadas en fotos.test.ts */
import type { Estado, Herramienta, OrigenFoto, Producto, Rol } from '../data/tipos';

export const ORIGENES_FOTO: OrigenFoto[] = ['propia', 'Saltoki', 'Esmove', 'fabricante'];
export const BUCKET_FOTOS = 'fotos-articulos';

/** Artículos que comparten la foto: el propio y, si tiene modelo (ropa y EPIs por tallas), todas las tallas del modelo */
export function grupoFoto(S: Pick<Estado, 'products'>, sku: string): Producto[] {
  const p = S.products.find(x => x.sku === sku);
  if (!p) return [];
  return p.modelo ? S.products.filter(x => x.sku === p.sku || x.modelo === p.modelo) : [p];
}

/** Foto que se muestra para un artículo: la suya o la de otra talla del mismo modelo */
export function fotoDe(S: Pick<Estado, 'products'>, p: Producto | undefined): { foto: string; mini: string } | null {
  if (!p) return null;
  const con = p.foto && p.fotoMini ? p : grupoFoto(S, p.sku).find(x => x.foto && x.fotoMini);
  return con ? { foto: con.foto!, mini: con.fotoMini! } : null;
}

/** Foto de una herramienta, EPI o prenda asignada: la del artículo del catálogo de su modelo, si lo hay */
export function fotoDeHerramienta(S: Pick<Estado, 'products'>, h: Pick<Herramienta, 'modelo' | 'nombre'>): { foto: string; mini: string } | null {
  const clave = h.modelo || h.nombre;
  const p = S.products.find(x => x.sku === clave || (x.modelo && x.modelo === clave));
  return fotoDe(S, p);
}

/** Qué puede hacer el usuario con la foto: el almacén solo añade si no hay; sustituir y quitar es del administrador */
export function permisoFoto(S: Pick<Estado, 'products'>, rol: Rol, p: Producto): { poner: boolean; sustituir: boolean; quitar: boolean } {
  const tiene = !!fotoDe(S, p);
  const admin = rol === 'admin';
  return { poner: !tiene, sustituir: tiene && admin, quitar: tiene && admin };
}

/** E-021: carpeta de las fotos de un SKU. Lo que no sea A-Z0-9._- va como !HH (cada byte UTF-8), igual que _clave_sku() en el servidor.
    Para un SKU válido es el propio SKU, así que las fotos ya subidas no cambian de ruta. */
export function claveSku(sku: string): string {
  let r = '';
  for (const c of sku.toUpperCase()) r += /^[A-Z0-9._-]$/.test(c) ? c : [...new TextEncoder().encode(c)].map(b => '!' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
  return r;
}

/** Rutas nuevas en el bucket: productos/<clave del SKU>/<marca>.webp y su miniatura. La marca evita cachés viejas al sustituir */
export function rutasFoto(sku: string, ext: 'webp' | 'jpg', marca = Date.now().toString(36)): { foto: string; mini: string } {
  const base = `productos/${claveSku(sku)}/${marca.replace(/[^A-Za-z0-9_]/g, '')}`;
  return { foto: `${base}.${ext}`, mini: `${base}-mini.${ext}` };
}

/* ---------- Importación por lote (administrador) ---------- */
const limpiar = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '');
/** Nombre de archivo sin carpeta ni extensiones (6040615306.webp, 6040615306.JPG, fotos/6040615306.foto.png…) */
export function claveArchivo(nombre: string): string {
  const base = nombre.split(/[\\/]/).pop() || '';
  return limpiar(base.replace(/(\.(webp|jpe?g|png|gif|heic|heif|avif|bmp|tiff?))+$/i, '').replace(/\.foto$/i, ''));
}

/** Empareja un archivo con un artículo por SKU, código del proveedor (supplierRef) o EAN, sin distinguir mayúsculas */
export function emparejarArchivo(nombre: string, productos: Producto[]): { sku: string; por: 'SKU' | 'ref. proveedor' | 'EAN' } | null {
  const c = claveArchivo(nombre);
  if (!c) return null;
  const eq = (v?: string) => !!v && limpiar(v) === c;
  const porSku = productos.find(p => eq(p.sku));
  if (porSku) return { sku: porSku.sku, por: 'SKU' };
  const porRef = productos.find(p => eq(p.supplierRef));
  if (porRef) return { sku: porRef.sku, por: 'ref. proveedor' };
  const porEan = productos.find(p => eq(p.ean));
  if (porEan) return { sku: porEan.sku, por: 'EAN' };
  return null;
}

export interface Asignacion { archivo: string; sku: string | null; por?: string; estado: 'nueva' | 'sustituye' | 'sin-pareja' | 'repetida' | 'no-imagen' }
/** Vista previa de la importación: qué archivo va a qué artículo, cuáles no casan y cuáles sustituirían una foto */
export function planImportacion(archivos: { name: string; type?: string }[], S: Pick<Estado, 'products'>): Asignacion[] {
  const vistos = new Set<string>();
  return archivos.map(f => {
    if (f.type && !/^image\//.test(f.type)) return { archivo: f.name, sku: null, estado: 'no-imagen' as const };
    const m = emparejarArchivo(f.name, S.products);
    if (!m) return { archivo: f.name, sku: null, estado: 'sin-pareja' as const };
    // una foto por modelo: dos archivos para el mismo artículo (o para tallas del mismo modelo) → vale el primero
    const grupo = grupoFoto(S, m.sku).map(p => p.sku).sort().join('|');
    if (vistos.has(grupo)) return { archivo: f.name, sku: m.sku, por: m.por, estado: 'repetida' as const };
    vistos.add(grupo);
    const p = S.products.find(x => x.sku === m.sku)!;
    return { archivo: f.name, sku: m.sku, por: m.por, estado: fotoDe(S, p) ? 'sustituye' as const : 'nueva' as const };
  });
}

/** Medidas de la foto reducida: lado mayor ≤ max, sin ampliar nunca */
export function medidas(ancho: number, alto: number, max: number): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(ancho, alto, 1));
  return { w: Math.max(1, Math.round(ancho * k)), h: Math.max(1, Math.round(alto * k)) };
}

/** E-021: artículo al que va una foto que esperaba en la cola: el mismo SKU o, si se le cambió el código o se fusionó, el que lo sustituye.
    null si ya no existe. */
export function destinoDeFoto(S: Pick<Estado, 'products' | 'archivados'>, sku: string): string | null {
  let actual = sku;
  for (let i = 0; i < 6; i++) {
    if (S.products.some(p => p.sku === actual)) return actual;
    const a = S.archivados?.find(p => p.sku === actual);
    if (!a?.fusionadoEn) return null;
    actual = a.fusionadoEn;
  }
  return null;
}
