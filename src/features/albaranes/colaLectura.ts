/* E-024 · Albaranes escaneados en este dispositivo (IndexedDB):
   - "lecturas": páginas que esperan a leerse (sin cobertura) o ya leídas pendientes de revisar;
   - "paginas": las páginas recortadas de cada albarán aprobado. Con Supabase se suben al bucket PRIVADO "albaranes-paginas"
     (<id del albarán>/<n>.jpg) en cuanto el albarán existe en el servidor; en demostración se quedan solo en este navegador. */
import { crearStore } from '../../store/crear';
import { supabase } from '../../store/nube/cliente';
import { crearCola, leerPorLotes, type AlmacenLecturas, type Lectura } from '../../domain/lecturaAlbaran';
import { nuevoId } from '../../store/ops';
import { leerConIA } from './lector';

export const BUCKET_PAGINAS = 'albaranes-paginas';
/** Nombres de las páginas tal como se guardan con el albarán: 1.jpg, 2.jpg… (un PDF, tal cual: 3.pdf) */
export const nombresPaginas = (paginas: Blob[]) => paginas.map((b, i) => `${i + 1}.${b.type === 'application/pdf' ? 'pdf' : 'jpg'}`);
export const rutaPagina = (albaran: string, nombre: string) => `${albaran}/${nombre}`;

let bd: Promise<IDBDatabase> | null = null;
function abrir(): Promise<IDBDatabase> {
  bd ??= new Promise((ok, ko) => {
    const r = indexedDB.open('almacen-albaranes', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('lecturas', { keyPath: 'id' }); r.result.createObjectStore('archivos'); r.result.createObjectStore('paginas'); };
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
  return bd;
}
type Tienda = 'lecturas' | 'archivos' | 'paginas';
async function tx<T>(t: Tienda, modo: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await abrir();
  return new Promise((ok, ko) => { const r = f(d.transaction(t, modo).objectStore(t)); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
}

const almacen: AlmacenLecturas = {
  listar: () => tx<Lectura[]>('lecturas', 'readonly', s => s.getAll() as IDBRequest<Lectura[]>).catch(() => []),
  async guardar(l, paginas) {
    if (paginas) for (let i = 0; i < paginas.length; i++) await tx('archivos', 'readwrite', s => s.put(paginas[i], `${l.id}/${i + 1}`));
    await tx('lecturas', 'readwrite', s => s.put(l));
    await refrescar();
  },
  async paginas(id) {
    const n = (await tx<Lectura | undefined>('lecturas', 'readonly', s => s.get(id) as IDBRequest<Lectura | undefined>))?.paginas || 0;
    const r: Blob[] = [];
    for (let i = 1; i <= n; i++) { const b = await tx<Blob | undefined>('archivos', 'readonly', s => s.get(`${id}/${i}`) as IDBRequest<Blob | undefined>); if (b) r.push(b); }
    return r;
  },
  async borrar(id) {
    const n = (await tx<Lectura | undefined>('lecturas', 'readonly', s => s.get(id) as IDBRequest<Lectura | undefined>).catch(() => undefined))?.paginas || 0;
    for (let i = 1; i <= n; i++) await tx('archivos', 'readwrite', s => s.delete(`${id}/${i}`)).catch(() => undefined);
    await tx('lecturas', 'readwrite', s => s.delete(id)).catch(() => undefined);
    await refrescar();
  },
};

/** Lecturas de este dispositivo, para la pantalla de Albaranes */
export const lecturas = crearStore<Lectura[]>([]);
async function refrescar() { lecturas.set((await almacen.listar()).sort((a, b) => b.ts - a.ts)); }

export const cola = crearCola({ almacen, enLinea: () => navigator.onLine, id: nuevoId, leer: p => leerPorLotes(p, b => leerConIA(b)) });
export const paginasDeLectura = almacen.paginas;

/* ---------- Páginas de los albaranes aprobados ---------- */
/** Guarda las páginas con el albarán (aquí siempre; en el servidor cuando se pueda) */
export async function guardarPaginasAlbaran(albaran: string, paginas: Blob[]) {
  const nombres = nombresPaginas(paginas);
  for (let i = 0; i < paginas.length; i++) await tx('paginas', 'readwrite', s => s.put(paginas[i], rutaPagina(albaran, nombres[i])));
  // el albarán sale por la cola de operaciones: se intenta enseguida y otra vez cuando ya debería estar en el servidor
  void subirPaginas(); setTimeout(() => void subirPaginas(), 10e3);
}
export const paginaLocal = (ruta: string) => tx<Blob | undefined>('paginas', 'readonly', s => s.get(ruta) as IDBRequest<Blob | undefined>).catch(() => undefined);

let subiendo = false;
/** Sube las páginas que faltan. Si el albarán aún no ha llegado al servidor (aprobado sin cobertura), lo intenta más tarde. */
export async function subirPaginas() {
  if (!supabase || subiendo || !navigator.onLine) return;
  subiendo = true;
  try {
    const rutas = (await tx<IDBValidKey[]>('paginas', 'readonly', s => s.getAllKeys()).catch(() => [])).map(String);
    for (const ruta of rutas) {
      const b = await paginaLocal(ruta); if (!b) continue;
      const { error } = await supabase.storage.from(BUCKET_PAGINAS).upload(ruta, b, { contentType: b.type || 'image/jpeg', upsert: false });
      // ya estaba (reintento) = hecho; otro fallo = se reintenta en la próxima pasada
      // ya está en el servidor: la copia de este dispositivo sobra
      if (!error || /exists|duplicate/i.test(error.message)) await tx('paginas', 'readwrite', s => s.delete(ruta));
    }
  } finally { subiendo = false; }
}

/** URL para ver una página: la copia de este dispositivo o una URL firmada del bucket (1 hora) */
export async function urlPagina(ruta: string): Promise<string | null> {
  const b = await paginaLocal(ruta); if (b) return URL.createObjectURL(b);
  if (!supabase) return null;
  const { data } = await supabase.storage.from(BUCKET_PAGINAS).createSignedUrl(ruta, 3600);
  return data?.signedUrl || null;
}

// al volver la cobertura (y al abrir la app): leer lo pendiente y subir las páginas que falten
if (typeof window !== 'undefined' && 'indexedDB' in window) {
  const pasada = () => { void cola.procesar().then(r => { if (r.some(x => x.estado === 'leido')) avisarLeidas(r.filter(x => x.estado === 'leido').length); }); void subirPaginas(); };
  addEventListener('online', pasada);
  setTimeout(() => { void refrescar(); pasada(); }, 1500);
  setInterval(() => { if (navigator.onLine) pasada(); }, 5 * 60e3);
}
let avisarLeidas = (_n: number) => { /* lo pone la pantalla de albaranes */ };
export const alLeerPendientes = (f: (n: number) => void) => { avisarLeidas = f; };
