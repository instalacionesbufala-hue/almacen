/* E-038 · Retirada de material en custodia por el socio (o por un tercero en su nombre): socio y origen (almacén o un vehículo),
   cesta con buscador y escáner (solo artículos de ese socio), datos de quién recoge y en nombre de quién, firma y albarán
   RET-AAAA-NNNN en PDF. La lista de retiradas va en Custodia; el administrador puede anular una (movimientos inversos). */
import { BotonGrupo, CopiasJustificante } from '../entregas/Grupo';
import { grupoDe } from '../../domain/grupoWhatsapp';
import { useState } from 'react';
import type { Retirada } from '../../data/tipos';
import { comprobarRetirada, disponibleRetirada, MOTIVO_RETIRADA, numRetirada } from '../../domain/retiradas';
import { contenidoTxt, esCustodia, find, nombreVehiculo, qtyTxt, resolveCode, unidadesABordo } from '../../domain/reglas';
import { equivTxt } from '../../domain/formatos';
import { fechaHora, num, toNum } from '../../domain/formato';
import { ejecutar, S, useAlmacen } from '../../store/almacen';
import { nuevoId } from '../../store/ops';
import { usePermisos } from '../../store/permisos';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { Firma, firmaPNG, type Trazo } from '../../ui/firma';
import { BTN_P, BTN_S, CARD, Campo, FirmaImg, Icon, INP, LBL, Tag } from '../../ui/base';
import { SelectorArticulo } from '../../ui/selectorArticulo';
import { useCamara } from '../escaner/camara';
import { SelectorSocio } from '../config/Socios';
import { compartirRetirada, descargarRetirada } from './retiradaPdf';

export const abrirRetirada = (socio: string) => openModal(<NuevaRetirada socio={socio} />, { ancha: true });
/** E-039 · Desde Entregas o el menú: empieza con el primer socio que tenga material (se puede cambiar en la propia retirada) */
export function iniciarRetirada() {
  const E = S(), activos = E.propietarios.filter(o => o.activo !== false);
  const conMaterial = activos.find(o => E.products.some(p => esCustodia(p) && p.propietario === o.id && (p.stock > 0 || E.aBordo.some(b => b.sku === p.sku && b.unidades > 0))));
  abrirRetirada((conMaterial || activos[0])?.id || '');
}
export const abrirVerRetirada = (id: string) => openModal(<VerRetirada id={id} />, { ancha: true });

type Linea = { sku: string; cantidad: string };
function NuevaRetirada({ socio: inicial }: { socio: string }) {
  const E = useAlmacen();
  const [socio, setSocio] = useState(inicial), [vehiculo, setVehiculo] = useState('');
  const [lineas, setLineas] = useState<Linea[]>([]), [escaner, setEscaner] = useState(false), [manual, setManual] = useState('');
  const [d, setD] = useState({ recoge: '', recogeDoc: '', enNombre: 'socio' as 'socio' | 'tercero', tercero: '', terceroEmpresa: '', motivo: 'devolucion' as Retirada['motivo'], motivoTexto: '', referencia: '', transporte: '', notas: '' });
  const [trazos, setTrazos] = useState<Trazo[]>([]), [hecha, setHecha] = useState<string | null>(null);
  const nombreSocio = E.propietarios.find(o => o.id === socio)?.nombre || socio;
  const delSocio = (sku: string) => { const p = find(E, sku); return !!p && esCustodia(p) && p.propietario === socio && !p.borrador && !p.archivado; };
  const vehiculos = E.vehiculos.filter(v => E.aBordo.some(b => b.vehiculo === v.id && b.unidades > 0 && delSocio(b.sku)));
  const anadir = (sku: string) => {
    const p = find(E, sku);
    if (!p || !delSocio(sku)) return toast(p ? `${p.name} no es material en custodia de ${nombreSocio}: solo se retira lo suyo.` : 'Código desconocido.', 'warn');
    setLineas(ls => ls.some(l => l.sku === sku) ? ls.map(l => l.sku === sku ? { ...l, cantidad: String(toNum(l.cantidad) + 1) } : l) : [...ls, { sku, cantidad: '1' }]);
  };
  const leer = (c: string) => { const r = resolveCode(S(), c); if (r) anadir(r.p.sku); else toast(`Código desconocido: ${c}`, 'warn'); };
  const datosLineas = lineas.map(l => ({ sku: l.sku, cantidad: toNum(l.cantidad) }));
  const avisos = comprobarRetirada(E, { socio, vehiculo: vehiculo || undefined, lineas: datosLineas });
  const guardar = () => {
    if (avisos.length) return toast(avisos[0], 'err');
    if (!d.recoge.trim()) return toast('Indica quién recoge el material.', 'err');
    if (d.enNombre === 'tercero' && !d.tercero.trim()) return toast('Indica el tercero autorizado en cuyo nombre se recoge.', 'err');
    if (d.motivo === 'otro' && !d.motivoTexto.trim()) return toast('Explica el motivo de la retirada.', 'err');
    if (!trazos.length) return toast('Falta la firma de quien recoge.', 'err');
    const id = nuevoId();
    if (ejecutar({ op: 'retirada', args: { id, datos: { socio, vehiculo: vehiculo || undefined, ...d, firma: firmaPNG(trazos), lineas: datosLineas } } })) { setHecha(id); toast('Retirada registrada: el stock en custodia ya está descontado.', 'ok', 6000); }
  };
  if (hecha) return <VerRetirada id={hecha} recien />;
  const campo = (k: keyof typeof d, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) =>
    <Campo label={label}><input value={d[k]} onChange={e => setD({ ...d, [k]: e.target.value })} className={`${INP} h-12`} {...extra} /></Campo>;
  return (<>
    <SheetHead title="Retirada por el socio" sub="Material en custodia que el socio (o un tercero en su nombre) se lleva del almacén o de una furgoneta." />
    <div className="p-5 flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Campo label="Socio"><SelectorSocio value={socio} onChange={x => { setSocio(x); setLineas([]); setVehiculo(''); }} /></Campo>
        <Campo label="Sale de"><select value={vehiculo} onChange={e => { setVehiculo(e.target.value); }} className={`${INP} h-12`}>
          <option value="">Almacén</option>{vehiculos.map(v => <option key={v.id} value={v.id}>{nombreVehiculo(E, v.id)}</option>)}</select></Campo>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Material de {nombreSocio}</h3>
          <button onClick={() => setEscaner(!escaner)} className={`${BTN_S} h-11 px-3`}><Icon n="qr_code_scanner" className="ico-20" />{escaner ? 'Cerrar escáner' : 'Escanear'}</button></div>
        {escaner && <Escaner onLeer={leer} manual={manual} setManual={setManual} />}
        <SelectorArticulo valor={null} onChange={sku => sku && anadir(sku)} filtro={p => delSocio(p.sku) && disponibleRetirada(E, p.sku, vehiculo || undefined) > 0}
          placeholder={`Añadir artículo de ${nombreSocio}…`} />
        {lineas.map(l => { const p = find(E, l.sku)!, q = toNum(l.cantidad), disp = disponibleRetirada(E, l.sku, vehiculo || undefined); return (
          <div key={l.sku} className="flex items-center gap-2 bg-surface-container-low rounded-lg p-2">
            <div className="flex-1 min-w-0"><div className="font-medium truncate">{p.name}</div>
              <div className="font-mono text-label-sm text-secondary">{p.sku}{contenidoTxt(p) ? ` · ${contenidoTxt(p)}` : ''} · hay {qtyTxt(p, Math.max(0, disp))}</div>
              {q > 0 && equivTxt(p, q) && <div className="text-label-sm text-secondary">= {equivTxt(p, q)}</div>}</div>
            <input value={l.cantidad} onChange={e => setLineas(ls => ls.map(x => x.sku === l.sku ? { ...x, cantidad: e.target.value } : x))} inputMode="decimal" className={`${INP} h-12 !w-20 text-center font-mono ${q > disp ? 'ring-2 ring-error' : ''}`} aria-label={`Cantidad de ${p.name}`} />
            <button onClick={() => setLineas(ls => ls.filter(x => x.sku !== l.sku))} className="h-12 w-11 shrink-0 text-secondary" aria-label={`Quitar ${p.name}`}><Icon n="close" className="ico-20" /></button>
          </div>); })}
        {lineas.length > 0 && avisos.map(a => <p key={a} className="text-body-sm text-error">{a}</p>)}
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <h3 className="font-semibold sm:col-span-2">Quién recoge</h3>
        {campo('recoge', 'Nombre de quien recoge *')}{campo('recogeDoc', 'DNI o empresa (opcional)')}
        <Campo label="En nombre de"><select value={d.enNombre} onChange={e => setD({ ...d, enNombre: e.target.value as 'socio' | 'tercero' })} className={`${INP} h-12`}>
          <option value="socio">{nombreSocio} (el socio)</option><option value="tercero">Un tercero autorizado por {nombreSocio}</option></select></Campo>
        {d.enNombre === 'tercero' ? <>{campo('tercero', 'Tercero autorizado *')}{campo('terceroEmpresa', 'Su empresa')}</> : <div className="hidden sm:block" />}
        <Campo label="Motivo"><select value={d.motivo} onChange={e => setD({ ...d, motivo: e.target.value as Retirada['motivo'] })} className={`${INP} h-12`}>
          {Object.entries(MOTIVO_RETIRADA).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Campo>
        {campo('motivoTexto', d.motivo === 'otro' ? 'Explica el motivo *' : 'Detalle del motivo (opcional)')}
        {campo('referencia', 'Referencia del socio (pedido, RMA o albarán)')}{campo('transporte', 'Matrícula o transportista')}
        <div className="sm:col-span-2">{campo('notas', 'Notas')}</div>
      </section>

      <section className="flex flex-col gap-2"><div className="flex items-center justify-between"><h3 className="font-semibold">Firma de quien recoge</h3>
        {trazos.length > 0 && <button onClick={() => setTrazos([])} className="text-primary text-body-sm font-semibold h-10">Borrar</button>}</div>
        <Firma trazos={trazos} onChange={setTrazos} /></section>
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-14 px-5`}>Cancelar</button>
      <button onClick={guardar} className={`${BTN_P} h-14 flex-1`}><Icon n="draw" className="ico-20" />Firmar y registrar la retirada</button></SheetFoot>
  </>);
}

function Escaner({ onLeer, manual, setManual }: { onLeer: (c: string) => void; manual: string; setManual: (v: string) => void }) {
  const { video, estado } = useCamara(true, onLeer, { pausarConModal: false, repetirMs: 1500 });
  return (<div className="flex flex-col gap-2">
    <div className="relative rounded-xl overflow-hidden bg-[#0b1c30] h-48"><video ref={video} playsInline muted className="w-full h-full object-cover" />
      {!estado.on && <p className="absolute inset-0 grid place-items-center text-white/80 text-body-sm text-center p-4">{estado.msg || 'Abriendo la cámara…'}</p>}</div>
    <form onSubmit={e => { e.preventDefault(); if (manual.trim()) { onLeer(manual.trim()); setManual(''); } }} className="flex gap-2">
      <input value={manual} onChange={e => setManual(e.target.value)} className={`${INP} h-12 font-mono`} placeholder="O escribe o pega un código" aria-label="Código manual" />
      <button className={`${BTN_S} h-12 px-4`}>Añadir</button></form>
  </div>);
}

function VerRetirada({ id, recien = false }: { id: string; recien?: boolean }) {
  const E = useAlmacen(), perm = usePermisos(), r = (E.retiradas || []).find(x => x.id === id);
  if (!r) return <SheetHead title="Retirada no encontrada" />;
  const socio = E.propietarios.find(o => o.id === r.socio)?.nombre || r.socio;
  const anular = () => {
    const motivo = prompt(`¿Por qué se anula la retirada ${numRetirada(r)}? El material vuelve a ${r.vehiculo ? nombreVehiculo(E, r.vehiculo) : 'el almacén'} con un movimiento inverso.`);
    if (motivo === null) return;
    if (!motivo.trim()) return toast('Indica el motivo de la anulación.', 'err');
    if (ejecutar({ op: 'anularRetirada', args: { id: r.id, motivo } })) toast(`Retirada ${numRetirada(r)} anulada: el stock vuelve.`, 'ok', 6000);
  };
  return (<>
    <SheetHead title={`Retirada ${numRetirada(r)}`} sub={`${socio} · ${fechaHora(r.ts)}${recien ? ' · registrada' : ''}`} />
    <div className="p-5 flex flex-col gap-3">
      {r.estado === 'anulada' && <p className="bg-error-container text-error rounded-lg p-3 text-body-sm font-semibold">Anulada{r.anuladaPor ? ` por ${r.anuladaPor}` : ''}{r.anuladaTs ? ` el ${fechaHora(r.anuladaTs)}` : ''}: {r.anulacionMotivo}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-body-sm">
        {([['Sale de', r.vehiculo ? nombreVehiculo(E, r.vehiculo) : 'Almacén'], ['Recoge', `${r.recoge}${r.recogeDoc ? ` · ${r.recogeDoc}` : ''}`],
          ['En nombre de', r.enNombre === 'tercero' ? `${r.tercero}${r.terceroEmpresa ? ` (${r.terceroEmpresa})` : ''}, autorizado por ${socio}` : socio],
          ['Motivo', `${MOTIVO_RETIRADA[r.motivo]}${r.motivoTexto ? ` · ${r.motivoTexto}` : ''}`], ['Referencia del socio', r.referencia || '—'], ['Transporte', r.transporte || '—']] as const)
          .map(([k, v]) => <div key={k} className="bg-surface-container-low rounded-lg p-2.5"><div className={LBL}>{k}</div><div className="font-medium break-words">{v}</div></div>)}
      </div>
      {r.notas && <p className="text-body-sm">Notas: {r.notas}</p>}
      <div>{r.lineas.map(l => { const p = find(E, l.sku); return <div key={l.sku} className="flex justify-between gap-2 py-1.5 border-b border-surface-container text-body-sm">
        <span className="min-w-0"><span className="block truncate">{l.nombre}</span><span className="font-mono text-label-sm text-secondary">{l.sku}</span></span>
        <b className="text-right">{p ? qtyTxt(p, l.cantidad) : num(l.cantidad)}</b></div>; })}</div>
      {r.firma && <div><div className={LBL}>Firma de {r.recoge}</div><FirmaImg f={r.firma} className="h-24 w-64" /></div>}
      <p className="font-mono text-label-sm text-secondary break-all">Huella: {r.hash || 'se calcula al sincronizar'}</p>
      <CopiasJustificante retirada={r.id} />
    </div>
    <SheetFoot className="grid grid-cols-2 gap-2">
      <BotonGrupo j={{ tipo: 'retirada', doc: r }} className={`${BTN_P} h-14 col-span-2`} />
      <button onClick={() => void compartirRetirada(r)} className={`${grupoDe(E, { tipo: 'retirada', doc: r }) ? BTN_S : BTN_P} h-12`}><Icon n="share" className="ico-20" />Compartir PDF</button>
      <button onClick={() => void descargarRetirada(r)} className={`${BTN_S} h-12`}><Icon n="file_download" className="ico-20" />Descargar</button>
      {perm.admin && r.estado === 'firmada' && <button onClick={anular} className={`${BTN_S} h-12 col-span-2 !text-error`}><Icon n="undo" className="ico-20" />Anular la retirada</button>}
    </SheetFoot>
  </>);
}

/** Retiradas de un socio (Custodia; también en lo que ve el socio) */
export function ListaRetiradas({ socio }: { socio: string }) {
  const E = useAlmacen(), perm = usePermisos(), nombre = E.propietarios.find(o => o.id === socio)?.nombre || socio;
  const lista = (E.retiradas || []).filter(r => r.socio === socio);
  const hay = E.products.some(p => esCustodia(p) && p.propietario === socio && (p.stock > 0 || E.aBordo.some(b => b.sku === p.sku && unidadesABordo(E, b.vehiculo, p.sku) > 0)));
  return (<section className={`${CARD} p-4 flex flex-col gap-2`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-headline-sm font-semibold">Retiradas de {nombre}</h2>
      {perm.mod('movimientos') && !perm.socio && <button onClick={() => abrirRetirada(socio)} disabled={!hay} className={`${BTN_P} h-11 px-4 disabled:opacity-40`}><Icon n="outbox" className="ico-20" />Registrar retirada</button>}</div>
    {lista.slice(0, 20).map(r => <button key={r.id} onClick={() => abrirVerRetirada(r.id)} className="flex flex-wrap justify-between items-center gap-2 py-2 border-b border-surface-container text-left">
      <span><b className="font-mono">{numRetirada(r)}</b> · {r.recoge}{r.enNombre === 'tercero' ? ` (en nombre de ${r.tercero})` : ''} {r.estado === 'anulada' && <Tag c="bg-error-container text-error">anulada</Tag>}</span>
      <span className="text-body-sm text-secondary">{fechaHora(r.ts)} · {r.lineas.length} artículo{r.lineas.length === 1 ? '' : 's'} · {MOTIVO_RETIRADA[r.motivo]}</span></button>)}
    {!lista.length && <p className="text-body-sm text-secondary">Cuando {nombre} (o alguien en su nombre) se lleve material suyo, regístralo aquí con su firma: el stock en custodia baja y queda el albarán de retirada.</p>}
  </section>);
}
