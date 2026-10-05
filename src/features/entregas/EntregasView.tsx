/* E-011 · Nueva entrega en tres pasos (móvil primero, botones de 56 px):
   1. Para quién (técnico y, si se quiere, la obra) · 2. Qué se entrega (buscador o escáner seguido) · 3. Firma del técnico.
   Nada predeterminado: el almacén elige los artículos. Se puede guardar como preparada (stock reservado) para firmar más tarde. */
import { enMetros, equivTxt } from '../../domain/formatos';
import { useEffect, useMemo, useState } from 'react';
import { UNIT, categoriasActivas } from '../../data/catalogo';
import type { Producto } from '../../data/tipos';
import { contenidoDe, contenidoTxt, disponibleReal, find, formatoEntero, unidadTxt, nombreVehiculo, numEntrega, qtyTxt, status, vehiculoDeEquipo } from '../../domain/reglas';
import { fechaHora, num } from '../../domain/formato';
import { aLineas, esPersonal, esPrenda, problemas, variantes } from '../../domain/entregas';
import { avisoEstado, ejecutar, guardar, S, useAlmacen } from '../../store/almacen';
import { nuevoId } from '../../store/ops';
import { modoNube } from '../../store/nube/cliente';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, CARD, Icon, INP, LBL, TagCustodia, Tile } from '../../ui/base';
import { OrdenArticulos, useListaArticulos } from '../../ui/selectorArticulo';
import { useCamara } from '../escaner/camara';
import { anadirACesta, cambiarTalla, cesta, disponible, escanearEnCesta, fijarCantidad, fijarObra, irAPaso, paraEquipo, quitarDeCesta, sumarUno, vaciarCesta } from './cesta';
import { abrirInformeEntregas, abrirRecibo, confirmarFirma, EtiquetaCopia, PanelFirma, Preparadas, type DatosFirma } from './Hojas';
import { usePermisos } from '../../store/permisos';

export { abrirRecibo };

const PASOS = [{ n: 1, t: 'Para quién', i: 'person' }, { n: 2, t: 'Material', i: 'inventory_2' }, { n: 3, t: 'Firma', i: 'signature' }] as const;

export default function EntregasView() {
  const E = useAlmacen(), c = cesta(), paso = c.paso || 1, puede = usePermisos().mod('entregas');
  const eq = E.equipos.find(e => e.id === c.equipo);
  const puedePaso = (n: number) => n === 1 || (n === 2 && !!eq) || (n === 3 && !!eq && c.lineas.length > 0);
  return (
    <div className="px-4 lg:px-gutter py-4 lg:py-space-lg flex flex-col gap-4 lg:gap-space-lg max-w-[1400px]">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><span className={LBL}>Almacén → equipo</span><h1 className="text-headline-lg font-bold">Entrega de material</h1></div>
        <button onClick={abrirInformeEntregas} className={`${BTN_S} h-12 px-4`}><Icon n="summarize" className="ico-20" />Entregas por equipo</button>
      </div>
      {/* E-027: sin "Modificar entregas" se ven las entregas hechas y sus PDF, no el asistente para hacerlas */}
      {!puede && <p className="text-body-sm text-secondary bg-surface-container-low rounded-xl p-3">Tu rol permite ver las entregas y sus justificantes, no prepararlas ni firmarlas.</p>}
      {puede && <Preparadas />}
      {puede && <nav className="grid grid-cols-3 gap-2" aria-label="Pasos de la entrega">{PASOS.map(p => (
        <button key={p.n} onClick={() => puedePaso(p.n) && irAPaso(p.n)} disabled={!puedePaso(p.n)} aria-current={paso === p.n ? 'step' : undefined}
          className={`h-14 rounded-xl flex items-center justify-center gap-2 font-semibold text-body-md disabled:opacity-40 ${paso === p.n ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface'}`}>
          <span className={`w-7 h-7 rounded-full grid place-items-center font-mono text-label-md ${paso === p.n ? 'bg-white/20' : 'bg-white'}`}>{p.n}</span>
          <span className="truncate">{p.t}{p.n === 2 && c.lineas.length ? ` (${c.lineas.length})` : ''}</span></button>))}</nav>}
      {puede && paso === 1 && <PasoQuien />}
      {puede && paso === 2 && <PasoMaterial />}
      {puede && paso === 3 && <PasoFirma />}
      <Ultimas />
    </div>
  );
}

/* ---------- 1 · Para qué equipo (E-017: el material se entrega al equipo; un técnico firma la recogida) ---------- */
function PasoQuien() {
  const E = useAlmacen(), c = cesta();
  const [q, setQ] = useState('');
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const texto = (e: typeof E.equipos[number]) => `${e.nombre} ${e.id} ${e.tecnicos.map(t => E.tecnicos.find(x => x.id === t)?.nombre || '').join(' ')} ${e.vehiculo ? nombreVehiculo(E, e.vehiculo) : ''}`;
  const lista = E.equipos.filter(e => !q.trim() || norm(texto(e)).includes(norm(q.trim())));
  return (
    <section className={`${CARD} p-4 lg:p-space-md flex flex-col gap-3`}>
      <h2 className="text-headline-md font-semibold flex items-center gap-2"><Icon n="groups" className="text-primary" />¿Para qué equipo es el material?</h2>
      <div className="relative"><Icon n="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline ico-20" />
        <input value={q} onChange={e => setQ(e.target.value)} type="search" className={`${INP} pl-10 h-14`} placeholder="Buscar equipo, técnico o matrícula" /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">{lista.map(e => { const veh = vehiculoDeEquipo(E, e.id), v = E.vehiculos.find(x => x.id === veh), sel = c.equipo === e.id;
        const tecs = e.tecnicos.map(t => E.tecnicos.find(x => x.id === t)?.nombre).filter(Boolean), bloqueado = !veh || !tecs.length; return (
        <button key={e.id} disabled={bloqueado} onClick={() => paraEquipo(e.id)} className={`text-left min-h-20 rounded-xl p-3 flex items-center gap-3 disabled:opacity-50 ${sel ? 'bg-primary text-white' : 'bg-surface-container-low hover:bg-surface-container'}`}>
          <span className={`w-11 h-11 rounded-xl grid place-items-center shrink-0 ${sel ? 'bg-white/20' : 'bg-primary-fixed text-primary'}`}><Icon n="local_shipping" /></span>
          <span className="flex-1 min-w-0"><span className="block font-semibold truncate">{e.nombre}{v ? ` · ${v.matricula}` : ''}</span>
            <span className={`block text-body-sm truncate ${sel ? 'text-white/80' : 'text-secondary'}`}>{!veh ? 'Sin vehículo: asígnale uno en Equipos y técnicos' : !tecs.length ? 'Sin técnicos: asígnale alguno para que firmen' : tecs.join(' · ')}</span></span>
          {sel && <Icon n="check_circle" className="ico-fill" />}
        </button>); })}</div>
      {!E.equipos.length && <p className="text-body-sm text-secondary">Aún no hay equipos: créalos en Equipos y técnicos.</p>}
      <label className="flex flex-col gap-1"><span className={LBL}>Obra (opcional)</span>
        <input value={c.obra || ''} onChange={e => fijarObra(e.target.value)} className={`${INP} h-14`} placeholder="C/ Recogidas 12, Granada" /></label>
      <button onClick={() => irAPaso(2)} disabled={!c.equipo} className={`${BTN_P} h-14 text-body-lg`}><Icon n="arrow_forward" />Siguiente: elegir el material</button>
    </section>
  );
}

/* ---------- 2 · Qué se entrega ---------- */
interface Lectura { ts: number; texto: string; ok: boolean }
function PasoMaterial() {
  const E = useAlmacen(), c = cesta();
  const [q, setQ] = useState(''), [cat, setCat] = useState('all'), [escaneando, setEscaneando] = useState(false), [manual, setManual] = useState('');
  const [lecturas, setLecturas] = useState<Lectura[]>([]);
  const eq = E.equipos.find(e => e.id === c.equipo);
  const porCat = useMemo(() => (q || cat === 'all' ? undefined : (p: Producto) => p.cat === cat), [q, cat]);
  const prods = useListaArticulos(q, { filtro: porCat, max: 24 }).lista;           // E-024: A-Z o por referencia
  const leer = (raw: string) => {
    const r = escanearEnCesta(raw), p = r.sku ? find(S(), r.sku) : undefined;
    const l = p ? S().cesta.lineas.find(x => x.sku === p.sku) : undefined;
    const texto = r.ok ? `${p?.name}${l ? ` · ${qtyTxt(p!, l.qty)} en la cesta` : ''}` : r.aviso || 'No se ha podido añadir';
    setLecturas(x => [{ ts: Date.now(), texto, ok: r.ok }, ...x].slice(0, 6));
    if (navigator.vibrate) navigator.vibrate(r.ok ? 40 : [60, 60, 60]);
  };
  const guardarPreparada = () => {
    const err = problemas(S(), c); if (err.length) return toast(err[0], 'err', 6000);
    const numero = modoNube ? undefined : `ENT-${new Date().getFullYear()}-${String(E.seq.ent + 1).padStart(4, '0')}`;
    const id = modoNube ? nuevoId() : numero!;
    if (!ejecutar({ op: 'prepararEntrega', args: { id, numero, equipo: c.equipo, receptor: null, obra: (c.obra || '').trim(), lineas: aLineas(c) } })) return;
    if (!modoNube) E.seq.ent++;
    vaciarCesta();
    toast(`Entrega preparada para ${eq?.nombre}: el material queda reservado ${E.configAvisos.horasReserva || 48} h hasta que uno de sus técnicos firme la recogida.`, 'ok', 6000);
  };
  const err = problemas(E, c);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-space-lg items-start">
      <section className={`${CARD} p-4 lg:p-space-md flex flex-col gap-3 lg:col-span-7`}>
        <button onClick={() => irAPaso(1)} className="self-start flex items-center gap-2 rounded-lg bg-surface-container-low px-3 h-11 text-body-sm"><Icon n="groups" className="ico-18 text-primary" /><b>{eq?.nombre}</b>{eq && vehiculoDeEquipo(E, eq.id) ? ` · ${E.vehiculos.find(v => v.id === eq.vehiculo)?.matricula}` : ''}{c.obra ? ` · ${c.obra}` : ''}<Icon n="edit" className="ico-16 text-secondary" /></button>
        <div className="flex gap-2">
          <div className="relative flex-1"><Icon n="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline ico-20" />
            <input value={q} onChange={e => setQ(e.target.value)} type="search" className={`${INP} pl-10 h-14`} placeholder="Buscar por nombre, SKU o código" /></div>
          <button onClick={() => setEscaneando(!escaneando)} className={`${escaneando ? BTN_P : BTN_S} h-14 px-4 shrink-0`} aria-pressed={escaneando}><Icon n={escaneando ? 'close' : 'barcode_scanner'} className="ico-20" /><span className="hidden sm:inline">{escaneando ? 'Parar' : 'Escanear'}</span></button>
        </div>
        {escaneando && <Escaner onLeer={leer} lecturas={lecturas} manual={manual} setManual={setManual} />}
        {!q && <div className="flex gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">{[['all', 'Todo'] as const, ...categoriasActivas().map(([k, v]) => [k, v.label] as const)].map(([k, l]) =>
          <button key={k} onClick={() => setCat(k)} className={`shrink-0 px-3 h-11 rounded-full text-body-sm font-semibold ${cat === k ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface-variant'}`}>{l}</button>)}</div>}
        <OrdenArticulos agrupar={false} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{prods.length ? prods.map(p => { const d = disponible(p.sku); return (
          <button key={p.sku} onClick={() => anadirACesta(p.sku)} disabled={d <= 0} className="text-left bg-surface-container-low hover:bg-surface-container rounded-xl p-2.5 flex items-center gap-3 disabled:opacity-40 min-h-16">
            <Tile p={p} size="w-14 h-14" />
            <span className="flex-1 min-w-0"><span className="block font-semibold leading-snug line-clamp-2">{p.name}</span>
              <span className="block font-mono text-label-sm text-secondary truncate">{p.sku}{esPrenda(p) && p.modelo ? ' · talla en la cesta' : ''}</span>
              <span className="flex items-center gap-1 mt-0.5"><span className="font-mono text-label-sm">Disp. <b>{num(d)}</b> {UNIT[p.unit]}</span><TagCustodia p={p} /></span></span>
            <Icon n="add_circle" className="text-primary ico-28" />
          </button>); }) : <p className="text-secondary">Sin resultados.</p>}</div>
      </section>

      <section className={`${CARD} p-4 lg:p-space-md flex flex-col gap-3 lg:col-span-5 lg:sticky lg:top-20`}>
        <div className="flex items-center justify-between"><h2 className="text-headline-md font-semibold flex items-center gap-2"><span className="w-7 h-7 rounded-md bg-primary-container text-white grid place-items-center font-mono text-label-md">{c.lineas.length}</span>Cesta</h2>
          {c.lineas.length > 0 && <button onClick={() => { if (confirm('¿Vaciar la cesta?')) { c.lineas = []; guardar(); } }} className="text-error text-body-sm flex items-center gap-1 h-11"><Icon n="delete" className="ico-18" />Vaciar</button>}</div>
        {c.lineas.length ? c.lineas.map(l => <LineaCesta key={l.sku} sku={l.sku} />)
          : <div className="text-center text-secondary py-6 bg-surface-container-low rounded-xl">Busca o escanea los artículos que se lleva.<br /><span className="text-body-sm">La cesta se guarda en este dispositivo aunque cierres la app.</span></div>}
        {c.lineas.length > 0 && err.length > 0 && <ul className="text-body-sm text-amber-800 flex flex-col gap-0.5">{err.map(x => <li key={x}>• {x}</li>)}</ul>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button onClick={guardarPreparada} disabled={err.length > 0} className={`${BTN_S} h-14`} title="El stock queda reservado hasta que el técnico firme"><Icon n="bookmark_add" className="ico-20" />Guardar preparada</button>
          <button onClick={() => irAPaso(3)} disabled={err.length > 0} className={`${BTN_P} h-14`}><Icon n="signature" className="ico-20" />Siguiente: firmar</button>
        </div>
      </section>
    </div>
  );
}

function LineaCesta({ sku }: { sku: string }) {
  const E = useAlmacen(), c = cesta(), l = c.lineas.find(x => x.sku === sku), p = find(E, sku);
  if (!l || !p) return null;
  const disp = Math.max(0, disponibleReal(E, p)), falta = formatoEntero(p) && l.qty !== Math.trunc(l.qty), excede = l.qty > disp;
  const tallas = esPrenda(p) ? variantes(E, p) : [];
  // E-031: con "metros sueltos" se elige entregar rollos (o el formato que sea) o metros
  const sueltos = !formatoEntero(p) && enMetros(p), [enM, setEnM] = useState(false), factor = sueltos && enM ? contenidoDe(p) : 1;
  return (
    <div className={`rounded-xl p-3 flex flex-col gap-2 ${excede || falta ? 'bg-amber-50 ring-1 ring-amber-300' : 'bg-surface-container-low'}`}>
      <div className="flex items-center gap-3"><Tile p={p} size="w-12 h-12" />
        <div className="flex-1 min-w-0"><div className="font-semibold leading-snug">{p.name} <TagCustodia p={p} /></div>
          <div className="font-mono text-label-sm text-secondary">{p.sku} · disp. {qtyTxt(p, disp)}</div></div></div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center bg-white rounded-lg">
          <button onClick={() => quitarDeCesta(sku)} className="w-14 h-14 grid place-items-center" aria-label={`Menos ${p.name}`}><Icon n="remove" /></button>
          <Cantidad sku={sku} qty={l.qty} factor={factor} />
          <button onClick={() => sumarUno(sku)} className="w-14 h-14 grid place-items-center bg-primary text-white rounded-r-lg" aria-label={`Más ${p.name}`}><Icon n="add" /></button>
        </div>
        {sueltos ? <div className="flex rounded-lg overflow-hidden border border-outline-variant" role="group" aria-label="Entregar en">{([[false, unidadTxt(p.unit, 2)], [true, 'metros']] as const).map(([m, t]) => <button key={t} onClick={() => setEnM(m)} className={`h-12 px-3 text-body-sm font-semibold ${enM === m ? 'bg-primary text-white' : 'bg-white'}`}>{t}</button>)}</div>
          : <span className="text-body-sm text-secondary">{UNIT[p.unit]}</span>}
        {equivTxt(p, l.qty) && <span className="text-body-sm text-secondary">= {sueltos && enM ? qtyTxt(p, l.qty) : equivTxt(p, l.qty)}</span>}
        {tallas.length > 1 && <label className="flex items-center gap-2 ml-auto"><span className={LBL}>Talla</span>
          <select value={sku} onChange={e => cambiarTalla(sku, e.target.value)} className={`${INP} !w-auto h-14 font-semibold`} aria-label={`Talla de ${p.name}`}>
            {tallas.map(v => <option key={v.sku} value={v.sku} disabled={v.sku !== sku && Math.max(0, disponibleReal(E, v)) <= 0}>{v.talla || v.sku}{v.sku !== sku ? ` (${num(Math.max(0, disponibleReal(E, v)))})` : ''}</option>)}</select></label>}
      </div>
      {excede && <p className="text-body-sm text-amber-800">Solo hay {qtyTxt(p, disp)} disponibles: ajusta la cantidad.</p>}
      {falta && <p className="text-body-sm text-amber-800">Se entrega por {p.unit} entero.</p>}
      {!esPersonal(p) && contenidoTxt(p) && <p className="text-body-sm text-secondary">{contenidoTxt(p)} · entra en el vehículo del equipo</p>}
      {esPersonal(p) && <p className="text-body-sm text-secondary">Dotación personal: pasa al técnico que firme la recogida, no al vehículo.</p>}
    </div>
  );
}

/** factor: con metros sueltos se escribe en metros (qty × contenido) y se guarda en formatos */
function Cantidad({ sku, qty, factor = 1 }: { sku: string; qty: number; factor?: number }) {
  const ver = String(Math.round(qty * factor * 1000) / 1000);
  const [v, setV] = useState(ver);
  useEffect(() => setV(ver), [ver]);
  return <input value={v} onChange={e => setV(e.target.value)} onBlur={() => fijarCantidad(sku, Math.round(Number(v.replace(',', '.')) / factor * 1000) / 1000)} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    inputMode="decimal" className="w-16 text-center font-bold text-body-lg bg-transparent focus:outline-none" aria-label="Cantidad" />;
}

/** Escáner en modo seguido: cada lectura suma a la cesta sin salir de la pantalla */
function Escaner({ onLeer, lecturas, manual, setManual }: { onLeer: (c: string) => void; lecturas: Lectura[]; manual: string; setManual: (v: string) => void }) {
  const { video, estado } = useCamara(true, onLeer, { pausarConModal: false, repetirMs: 1500 });
  return (
    <div className="flex flex-col gap-2">
      <div className="relative rounded-xl overflow-hidden bg-[#0b1c30] h-52">
        <video ref={video} playsInline muted className="w-full h-full object-cover" />
        {!estado.on && <p className="absolute inset-0 grid place-items-center text-white/80 text-body-sm text-center p-4">{estado.msg || 'Abriendo la cámara…'}</p>}
        {estado.on && <span className="absolute top-2 left-2 font-mono text-label-sm bg-black/50 text-white px-2 py-0.5 rounded">Lectura seguida · cada código suma</span>}
      </div>
      <form onSubmit={e => { e.preventDefault(); if (manual.trim()) { onLeer(manual.trim()); setManual(''); } }} className="flex gap-2">
        <input value={manual} onChange={e => setManual(e.target.value)} className={`${INP} h-14 font-mono`} placeholder="O escribe o pega un código" aria-label="Código manual" />
        <button className={`${BTN_S} h-14 px-4`}>Añadir</button>
      </form>
      {lecturas.length > 0 && <ul className="flex flex-col gap-1">{lecturas.map(l => <li key={l.ts} className={`text-body-sm flex items-center gap-2 ${l.ok ? 'text-tertiary' : 'text-amber-800'}`}><Icon n={l.ok ? 'check_circle' : 'error'} className="ico-18" />{l.texto}</li>)}</ul>}
    </div>
  );
}

/* ---------- 3 · Firma ---------- */
function PasoFirma() {
  const E = useAlmacen(), c = cesta(), eq = E.equipos.find(e => e.id === c.equipo);
  const err = problemas(E, c);
  const firmar = async ({ firma, email, telefono, recoge, copiaEquipo }: DatosFirma) => {
    const bad = problemas(S(), c); if (bad.length) { toast(bad[0], 'err', 6000); return false; }
    const antes = c.lineas.map(l => { const p = find(S(), l.sku)!; return { p, before: status(p) }; });
    const numero = modoNube ? undefined : `ENT-${new Date().getFullYear()}-${String(S().seq.ent + 1).padStart(4, '0')}`;
    const id = modoNube ? nuevoId() : numero!;
    // preparar (reserva) y confirmar van seguidas en la cola: en el servidor la firma descuenta todo o nada
    if (!ejecutar({ op: 'prepararEntrega', args: { id, numero, equipo: c.equipo, receptor: null, obra: (c.obra || '').trim(), lineas: aLineas(c) } })) return false;
    if (!modoNube) S().seq.ent++;
    if (!(await confirmarFirma(id, firma, email, recoge, telefono, copiaEquipo))) { toast('La entrega ha quedado preparada (reservada): fírmala desde la lista de preparadas.', 'warn', 7000); vaciarCesta(); return false; }
    vaciarCesta();
    toast(`Entrega a ${eq?.nombre} recogida por ${S().tecnicos.find(t => t.id === recoge)?.nombre}. Stock descontado${email ? ' y copia por correo en camino' : ''}.`, 'ok', 6000);
    antes.forEach(a => avisoEstado({ ...a, after: status(a.p) }));
    abrirRecibo(id);
    return true;
  };
  if (err.length) return <section className={`${CARD} p-4`}><p className="text-amber-800">{err[0]}</p><button onClick={() => irAPaso(2)} className={`${BTN_S} h-14 px-4 mt-3`}>Volver a la cesta</button></section>;
  return (
    <section className={`${CARD} overflow-hidden max-w-3xl w-full mx-auto`}>
      <div className="px-4 lg:px-5 pt-4 flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-headline-md font-semibold">Entrega al equipo {eq?.nombre}</h2><p className="text-body-sm text-secondary">{eq?.nombre}{eq?.vehiculo ? ` · el material entra en ${nombreVehiculo(E, eq.vehiculo).split(' · ').pop()}` : ''} · comprueba el material y firma</p></div>
        <button onClick={() => irAPaso(2)} className={`${BTN_S} h-11 px-3`}><Icon n="edit" className="ico-18" />Cambiar</button>
      </div>
      <PanelFirma enPagina lineas={aLineas(c)} equipo={c.equipo} obra={c.obra} onFirmar={firmar} />
    </section>
  );
}

/* ---------- Últimas entregas: si llegó la copia, y reenviar ---------- */
function Ultimas() {
  const E = useAlmacen();
  const lista = E.entregas.filter(e => (e.estado ?? 'firmada') === 'firmada').sort((a, b) => b.ts - a.ts).slice(0, 8);
  if (!lista.length) return null;
  return (
    <section className={`${CARD} p-4 lg:p-space-md flex flex-col gap-1`}>
      <h2 className="text-headline-sm font-semibold mb-1 flex items-center gap-2"><Icon n="history" className="text-primary" />Últimas entregas</h2>
      {lista.map(e => { const t = E.tecnicos.find(x => x.id === e.receptor), eqE = E.equipos.find(x => x.id === e.equipo); return (
        <button key={e.id} onClick={() => abrirRecibo(e.id)} className="text-left flex flex-wrap items-center gap-x-3 gap-y-1 py-3 border-t border-surface-container min-h-14">
          <span className="font-mono text-label-md text-primary">{numEntrega(e)}</span>
          <span className="flex-1 min-w-[140px] font-medium">{eqE?.nombre || e.equipo}<span className="block text-body-sm text-secondary">{fechaHora(e.ts)} · recogido por {t?.nombre || '—'} · {e.lineas.length} líneas{e.obra ? ` · ${e.obra}` : ''}</span></span>
          <EtiquetaCopia e={e} /><Icon n="chevron_right" className="text-secondary" />
        </button>); })}
    </section>
  );
}
