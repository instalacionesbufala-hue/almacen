/* E-024 · Lectura de un albarán de varias páginas: lotes para no pasar el límite de la IA y cola sin conexión.
   Núcleo sin navegador (el almacenamiento y la llamada a la IA se inyectan), probado en lecturaAlbaran.test.ts. */
import type { AlbaranIA } from '../data/tipos';
import { unirAlbaranes, type AlbaranLeido } from '../../supabase/functions/_compartido/albaran';

export type ResultadoLectura = AlbaranIA & { avisos?: string[]; paginas?: number };
export interface Lectura {
  id: string; ts: number; nombre: string; paginas: number;
  /** pendiente = esperando cobertura; leido = listo para revisar */
  estado: 'pendiente' | 'leyendo' | 'leido' | 'error';
  error?: string; resultado?: ResultadoLectura;
}
export interface AlmacenLecturas {
  listar(): Promise<Lectura[]>;
  guardar(l: Lectura, paginas?: Blob[]): Promise<void>;
  paginas(id: string): Promise<Blob[]>;
  borrar(id: string): Promise<void>;
}

export const MAX_POR_LOTE = 6, MAX_BYTES_LOTE = 8 * 1024 * 1024;
/** Reparte las páginas en lotes (en orden) de como mucho `max` páginas y `bytes` en total */
export function lotes<T extends { size: number }>(paginas: T[], max = MAX_POR_LOTE, bytes = MAX_BYTES_LOTE): T[][] {
  const r: T[][] = []; let actual: T[] = [], peso = 0;
  for (const p of paginas) {
    if (actual.length && (actual.length >= max || peso + p.size > bytes)) { r.push(actual); actual = []; peso = 0; }
    actual.push(p); peso += p.size;
  }
  if (actual.length) r.push(actual);
  return r;
}

const aLeido = (a: AlbaranIA): AlbaranLeido => ({ proveedor: a.proveedor || '', cif: a.cif || '', numero: a.numero || '', fecha: a.fecha || '', bultos: a.bultos,
  lineas: (a.lineas || []).map(l => ({ codigo: l.codigo || '', descripcion: l.descripcion || '', cantidad: Number(l.cantidad) || 0, sku: l.sku ?? null, how: null, series: l.series || [], nota: l.nota || '', confianza: Number(l.confianza) || 0.8 })) });

/** Lee todas las páginas como un solo albarán: un lote por llamada y las respuestas unidas (sin cabeceras ni líneas repetidas) */
export async function leerPorLotes(paginas: Blob[], leerLote: (b: Blob[]) => Promise<AlbaranIA>): Promise<ResultadoLectura> {
  const partes: AlbaranIA[] = [];
  for (const l of lotes(paginas)) partes.push(await leerLote(l));
  if (partes.length === 1) return { ...partes[0], paginas: paginas.length };
  const u = unirAlbaranes(partes.map(aLeido));
  return { ...u, paginas: paginas.length };
}

export const esErrorDeRed = (e: unknown) => e instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed|sin conexi/i.test(String((e as Error)?.message || e));

/** Cola de lecturas: sin cobertura las páginas se guardan como "pendiente de leer" y se leen al volver la conexión */
export function crearCola(o: { almacen: AlmacenLecturas; leer: (paginas: Blob[]) => Promise<ResultadoLectura>; enLinea: () => boolean; id: () => string; ahora?: () => number }) {
  let ocupada: Promise<Lectura[]> | null = null;
  const ahora = o.ahora || Date.now;
  async function leerUna(l: Lectura): Promise<Lectura> {
    await o.almacen.guardar({ ...l, estado: 'leyendo', error: undefined });
    try {
      const resultado = await o.leer(await o.almacen.paginas(l.id));
      const x: Lectura = { ...l, estado: 'leido', resultado, error: undefined };
      await o.almacen.guardar(x); return x;
    } catch (e) {
      // sin red vuelve a esperar; cualquier otro fallo queda a la vista para reintentar o descartar
      const x: Lectura = esErrorDeRed(e) ? { ...l, estado: 'pendiente', error: undefined } : { ...l, estado: 'error', error: (e as Error).message || String(e) };
      await o.almacen.guardar(x); return x;
    }
  }
  return {
    /** Guarda las páginas y, si hay conexión, las lee ya */
    async nueva(paginas: Blob[], nombre: string): Promise<Lectura> {
      const l: Lectura = { id: o.id(), ts: ahora(), nombre, paginas: paginas.length, estado: 'pendiente' };
      await o.almacen.guardar(l, paginas);
      return o.enLinea() ? leerUna(l) : l;
    },
    /** Lee las que esperaban cobertura (una cada vez; si ya está leyendo, espera a esa pasada) */
    procesar(): Promise<Lectura[]> {
      ocupada ??= (async () => {
        const hechas: Lectura[] = [];
        try {
          for (const l of (await o.almacen.listar()).filter(x => x.estado === 'pendiente' || x.estado === 'leyendo').sort((a, b) => a.ts - b.ts)) {
            if (!o.enLinea()) break;
            const r = await leerUna(l); hechas.push(r);
            if (r.estado === 'pendiente') break;                       // se ha vuelto a ir la conexión
          }
        } finally { ocupada = null; }
        return hechas;
      })();
      return ocupada;
    },
    async reintentar(id: string) { const l = (await o.almacen.listar()).find(x => x.id === id); return l && o.enLinea() ? leerUna(l) : l; },
    descartar: (id: string) => o.almacen.borrar(id),
  };
}
