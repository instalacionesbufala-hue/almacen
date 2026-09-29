/* E-009 · Fotos: guardar, subir (también sin cobertura, se sube después), leer con URL firmadas y quitar.
   - Nube: bucket privado "fotos-articulos". Solo se lee con sesión, mediante URL firmadas que caducan.
   - Demostración (sin Supabase): las fotos se quedan en este navegador (IndexedDB), nunca en el repositorio ni en la web publicada.
   Cada foto se guarda primero en IndexedDB; la cola de subidas la envía al bucket cuando hay conexión. */
import { useEffect, useState } from 'react';
import type { Estado, OrigenFoto } from '../../data/tipos';
import { BUCKET_FOTOS, fotoDe, rutasFoto } from '../../domain/fotos';
import { find } from '../../domain/reglas';
import { ejecutar, S } from '../../store/almacen';
import { crearStore } from '../../store/crear';
import { supabase } from '../../store/nube/cliente';
import { sesion } from '../../store/nube/sync';
import { aJpegDataUrl, comprimir } from './imagen';

/* ---------- IndexedDB: archivos y cola de subidas ---------- */
interface Subida { foto: string; mini: string; sku: string; retirar: string[]; ts: number; error?: string }
let bd: Promise<IDBDatabase> | null = null;
function abrir(): Promise<IDBDatabase> {
  bd ??= new Promise((ok, ko) => {
    const r = indexedDB.open('almacen-fotos', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('archivos'); r.result.createObjectStore('subidas', { keyPath: 'foto' }); };
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
  return bd;
}
async function tx<T>(almacenIdb: 'archivos' | 'subidas', modo: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await abrir();
  return new Promise((ok, ko) => { const r = f(d.transaction(almacenIdb, modo).objectStore(almacenIdb)); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
}
const leerArchivo = (ruta: string) => tx<Blob | undefined>('archivos', 'readonly', s => s.get(ruta) as IDBRequest<Blob | undefined>).catch(() => undefined);
const guardarArchivo = (ruta: string, b: Blob) => tx('archivos', 'readwrite', s => s.put(b, ruta));
const borrarArchivo = (ruta: string) => tx('archivos', 'readwrite', s => s.delete(ruta)).catch(() => undefined);
const listarSubidas = () => tx<Subida[]>('subidas', 'readonly', s => s.getAll() as IDBRequest<Subida[]>).catch(() => [] as Subida[]);

/** Rutas de fotos que esperan a subirse (para el aviso "pendiente de subir") */
export const subidasPendientes = crearStore<Set<string>>(new Set());
async function refrescarPendientes() { subidasPendientes.set(new Set((await listarSubidas()).map(s => s.foto))); }

/* ---------- URL para mostrar una foto ---------- */
const HORAS_URL = 12;
const LS_URLS = 'almacen-fotos-urls-v1';
const locales = new Map<string, string>();                           // ruta → blob: URL (archivo en este navegador)
let firmadas: Record<string, [string, number]> = {};                  // ruta → [URL firmada, caduca]
try { firmadas = JSON.parse(localStorage.getItem(LS_URLS) || '{}'); } catch { /* vacío */ }
const guardarFirmadas = () => { try { localStorage.setItem(LS_URLS, JSON.stringify(firmadas)); } catch { /* sin espacio */ } };
const vigente = (ruta: string) => { const f = firmadas[ruta]; return f && f[1] > Date.now() + 5 * 60e3 ? f[0] : null; };

// Las peticiones de una misma pantalla se agrupan en UNA llamada (lista de 200 artículos = 1 petición de URL)
let lote = new Map<string, ((u: string | null) => void)[]>();
let temporizador: ReturnType<typeof setTimeout> | undefined;
async function firmarLote() {
  const pedidas = lote; lote = new Map(); temporizador = undefined;
  const rutas = [...pedidas.keys()];
  let res: Record<string, string | null> = {};
  if (supabase && rutas.length) {
    const { data } = await supabase.storage.from(BUCKET_FOTOS).createSignedUrls(rutas, HORAS_URL * 3600);
    res = Object.fromEntries((data || []).map(d => [d.path || '', d.error ? null : d.signedUrl]));
    const caduca = Date.now() + HORAS_URL * 3600e3;
    for (const [r, u] of Object.entries(res)) if (u) firmadas[r] = [u, caduca];
    // se limpian las caducadas para que no crezca sin fin
    for (const [r, f] of Object.entries(firmadas)) if (f[1] < Date.now()) delete firmadas[r];
    guardarFirmadas();
  }
  for (const [r, fs] of pedidas) fs.forEach(f => f(res[r] ?? null));
}

export async function urlFoto(ruta: string | undefined): Promise<string | null> {
  if (!ruta) return null;
  if (locales.has(ruta)) return locales.get(ruta)!;
  const v = vigente(ruta); if (v) return v;
  const b = await leerArchivo(ruta);
  if (b) { const u = URL.createObjectURL(b); locales.set(ruta, u); return u; }
  if (!supabase || sesion.get().estado !== 'lista') return null;
  return new Promise(ok => {
    lote.set(ruta, [...(lote.get(ruta) || []), ok]);
    temporizador ??= setTimeout(() => void firmarLote(), 30);
  });
}

/** URL de una foto para React (null mientras carga o si no hay) */
export function useFotoUrl(ruta: string | undefined): string | null {
  const inicial = ruta ? locales.get(ruta) || vigente(ruta) : null;
  const [url, setUrl] = useState<string | null>(inicial);
  useEffect(() => {
    let vivo = true;
    if (!ruta) { setUrl(null); return; }
    void urlFoto(ruta).then(u => { if (vivo) setUrl(u); });
    return () => { vivo = false; };
  }, [ruta]);
  return url;
}

/* ---------- Guardar una foto nueva ---------- */
export async function guardarFoto(sku: string, archivo: Blob, origen: OrigenFoto): Promise<boolean> {
  const E = S(), p = find(E, sku);
  if (!p) throw new Error('Producto no encontrado');
  const anterior = fotoDe(E, p);
  const c = await comprimir(archivo);
  const rutas = rutasFoto(sku, c.ext);
  await guardarArchivo(rutas.foto, c.grande);
  await guardarArchivo(rutas.mini, c.mini);
  locales.set(rutas.foto, URL.createObjectURL(c.grande)); locales.set(rutas.mini, URL.createObjectURL(c.mini));
  // la operación comprueba los permisos (almacén: solo si no hay foto) y en la nube va a la cola como las demás
  if (!ejecutar({ op: 'foto', args: { sku, foto: rutas.foto, mini: rutas.mini, origen } })) {
    await borrarArchivo(rutas.foto); await borrarArchivo(rutas.mini);
    return false;
  }
  if (supabase) {
    const retirar = anterior ? [anterior.foto, anterior.mini] : [];
    await tx('subidas', 'readwrite', s => s.put({ foto: rutas.foto, mini: rutas.mini, sku, retirar, ts: Date.now() } satisfies Subida));
    await refrescarPendientes();
    void procesarSubidas();
  } else if (anterior) { await borrarArchivo(anterior.foto); await borrarArchivo(anterior.mini); }
  return true;
}

export async function quitarFoto(sku: string): Promise<boolean> {
  const E = S(), f = fotoDe(E, find(E, sku));
  if (!ejecutar({ op: 'quitarFoto', args: { sku } })) return false;
  if (f) {
    await borrarArchivo(f.foto); await borrarArchivo(f.mini);
    if (supabase) void supabase.storage.from(BUCKET_FOTOS).remove([f.foto, f.mini]); // si falla (sin cobertura), queda un archivo huérfano sin enlazar
  }
  return true;
}

/* ---------- Cola de subidas ---------- */
let subiendo = false;
export async function procesarSubidas(): Promise<void> {
  if (!supabase || subiendo || sesion.get().estado !== 'lista' || !navigator.onLine) return;
  subiendo = true;
  try {
    for (const s of await listarSubidas()) {
      let error: string | undefined;
      for (const ruta of [s.foto, s.mini]) {
        const b = await leerArchivo(ruta);
        if (!b) { error = 'El archivo de la foto se ha perdido en este navegador'; break; }
        // las rutas no se reutilizan nunca: se pueden cachear un año
        const r = await supabase.storage.from(BUCKET_FOTOS).upload(ruta, b, { contentType: b.type, cacheControl: '31536000', upsert: false });
        if (r.error && !/exists|duplicate/i.test(r.error.message)) { error = r.error.message; break; }
      }
      if (error) {
        if (/fetch|network|load failed/i.test(error)) break;                                  // sin cobertura: se reintenta luego
        await tx('subidas', 'readwrite', st => st.put({ ...s, error }));
        continue;
      }
      await tx('subidas', 'readwrite', st => st.delete(s.foto));
      await borrarArchivo(s.foto);                                                             // la grande ya está en el bucket; la miniatura se queda para verla sin cobertura
      if (s.retirar.length) void supabase.storage.from(BUCKET_FOTOS).remove(s.retirar);      // foto sustituida (solo el administrador puede)
    }
  } finally { subiendo = false; await refrescarPendientes(); }
}

let iniciado = false;
export function iniciarFotos() {
  if (iniciado) return; iniciado = true;
  void refrescarPendientes();
  if (!supabase) return;
  // la cola comprueba sola si hay sesión y conexión
  addEventListener('online', () => void procesarSubidas());
  setTimeout(() => void procesarSubidas(), 3000);
  setInterval(() => void procesarSubidas(), 30000);
}

/** Miniaturas del material en custodia de un propietario, como data URL (para el PDF del informe, que se abre en otra ventana) */
export async function fotosInforme(E: Estado, propietario: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(E.products.filter(p => p.propiedad === 'custodia' && p.propietario === propietario).map(async p => {
    const f = fotoDe(E, p), u = f ? await urlFoto(f.mini) : null, d = u ? await aJpegDataUrl(u, 120) : null;
    if (d) out[p.sku] = d;
  }));
  return out;
}
