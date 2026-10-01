/* E-020 · El mismo lector que usa la cámara, con imágenes de prueba: EAN-13, Code 128 y QR, girados y combinados */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { leerCodigos, prepararLector } from './lector';
import { elegirCodigo } from '../../domain/codigos';

const dir = new URL('./fixtures/', import.meta.url);
const png = (n: string) => new Uint8Array(readFileSync(new URL(`${n}.png`, dir)));

/** PNG en gris de 8 bits (como los de las pruebas) → RGBA, para componer fotogramas */
function rgba(n: string) {
  const b = Buffer.from(png(n)); const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  const idat: Buffer[] = []; for (let i = 8; i < b.length;) { const len = b.readUInt32BE(i), tipo = b.toString('ascii', i + 4, i + 8); if (tipo === 'IDAT') idat.push(b.subarray(i + 8, i + 8 + len)); i += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat)), g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w + 1)], fila = raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1));
    for (let x = 0; x < w; x++) {
      const a = x ? g[y * w + x - 1] : 0, up = y ? g[(y - 1) * w + x] : 0, c = x && y ? g[(y - 1) * w + x - 1] : 0;
      const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      const pred = [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : c][f];
      g[y * w + x] = (fila[x] + pred) & 255;
    }
  }
  return { w, h, g };
}
const lienzo = (w: number, h: number) => ({ w, h, g: new Uint8Array(w * h).fill(255) });
const pegar = (d: ReturnType<typeof lienzo>, s: ReturnType<typeof rgba>, ox: number, oy: number) => { for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) d.g[(oy + y) * d.w + ox + x] = s.g[y * s.w + x]; };
const girar = (s: ReturnType<typeof rgba>) => { const d = { w: s.h, h: s.w, g: new Uint8Array(s.w * s.h) }; for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) d.g[x * d.w + (s.h - 1 - y)] = s.g[y * s.w + x]; return d; };
const imagen = (s: { w: number; h: number; g: Uint8Array }) => { const data = new Uint8ClampedArray(s.w * s.h * 4); s.g.forEach((v, i) => { data.set([v, v, v, 255], i * 4); }); return { data, width: s.w, height: s.h }; };

beforeAll(() => { prepararLector({ wasmBinary: readFileSync(new URL('../../../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', import.meta.url)) }); });

describe('lector multiformato (ZXing)', () => {
  it('lee EAN-13, Code 128 y QR', async () => {
    expect(await leerCodigos(png('ean13'))).toEqual([{ texto: '8412345678905', formato: 'EAN13' }]);
    expect(await leerCodigos(png('code128'))).toEqual([{ texto: 'BF-000123', formato: 'Code128' }]);
    expect(await leerCodigos(png('qr-buf'))).toEqual([{ texto: 'BUF:CAB-RZ1K-5G6', formato: 'QRCode' }]);
  });
  it('lee un código de barras girado 90° (cajas escaneadas de lado)', async () => {
    const e = girar(rgba('ean13')), c = lienzo(e.w + 80, e.h + 80); pegar(c, e, 40, 40);
    expect((await leerCodigos(imagen(c))).map(x => x.texto)).toEqual(['8412345678905']);
  });
  it('con el QR del fabricante y un EAN en el mismo fotograma, gana el EAN', async () => {
    const a = rgba('qr-url'), b = rgba('ean13'), c = lienzo(a.w + b.w + 120, Math.max(a.h, b.h) + 80);
    pegar(c, a, 40, 40); pegar(c, b, a.w + 80, 40);
    const l = await leerCodigos(imagen(c));
    expect(l.map(x => x.texto).sort()).toEqual(['8412345678905', 'http://tag.yt/zeSA7']);
    expect(elegirCodigo(l)).toEqual({ tipo: 'codigo', codigo: '8412345678905', formato: 'EAN13' });
  });
  it('solo el QR del fabricante: se avisa de que no es un código del almacén', async () => {
    expect(elegirCodigo(await leerCodigos(png('qr-url')))).toEqual({ tipo: 'ajena', url: 'http://tag.yt/zeSA7' });
  });
});
