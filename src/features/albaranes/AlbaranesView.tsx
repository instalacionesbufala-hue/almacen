/* Recepción de albaranes con IA: sube foto o PDF, la IA propone líneas y el usuario confirma. Nada entra solo. */
import { useRef, useState } from 'react';
import type { AlbaranIA } from '../../data/tipos';
import { MARCA, UNIT, idsCategoriasActivas } from '../../data/catalogo';
import { contenidoTxt, find, formatoEntero, matchLine, qtyTxt } from '../../domain/reglas';
import { fechaHora, hace, num, parseSN, toNum } from '../../domain/formato';
import { descargarCsv } from '../../domain/csv';
import { ejecutar, S, useAlmacen } from '../../store/almacen';
import { nuevoId } from '../../store/ops';
import { crearStore } from '../../store/crear';
import { useEsEscritorio } from '../../store/ui';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, BTN_T, CARD, Icon, INP, LBL, Tag, Vacio, Tile } from '../../ui/base';
import { abrirBorrador, abrirFormProducto } from '../inventario/hojas';
import { AVISO_GEMINI, DEMOS, demoPara, iaReal, leerConIA } from './lector';
import { FotoLinea } from '../../ui/foto';
import { categoriaSugerida, detectarUnidad, normalizarProveedor } from '../../../supabase/functions/_compartido/clasificar';
import { abrirDetalleAlbaran } from './DetalleAlbaran';

interface Linea { codigo: string; descripcion: string; cantidad: string; confianza: number; sku: string | null; how: string | null; include: boolean; series: string; nota: string }
interface Doc { proveedor: string; delegacion?: string; numero: string; fecha: string; cif: string; bultos?: number }
interface Alb { stage: 'idle' | 'processing' | 'review'; mode: 'ia' | 'sim' | null; steps: ('run' | 'done')[]; doc: Doc; lines: Linea[]; file: string; preview: string | null; isPdf: boolean; ms: number }
const vacio = (): Alb => ({ stage: 'idle', mode: null, steps: [], doc: { proveedor: '', numero: '', fecha: '', cif: '' }, lines: [], file: '', preview: null, isPdf: false, ms: 0 });
/* El albarán en curso sobrevive a los cambios de pantalla */
const albStore = crearStore<Alb>(vacio());
const A = () => albStore.get();
const emit = () => albStore.emit();

const PASOS: [string, string, string][] = [
  ['Segmentación de cabecera', 'Proveedor, CIF, n.º de albarán y fecha', 'view_agenda'],
  ['Matriz de líneas y n.º de serie', 'Códigos, cantidades y series por línea', 'qr_code_2'],
  ['Cotejo con el catálogo', 'Emparejado con SKU y detección de modelos nuevos', 'join_inner'],
];
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function cargarLineas(doc: AlbaranIA, mode: 'ia' | 'sim') {
  const E = S(), a = A();
  // E-016: el proveedor es el emisor (nunca Búfala) y Saltoki es uno solo, con la delegación aparte
  const np = normalizarProveedor(doc.proveedor || '');
  a.doc = { proveedor: np.proveedor, delegacion: np.delegacion, numero: doc.numero || '', fecha: doc.fecha || '', cif: doc.cif || '', bultos: doc.bultos };
  a.lines = (doc.lineas || []).map(l => {
    let sku = l.sku && find(E, l.sku) ? l.sku : null, how: string | null = sku ? 'IA' : null;
    if (!sku) { const m = matchLine(E, l.codigo, l.descripcion); sku = m.sku; how = m.how; }
    const embalaje = /bolsa|embalaje|porte/i.test(l.descripcion || '') && !sku;
    return { codigo: l.codigo || '', descripcion: l.descripcion || '', cantidad: String(Number(l.cantidad) || 0), confianza: Number(l.confianza) || .8, sku, how, include: !!sku && !embalaje, series: (l.series || []).join('\n'), nota: l.nota || '' };
  });
  a.mode = mode;
}
async function pasos() { for (let i = 0; i < 3; i++) { A().steps[i] = 'run'; emit(); await wait(600 + Math.random() * 450); A().steps[i] = 'done'; } }

export async function procesarDemo(key: string, nombre?: string, mantener = false) {
  const prev = mantener ? { preview: A().preview, isPdf: A().isPdf } : { preview: null, isPdf: false };
  const t0 = performance.now();
  albStore.set({ ...vacio(), stage: 'processing', mode: 'sim', file: nombre || `Ejemplo · ${DEMOS[key].proveedor} ${DEMOS[key].numero}`, ...prev });
  await pasos();
  cargarLineas(DEMOS[key], 'sim'); A().stage = 'review'; A().ms = performance.now() - t0; emit();
}
export async function procesarArchivo(file?: File) {
  if (!file || A().stage === 'processing') return;
  const isImg = /^image\//.test(file.type), isPdf = file.type === 'application/pdf';
  if (!isImg && !isPdf) return toast('Formato no admitido. Sube una foto (JPG/PNG) o un PDF.', 'err');
  const t0 = performance.now();
  albStore.set({ ...vacio(), stage: 'processing', file: file.name, preview: URL.createObjectURL(file), isPdf });
  if (iaReal()) {
    A().mode = 'ia'; A().steps = ['run']; emit();
    try {
      const t = setTimeout(() => { A().steps = ['done', 'run']; emit(); }, 2500);
      const data = await leerConIA(file, S());
      clearTimeout(t); A().steps = ['done', 'done', 'run']; emit(); await wait(300);
      cargarLineas(data, 'ia'); A().steps[2] = 'done'; A().stage = 'review'; A().ms = performance.now() - t0; emit();
      if (!A().lines.length) toast('La IA no ha encontrado líneas de material. Prueba con una foto más nítida y de frente.', 'warn', 7000);
      return;
    } catch (e) { toast(`${(e as Error).message}. Se muestra un resultado simulado.`, 'warn', 7000); }
  }
  await procesarDemo(demoPara(file.name), file.name, true);
}

function confirmar() {
  const E = S(), a = A(), lines = a.lines.filter(l => l.include && l.sku);
  for (const l of lines) {
    const p = find(E, l.sku!)!, q = toNum(l.cantidad);
    if (!(q > 0)) return toast(`Revisa la cantidad de ${p.name}.`, 'err');
    if (formatoEntero(p) && q !== Math.trunc(q)) return toast(`${p.name}: se recibe por ${p.unit} entero (revisa la cantidad).`, 'err', 7000);
  }
  const conf = a.lines.reduce((s, l) => s + l.confianza, 0) / (a.lines.length || 1);
  // todo o nada: se valida entero en local y el servidor lo repite en una sola transacción
  if (!ejecutar({ op: 'albaran', args: { id: nuevoId(), cabecera: { numero: a.doc.numero || 's/n', proveedor: normalizarProveedor(a.doc.proveedor).proveedor || a.doc.proveedor, delegacion: a.doc.delegacion || '', cif: a.doc.cif, fecha: a.doc.fecha, confianza: conf, modo: a.mode || 'sim' },
    lineas: lines.map(l => ({ sku: l.sku!, cantidad: toNum(l.cantidad), series: [], codigo: l.codigo || undefined })) } })) return;
  toast(`Albarán ${a.doc.numero} integrado: ${lines.length} línea${lines.length === 1 ? '' : 's'} sumada${lines.length === 1 ? '' : 's'} al stock.`, 'ok', 6000);
  albStore.set(vacio());
}

export default function AlbaranesView() {
  const E = useAlmacen(), a = albStore.use(), desk = useEsEscritorio(), input = useRef<HTMLInputElement>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const avg = E.albaranes.length ? E.albaranes.reduce((s, h) => s + (h.confianza || .95), 0) / E.albaranes.length : .98;
  const procesando = a.stage === 'processing';
  return (
    <div className="px-4 lg:px-gutter py-4 lg:py-space-lg flex flex-col gap-space-lg max-w-[1600px]">
      <section className={`${CARD} p-space-md lg:p-space-lg flex flex-col lg:flex-row gap-space-md lg:items-center justify-between relative overflow-hidden`}>
        <div className="absolute -right-10 -top-16 w-72 h-72 rounded-full bg-tertiary-fixed/20 blur-3xl pointer-events-none" />
        <div className="flex gap-space-md relative"><span className="w-12 h-12 shrink-0 rounded-xl bg-primary-container text-white grid place-items-center"><Icon n="document_scanner" className="ico-28" /></span>
          <div><h1 className="text-headline-lg-mobile lg:text-headline-lg font-bold">Recepción inteligente de albaranes</h1>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full ${iaReal() ? 'bg-tertiary-fixed/40 text-tertiary' : 'bg-surface-container-high text-secondary'} font-mono text-label-sm mt-1`}><span className={`w-1.5 h-1.5 rounded-full bg-current ${iaReal() ? 'pulso' : ''}`} />{iaReal() ? 'IA CONECTADA (GEMINI)' : 'MODO SIMULADO'}</span>
            <p className="text-body-md text-secondary mt-2 max-w-2xl">Foto o PDF del albarán en papel, de cualquier proveedor. La IA extrae proveedor, líneas, cantidades y números de serie, y los coteja con el catálogo. <b className="text-on-surface">Nada entra en stock hasta que tú lo confirmas.</b></p>
            {iaReal() && <p className="text-body-sm text-amber-800 bg-amber-50 rounded-lg p-2 mt-2 max-w-2xl">{AVISO_GEMINI}</p>}</div></div>
        <div className="grid grid-cols-2 gap-space-sm relative shrink-0">
          <div className="bg-surface-container-low rounded-xl p-3 flex items-center gap-2"><Icon n="bolt" className="text-primary" /><div><div className={LBL}>Último proceso</div><div className="font-mono text-label-lg">{a.ms ? (a.ms / 1000).toFixed(2) + ' s' : '—'}</div></div></div>
          <div className="bg-surface-container-low rounded-xl p-3 flex items-center gap-2"><Icon n="verified" className="text-tertiary" /><div><div className={LBL}>Confianza media</div><div className="font-mono text-label-lg">{(avg * 100).toFixed(1)}%</div></div></div></div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
        <section className={`lg:col-span-8 ${CARD} p-space-md`}>
          <button onClick={() => input.current?.click()} disabled={procesando}
            onDragOver={e => { e.preventDefault(); setArrastrando(true); }} onDragLeave={() => setArrastrando(false)} onDrop={e => { e.preventDefault(); setArrastrando(false); procesarArchivo(e.dataTransfer.files[0]); }}
            className={`w-full flex flex-col items-center justify-center text-center gap-3 min-h-[220px] rounded-xl border-2 border-dashed ${arrastrando ? 'border-primary bg-primary-fixed/50' : 'border-primary-fixed-dim bg-surface-container-low hover:bg-surface-container'} p-6 transition-colors`}>
            <span className="w-16 h-16 rounded-2xl bg-primary-fixed text-primary grid place-items-center"><Icon n={procesando ? 'progress_activity' : 'cloud_upload'} className={`ico-32 ${procesando ? 'girar' : ''}`} /></span>
            <span className="text-headline-sm font-semibold">{procesando ? `Procesando ${a.file}…` : desk ? 'Arrastra aquí el albarán o selecciónalo de tu equipo' : 'Hacer foto o subir albarán'}</span>
            <span className="text-body-sm text-secondary">PDF, JPG o PNG. En el móvil puedes usar la cámara directamente.</span>
            <span className="flex flex-wrap justify-center gap-2"><Tag>PDF</Tag><Tag>JPG / PNG</Tag><Tag>CÁMARA</Tag></span>
          </button>
          <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { procesarArchivo(e.target.files?.[0]); e.target.value = ''; }} />
          <div className="mt-space-md"><div className={`${LBL} mb-2`}>¿Sin albarán a mano? Prueba con uno de ejemplo</div>
            <div className="flex flex-wrap gap-2">{Object.entries(DEMOS).map(([k, d]) => <button key={k} onClick={() => procesarDemo(k)} disabled={procesando} className={`${BTN_T} px-3 h-11 text-body-sm`}><Icon n="description" className="ico-18" />{d.proveedor} · {d.lineas?.length} líneas</button>)}</div></div>
        </section>
        <section className={`lg:col-span-4 ${CARD} p-space-md flex flex-col gap-2`}>
          <div className="flex justify-between items-center"><span className={LBL}>Túnel de procesamiento</span><span className={`w-2 h-2 rounded-full ${procesando ? 'bg-primary pulso' : a.stage === 'review' ? 'bg-tertiary-container' : 'bg-outline-variant'}`} /></div>
          {PASOS.map(([t, d, i], k) => { const st = a.steps[k] || 'wait'; return (
            <div key={t} className={`flex gap-3 items-start rounded-lg p-3 ${st === 'run' ? 'bg-primary-fixed/60' : st === 'done' ? 'bg-tertiary-fixed/20' : 'bg-surface-container-low'}`}>
              <span className={st === 'done' ? 'text-tertiary' : st === 'run' ? 'text-primary' : 'text-outline'}><Icon n={st === 'done' ? 'check_circle' : st === 'run' ? 'progress_activity' : i} className={st === 'run' ? 'girar' : ''} /></span>
              <div><div className="font-mono text-label-md font-semibold">{t}</div><div className="text-body-sm text-secondary">{d}</div></div></div>); })}
          <p className="text-body-sm text-secondary mt-1">{iaReal() ? 'Las fotos y los PDF se leen con Gemini desde el servidor.' : 'Ahora la lectura es simulada con albaranes de ejemplo. La lectura real con Gemini se activa al conectar la función del servidor (encargo E-003).'}</p>
        </section>
      </div>

      {a.stage === 'review' && <Revision />}

      <section className={`${CARD} overflow-hidden`}>
        <div className="p-space-md"><h2 className="text-headline-md font-semibold">Historial de albaranes procesados</h2><p className="text-body-sm text-secondary">Registro auditable de las entradas confirmadas desde albarán.</p></div>
        {desk ? <div className="overflow-x-auto"><table className="tabla w-full"><thead className="bg-surface-container-low"><tr><th>Albarán</th><th>Proveedor</th><th>Fecha y hora</th><th>Líneas</th><th>Confianza</th><th>Estado</th><th>Operario</th></tr></thead>
          <tbody>{E.albaranes.length ? E.albaranes.map((h, i) => <tr key={i} onClick={() => h.id && abrirDetalleAlbaran(h.id)} className={h.id ? 'cursor-pointer hover:bg-surface-container-low' : ''}><td className="font-mono text-label-md"><Icon n={h.modo === 'ia' ? 'photo_camera' : 'description'} className="ico-18 text-primary" /> {h.numero}</td><td>{h.proveedor}{h.delegacion ? ` · ${h.delegacion}` : ''}</td><td className="font-mono text-label-sm">{fechaHora(h.ts)}</td><td>{h.lineas} ({num(h.unidades || 0)} uds)</td><td className="font-mono text-label-sm">{Math.round((h.confianza || .95) * 1000) / 10}%</td><td><Tag c="bg-tertiary-fixed/30 text-tertiary">Confirmado</Tag></td><td>{h.operator}</td></tr>)
            : <tr><td colSpan={7}><Vacio>Todavía no hay albaranes.</Vacio></td></tr>}</tbody></table></div>
          : <div className="px-4 pb-4">{E.albaranes.length ? E.albaranes.map((h, i) => <div key={i} onClick={() => h.id && abrirDetalleAlbaran(h.id)} className="flex justify-between gap-2 py-3 border-t border-surface-container cursor-pointer"><div className="min-w-0"><div className="font-medium truncate">{h.proveedor}</div><div className="font-mono text-label-sm text-secondary">#{h.numero} · {h.lineas} líneas</div></div><div className="text-right shrink-0"><Tag c="bg-tertiary-fixed/30 text-tertiary">Confirmado</Tag><div className="font-mono text-label-sm text-secondary mt-1">{hace(h.ts)}</div></div></div>) : <Vacio>Todavía no hay albaranes.</Vacio>}</div>}
      </section>
    </div>
  );
}

function Revision() {
  useAlmacen(); // se repinta al crear una referencia desde una línea
  const a = albStore.use(), d = a.doc, ok = a.lines.filter(l => l.include && l.sku);
  const unidades = ok.reduce((s, l) => s + (toNum(l.cantidad) || 0), 0), conf = a.lines.length ? a.lines.reduce((s, l) => s + l.confianza, 0) / a.lines.length : 0;
  const exportar = () => descargarCsv(`albaran-${(d.numero || 'sn').replace(/[^\w-]/g, '')}.csv`, [['Proveedor', 'N.º albarán', 'Fecha', 'Código', 'Descripción', 'SKU', 'Cantidad', 'N.º serie', 'Confianza', 'Se ingresa'],
    ...a.lines.map(l => [d.proveedor, d.numero, d.fecha, l.codigo, l.descripcion, l.sku || '', l.cantidad, parseSN(l.series).join(' '), Math.round(l.confianza * 100) + '%', l.include && l.sku ? 'Sí' : 'No'])]);
  return (
    <section className="flex flex-col gap-space-md">
      <div className="flex flex-wrap items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-tertiary-container" /><h2 className="text-headline-md font-semibold">Validación de albarán en curso</h2><Tag c="bg-primary-fixed text-primary">{d.numero || 's/n'}</Tag>{a.mode === 'ia' ? <Tag c="bg-tertiary-fixed/40 text-tertiary">Lectura real</Tag> : <Tag>Simulado</Tag>}<span className="text-body-sm text-secondary lg:ml-auto">Archivo: {a.file}</span></div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
        <div className={`lg:col-span-5 ${CARD} p-space-md`}><div className="flex items-center gap-2 mb-3"><Icon n="image" className="text-secondary" /><span className="font-semibold">Documento fuente</span></div>
          <div className="bg-primary-fixed/40 rounded-xl p-3">
            {a.preview && !a.isPdf ? <img src={a.preview} alt="Albarán subido" className="w-full rounded-lg" />
              : a.preview && a.isPdf ? <iframe src={a.preview} title="Albarán PDF" className="w-full h-[560px] rounded-lg bg-white" />
                : <div className="papel rounded-lg p-4 text-[12px] leading-snug">
                  <div className="marca-ia p-2 flex justify-between gap-2"><div><div className="font-bold text-[14px]">{d.proveedor}</div><div className="text-secondary">CIF: {d.cif || '—'}</div></div><div className="text-right"><div className="font-bold">ALBARÁN</div><div className="font-mono text-primary">#{d.numero}</div><div className="text-secondary">{d.fecha}</div></div></div>
                  <div className="flex justify-between text-secondary mt-3 mb-2"><span>Destinatario: {MARCA.nombre}</span><span>{d.bultos || a.lines.length} bultos</span></div>
                  <div className="flex justify-between font-mono text-[10px] text-secondary border-b pb-1 mb-2"><span>DESCRIPCIÓN</span><span>CANT.</span></div>
                  {a.lines.map((l, i) => <div key={i} className={`marca-ia ${l.sku ? '' : 'nuevo'} p-2 mb-2 flex justify-between gap-2`}><span className={`absolute -top-2 -left-2 px-1 rounded font-mono text-[9px] text-white ${l.sku ? 'bg-primary-container' : 'bg-amber-600'}`}>#{i + 1}{l.sku ? '' : ' NUEVO'}</span>
                    <div><div>{l.descripcion}</div><div className="font-mono text-[10px] text-secondary">{l.codigo || 'sin código'}</div></div><div className="font-semibold whitespace-nowrap">{l.cantidad}</div></div>)}
                  <div className="flex justify-between text-secondary mt-4 pt-2 border-t"><span>Transportista · matrícula</span><span className="italic">Firma de entrega</span></div>
                </div>}
          </div></div>
        <div className="lg:col-span-7 flex flex-col gap-space-md min-w-0">
          <div className={`${CARD} p-space-md`}>
            <div className="flex justify-between items-center gap-2 mb-3"><span className="font-semibold">Datos generales extraídos</span><span className="font-mono text-label-sm px-2 py-0.5 rounded-full bg-tertiary-fixed/30 text-tertiary">{(conf * 100).toFixed(1)}% confianza</span></div>
            <div className="grid grid-cols-2 xl:grid-cols-5 gap-2">{([['proveedor', 'Proveedor (emisor)'], ['delegacion', 'Delegación'], ['numero', 'N.º albarán'], ['fecha', 'Fecha'], ['cif', 'CIF']] as [keyof Doc, string][]).map(([k, l]) =>
              <label key={k} className="bg-surface-container-low rounded-lg p-2.5"><span className={LBL}>{l}</span><input value={String(d[k] ?? '')} onChange={e => { (d as unknown as Record<string, string>)[k] = e.target.value; emit(); }} className="w-full bg-transparent font-semibold focus:outline-none focus:ring-2 focus:ring-primary rounded" /></label>)}</div>
          </div>
          <div className={`${CARD} overflow-hidden`}>
            <div className="p-space-md flex justify-between items-center gap-2"><span className="font-semibold">Artículos detectados para inventario</span><span className="font-mono text-label-sm text-secondary">{a.lines.length} líneas · {ok.length} se ingresarán</span></div>
            {a.lines.map((l, i) => <LineaAlb key={i} l={l} i={i} proveedor={d.proveedor} />)}
            <div className="p-space-md flex flex-col sm:flex-row gap-2 bg-surface-container-low">
              <button onClick={() => { a.lines.push({ codigo: '', descripcion: 'Línea añadida a mano', cantidad: '1', confianza: 1, sku: null, how: 'manual', include: false, series: '', nota: '' }); emit(); }} className={`${BTN_S} h-12 px-4`}><Icon n="playlist_add" className="ico-20" />Añadir línea manual</button>
              <button onClick={exportar} className={`${BTN_S} h-12 px-4`}><Icon n="ios_share" className="ico-20" />Exportar CSV</button>
              <button onClick={() => albStore.set(vacio())} className={`${BTN_S} h-12 px-4`}>Descartar</button>
              <button onClick={confirmar} disabled={!ok.length} className={`${BTN_P} h-14 sm:h-auto px-5 flex-1 text-body-lg`}><Icon n="check_circle" className="ico-fill" />Confirmar e integrar en stock ({ok.length} línea{ok.length === 1 ? '' : 's'}, {num(unidades)} uds)</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LineaAlb({ l, i, proveedor }: { l: Linea; i: number; proveedor: string }) {
  const E = S(), p = l.sku ? find(E, l.sku) : undefined;
  const q = toNum(l.cantidad) || 0;
  const est = !p ? { t: l.how === 'nuevo' ? 'Artículo nuevo' : 'No catalogado', c: 'bg-amber-100 text-amber-800' } : l.confianza >= .9 ? { t: `Coincide (+${num(q)} ${UNIT[p.unit]})`, c: 'bg-tertiary-fixed/30 text-tertiary' } : { t: `Revisar · ${Math.round(l.confianza * 100)}%`, c: 'bg-amber-100 text-amber-800' };
  const alCrear = (sku: string) => { l.sku = sku; l.include = true; l.how = 'alta manual'; emit(); };
  // E-016: unidad, formato, categoría y proveedor sugeridos con las mismas reglas que el catálogo real (corregibles en el formulario)
  const crearSku = () => { const u = detectarUnidad(l.descripcion);
    return S().rol !== 'admin' ? abrirBorrador(l.codigo, alCrear) : abrirFormProducto(undefined, { sku: l.codigo.toUpperCase(), name: l.descripcion, supplierRef: l.codigo || undefined,
      supplier: normalizarProveedor(proveedor).proveedor, cat: categoriaSugerida(l.descripcion, idsCategoriasActivas()), unit: u.unidad, contenido: u.contenido, minimoDefinido: false },
    sku => { l.sku = sku; l.include = true; l.how = 'alta manual'; emit(); }); };
  return (
    <div className={`p-space-md border-t border-surface-container ${!p ? 'bg-amber-50' : ''} ${l.include ? '' : 'opacity-60'}`}>
      <div className="flex gap-3">
        <input type="checkbox" checked={l.include} disabled={!p} onChange={e => { l.include = e.target.checked; emit(); }} className="w-5 h-5 mt-1 accent-primary shrink-0" aria-label={`Incluir línea ${i + 1}`} />
        {p ? <Tile p={p} size="w-12 h-12" /> : <FotoLinea size="w-12 h-12" />}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex flex-wrap justify-between gap-2"><div className="min-w-0"><div className="font-semibold">{l.descripcion}</div><div className="font-mono text-label-sm text-secondary">{l.codigo || 'sin código'}{l.how && ` · emparejado por ${l.how}`}{l.nota && ` · ${l.nota}`}</div></div>
            <span className={`self-start font-mono text-label-sm px-2 py-1 rounded-full whitespace-nowrap ${est.c}`}>● {est.t}</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px] gap-2">
            <select value={l.sku || ''} onChange={e => { l.sku = e.target.value || null; l.include = !!e.target.value; l.how = e.target.value ? 'manual' : null; emit(); }} className={`${INP} h-11 text-body-sm`} aria-label="Referencia del catálogo">
              <option value="">— Sin correspondencia (no se ingresa) —</option>{E.products.map(x => <option key={x.sku} value={x.sku}>{x.sku} · {x.name}</option>)}</select>
            <label className={`flex items-center gap-2 ${INP} h-11`}><input value={l.cantidad} onChange={e => { l.cantidad = e.target.value; emit(); }} inputMode="decimal" className="w-full bg-transparent focus:outline-none font-semibold" aria-label="Cantidad" /><span className="text-body-sm text-secondary">{p ? UNIT[p.unit] : ''}</span></label>
          </div>
          {p ? <div className="text-body-sm text-secondary">Entra en el almacén{contenidoTxt(p) ? ` (${contenidoTxt(p)})` : ''} · stock {qtyTxt(p, p.stock)} → <b className="text-on-surface">{qtyTxt(p, p.stock + q)}</b></div>
            : <div className="flex flex-wrap items-center gap-2 text-body-sm"><span className="text-amber-800 flex items-center gap-1"><Icon n="auto_awesome" className="ico-16" />{l.how === 'nuevo' ? `El código ${l.codigo} no está en el catálogo: créalo como artículo nuevo o reasígnalo a mano en el desplegable.` : 'Modelo nuevo: créalo o elige uno del catálogo.'}</span><button onClick={crearSku} className="px-3 h-9 rounded-lg bg-amber-600 text-white font-semibold">Crear artículo nuevo</button></div>}
        </div>
      </div>
    </div>
  );
}
