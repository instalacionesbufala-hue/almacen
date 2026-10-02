/* E-024 · Escanear documentos (como "Escanear documentos" del iPhone), sin librerías ni descargas:
   - detección de la hoja: el papel es la zona clara más grande (umbral de Otsu + mayor componente conexa) y sus 4 esquinas;
   - enderezado con corrección de perspectiva (homografía + interpolación bilineal);
   - mejora de lectura (contraste o blanco y negro), giro y detección de "encuadre quieto" para el disparo automático.
   Funciones puras sobre imágenes RGBA (las de un canvas), probadas en documento.test.ts. */

export interface Img { data: Uint8ClampedArray; width: number; height: number }
export interface Punto { x: number; y: number }
/** Esquinas en orden: arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda */
export type Quad = [Punto, Punto, Punto, Punto];
export type Mejora = 'color' | 'contraste' | 'byn';

export const nuevaImg = (width: number, height: number): Img => ({ data: new Uint8ClampedArray(width * height * 4), width, height });

/** Escala de grises (luminancia), reduciendo de paso la imagen para que el lado largo no pase de `lado` */
export function grisReducido(img: Img, lado = 240): { g: Float32Array; w: number; h: number; escala: number } {
  const escala = Math.min(1, lado / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * escala)), h = Math.max(1, Math.round(img.height * escala));
  const g = new Float32Array(w * h), d = img.data;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y / escala), y1 = Math.max(y0 + 1, Math.min(img.height, Math.floor((y + 1) / escala)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / escala), x1 = Math.max(x0 + 1, Math.min(img.width, Math.floor((x + 1) / escala)));
      let s = 0, n = 0;
      // media del bloque (con un paso para no recorrer todos los píxeles de una foto grande)
      const py = Math.max(1, Math.floor((y1 - y0) / 3)), px = Math.max(1, Math.floor((x1 - x0) / 3));
      for (let yy = y0; yy < y1; yy += py) for (let xx = x0; xx < x1; xx += px) { const i = (yy * img.width + xx) * 4; s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
      g[y * w + x] = s / n;
    }
  }
  return { g, w, h, escala };
}

/** Umbral de Otsu de un histograma de grises */
export function otsu(g: Float32Array): number {
  const hist = new Array(256).fill(0);
  for (const v of g) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
  const total = g.length; let suma = 0;
  for (let i = 0; i < 256; i++) suma += i * hist[i];
  let sB = 0, wB = 0, mejor = 0, umbral = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (suma - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > mejor) { mejor = v; umbral = t; }
  }
  return umbral;
}

export const areaQuad = (q: Quad) => Math.abs(q.reduce((a, p, i) => { const r = q[(i + 1) % 4]; return a + p.x * r.y - r.x * p.y; }, 0)) / 2;
const dist = (a: Punto, b: Punto) => Math.hypot(a.x - b.x, a.y - b.y);

/** ¿Es un cuadrilátero convexo con las esquinas en orden (sentido horario en pantalla)? */
export function quadValido(q: Quad): boolean {
  let signo = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-6) return false;
    if (!signo) signo = Math.sign(z); else if (Math.sign(z) !== signo) return false;
  }
  return signo > 0;
}

/** Busca la hoja de papel: devuelve sus 4 esquinas en coordenadas de la imagen, o null si no hay una hoja clara */
export function detectarHoja(img: Img, o: { lado?: number; areaMin?: number } = {}): Quad | null {
  const { g, w, h, escala } = grisReducido(img, o.lado ?? 240);
  // suavizado 3×3 para que el texto de la hoja no la "agujeree"
  const s = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let t = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) { t += g[yy * w + xx]; n++; } }
    s[y * w + x] = t / n;
  }
  const u = otsu(s);
  const claro = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) claro[i] = s[i] > u ? 1 : 0;
  // mayor zona clara conexa
  const marca = new Int32Array(w * h), cola = new Int32Array(w * h);
  let mejor = -1, mejorN = 0, etiqueta = 0;
  for (let i = 0; i < w * h; i++) {
    if (!claro[i] || marca[i]) continue;
    etiqueta++; let a = 0, b = 0; cola[b++] = i; marca[i] = etiqueta;
    while (a < b) {
      const k = cola[a++], x = k % w, y = (k - x) / w;
      const vec = [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1];
      for (const v of vec) if (v >= 0 && claro[v] && !marca[v]) { marca[v] = etiqueta; cola[b++] = v; }
    }
    if (b > mejorN) { mejorN = b; mejor = etiqueta; }
  }
  if (mejor < 0) return null;
  // esquinas: extremos de x+y y de x−y de la zona
  let tl = { x: 0, y: 0, v: Infinity }, br = { x: 0, y: 0, v: -Infinity }, tr = { x: 0, y: 0, v: -Infinity }, bl = { x: 0, y: 0, v: Infinity };
  for (let k = 0; k < w * h; k++) {
    if (marca[k] !== mejor) continue;
    const x = k % w, y = (k - x) / w, sum = x + y, dif = x - y;
    if (sum < tl.v) tl = { x, y, v: sum };
    if (sum > br.v) br = { x, y, v: sum };
    if (dif > tr.v) tr = { x, y, v: dif };
    if (dif < bl.v) bl = { x, y, v: dif };
  }
  const k = 1 / escala, P = (p: { x: number; y: number }): Punto => ({ x: (p.x + 0.5) * k, y: (p.y + 0.5) * k });
  const q: Quad = [P(tl), P(tr), P(br), P(bl)];
  if (!quadValido(q)) return null;
  const areaRed = areaQuad([tl, tr, br, bl]);
  // la hoja debe ocupar una parte razonable del encuadre y "llenar" su cuadrilátero (no una mancha irregular)
  if (areaRed < (o.areaMin ?? 0.15) * w * h) return null;
  if (mejorN / Math.max(1, areaRed) < 0.8) return null;
  return q;
}

/** Esquinas por defecto (sin detección): un margen del 6 % */
export const quadPorDefecto = (w: number, h: number, m = 0.06): Quad =>
  [{ x: w * m, y: h * m }, { x: w * (1 - m), y: h * m }, { x: w * (1 - m), y: h * (1 - m) }, { x: w * m, y: h * (1 - m) }];

/** Tamaño del documento enderezado (lado largo como mucho `maxLado`) */
export function tamanoEnderezado(q: Quad, maxLado = 1600): { w: number; h: number } {
  const w = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const e = Math.min(1, maxLado / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * e)), h: Math.max(1, Math.round(h * e)) };
}

/** Homografía que lleva los 4 puntos `de` a los 4 puntos `a` (matriz 3×3 en fila, h33 = 1) */
export function homografia(de: Quad, a: Quad): number[] {
  const M: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = de[i], { x: u, y: v } = a[i];
    M.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    M.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // eliminación de Gauss con pivote parcial
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) throw new Error('Esquinas no válidas');
    for (let r = 0; r < 8; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 9; k++) M[r][k] -= f * M[c][k]; }
  }
  return [...M.map((r, i) => r[8] / r[i]), 1];
}
export const aplicarH = (H: number[], x: number, y: number): Punto => {
  const d = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / d, y: (H[3] * x + H[4] * y + H[5]) / d };
};

/** Recorta y endereza la hoja: el resultado es el documento visto de frente */
export function enderezar(img: Img, q: Quad, maxLado = 1600): Img {
  const { w, h } = tamanoEnderezado(q, maxLado), out = nuevaImg(w, h);
  // de cada píxel del resultado al punto de la foto
  const H = homografia([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], q);
  const d = img.data, W = img.width, Hh = img.height, o = out.data;
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
    const p = aplicarH(H, u + 0.5, v + 0.5);
    const x = Math.max(0, Math.min(W - 1.001, p.x - 0.5)), y = Math.max(0, Math.min(Hh - 1.001, p.y - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4, j = (v * w + u) * 4;
    for (let c = 0; c < 3; c++) o[j + c] = (d[i00 + c] * (1 - fx) + d[i10 + c] * fx) * (1 - fy) + (d[i01 + c] * (1 - fx) + d[i11 + c] * fx) * fy;
    o[j + 3] = 255;
  }
  return out;
}

/** Mejora de lectura: "contraste" estira los niveles (papel blanco, tinta negra); "byn" binariza con umbral local (sombras incluidas) */
export function mejorar(img: Img, modo: Mejora): Img {
  if (modo === 'color') return img;
  const { width: w, height: h, data: d } = img, out = nuevaImg(w, h), o = out.data, n = w * h;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  if (modo === 'contraste') {
    const orden = Float32Array.from(g).sort(), alto = orden[Math.min(n - 1, Math.floor(n * 0.9))];
    // una hoja casi sin tinta no da un negro de referencia: con un rango mínimo no se tiñe ni se quema el papel
    const negro = Math.min(orden[Math.floor(n * 0.02)], alto - 110), f = 255 / Math.max(1, alto - negro);
    for (let i = 0; i < n * 4; i++) o[i] = (i & 3) === 3 ? 255 : (d[i] - negro) * f;
    return out;
  }
  // Bradley: oscuro si está claramente por debajo de la media de su entorno
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let fila = 0; for (let x = 0; x < w; x++) { fila += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + fila; } }
  const r = Math.max(4, Math.round(Math.max(w, h) / 32));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    const s = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
    const media = s / ((x1 - x0) * (y1 - y0)), v = g[y * w + x] < media * 0.88 ? 0 : 255, j = (y * w + x) * 4;
    o[j] = o[j + 1] = o[j + 2] = v; o[j + 3] = 255;
  }
  return out;
}

/** Giro de 90° (1 = horario, -1 = antihorario) o 180° (2) */
export function girar(img: Img, veces: 1 | -1 | 2): Img {
  const { width: w, height: h, data: d } = img, r = veces === 2 ? nuevaImg(w, h) : nuevaImg(h, w), o = r.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [nx, ny] = veces === 1 ? [h - 1 - y, x] : veces === -1 ? [y, w - 1 - x] : [w - 1 - x, h - 1 - y];
    const i = (y * w + x) * 4, j = (ny * r.width + nx) * 4;
    o[j] = d[i]; o[j + 1] = d[i + 1]; o[j + 2] = d[i + 2]; o[j + 3] = d[i + 3];
  }
  return r;
}

/** Disparo automático: la hoja lleva `ms` quieta (esquinas que se mueven menos de `tol` × diagonal del encuadre) */
export function encuadreQuieto(historial: { ts: number; q: Quad }[], ahora: number, diag: number, ms = 800, tol = 0.02): boolean {
  if (!historial.length) return false;
  const ultimo = historial[historial.length - 1].q, ventana = historial.filter(e => ahora - e.ts <= ms * 1.5);
  if (!ventana.length || ahora - ventana[0].ts < ms) return false;
  return ventana.every(e => e.q.every((p, i) => dist(p, ultimo[i]) <= tol * diag));
}
