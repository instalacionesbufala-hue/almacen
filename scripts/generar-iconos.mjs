/* Genera los iconos PNG de la app (PWA) sin dependencias: cuadrado azul Stitch con un rayo blanco.
   Uso: node scripts/generar-iconos.mjs */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const AZUL = [29, 78, 216], BLANCO = [255, 255, 255];
// rayo en coordenadas 0..24 (mismo dibujo que el favicon)
const RAYO = [[13, 3], [6, 14], [11, 14], [10, 21], [17, 10], [12, 10]];

function dentro(x, y, pol) {
  let d = false;
  for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
    const [xi, yi] = pol[i], [xj, yj] = pol[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
  }
  return d;
}
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function bloque(tipo, datos) {
  const t = Buffer.from(tipo), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(datos.length); crc.writeUInt32BE(crc32(Buffer.concat([t, datos])));
  return Buffer.concat([len, t, datos, crc]);
}
function png(tam, { margen = 0, redondeo = 0.22 } = {}) {
  const filas = [];
  const esc = (tam * (1 - 2 * margen)) / 24, off = tam * margen, r = tam * redondeo;
  for (let y = 0; y < tam; y++) {
    const fila = Buffer.alloc(1 + tam * 4);
    for (let x = 0; x < tam; x++) {
      // esquinas redondeadas (transparentes) salvo en el icono "maskable", que es cuadrado
      const cx = Math.min(Math.max(x + .5, r), tam - r), cy = Math.min(Math.max(y + .5, r), tam - r);
      const fuera = redondeo > 0 && Math.hypot(x + .5 - cx, y + .5 - cy) > r;
      const u = (x + .5 - off) / esc, v = (y + .5 - off) / esc;
      const [R, G, B] = dentro(u, v, RAYO) ? BLANCO : AZUL;
      fila.set([R, G, B, fuera ? 0 : 255], 1 + x * 4);
    }
    filas.push(fila);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tam, 0); ihdr.writeUInt32BE(tam, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloque('IHDR', ihdr), bloque('IDAT', deflateSync(Buffer.concat(filas))), bloque('IEND', Buffer.alloc(0))]);
}

mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/icono-192.png', import.meta.url), png(192, { margen: .12 }));
writeFileSync(new URL('../public/icono-512.png', import.meta.url), png(512, { margen: .12 }));
writeFileSync(new URL('../public/icono-maskable-512.png', import.meta.url), png(512, { margen: .2, redondeo: 0 }));
writeFileSync(new URL('../public/apple-touch-icon.png', import.meta.url), png(180, { margen: .14, redondeo: 0 }));
console.log('Iconos generados en public/');
