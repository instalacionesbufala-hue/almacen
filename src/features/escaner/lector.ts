/* E-020 · Lector multiformato (ZXing en WebAssembly): funciona igual en iPhone (Safari no tiene BarcodeDetector) y en Android.
   El .wasm va empaquetado con la app (sin CDN). Lo usan la cámara y las pruebas, con las mismas opciones. */
import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';
import type { Lectura } from '../../domain/codigos';

export const FORMATOS = ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'Code128', 'Code39', 'ITF', 'Codabar', 'QRCode', 'DataMatrix'] as const;
const OPCIONES: ReaderOptions = { formats: [...FORMATOS], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 4 };

/** Indica de dónde sale el .wasm: su URL dentro de la app (navegador) o sus bytes (pruebas) */
export function prepararLector(o: { wasmUrl?: string; wasmBinary?: ArrayBuffer | Uint8Array }) {
  prepareZXingModule({
    overrides: o.wasmBinary ? { wasmBinary: o.wasmBinary as ArrayBuffer } : { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') && o.wasmUrl ? o.wasmUrl : prefix + path) },
    fireImmediately: true,
  });
}

/** Lee todos los códigos de un fotograma (también girados 90°) */
export async function leerCodigos(img: { data: Uint8ClampedArray | Uint8Array; width: number; height: number } | Uint8Array): Promise<Lectura[]> {
  const r = await readBarcodes(img as Parameters<typeof readBarcodes>[0], OPCIONES);
  return r.filter(x => x.isValid && x.text).map(x => ({ texto: x.text, formato: x.format }));
}
