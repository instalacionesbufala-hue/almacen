/* E-007 · Entregas con plantilla: preparar (reserva el stock), firmar en pantalla grande, plantillas, tallas, justificante e informe */
import { useMemo, useState } from 'react';
import type { Entrega, LineaEntrega, LineaPlantilla, Plantilla, Tallas, TipoTalla } from '../../data/tipos';
import { UNIT } from '../../data/catalogo';
import { disponibleReal, find, numEntrega, qtyTxt, searchProducts, valorProducto } from '../../domain/reglas';
import { eur, fechaHora, num, toNum } from '../../domain/formato';
import { hashEntrega } from '../../domain/hash';
import { descargarCsv } from '../../domain/csv';
import { herramientasLibres, NOMBRE_TALLA, resolverPlantilla, type LineaResuelta } from '../../domain/plantillas';
import { ejecutar, guardar, S, useAlmacen } from '../../store/almacen';
import { usePermisos } from '../../store/permisos';
import { nuevoId } from '../../store/ops';
import { modoNube, supabase } from '../../store/nube/cliente';
import { procesarAhora } from '../../store/nube/avisos';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { Firma, firmaPNG, type Trazo } from '../../ui/firma';
import { BTN_P, BTN_S, Campo, Icon, INP, LBL, Tag, Vacio } from '../../ui/base';
import { abrirRecibo } from './EntregasView';
import { FotoLinea } from '../../ui/foto';
import { fotoDe, fotoDeHerramienta } from '../../domain/fotos';
import { urlFoto } from '../fotos/servicio';
import { aJpegDataUrl } from '../fotos/imagen';

/* ---------- Entregas preparadas (reservadas, pendientes de firma) ---------- */
export function Preparadas() {
  const E = useAlmacen();
  const lista = E.entregas.filter(e => e.estado === 'preparada').sort((a, b) => (a.caduca ?? 0) - (b.caduca ?? 0));
  if (!lista.length) return null;
  return (
    <section className="bg-amber-50 rounded-xl p-4 flex flex-col gap-2">
      <h2 className="font-semibold flex items-center gap-2"><Icon n="inventory" className="text-amber-800" />Entregas preparadas: el stock está reservado hasta que el técnico firme</h2>
      {lista.map(e => { const caducada = (e.caduca ?? 0) <= Date.now(), t = E.tecnicos.find(x => x.id === e.receptor), pl = E.plantillas.find(p => p.id === e.plantilla); return (
        <div key={e.id} className="flex flex-wrap items-center gap-3 bg-white rounded-lg p-3">
          <div className="flex-1 min-w-[200px]"><div className="font-semibold">{numEntrega(e)} · {t?.nombre} · {E.equipos.find(q => q.id === e.equipo)?.flota}</div>
            <div className="text-body-sm text-secondary">{pl ? pl.nombre + ' · ' : ''}{e.lineas.length} líneas{e.obra ? ` · ${e.obra}` : ''} · {caducada ? <span className="text-error">reserva caducada</span> : `reserva hasta ${fechaHora(e.caduca!)}`}</div></div>
          <button onClick={() => { if (ejecutar({ op: 'anularEntrega', args: { id: e.id } })) toast('Entrega anulada: el stock vuelve a estar libre.', 'ok'); }} className={`${BTN_S} h-11 px-3`}>Anular</button>
          {!caducada && <button onClick={() => abrirFirma(e.id)} className={`${BTN_P} h-11 px-4`}><Icon n="draw" className="ico-20" />Firmar</button>}
        </div>); })}
    </section>
  );
}

/* ---------- Preparar desde plantilla ---------- */
export const abrirPreparar = (equipo?: string) => openModal(<Preparar equipo0={equipo} />, { ancha: true });
function Preparar({ equipo0 }: { equipo0?: string }) {
  const E = useAlmacen();
  const [equipo, setEquipo] = useState(equipo0 || E.cesta.equipo || E.equipos[0]?.id || '');
  const eq = E.equipos.find(x => x.id === equipo);
  const [receptor, setReceptor] = useState(eq?.tecnicos[0] || '');
  const [plantilla, setPlantilla] = useState(E.plantillas[0]?.id || '');
  const [obra, setObra] = useState('');
  const [lineas, setLineas] = useState<LineaResuelta[]>(() => { const pl = E.plantillas.find(p => p.id === plantilla); return pl ? resolverPlantilla(E, pl, equipo, receptor) : []; });
  const [q, setQ] = useState('');
  const recalcular = (pid = plantilla, eqId = equipo, rec = receptor) => { const pl = E.plantillas.find(p => p.id === pid); setLineas(pl ? resolverPlantilla(S(), pl, eqId, rec) : []); };
  const cambiarEquipo = (id: string) => { const r = E.equipos.find(x => x.id === id)?.tecnicos[0] || ''; setEquipo(id); setReceptor(r); recalcular(plantilla, id, r); };
  const setL = (clave: string, cambio: Partial<LineaResuelta>) => setLineas(lineas.map(l => l.clave === clave ? { ...l, ...cambio } : l));
  const extras = q.trim() ? searchProducts(E, q).filter(p => !lineas.some(l => l.sku === p.sku)).slice(0, 6) : [];
  const validas = lineas.filter(l => l.cantidad > 0);
  const aEntrega = (): LineaEntrega[] => validas.flatMap((l): LineaEntrega[] => l.tipo === 'herramienta'
    ? l.herramientas.slice(0, l.cantidad).map((id): LineaEntrega => ({ tipo: 'herramienta', sku: '', qty: 1, serials: [], dotacion: id }))
    : [{ tipo: 'stock' as const, sku: l.sku!, qty: l.cantidad, serials: find(E, l.sku!)?.serialized ? l.serials.slice(0, l.cantidad) : [] }]);
  const preparar = (firmarYa: boolean) => {
    if (!validas.length) return toast('No hay nada que entregar.', 'err');
    const numero = modoNube ? undefined : `ENT-${new Date().getFullYear()}-${String(E.seq.ent + 1).padStart(4, '0')}`;
    const id = modoNube ? nuevoId() : numero!;
    if (!ejecutar({ op: 'prepararEntrega', args: { id, numero, equipo, receptor, obra: obra.trim(), plantilla: plantilla || undefined, lineas: aEntrega() } })) return;
    if (!modoNube) { E.seq.ent++; guardar(); }
    closeModal();
    if (firmarYa) abrirFirma(id); else toast(`Entrega preparada: el material queda reservado ${E.configAvisos.horasReserva} h hasta que ${E.tecnicos.find(t => t.id === receptor)?.nombre} firme.`, 'ok', 6000);
  };
  return (<>
    <SheetHead title="Preparar entrega" sub="Elige la plantilla y el técnico: la cesta sale rellena con sus cantidades y tallas. Ajusta lo que haga falta." />
    <div className="p-5 flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <Campo label="Plantilla"><select value={plantilla} onChange={e => { setPlantilla(e.target.value); recalcular(e.target.value); }} className={`${INP} h-12`}><option value="">— Sin plantilla —</option>{E.plantillas.map(p => <option key={p.id} value={p.id}>{p.nombre}{p.modoKit ? ' (kit)' : ''}</option>)}</select></Campo>
        <Campo label="Equipo / furgoneta"><select value={equipo} onChange={e => cambiarEquipo(e.target.value)} className={`${INP} h-12`}>{E.equipos.map(x => <option key={x.id} value={x.id}>{x.nombre} · {x.matricula}</option>)}</select></Campo>
        <Campo label="Técnico que recibe"><select value={receptor} onChange={e => { setReceptor(e.target.value); recalcular(plantilla, equipo, e.target.value); }} className={`${INP} h-12`}>{(eq?.tecnicos || []).map(id => <option key={id} value={id}>{E.tecnicos.find(t => t.id === id)?.nombre}</option>)}</select></Campo>
        <Campo label="Obra (opcional)"><input value={obra} onChange={e => setObra(e.target.value)} className={`${INP} h-12`} placeholder="C/ Recogidas 12, Granada" /></Campo>
      </div>
      {E.plantillas.find(p => p.id === plantilla)?.modoKit && <p className="text-body-sm text-primary bg-primary-fixed/40 rounded-lg p-2">Modo kit: se entrega solo lo que le falta a la furgoneta para llegar al contenido de la plantilla.</p>}
      <div className="flex flex-col">{lineas.length ? lineas.map(l => { const p = l.sku ? find(E, l.sku) : undefined; return (
        <div key={l.clave} className={`flex flex-wrap items-center gap-3 py-2.5 border-b border-surface-container ${l.cantidad === 0 ? 'opacity-60' : ''}`}>
          <FotoLinea sku={l.sku} modelo={l.modelo} herramienta={l.herramientas[0]} size="w-11 h-11" /><div className="flex-1 min-w-[200px]"><div className="font-medium">{l.nombre}</div>
            <div className="font-mono text-label-sm text-secondary">{l.sku || l.modelo} · disponible {num(l.disponible)}{l.pedida !== l.cantidad ? ` · plantilla ${num(l.pedida)}` : ''}</div>
            {l.aviso && <div className="text-body-sm text-amber-800">{l.aviso}</div>}
            {p?.serialized && l.cantidad > 0 && <div className="flex flex-wrap gap-1 mt-1">{(p.serials || []).map(s => <button key={s} onClick={() => setL(l.clave, { serials: l.serials.includes(s) ? l.serials.filter(x => x !== s) : [...l.serials, s].slice(-l.cantidad) })} className={`px-2 h-8 rounded font-mono text-label-sm ${l.serials.includes(s) ? 'bg-primary text-white' : 'bg-surface-container-low'}`}>{s}</button>)}</div>}
            {l.tipo === 'herramienta' && <div className="flex flex-wrap gap-1 mt-1">{herramientasLibres(E, l.modelo!).map(h => <button key={h.id} onClick={() => setL(l.clave, { herramientas: l.herramientas.includes(h.id) ? l.herramientas.filter(x => x !== h.id) : [...l.herramientas, h.id].slice(-l.cantidad) })} className={`px-2 h-8 rounded font-mono text-label-sm ${l.herramientas.includes(h.id) ? 'bg-primary text-white' : 'bg-surface-container-low'}`}>{h.serie || h.id}</button>)}</div>}
          </div>
          <input value={String(l.cantidad)} disabled={!l.editable && l.cantidad <= l.disponible} onChange={e => setL(l.clave, { cantidad: Math.max(0, Math.min(toNum(e.target.value) || 0, l.disponible)) })} inputMode="decimal" className={`${INP} !w-24 h-11 text-center font-mono`} aria-label={`Cantidad de ${l.nombre}`} />
          <span className="text-body-sm text-secondary w-8">{p ? UNIT[p.unit] : 'ud'}</span>
          <button onClick={() => setLineas(lineas.filter(x => x.clave !== l.clave))} className="p-2 text-error" aria-label="Quitar línea"><Icon n="close" /></button>
        </div>); }) : <Vacio>Elige una plantilla o añade material.</Vacio>}</div>
      <div className="relative"><Icon n="add" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline ico-20" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Añadir un extra: busca en el catálogo" className={`${INP} pl-10 h-11`} /></div>
      {extras.map(p => <button key={p.sku} onClick={() => { const disp = Math.max(0, disponibleReal(E, p)); setLineas([...lineas, { clave: 'x' + p.sku, tipo: 'stock', sku: p.sku, nombre: p.name, cantidad: Math.min(p.unit === 'm' ? 10 : 1, disp), pedida: 1, editable: true, disponible: disp, serials: (p.serials || []).slice(0, 1), herramientas: [] }]); setQ(''); }}
        className="text-left flex justify-between gap-2 py-2 px-3 rounded-lg bg-surface-container-low"><span>{p.name}</span><span className="font-mono text-label-sm text-secondary">{qtyTxt(p, disponibleReal(E, p))} libres</span></button>)}
    </div>
    <SheetFoot className="flex flex-wrap gap-2"><button onClick={() => preparar(false)} disabled={!validas.length} className={`${BTN_S} h-12 px-4`}><Icon n="bookmark_add" className="ico-20" />Guardar preparada (reserva)</button>
      <button onClick={() => preparar(true)} disabled={!validas.length} className={`${BTN_P} h-12 flex-1`}><Icon n="draw" className="ico-20" />Preparar y firmar ahora ({validas.length} líneas)</button></SheetFoot>
  </>);
}

/* ---------- Firma en pantalla grande: el técnico comprueba y firma con el dedo ---------- */
export const abrirFirma = (id: string) => openModal(<FirmaGrande id={id} />, { ancha: true });
function FirmaGrande({ id }: { id: string }) {
  const E = useAlmacen(), e = E.entregas.find(x => x.id === id);
  const [firma, setFirma] = useState<Trazo[]>([]);
  if (!e) return <SheetHead title="Entrega no encontrada" />;
  const t = E.tecnicos.find(x => x.id === e.receptor);
  const firmar = async () => {
    if (!ejecutar({ op: 'confirmarEntrega', args: { id, firma: firmaPNG(firma) } })) return;
    if (!modoNube) { const x = S().entregas.find(y => y.id === id)!; x.hash = await hashEntrega(x); guardar(); }
    closeModal(); toast(`Entrega firmada por ${t?.nombre}. Stock descontado${modoNube ? '; el número y la huella se confirman al sincronizar' : ''}.`, 'ok', 6000);
    abrirRecibo(id);
  };
  return (<>
    <SheetHead title={`Entrega para ${t?.nombre}`} sub={`${numEntrega(e)} · ${E.equipos.find(q => q.id === e.equipo)?.flota}${e.obra ? ' · ' + e.obra : ''}`} />
    <div className="p-5 flex flex-col gap-3">
      <ul className="flex flex-col gap-1 text-headline-sm">{e.lineas.map((l, i) => { const p = find(E, l.sku), h = E.herramientas.find(x => x.id === l.dotacion); return (
        <li key={i} className="flex items-center gap-3 py-2 border-b border-surface-container"><FotoLinea sku={l.sku} herramienta={l.dotacion} size="w-12 h-12" /><span className="flex-1">{h ? `${h.nombre} · ${h.serie}` : p?.name}{l.serials.length ? <span className="block font-mono text-label-md text-secondary">S/N {l.serials.join(', ')}</span> : null}</span>
          <b className="whitespace-nowrap">{h ? '1 ud' : p ? qtyTxt(p, l.qty) : num(l.qty)}</b></li>); })}</ul>
      <div><div className={`${LBL} mb-1`}>Firma de {t?.nombre}</div><Firma trazos={firma} onChange={setFirma} /><button onClick={() => setFirma([])} className="text-body-sm text-secondary mt-1">Borrar firma</button></div>
      <p className="text-body-sm text-secondary">Al firmar confirmas que recibes este material revisado y completo.</p>
    </div>
    <SheetFoot><button onClick={() => void firmar()} disabled={!firma.length} className={`${BTN_P} w-full h-16 text-headline-sm`}><Icon n="check_circle" className="ico-fill" />Firmar y recibir</button></SheetFoot>
  </>);
}

/* ---------- Justificante en PDF (Supabase Storage) ---------- */
interface JsPDFDoc { setFontSize(n: number): void; text(t: string | string[], x: number, y: number): void; addImage(d: string, f: string, x: number, y: number, w: number, h: number): void; splitTextToSize(t: string, w: number): string[]; output(t: 'blob'): Blob; save(n: string): void }
declare global { interface Window { jspdf?: { jsPDF: new () => JsPDFDoc } } }
async function cargarJsPDF() {
  if (window.jspdf) return window.jspdf.jsPDF;
  await new Promise<void>((ok, ko) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'; s.onload = () => ok(); s.onerror = () => ko(new Error('Sin conexión: no se puede generar el PDF')); document.head.appendChild(s); });
  return window.jspdf!.jsPDF;
}
export async function justificantePdf(e: Entrega): Promise<Blob> {
  const E = S(), J = await cargarJsPDF(), d = new J();
  const eq = E.equipos.find(q => q.id === e.equipo), t = E.tecnicos.find(x => x.id === e.receptor);
  d.setFontSize(16); d.text(`Albarán de entrega ${numEntrega(e)}`, 15, 20);
  d.setFontSize(10); d.text([`Almacén Búfala · ${fechaHora(e.ts)}`, `Equipo: ${eq?.nombre || e.equipo} · ${eq?.flota || ''} (${eq?.matricula || ''})`, `Recibe: ${t?.nombre || ''} · DNI ${e.dni || t?.dni || ''}`, e.obra ? `Obra: ${e.obra}` : ''].filter(Boolean), 15, 30);
  let y = 58;
  for (const l of e.lineas) {
    const p = find(E, l.sku), h = E.herramientas.find(x => x.id === l.dotacion);
    const txt = `${h ? `${h.nombre} · ${h.serie}` : p?.name || l.sku}  —  ${h ? '1 ud' : p ? qtyTxt(p, l.qty) : num(l.qty)}${l.serials.length ? `  (S/N ${l.serials.join(', ')})` : ''}`;
    // E-009: miniatura de la foto en cada línea (si el artículo la tiene)
    const f = h ? fotoDeHerramienta(E, h) : fotoDe(E, p);
    const img = f ? await urlFoto(f.mini).then(u => u ? aJpegDataUrl(u) : null) : null;
    const y0 = y;
    if (img) d.addImage(img, 'JPEG', 15, y - 4, 11, 11);
    for (const linea of d.splitTextToSize(txt, 165)) { d.text(linea, 29, y); y += 6; }
    y = Math.max(y, y0 + 10);
  }
  if (e.firma?.startsWith('data:')) d.addImage(e.firma, 'PNG', 15, y + 6, 70, 27);
  d.text(`Firma de ${t?.nombre || 'el receptor'}`, 15, y + 38);
  d.setFontSize(7); d.text(d.splitTextToSize(`Huella SHA-256: ${e.hash || 'se calcula en el servidor'}`, 180), 15, y + 46);
  return d.output('blob');
}
export async function guardarJustificante(e: Entrega): Promise<string | null> {
  const pdf = await justificantePdf(e), nombre = `${numEntrega(e)}.pdf`;
  if (!supabase) { const a = document.createElement('a'); a.href = URL.createObjectURL(pdf); a.download = nombre; a.click(); return null; }
  const ruta = `entregas/${nombre}`;
  const { error } = await supabase.storage.from('justificantes').upload(ruta, pdf, { contentType: 'application/pdf', upsert: false });
  if (error && !/exists|Duplicate/i.test(error.message)) throw new Error(error.message);
  const { data } = await supabase.storage.from('justificantes').createSignedUrl(ruta, 7 * 24 * 3600);
  return data?.signedUrl || null;
}
export async function enviarJustificante(e: Entrega) {
  try {
    const url = await guardarJustificante(e);
    if (!modoNube) return toast('PDF descargado. En la nube se guarda y se envía por correo.', 'ok');
    const E = S(), t = E.tecnicos.find(x => x.id === e.receptor);
    if (E.rol !== 'admin') return toast('Justificante guardado en la nube.', 'ok');
    if (!ejecutar({ op: 'envio', args: { canal: 'correo', tipo: 'solicitud', asunto: `Justificante de entrega ${numEntrega(e)}`, cuerpo: `Entrega ${numEntrega(e)} firmada por ${t?.nombre} el ${fechaHora(e.ts)}.\n\nPDF (enlace válido 7 días): ${url}`, destinatarios: [] } })) return;
    const err = await procesarAhora(); err ? toast(err, 'err', 7000) : toast('Justificante guardado y enviado por correo.', 'ok');
  } catch (err) { toast((err as Error).message, 'err', 7000); }
}

/* ---------- Plantillas (administrador) ---------- */
export const abrirPlantillas = () => openModal(<Plantillas />, { ancha: true });
function Plantillas() {
  const E = useAlmacen();
  return (<>
    <SheetHead title="Plantillas de entrega" sub="Se elige una, se ajusta si hace falta y el técnico solo firma." />
    <div className="p-5 flex flex-col gap-2">
      {E.plantillas.map(p => <button key={p.id} onClick={() => openModal(<EditarPlantilla p={p} />, { ancha: true })} className="text-left rounded-xl bg-surface-container-low p-3 flex justify-between gap-2">
        <span><b>{p.nombre}</b>{p.modoKit && <Tag c="bg-primary-fixed text-primary ml-2">Kit de furgoneta</Tag>}<span className="block text-body-sm text-secondary">{p.descripcion} · {p.lineas.length} líneas</span></span><Icon n="chevron_right" /></button>)}
      <button onClick={() => openModal(<EditarPlantilla p={{ id: nuevoId(), nombre: '', descripcion: '', modoKit: false, activa: true, lineas: [] }} />, { ancha: true })} className={`${BTN_P} h-12`}><Icon n="add" className="ico-20" />Nueva plantilla</button>
    </div>
  </>);
}
function EditarPlantilla({ p }: { p: Plantilla }) {
  const E = useAlmacen();
  const [f, setF] = useState<Plantilla>(JSON.parse(JSON.stringify(p)));
  const [q, setQ] = useState('');
  const modelosRopa = [...new Set(E.products.filter(x => (x.cat === 'ropa' || x.cat === 'epis') && x.modelo).map(x => x.modelo!))];
  const modelosHerr = [...new Set(E.herramientas.filter(h => h.clase === 'herramienta' && h.modelo).map(h => h.modelo!))];
  const setLinea = (i: number, c: Partial<LineaPlantilla>) => setF({ ...f, lineas: f.lineas.map((l, j) => j === i ? { ...l, ...c } : l) });
  const guardarP = (activa = true) => { if (ejecutar({ op: 'plantilla', args: { ...f, activa } })) { closeModal(); toast(activa ? 'Plantilla guardada.' : 'Plantilla retirada.', 'ok'); } };
  return (<>
    <SheetHead title={p.nombre || 'Nueva plantilla'} />
    <div className="p-5 flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Campo label="Nombre"><input value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} className={`${INP} h-12`} placeholder="Instalación punto de recarga monofásico" /></Campo>
        <Campo label="Descripción"><input value={f.descripcion} onChange={e => setF({ ...f, descripcion: e.target.value })} className={`${INP} h-12`} /></Campo>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={f.modoKit} onChange={e => setF({ ...f, modoKit: e.target.checked })} className="w-5 h-5 accent-primary" />Kit de furgoneta: la plantilla es el contenido objetivo y se entrega solo la diferencia</label>
      {f.lineas.map((l, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 py-2 border-b border-surface-container">
          <FotoLinea sku={l.sku} modelo={l.modelo} /><span className="flex-1 min-w-[200px] font-medium">{l.tipo === 'stock' ? find(E, l.sku!)?.name || l.sku : l.tipo === 'modelo' ? `${l.modelo} · talla de ${NOMBRE_TALLA[l.tipoTalla!]}` : `${l.modelo} (herramienta)`}</span>
          {l.tipo === 'modelo' && <select value={l.tipoTalla} onChange={e => setLinea(i, { tipoTalla: e.target.value as TipoTalla })} className={`${INP} !w-auto h-10`} aria-label="Talla">{(Object.keys(NOMBRE_TALLA) as TipoTalla[]).map(k => <option key={k} value={k}>{NOMBRE_TALLA[k]}</option>)}</select>}
          <input value={String(l.cantidad)} onChange={e => setLinea(i, { cantidad: toNum(e.target.value) || 0 })} inputMode="decimal" className={`${INP} !w-20 h-10 text-center`} aria-label="Cantidad" />
          <label className="flex items-center gap-1 text-body-sm"><input type="checkbox" checked={l.editable} onChange={e => setLinea(i, { editable: e.target.checked })} className="accent-primary" />Se puede cambiar</label>
          <button onClick={() => setF({ ...f, lineas: f.lineas.filter((_, j) => j !== i) })} className="p-2 text-error" aria-label="Quitar"><Icon n="close" /></button>
        </div>))}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="relative sm:col-span-1"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Añadir referencia…" className={`${INP} h-11`} />
          {q && <div className="absolute z-10 left-0 right-0 bg-white shadow-lg rounded-lg mt-1">{searchProducts(E, q).filter(x => x.cat !== 'ropa' && x.cat !== 'epis').slice(0, 6).map(x => <button key={x.sku} onClick={() => { setF({ ...f, lineas: [...f.lineas, { tipo: 'stock', sku: x.sku, cantidad: x.unit === 'm' ? 10 : 1, editable: true }] }); setQ(''); }} className="block w-full text-left px-3 py-2 hover:bg-surface-container-low text-body-sm">{x.name}</button>)}</div>}</div>
        <select value="" onChange={e => e.target.value && setF({ ...f, lineas: [...f.lineas, { tipo: 'modelo', modelo: e.target.value, tipoTalla: /guant/i.test(e.target.value) ? 'guantes' : /calz|bota/i.test(e.target.value) ? 'calzado' : /pant/i.test(e.target.value) ? 'pantalon' : 'camiseta', cantidad: 1, editable: true }] })} className={`${INP} h-11`} aria-label="Añadir ropa o EPI"><option value="">Añadir ropa o EPI (por talla)…</option>{modelosRopa.map(m => <option key={m} value={m}>{m}</option>)}</select>
        <select value="" onChange={e => e.target.value && setF({ ...f, lineas: [...f.lineas, { tipo: 'herramienta', modelo: e.target.value, cantidad: 1, editable: false }] })} className={`${INP} h-11`} aria-label="Añadir herramienta"><option value="">Añadir herramienta…</option>{modelosHerr.map(m => <option key={m} value={m}>{m}</option>)}</select>
      </div>
    </div>
    <SheetFoot className="flex gap-2">{E.plantillas.some(x => x.id === p.id) && <button onClick={() => guardarP(false)} className={`${BTN_S} h-12 px-4 text-error`}>Retirar</button>}<button onClick={() => guardarP(true)} className={`${BTN_P} h-12 flex-1`}><Icon n="save" className="ico-20" />Guardar plantilla</button></SheetFoot>
  </>);
}

/* ---------- Tallas del técnico ---------- */
export const abrirTallas = (tecnico: string) => openModal(<EditarTallas tecnico={tecnico} />);
function EditarTallas({ tecnico }: { tecnico: string }) {
  const E = useAlmacen(), t = E.tecnicos.find(x => x.id === tecnico)!;
  const [f, setF] = useState<Tallas>({ ...(t.tallas || {}) });
  const ok = () => { if (ejecutar({ op: 'tallas', args: { tecnico, tallas: f } })) { closeModal(); toast('Tallas guardadas.', 'ok'); } };
  return (<>
    <SheetHead title={`Tallas de ${t.nombre}`} sub="Las plantillas eligen con ellas la ropa y los EPIs." />
    <div className="p-5 grid grid-cols-2 gap-3">{(Object.keys(NOMBRE_TALLA) as TipoTalla[]).map(k =>
      <Campo key={k} label={NOMBRE_TALLA[k]}><input value={f[k] || ''} onChange={e => setF({ ...f, [k]: e.target.value.toUpperCase() })} className={`${INP} h-12 font-mono`} placeholder={k === 'camiseta' ? 'M' : k === 'pantalon' ? '44' : k === 'calzado' ? '42' : '9'} /></Campo>)}</div>
    <SheetFoot><button onClick={ok} className={`${BTN_P} w-full h-12`}><Icon n="save" className="ico-20" />Guardar tallas</button></SheetFoot>
  </>);
}

/* ---------- Informe: qué se ha entregado a cada técnico, por plantilla y periodo ---------- */
export const abrirInformeEntregas = () => openModal(<InformeEntregas />, { ancha: true });
function InformeEntregas() {
  const E = useAlmacen(), { verCostes } = usePermisos();
  const hoy = new Date();
  const [mes, setMes] = useState(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`);
  const [a, m] = mes.split('-').map(Number), desde = new Date(a, m - 1, 1).getTime(), hasta = new Date(a, m, 1).getTime();
  const filas = useMemo(() => {
    const g = new Map<string, { tecnico: string; plantilla: string; entregas: Set<string>; lineas: number; valor: number; obras: Set<string> }>();
    for (const e of E.entregas) {
      if ((e.estado ?? 'firmada') !== 'firmada' || e.ts < desde || e.ts >= hasta) continue;
      const k = `${e.receptor}|${e.plantilla || ''}`;
      const f = g.get(k) || { tecnico: E.tecnicos.find(t => t.id === e.receptor)?.nombre || e.receptor, plantilla: E.plantillas.find(p => p.id === e.plantilla)?.nombre || (e.plantilla ? 'Plantilla retirada' : 'Sin plantilla'), entregas: new Set<string>(), lineas: 0, valor: 0, obras: new Set<string>() };
      f.entregas.add(e.id); f.lineas += e.lineas.length; if (e.obra) f.obras.add(e.obra);
      for (const l of e.lineas) { const p = find(E, l.sku); if (p) f.valor += valorProducto({ ...p, stock: l.qty }); }
      g.set(k, f);
    }
    return [...g.values()].sort((x, y) => x.tecnico.localeCompare(y.tecnico));
  }, [E, desde, hasta]);
  const csv = () => descargarCsv(`entregas-por-tecnico-${mes}.csv`, [['Técnico', 'Plantilla', 'Entregas', 'Líneas', 'Obras', ...(verCostes ? ['Coste material propio'] : [])],
    ...filas.map(f => [f.tecnico, f.plantilla, f.entregas.size, f.lineas, [...f.obras].join(' | '), ...(verCostes ? [Math.round(f.valor * 100) / 100] : [])])]);
  return (<>
    <SheetHead title="Entregas por técnico y plantilla" sub="Útil para repartir costes por obra. El material en custodia no suma importe." />
    <div className="p-5 flex flex-col gap-3">
      <Campo label="Mes"><input type="month" value={mes} onChange={e => setMes(e.target.value)} className={`${INP} h-11 !w-48`} /></Campo>
      {filas.length ? <table className="tabla w-full text-body-sm"><thead><tr><th>Técnico</th><th>Plantilla</th><th>Entregas</th><th>Líneas</th><th>Obras</th>{verCostes && <th className="text-right">Coste</th>}</tr></thead>
        <tbody>{filas.map((f, i) => <tr key={i}><td>{f.tecnico}</td><td>{f.plantilla}</td><td>{f.entregas.size}</td><td>{f.lineas}</td><td>{[...f.obras].join(', ') || '—'}</td>{verCostes && <td className="text-right">{eur(f.valor)}</td>}</tr>)}</tbody></table>
        : <Vacio>No hay entregas firmadas en ese mes.</Vacio>}
    </div>
    <SheetFoot><button onClick={csv} disabled={!filas.length} className={`${BTN_S} w-full h-12`}><Icon n="table" className="ico-20" />Descargar CSV</button></SheetFoot>
  </>);
}

