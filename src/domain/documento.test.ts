import { describe, expect, it } from 'vitest';
import { aplicarH, detectarHoja, encuadreQuieto, enderezar, girar, homografia, mejorar, nuevaImg, quadValido, tamanoEnderezado, type Img, type Quad } from './documento';

/* Fixture: "foto" de 480×360 con una hoja en perspectiva (trapecio girado) sobre una mesa oscura con algo de ruido.
   La hoja lleva una marca roja junto a su esquina de arriba-izquierda, una azul abajo-derecha y unas líneas de "texto". */
const HOJA: Quad = [{ x: 110, y: 50 }, { x: 390, y: 75 }, { x: 420, y: 320 }, { x: 70, y: 300 }];
function dentro(q: Quad, x: number, y: number) {
  let s = 0;
  for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; const z = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x); if (z < 0) return false; s++; }
  return s === 4;
}
function fixture(): Img {
  const W = 480, H = 360, img = nuevaImg(W, H);
  // posición en la hoja (u, v en 0..1) de cada píxel, para pintar las marcas en coordenadas del documento
  const Hinv = homografia(HOJA, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
  let semilla = 7; const azar = () => ((semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; let c = [55 + azar() * 25, 50 + azar() * 25, 45 + azar() * 25];
    if (dentro(HOJA, x + 0.5, y + 0.5)) {
      const { x: u, y: v } = aplicarH(Hinv, x + 0.5, y + 0.5);
      c = [235, 233, 228];
      if (u > 0.05 && u < 0.15 && v > 0.05 && v < 0.15) c = [220, 30, 30];
      else if (u > 0.85 && u < 0.95 && v > 0.85 && v < 0.95) c = [30, 40, 220];
      else if (u > 0.25 && u < 0.75 && [0.3, 0.4, 0.5, 0.6].some(t => Math.abs(v - t) < 0.008)) c = [40, 40, 40];
    }
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
  }
  return img;
}
const px = (img: Img, x: number, y: number) => { const i = (Math.round(y) * img.width + Math.round(x)) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };

describe('E-024 · escanear documentos', () => {
  const foto = fixture();

  it('detecta las 4 esquinas de la hoja en perspectiva', () => {
    const q = detectarHoja(foto)!;
    expect(q).not.toBeNull();
    q.forEach((p, i) => { expect(Math.abs(p.x - HOJA[i].x)).toBeLessThan(6); expect(Math.abs(p.y - HOJA[i].y)).toBeLessThan(6); });
    expect(quadValido(q)).toBe(true);
  });

  it('no inventa una hoja en una imagen sin papel', () => {
    const vacia = nuevaImg(200, 150);
    for (let i = 0; i < vacia.data.length; i += 4) { const v = (i / 4) % 200 < 100 ? 60 : 70; vacia.data[i] = vacia.data[i + 1] = vacia.data[i + 2] = v; vacia.data[i + 3] = 255; }
    const q = detectarHoja(vacia);
    // si acaso, una mitad apenas más clara: no "llena" un cuadrilátero de hoja creíble
    if (q) expect(q.some(p => p.x < 1 || p.y < 1)).toBe(true);
  });

  it('endereza la hoja: la marca roja queda arriba-izquierda y la azul abajo-derecha', () => {
    const doc = enderezar(foto, detectarHoja(foto)!, 600);
    const { w, h } = { w: doc.width, h: doc.height };
    expect(Math.max(w, h)).toBeLessThanOrEqual(600);
    const rojo = px(doc, w * 0.1, h * 0.1), azul = px(doc, w * 0.9, h * 0.9), papel = px(doc, w * 0.5, h * 0.2);
    expect(rojo[0]).toBeGreaterThan(180); expect(rojo[2]).toBeLessThan(90);
    expect(azul[2]).toBeGreaterThan(180); expect(azul[0]).toBeLessThan(90);
    expect(papel.every(c => c > 200)).toBe(true);
    // las líneas de texto salen horizontales (misma fila oscura de lado a lado)
    const fila = Math.round(h * 0.4);
    const oscuras = [0.3, 0.5, 0.7].map(t => Math.min(...[-2, -1, 0, 1, 2].map(d => px(doc, w * t, fila + d)[0])));
    expect(Math.max(...oscuras)).toBeLessThan(120);
  });

  it('el tamaño enderezado respeta el lado largo máximo', () => {
    const t = tamanoEnderezado(HOJA, 1600);
    expect(t.w).toBeGreaterThan(t.h);
    expect(tamanoEnderezado(HOJA, 100).w).toBe(100);
  });

  it('blanco y negro: el papel sale blanco y la tinta negra; contraste estira los niveles', () => {
    const doc = enderezar(foto, detectarHoja(foto)!, 400);
    const byn = mejorar(doc, 'byn'), con = mejorar(doc, 'contraste');
    expect(px(byn, doc.width * 0.5, doc.height * 0.2)).toEqual([255, 255, 255]);
    const fila = Math.round(doc.height * 0.4);
    expect(Math.min(...[-1, 0, 1].map(d => px(byn, doc.width * 0.5, fila + d)[0]))).toBe(0);
    expect(px(con, doc.width * 0.5, doc.height * 0.2)[0]).toBe(255);
    expect(mejorar(doc, 'color')).toBe(doc);
  });

  it('contraste en una hoja casi sin tinta: el papel sale blanco y neutro, sin teñirse', () => {
    const hoja = nuevaImg(60, 80);
    for (let i = 0; i < hoja.data.length; i += 4) hoja.data.set([245, 243, 238, 255], i);   // papel algo cálido
    hoja.data.set([30, 30, 30, 255], 0);                                                      // un punto de tinta
    const c = px(mejorar(hoja, 'contraste'), 30, 40);
    expect(Math.min(...c)).toBeGreaterThan(230);
    expect(Math.max(...c) - Math.min(...c)).toBeLessThan(25);
  });

  it('gira 90° en los dos sentidos y 180°', () => {
    const a = nuevaImg(3, 2); a.data.set([255, 0, 0, 255], 0);       // rojo en (0,0)
    const h = girar(a, 1), ah = girar(a, -1), m = girar(a, 2);
    expect([h.width, h.height]).toEqual([2, 3]);
    expect(px(h, 1, 0)[0]).toBe(255);                                  // horario: arriba-derecha
    expect(px(ah, 0, 2)[0]).toBe(255);                                 // antihorario: abajo-izquierda
    expect(px(m, 2, 1)[0]).toBe(255);
  });

  it('disparo automático solo cuando la hoja lleva quieta el tiempo pedido', () => {
    const q = HOJA, mov = (d: number): Quad => q.map(p => ({ x: p.x + d, y: p.y })) as Quad;
    const hist = [0, 200, 400, 600, 800, 1000].map(ts => ({ ts, q: mov(ts === 0 ? 40 : 1) }));
    expect(encuadreQuieto(hist, 1000, 600, 800)).toBe(false);          // al principio se movía
    const quieta = [0, 200, 400, 600, 800, 1000].map(ts => ({ ts, q: mov(ts % 400 ? 2 : 0) }));
    expect(encuadreQuieto(quieta, 1000, 600, 800)).toBe(true);
    expect(encuadreQuieto(quieta.slice(-2), 1000, 600, 800)).toBe(false); // poco tiempo todavía
  });
});
