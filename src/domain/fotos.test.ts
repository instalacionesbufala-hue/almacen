import { describe, expect, it } from 'vitest';
import type { Estado, Producto } from '../data/tipos';
import { claveArchivo, emparejarArchivo, fotoDe, fotoDeHerramienta, medidas, permisoFoto, planImportacion, rutasFoto } from './fotos';
import { aplicarLocal } from '../store/ops';

const prod = (x: Partial<Producto> & { sku: string }): Producto => ({ name: x.sku, cat: 'aparamenta', unit: 'ud', stock: 5, min: 1, supplier: 'Saltoki', ...x });
const estado = (): Estado => ({
  products: [
    prod({ sku: 'SAL-DIF-40', supplierRef: '6040615306', ean: '8420000000017' }),
    prod({ sku: 'ESM-CPVE-MONO', supplierRef: 'CP-VE-1F-40', cat: 'cuadros', propiedad: 'custodia', propietario: 'ESMOVE' }),
    prod({ sku: 'ROPA-PANT-42', cat: 'ropa', modelo: 'Pantalón multibolsillos', talla: '42' }),
    prod({ sku: 'ROPA-PANT-44', cat: 'ropa', modelo: 'Pantalón multibolsillos', talla: '44' }),
    prod({ sku: 'CON-FOTO', foto: 'productos/CON-FOTO/a.webp', fotoMini: 'productos/CON-FOTO/a-mini.webp', fotoOrigen: 'propia' }),
  ],
  rol: 'almacen',
} as unknown as Estado);

describe('E-009 · emparejado de archivos por nombre', () => {
  const S = estado();
  it('por SKU, ref. del proveedor y EAN, sin distinguir mayúsculas', () => {
    expect(emparejarArchivo('sal-dif-40.jpg', S.products)).toEqual({ sku: 'SAL-DIF-40', por: 'SKU' });
    expect(emparejarArchivo('6040615306.webp', S.products)).toEqual({ sku: 'SAL-DIF-40', por: 'ref. proveedor' });
    expect(emparejarArchivo('cp-ve-1f-40.PNG', S.products)).toEqual({ sku: 'ESM-CPVE-MONO', por: 'ref. proveedor' });
    expect(emparejarArchivo('8420000000017.jpeg', S.products)).toEqual({ sku: 'SAL-DIF-40', por: 'EAN' });
  });
  it('con cualquier extensión (o varias), carpetas y espacios', () => {
    expect(claveArchivo('fotos/Saltoki/6040615306.JPG')).toBe('6040615306');
    expect(claveArchivo('C:\\fotos\\6040615306.jpg.webp')).toBe('6040615306');
    expect(claveArchivo(' 6040615306 .heic')).toBe('6040615306');
    expect(emparejarArchivo('6040615306.HEIC', S.products)?.sku).toBe('SAL-DIF-40');
  });
  it('no inventa: sin pareja si no coincide exacto', () => {
    expect(emparejarArchivo('604061530.webp', S.products)).toBeNull();
    expect(emparejarArchivo('IMG_2034.jpg', S.products)).toBeNull();
    expect(emparejarArchivo('.webp', S.products)).toBeNull();
  });
  it('la vista previa marca las que no casan, las repetidas y las que sustituyen una foto', () => {
    const plan = planImportacion([
      { name: '6040615306.webp', type: 'image/webp' }, { name: 'CON-FOTO.jpg', type: 'image/jpeg' }, { name: 'nada.png', type: 'image/png' },
      { name: 'ROPA-PANT-42.webp' }, { name: 'ROPA-PANT-44.webp' }, { name: 'lista.pdf', type: 'application/pdf' },
    ], S);
    expect(plan.map(a => [a.sku, a.estado])).toEqual([
      ['SAL-DIF-40', 'nueva'], ['CON-FOTO', 'sustituye'], [null, 'sin-pareja'],
      ['ROPA-PANT-42', 'nueva'], ['ROPA-PANT-44', 'repetida'], [null, 'no-imagen'],
    ]);
  });
});

describe('E-009 · permisos y foto por modelo', () => {
  it('el almacén solo añade foto donde no hay; el administrador sustituye y quita', () => {
    const S = estado(), con = S.products.find(p => p.sku === 'CON-FOTO')!, sin = S.products[0];
    expect(permisoFoto(S, 'almacen', sin)).toEqual({ poner: true, sustituir: false, quitar: false });
    expect(permisoFoto(S, 'almacen', con)).toEqual({ poner: false, sustituir: false, quitar: false });
    expect(permisoFoto(S, 'admin', con)).toEqual({ poner: false, sustituir: true, quitar: true });
  });
  it('el almacén NO puede sustituir una foto existente (operación rechazada)', () => {
    const S = estado();
    expect(() => aplicarLocal(S, { op: 'foto', args: { sku: 'CON-FOTO', foto: 'productos/CON-FOTO/b.webp', mini: 'productos/CON-FOTO/b-mini.webp', origen: 'propia' } })).toThrow(/solo el administrador/);
    expect(() => aplicarLocal(S, { op: 'quitarFoto', args: { sku: 'CON-FOTO' } })).toThrow(/Solo el administrador/);
    // reintento de la misma foto: no es sustituir
    aplicarLocal(S, { op: 'foto', args: { sku: 'CON-FOTO', foto: 'productos/CON-FOTO/a.webp', mini: 'productos/CON-FOTO/a-mini.webp', origen: 'propia' } });
    S.rol = 'admin';
    aplicarLocal(S, { op: 'foto', args: { sku: 'CON-FOTO', foto: 'productos/CON-FOTO/b.webp', mini: 'productos/CON-FOTO/b-mini.webp', origen: 'fabricante' } });
    expect(S.products.find(p => p.sku === 'CON-FOTO')).toMatchObject({ foto: 'productos/CON-FOTO/b.webp', fotoOrigen: 'fabricante' });
  });
  it('las tallas de un modelo comparten la foto, y las prendas entregadas también la muestran', () => {
    const S = estado();
    aplicarLocal(S, { op: 'foto', args: { sku: 'ROPA-PANT-42', foto: 'productos/ROPA-PANT-42/c.webp', mini: 'productos/ROPA-PANT-42/c-mini.webp', origen: 'fabricante' } });
    const t44 = S.products.find(p => p.sku === 'ROPA-PANT-44')!;
    expect(fotoDe(S, t44)?.mini).toBe('productos/ROPA-PANT-42/c-mini.webp');
    expect(permisoFoto(S, 'almacen', t44).poner).toBe(false);
    expect(fotoDeHerramienta(S, { nombre: 'Pantalón multibolsillos' })?.foto).toBe('productos/ROPA-PANT-42/c.webp');
    expect(fotoDeHerramienta(S, { nombre: 'Taladro sin catálogo' })).toBeNull();
  });
  it('rutas del bucket y medidas de la reducción (1.000 px y miniatura de 200 px)', () => {
    expect(rutasFoto('sal-dif-40', 'webp', 'm1')).toEqual({ foto: 'productos/SAL-DIF-40/m1.webp', mini: 'productos/SAL-DIF-40/m1-mini.webp' });
    expect(medidas(4000, 3000, 1000)).toEqual({ w: 1000, h: 750 });
    expect(medidas(3000, 4000, 200)).toEqual({ w: 150, h: 200 });
    expect(medidas(640, 480, 1000)).toEqual({ w: 640, h: 480 });
  });
});
