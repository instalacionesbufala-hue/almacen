/* E-009 · Fotos en pantalla: miniatura (con el icono de la categoría si no hay foto), foto grande que se amplía al tocarla,
   visor a pantalla completa y editor de la ficha (cámara, archivo o pegar). */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CatId, Herramienta, OrigenFoto, Producto } from '../data/tipos';
import { CATS } from '../data/catalogo';
import { fotoDe, fotoDeHerramienta, ORIGENES_FOTO, permisoFoto } from '../domain/fotos';
import { useAlmacen } from '../store/almacen';
import { crearStore } from '../store/crear';
import { guardarFoto, quitarFoto, subidasPendientes, useFotoUrl } from '../features/fotos/servicio';
import { toast } from './toast';

const Ico = ({ n, className = '' }: { n: string; className?: string }) => <span className={`material-symbols-outlined ${className}`} aria-hidden="true">{n}</span>;

/** Miniatura: la foto si existe; si no (o mientras carga), el icono de la categoría */
export function Miniatura({ ruta, cat, alt, size = 'w-12 h-12', tile, alerta, icono = 'ico-28' }: { ruta?: string; cat: CatId; alt: string; size?: string; tile?: string; alerta?: boolean; icono?: string }) {
  const url = useFotoUrl(ruta);
  const [cargada, setCargada] = useState(false);
  useEffect(() => setCargada(false), [url]);
  const fondo = tile ?? (alerta ? 'bg-error-container text-error' : CATS[cat].tile);
  return (
    <div className={`${size} shrink-0 rounded-xl relative overflow-hidden grid place-items-center ${url && cargada ? 'bg-white ring-1 ring-surface-container-high' : fondo}`}>
      {!(url && cargada) && <Ico n={CATS[cat].icon} className={icono} />}
      {url && <img src={url} alt={alt} loading="lazy" decoding="async" onLoad={() => setCargada(true)} onError={() => setCargada(false)}
        className={`absolute inset-0 w-full h-full object-contain ${cargada ? '' : 'opacity-0'}`} />}
      {url && cargada && alerta && <span className="absolute top-1 right-1 w-3 h-3 rounded-full bg-error ring-2 ring-white" title="Stock crítico" />}
    </div>
  );
}

/** Miniatura de un artículo del catálogo (las tallas de un modelo comparten la foto) */
export function FotoProducto({ p, size, alerta, icono }: { p: Producto; size?: string; alerta?: boolean; icono?: string }) {
  const E = useAlmacen(), f = fotoDe(E, p);
  return <Miniatura ruta={f?.mini} cat={p.cat} alt={p.name} size={size} alerta={alerta} icono={icono} />;
}

/** Miniatura de una herramienta, EPI o prenda (la foto del modelo en el catálogo, si lo hay) */
export function FotoHerramienta({ h, size = 'w-10 h-10' }: { h: Herramienta; size?: string }) {
  const E = useAlmacen(), f = fotoDeHerramienta(E, h);
  const cat: CatId = h.clase === 'epi' ? 'epis' : h.clase === 'ropa' ? 'ropa' : 'fijaciones';
  return <Miniatura ruta={f?.mini} cat={cat} alt={h.nombre} size={size} icono="ico-20" tile={f ? undefined : 'bg-surface-container-high text-secondary'} />;
}

/* ---------- Visor a pantalla completa ---------- */
const visor = crearStore<{ ruta: string; alt: string } | null>(null);
export const abrirVisor = (ruta: string, alt: string) => visor.set({ ruta, alt });
export function VisorHost() {
  const v = visor.use(), url = useFotoUrl(v?.ruta);
  useEffect(() => {
    if (!v) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); visor.set(null); } };
    addEventListener('keydown', k, true); return () => removeEventListener('keydown', k, true);
  }, [v]);
  if (!v) return null;
  return (
    <div className="fixed inset-0 z-[200] bg-black/90 grid place-items-center p-4" onClick={() => visor.set(null)} role="dialog" aria-label={v.alt}>
      {url ? <img src={url} alt={v.alt} className="max-w-full max-h-full object-contain rounded-lg" /> : <span className="text-white">Cargando foto…</span>}
      <button className="absolute top-4 right-4 w-14 h-14 rounded-full bg-white/15 text-white grid place-items-center" aria-label="Cerrar"><Ico n="close" className="ico-28" /></button>
    </div>
  );
}

/** Foto grande (ficha y escáner): se amplía al tocarla. Sin foto, el icono grande de la categoría */
export function FotoGrande({ p, className = 'h-56', children }: { p: Producto; className?: string; children?: ReactNode }) {
  const E = useAlmacen(), f = fotoDe(E, p);
  // mientras llega la grande se enseña la miniatura (ya suele estar en caché de la lista)
  const grande = useFotoUrl(f?.foto), mini = useFotoUrl(f?.mini), url = grande || mini;
  if (!f || !url) return (
    <div className={`${className} w-full rounded-xl grid place-items-center ${CATS[p.cat].tile} relative`}>
      <div className="flex flex-col items-center gap-1"><Ico n={CATS[p.cat].icon} className="ico-40" /><span className="text-body-sm opacity-80">{f ? 'Cargando foto…' : 'Sin foto'}</span></div>{children}
    </div>);
  return (
    <button type="button" onClick={() => abrirVisor(f.foto, p.name)} className={`${className} w-full rounded-xl bg-white ring-1 ring-surface-container-high relative overflow-hidden`} aria-label={`Ampliar la foto de ${p.name}`}>
      <img src={url} alt={p.name} className="w-full h-full object-contain" />
      <span className="absolute bottom-2 right-2 w-9 h-9 rounded-full bg-black/45 text-white grid place-items-center"><Ico n="zoom_in" className="ico-20" /></span>
      {children}
    </button>);
}

/* ---------- Editor de la ficha ---------- */
const ORIGEN_TXT: Record<OrigenFoto, string> = { propia: 'Foto propia', Saltoki: 'Saltoki', Esmove: 'Esmove', fabricante: 'Fabricante' };
const BTN_FOTO = 'inline-flex items-center justify-center gap-2 rounded-lg font-semibold h-14 px-3 bg-surface-container-low hover:bg-surface-container-high text-primary disabled:opacity-40';

export function EditorFoto({ p }: { p: Producto }) {
  const E = useAlmacen(), pend = subidasPendientes.use(), f = fotoDe(E, p);
  const perm = permisoFoto(E, E.rol, p), puede = perm.poner || perm.sustituir;
  const [origen, setOrigen] = useState<OrigenFoto>(p.propiedad === 'custodia' ? 'Esmove' : 'propia');
  const [ocupado, setOcupado] = useState(false);
  const camara = useRef<HTMLInputElement>(null), archivo = useRef<HTMLInputElement>(null);

  const subir = async (b: Blob | null | undefined) => {
    if (!b || ocupado) return;
    if (f && !perm.sustituir) return toast('Este artículo ya tiene foto: solo el administrador puede sustituirla.', 'warn');
    if (f && !confirm('¿Sustituir la foto actual?')) return;
    setOcupado(true);
    try { if (await guardarFoto(p.sku, b, origen)) toast(pend.size || !navigator.onLine ? 'Foto guardada: se subirá en cuanto haya cobertura.' : 'Foto guardada.', 'ok'); }
    catch (e) { toast((e as Error).message, 'err', 6000); }
    finally { setOcupado(false); }
  };
  const pegar = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) { const t = it.types.find(x => x.startsWith('image/')); if (t) return void subir(await it.getType(t)); }
      toast('En el portapapeles no hay ninguna imagen.', 'warn');
    } catch { toast('El navegador no deja leer el portapapeles: pulsa Ctrl+V (o mantén pulsado y Pegar) con la ficha abierta.', 'warn', 6000); }
  };
  // Ctrl+V / Pegar con la ficha abierta
  useEffect(() => {
    if (!puede) return;
    const h = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea')) return;
      const img = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
      if (img) { e.preventDefault(); void subir(img); }
    };
    addEventListener('paste', h); return () => removeEventListener('paste', h);
  });

  return (
    <div className="flex flex-col gap-2">
      <FotoGrande p={p}>
        {f && pend.has(f.foto) && <span className="absolute top-2 left-2 rounded-md bg-amber-100 text-amber-800 text-label-sm font-semibold px-2 py-1 flex items-center gap-1"><Ico n="cloud_upload" className="ico-16" />Pendiente de subir</span>}
        {f && p.fotoOrigen && <span className="absolute bottom-2 left-2 rounded-md bg-black/45 text-white text-label-sm px-2 py-1">{ORIGEN_TXT[p.fotoOrigen]}</span>}
        {ocupado && <span className="absolute inset-0 bg-white/70 grid place-items-center text-primary font-semibold">Guardando foto…</span>}
      </FotoGrande>
      {puede && <>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" disabled={ocupado} onClick={() => camara.current?.click()} className={BTN_FOTO}><Ico n="photo_camera" className="ico-20" />{f ? 'Nueva foto' : 'Hacer foto'}</button>
          <button type="button" disabled={ocupado} onClick={() => archivo.current?.click()} className={BTN_FOTO}><Ico n="upload_file" className="ico-20" />Archivo</button>
          <button type="button" disabled={ocupado} onClick={() => void pegar()} className={BTN_FOTO}><Ico n="content_paste" className="ico-20" />Pegar</button>
        </div>
        <label className="flex items-center gap-2 text-body-sm text-secondary">Origen de la foto
          <select value={origen} onChange={e => setOrigen(e.target.value as OrigenFoto)} className="bg-surface-container-low rounded-lg px-2 py-1.5 text-on-surface">
            {ORIGENES_FOTO.map(o => <option key={o} value={o}>{ORIGEN_TXT[o]}</option>)}
          </select>
        </label>
        <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { void subir(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={archivo} type="file" accept="image/*" className="hidden" onChange={e => { void subir(e.target.files?.[0]); e.target.value = ''; }} />
      </>}
      {perm.quitar && <button type="button" disabled={ocupado} onClick={() => { if (confirm('¿Quitar la foto de este artículo (y de sus otras tallas)?')) void quitarFoto(p.sku).then(ok => ok && toast('Foto quitada.', 'ok')); }} className="self-start text-error text-body-sm font-semibold">Quitar la foto</button>}
      {f && !puede && <p className="text-body-sm text-secondary">Solo el administrador puede cambiar esta foto.</p>}
    </div>
  );
}

/** Miniatura para una línea de entrega, plantilla o pedido: artículo por SKU, modelo de ropa/EPI o herramienta */
export function FotoLinea({ sku, modelo, herramienta, size = 'w-10 h-10' }: { sku?: string; modelo?: string; herramienta?: string; size?: string }) {
  const E = useAlmacen();
  const h = herramienta ? E.herramientas.find(x => x.id === herramienta) : undefined;
  if (h) return <FotoHerramienta h={h} size={size} />;
  const p = (sku && E.products.find(x => x.sku === sku)) || (modelo && E.products.find(x => x.modelo === modelo)) || undefined;
  if (p) return <FotoProducto p={p} size={size} icono="ico-20" />;
  if (modelo) return <FotoHerramienta h={{ modelo, nombre: modelo, clase: 'herramienta' } as Herramienta} size={size} />;
  return <div className={`${size} shrink-0 rounded-xl grid place-items-center bg-surface-container-high text-secondary`}><Ico n="inventory_2" className="ico-20" /></div>;
}
