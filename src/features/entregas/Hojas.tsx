/* E-011 · Piezas de la entrega: panel de firma en pantalla grande (con el correo de la copia), entregas preparadas,
   albarán con el estado de la copia por correo, tallas del técnico e informe de entregas. Sin plantillas. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Entrega, LineaEntrega, Tallas, TipoTalla, Tecnico } from '../../data/tipos';
import { MARCA } from '../../data/catalogo';
import { find, nombreVehiculo, numEntrega, qtyTxt } from '../../domain/reglas';
import { fechaHora, num } from '../../domain/formato';
import { hashEntrega } from '../../domain/hash';
import { descargarCsv } from '../../domain/csv';
import { emailValido, NOMBRE_TALLA } from '../../domain/entregas';
import { estadoCopia } from '../../../supabase/functions/_compartido/envios';
import { ejecutar, guardar, S, useAlmacen } from '../../store/almacen';
import { nuevoId } from '../../store/ops';
import { modoNube } from '../../store/nube/cliente';
import { procesarAhora } from '../../store/nube/avisos';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { Firma, firmaPNG, type Trazo } from '../../ui/firma';
import { BTN_P, BTN_S, Campo, FirmaImg, Icon, INP, LBL, Vacio, Avatar } from '../../ui/base';
import { FotoLinea } from '../../ui/foto';
import { compartirJustificante, descargarJustificante } from './justificante';
import { enlaceWhatsApp, normalizarTelefono, textoWhatsApp } from '../../domain/whatsapp';
import { enlacePortal, generarToken, hashToken } from '../../domain/portal';
import { esPersonal, firmantesDe } from '../../domain/entregas';
import { usePermisos } from '../../store/permisos';

/** Sin dominio propio verificado en Resend, la copia solo llega al correo del administrador */
export const sinDominioResend = (remitente: string) => !remitente.trim() || /resend\.dev/i.test(remitente);

/* ---------- Panel de firma: resumen grande con fotos, correo de la copia y firma con el dedo ---------- */
/** E-017: la entrega es del equipo; firma el técnico del equipo que recoge (se elige aquí; con uno solo, ya viene elegido) */
export interface DatosFirma { firma: string; email: string; telefono: string; recoge: string; copiaEquipo: boolean }
export function PanelFirma({ lineas, equipo, receptor, obra, onFirmar, enPagina, extra }: { lineas: LineaEntrega[]; equipo: string; receptor?: string; obra?: string; onFirmar: (d: DatosFirma) => Promise<boolean>; enPagina?: boolean; extra?: ReactNode }) {
  const E = useAlmacen(), firmantes = firmantesDe(E, equipo), eqF = E.equipos.find(q => q.id === equipo);
  const [recoge, setRecoge] = useState(receptor && firmantes.some(x => x.id === receptor) ? receptor : firmantes.length === 1 ? firmantes[0].id : '');
  const t = E.tecnicos.find(x => x.id === recoge);
  const [firma, setFirma] = useState<Trazo[]>([]);
  const [email, setEmail] = useState(t?.email || '');
  const [telefono, setTelefono] = useState(t?.telefono || '');
  const [copiaEquipo, setCopiaEquipo] = useState(false);
  const elegir = (id: string) => { const x = E.tecnicos.find(y => y.id === id); setRecoge(id); setEmail(x?.email || ''); setTelefono(x?.telefono || ''); };
  const [ocupado, setOcupado] = useState(false);
  const malo = !!email.trim() && !emailValido(email);
  const telMalo = !!telefono.trim() && !normalizarTelefono(telefono);
  const firmar = async () => {
    if (!recoge) { document.getElementById('quien-recoge')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return toast('Toca arriba el nombre del técnico que recoge y firma.', 'err'); }
    if (malo) return toast('El correo no es válido: corrígelo o déjalo vacío.', 'err');
    if (telMalo) return toast('El teléfono no es válido: 9 cifras o con el prefijo del país (+34 600 000 000).', 'err');
    setOcupado(true);
    try { if (await onFirmar({ firma: firmaPNG(firma), email: email.trim().toLowerCase(), telefono: telefono.trim() ? normalizarTelefono(telefono)! : '', recoge, copiaEquipo })) setFirma([]); } finally { setOcupado(false); }
  };
  return (<>
    <div className="p-4 lg:p-5 flex flex-col gap-4">
      <div id="quien-recoge" className={!recoge && firmantes.length > 1 ? 'rounded-xl ring-2 ring-amber-400 p-2 -m-2' : ''}><div className={`${LBL} mb-1`}>Recoge y firma (técnico de {eqF?.nombre || 'el equipo'}){!recoge && firmantes.length > 1 ? ' · toca un nombre' : ''}</div>
        {!firmantes.length ? <p className="text-body-sm text-error">El equipo no tiene técnicos asignados: asígnale alguno en Equipos y técnicos.</p>
          : <div className="flex flex-wrap gap-2">{firmantes.map(x => <button key={x.id} type="button" onClick={() => elegir(x.id)}
            className={`min-h-14 px-4 rounded-xl flex items-center gap-2 font-semibold ${recoge === x.id ? 'bg-primary text-white' : 'bg-surface-container-low hover:bg-surface-container'}`}>
            <Avatar n={x.nombre} c={recoge === x.id ? 'bg-white/20 text-white' : undefined} />{x.nombre}{recoge === x.id && <Icon n="check_circle" className="ico-fill" />}</button>)}</div>}</div>
      <ul className="flex flex-col">{lineas.map((l, i) => { const p = find(E, l.sku), h = E.herramientas.find(x => x.id === l.dotacion); return (
        <li key={i} className="flex items-center gap-3 py-2.5 border-b border-surface-container">
          <FotoLinea sku={l.sku} herramienta={l.dotacion} size="w-14 h-14" />
          <span className="flex-1 min-w-0 text-body-lg font-medium leading-snug">{h ? `${h.nombre} · ${h.serie}` : p?.name || l.sku}
            {l.serials.length ? <span className="block font-mono text-label-md text-secondary">S/N {l.serials.join(', ')}</span> : null}
            {p?.talla ? <span className="block text-body-sm text-secondary">Talla {p.talla}</span> : null}
            {(h || (p && esPersonal(p))) ? <span className="block text-body-sm text-violet-800">Dotación personal de {t?.nombre || 'quien firme'}</span> : null}</span>
          <b className="text-headline-sm whitespace-nowrap">{h ? '1 ud' : p ? qtyTxt(p, l.qty) : num(l.qty)}</b></li>); })}</ul>
      {obra && <p className="text-body-sm">Obra: <b>{obra}</b></p>}
      <details className="rounded-xl bg-surface-container-low px-4 py-3"><summary className="cursor-pointer font-semibold text-body-md">Enviar copia por WhatsApp o correo (opcional)</summary><div className="flex flex-col gap-4 mt-3">
      <Campo label={`WhatsApp de ${t?.nombre || 'quien recoge'} (para enviarle la copia y su enlace)`}>
        <input value={telefono} onChange={e => setTelefono(e.target.value)} type="tel" inputMode="tel" autoComplete="off" placeholder="600 000 000"
          className={`${INP} h-14 ${telMalo ? 'ring-2 ring-error' : ''}`} />
      </Campo>
      {telMalo ? <p className="text-body-sm text-error -mt-2">Teléfono no válido.</p> : telefono.trim() && normalizarTelefono(telefono) !== (t?.telefono || null) ? <p className="text-body-sm text-secondary -mt-2">Se guardará en su ficha.</p> : null}
      <Campo label={`Copia por correo a ${t?.nombre || 'quien recoge'} (opcional)`}>
        <input value={email} onChange={e => setEmail(e.target.value)} type="email" inputMode="email" autoComplete="off" placeholder="correo@ejemplo.es (opcional)"
          className={`${INP} h-14 ${malo ? 'ring-2 ring-error' : ''}`} />
      </Campo>
      <p className="text-body-sm text-secondary -mt-2">{malo ? <span className="text-error">Correo no válido.</span>
        : !email.trim() ? 'Sin correo no se envía copia; después podrás compartir o descargar el PDF.'
          : email.trim().toLowerCase() !== (t?.email || '') ? 'Se guardará en su ficha y le llegará el PDF de la entrega firmada.'
            : 'Al firmar le llega el PDF de la entrega firmada.'}
        {!!email.trim() && modoNube && sinDominioResend(E.configAvisos.correoRemitente) && <span className="block text-amber-800">Aviso: sin dominio propio verificado en Resend, la copia solo llega al correo del administrador (guía, paso 8). Podrás compartir el PDF por WhatsApp o correo.</span>}</p>
      {firmantes.length > 1 && <label className="flex items-center gap-2 text-body-md"><input type="checkbox" checked={copiaEquipo} onChange={e => setCopiaEquipo(e.target.checked)} className="w-5 h-5 accent-primary" />Enviar la copia por correo también a los demás técnicos del equipo</label>}
      </div></details>
      <div><div className={`${LBL} mb-1`}>Firma de {t?.nombre || 'quien recoge'}</div><Firma trazos={firma} onChange={setFirma} />
        <button onClick={() => setFirma([])} className="text-body-sm text-secondary mt-1 h-10">Borrar firma</button></div>
      <p className="text-body-sm text-secondary">Al firmar confirmas que recoges para {eqF?.nombre || 'el equipo'} este material revisado y completo.</p>
    </div>
    {(() => { const b = <><button onClick={() => void firmar()} disabled={!firma.length || ocupado} className={`${BTN_P} w-full h-16 text-headline-sm`}><Icon n="check_circle" className="ico-fill" />{ocupado ? 'Firmando…' : !firma.length ? 'Firma arriba para continuar' : 'Firmar y recibir'}</button>{extra}</>;
      return enPagina ? <div className="p-4 border-t border-surface-container flex flex-col gap-2">{b}</div> : <SheetFoot className="flex flex-col gap-2">{b}</SheetFoot>; })()}
  </>);
}

/** Después de firmar: correo nuevo a la ficha (va antes en la cola), confirmación y, en la nube, envío inmediato de la copia */
export async function confirmarFirma(id: string, firma: string, email: string, receptor: string, telefono = '', copiaEquipo = false): Promise<boolean> {
  const t = S().tecnicos.find(x => x.id === receptor);
  if (email !== (t?.email || '') && !ejecutar({ op: 'emailTecnico', args: { tecnico: receptor, email } })) return false;
  if (telefono && telefono !== (t?.telefono || '') && !ejecutar({ op: 'telefonoTecnico', args: { tecnico: receptor, telefono } })) return false;
  if (!ejecutar({ op: 'confirmarEntrega', args: { id, firma, recoge: receptor, copiaEquipo } })) return false;
  if (!modoNube) { const x = S().entregas.find(y => y.id === id)!; x.hash = await hashEntrega(x); guardar(); }
  // el administrador puede lanzar el envío al momento; si no, la tarea programada lo envía en menos de un minuto
  else if (S().rol === 'admin' && email) void procesarAhora();
  return true;
}

/* ---------- Firmar una entrega preparada ---------- */
export const abrirFirma = (id: string) => openModal(<FirmaPreparada id={id} />, { ancha: true });
function FirmaPreparada({ id }: { id: string }) {
  const E = useAlmacen(), e = E.entregas.find(x => x.id === id);
  if (!e) return <SheetHead title="Entrega no encontrada" />;
  const eqE = E.equipos.find(q => q.id === e.equipo);
  return (<>
    <SheetHead title={`Entrega al equipo ${eqE?.nombre || e.equipo}`} sub={numEntrega(e)} />
    <PanelFirma lineas={e.lineas} equipo={e.equipo} receptor={e.receptor} obra={e.obra} onFirmar={async d => {
      if (!(await confirmarFirma(id, d.firma, d.email, d.recoge, d.telefono, d.copiaEquipo))) return false;
      closeModal(); toast(`Entrega firmada por ${E.tecnicos.find(x => x.id === d.recoge)?.nombre}. Stock descontado.`, 'ok', 6000); abrirRecibo(id);
      return true;
    }} />
  </>);
}

/* ---------- Entregas preparadas (stock reservado, pendientes de firma) ---------- */
export function Preparadas() {
  const E = useAlmacen();
  const lista = E.entregas.filter(e => e.estado === 'preparada').sort((a, b) => (a.caduca ?? 0) - (b.caduca ?? 0));
  if (!lista.length) return null;
  return (
    <section className="bg-amber-50 rounded-xl p-4 flex flex-col gap-2">
      <h2 className="font-semibold flex items-center gap-2"><Icon n="inventory" className="text-amber-800" />Preparadas: el stock está reservado hasta que el técnico firme</h2>
      {lista.map(e => { const caducada = (e.caduca ?? 0) <= Date.now(), t = E.tecnicos.find(x => x.id === e.receptor); return (
        <div key={e.id} className="flex flex-wrap items-center gap-3 bg-white rounded-lg p-3">
          <div className="flex-1 min-w-[200px]"><div className="font-semibold">{numEntrega(e)} · {E.equipos.find(q => q.id === e.equipo)?.nombre || e.equipo}{t ? ` · ${t.nombre}` : ''}</div>
            <div className="text-body-sm text-secondary">{e.lineas.length} líneas{e.obra ? ` · ${e.obra}` : ''} · {caducada ? <span className="text-error">reserva caducada: anúlala y prepárala de nuevo</span> : `reserva hasta ${fechaHora(e.caduca!)}`}</div></div>
          <button onClick={() => { if (ejecutar({ op: 'anularEntrega', args: { id: e.id } })) toast('Entrega anulada: el stock vuelve a estar libre.', 'ok'); }} className={`${BTN_S} h-14 px-4`}>Anular</button>
          {!caducada && <button onClick={() => abrirFirma(e.id)} className={`${BTN_P} h-14 px-5`}><Icon n="draw" className="ico-20" />Firmar</button>}
        </div>); })}
    </section>
  );
}

/* ---------- Estado de la copia por correo ---------- */
export function useCopia(e: Entrega) {
  const E = useAlmacen();
  const envios = E.envios.filter(x => x.entrega === e.id);
  return { estado: modoNube ? estadoCopia(envios.map(x => ({ estado: x.estado, reintentos: x.reintentos ?? 0 }))) : 'demo' as const, ultimo: envios[0] };
}
export function EtiquetaCopia({ e }: { e: Entrega }) {
  const { estado, ultimo } = useCopia(e);
  if ((e.estado ?? 'firmada') !== 'firmada') return null;
  const m = { enviada: ['bg-tertiary-fixed/40 text-tertiary', 'mark_email_read', 'Copia enviada'], pendiente: ['bg-amber-100 text-amber-800', 'schedule_send', 'Enviando copia'],
    fallida: ['bg-error-container text-error', 'mail_lock', 'Copia no enviada'], 'sin-correo': ['bg-surface-container-high text-secondary', 'mail', 'Sin copia'], demo: ['bg-surface-container-high text-secondary', 'mail', 'Copia (en la nube)'] }[estado];
  return <span title={ultimo?.error || ultimo?.destinatarios?.join(', ') || ''} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-label-sm font-semibold ${m[0]}`}><Icon n={m[1]} className="ico-16" />{m[2]}</span>;
}

/* ---------- Albarán de la entrega (con la copia por correo) ---------- */
export const abrirRecibo = (id: string) => openModal(<Recibo id={id} />);
function Recibo({ id }: { id: string }) {
  const perm = usePermisos();
  const E = useAlmacen(), e = E.entregas.find(x => x.id === id);
  const [email, setEmail] = useState('');
  if (!e) return <SheetHead title="Entrega no encontrada" />;
  const eq = E.equipos.find(x => x.id === e.equipo), rec = E.tecnicos.find(t => t.id === e.receptor);
  const firmada = (e.estado ?? 'firmada') === 'firmada';
  return (<>
    <SheetHead title={`Albarán de entrega ${numEntrega(e)}`} sub={fechaHora(e.ts)} />
    <div id="impresion" className="p-5 flex flex-col gap-3 bg-white">
      <div className="flex justify-between"><div><div className="font-bold">{MARCA.nombre}</div><div className="text-body-sm text-secondary">{MARCA.nave}</div></div><div className="text-right font-mono text-label-md">{numEntrega(e)}<br />{fechaHora(e.ts)}</div></div>
      <div className="grid grid-cols-2 gap-2 text-body-sm">
        <div className="bg-surface-container-low rounded-lg p-2.5"><div className={LBL}>Entrega al equipo</div>{eq ? eq.nombre : e.equipo}{e.vehiculo ? ` · ${nombreVehiculo(E, e.vehiculo).split(' · ').pop()}` : ''}</div>
        <div className="bg-surface-container-low rounded-lg p-2.5"><div className={LBL}>Recoge y firma</div>{rec?.nombre || '—'}{rec ? ` · DNI ${e.dni || rec.dni}` : ''}</div></div>
      <table className="w-full text-body-sm"><thead><tr className={`text-left ${LBL}`}><th className="py-1">Material</th><th>S/N</th><th className="text-right">Cant.</th></tr></thead>
        <tbody>{e.lineas.map((l, i) => { const p = find(E, l.sku), h = E.herramientas.find(x => x.id === l.dotacion); return <tr key={i} className="border-t border-surface-container"><td className="py-1.5">
          <span className="flex items-center gap-2"><FotoLinea sku={l.sku} herramienta={l.dotacion} size="w-9 h-9" /><span>{h ? h.nombre : p ? p.name : l.sku}<span className="block font-mono text-label-sm text-secondary">{h ? h.serie : l.sku}</span></span></span></td>
          <td className="font-mono text-label-sm">{(l.serials || []).map(s => <div key={s}>{s}</div>)}</td><td className="text-right font-semibold">{h ? '1 ud' : p ? qtyTxt(p, l.qty) : num(l.qty)}</td></tr>; })}</tbody></table>
      {firmada ? <div className="flex items-end justify-between gap-3 border-t border-surface-container pt-3"><div><FirmaImg f={e.firma} className="h-16 w-44" /><div className="text-body-sm text-secondary">Firma de quien recoge</div></div>
        <div className="font-mono text-[9px] text-secondary break-all max-w-[55%] text-right">Huella SHA-256<br />{e.hash || 'Se calcula en el servidor al sincronizar'}</div></div>
        : <p className="text-body-sm text-amber-800">Pendiente de firma{e.estado === 'anulada' ? ' (anulada)' : ''}.</p>}
      {e.obra && <p className="text-body-sm">Obra: <b>{e.obra}</b></p>}
      <p className="text-body-sm text-secondary">Recogida por {rec?.nombre || 'un técnico del equipo'} para el equipo {eq?.nombre || e.equipo}. Registrado por {e.operator}.</p>
    </div>
    {firmada && perm.mod('entregas') && <CopiaWhatsApp e={e} />}
    {firmada && perm.mod('entregas') && <CopiaCorreo e={e} email={email} setEmail={setEmail} />}
    {firmada && <HistorialCopias e={e} />}
    <SheetFoot className="flex flex-wrap gap-2">
      <button onClick={closeModal} className={`${BTN_S} h-14 px-5`}>Cerrar</button>
      <button onClick={() => void compartirJustificante(e).then(ok => { if (ok && firmada && perm.mod('entregas')) ejecutar({ op: 'copiaEntrega', args: { id: nuevoId(), entrega: e.id, canal: 'compartir', destino: '' } }); })} className={`${BTN_P} h-16 w-full sm:w-auto sm:flex-1 text-headline-sm order-first`}><Icon n="share" className="ico-20" />Compartir PDF</button>
      <button onClick={() => void descargarJustificante(e)} className={`${BTN_S} h-14 px-4`}><Icon n="download" className="ico-20" />Descargar PDF</button>
      {perm.exportar && <button onClick={() => print()} className={`${BTN_S} h-14 px-4`}><Icon n="print" className="ico-20" />Imprimir</button>}
    </SheetFoot>
  </>);
}

/* ---------- E-014 · Copia por WhatsApp con el enlace a su portal ---------- */
function CopiaWhatsApp({ e }: { e: Entrega }) {
  const E = useAlmacen(), t = E.tecnicos.find(x => x.id === e.receptor);
  // E-017: la copia va al técnico que firmó; opcionalmente, también a los demás técnicos del equipo (cada uno con su enlace)
  const otros = firmantesDe(E, e.equipo).filter(x => x.id !== e.receptor);
  const [tel, setTel] = useState(t?.telefono || '');
  // los tokens se preparan al abrir el albarán para que el botón abra WhatsApp en el mismo toque (los móviles bloquean las ventanas abiertas tarde)
  const [enlaces, setEnlaces] = useState<Record<string, { token: string; hash: string }>>({});
  const preparar = (id: string) => { const token = generarToken(); void hashToken(token).then(hash => setEnlaces(x => ({ ...x, [id]: { token, hash } }))); };
  useEffect(() => { [e.receptor, ...otros.map(o => o.id)].filter(Boolean).forEach(preparar); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const n = normalizarTelefono(tel), enviadas = E.copias.filter(c => c.entrega === e.id && c.canal === 'whatsapp').length;
  const enviarA = (tec: Tecnico, telefono: string) => {
    const enlace = enlaces[tec.id]; if (!enlace) return;
    const url = enlaceWhatsApp(telefono, textoWhatsApp({ nombre: tec.nombre, numero: numEntrega(e), fecha: e.ts, lineas: e.lineas.length, enlace: enlacePortal(enlace.token) }))!;
    window.open(url, '_blank', 'noopener');
    if (telefono !== (tec.telefono || '')) ejecutar({ op: 'telefonoTecnico', args: { tecnico: tec.id, telefono } });
    ejecutar({ op: 'enlacePortal', args: { tecnico: tec.id, hash: enlace.hash, entrega: e.id } });
    ejecutar({ op: 'copiaEntrega', args: { id: nuevoId(), entrega: e.id, canal: 'whatsapp', destino: telefono } });
    preparar(tec.id);   // el siguiente envío lleva otro enlace
  };
  const enviar = () => { if (!n) return toast('Escribe el teléfono del técnico: 9 cifras o con el prefijo del país.', 'err'); if (t) enviarA(t, n); };
  return (
    <div className="mx-5 mb-3 rounded-xl p-3 flex flex-col gap-2 bg-[#e7f8ee]">
      <div className="flex flex-wrap gap-2">
        <input value={tel} onChange={x => setTel(x.target.value)} type="tel" inputMode="tel" placeholder={`Teléfono de ${t?.nombre || 'quien firmó'}`} aria-label="Teléfono para WhatsApp"
          className={`${INP} h-14 flex-1 min-w-[180px] ${tel.trim() && !n ? 'ring-2 ring-error' : ''}`} />
        <button onClick={enviar} disabled={!t || !enlaces[t.id]} className="h-14 px-5 rounded-xl bg-[#128c3e] hover:bg-[#0f7a36] text-white font-semibold inline-flex items-center gap-2 disabled:opacity-50">
          <Icon n="chat" className="ico-fill" />{enviadas ? 'Reenviar por WhatsApp' : 'Enviar por WhatsApp'}</button>
      </div>
      {otros.length > 0 && <div className="flex flex-wrap items-center gap-2 text-body-sm"><span className="text-secondary">También al resto del equipo:</span>
        {otros.map(o => { const to = normalizarTelefono(o.telefono); return <button key={o.id} disabled={!to || !enlaces[o.id]} onClick={() => to && enviarA(o, to)} title={to ? '' : 'Sin teléfono en su ficha'}
          className="h-10 px-3 rounded-lg bg-white font-semibold text-[#0f7a36] disabled:opacity-40 inline-flex items-center gap-1"><Icon n="chat" className="ico-18" />{o.nombre}</button>; })}</div>}
      <p className="text-body-sm text-secondary">Le llega un mensaje breve con el enlace a <b>su portal</b>: las entregas de su equipo, el PDF firmado y lo que lleva su vehículo. Sin usuario ni contraseña; el administrador puede revocar sus enlaces desde su ficha.</p>
    </div>
  );
}

function HistorialCopias({ e }: { e: Entrega }) {
  const E = useAlmacen();
  const filas = [
    ...E.copias.filter(c => c.entrega === e.id).map(c => ({ ts: c.ts, icon: c.canal === 'whatsapp' ? 'chat' : 'share', txt: `${c.canal === 'whatsapp' ? 'WhatsApp' : 'PDF compartido'}${c.destino ? ` · ${c.destino}` : ''}`, quien: c.operator })),
    ...E.envios.filter(x => x.entrega === e.id).map(x => ({ ts: x.ts, icon: 'mail', txt: `Correo · ${(x.destinatarios || []).join(', ')} · ${x.estado === 'enviado' ? 'enviado' : x.estado === 'descartado' ? 'sustituido por un reenvío' : x.estado === 'pendiente' ? 'pendiente' : 'no enviado'}`, quien: '' })),
  ].sort((a, b) => b.ts - a.ts);
  if (!filas.length) return null;
  return (
    <div className="mx-5 mb-3"><div className={`${LBL} mb-1`}>Copias enviadas</div>
      {filas.map((f, i) => <div key={i} className="flex items-center gap-2 py-1.5 border-b border-surface-container text-body-sm"><Icon n={f.icon} className="ico-18 text-secondary" /><span className="flex-1 min-w-0 truncate">{f.txt}</span><span className="text-secondary whitespace-nowrap">{fechaHora(f.ts)}{f.quien ? ` · ${f.quien}` : ''}</span></div>)}
    </div>
  );
}

function CopiaCorreo({ e, email, setEmail }: { e: Entrega; email: string; setEmail: (v: string) => void }) {
  const E = useAlmacen(), { estado, ultimo } = useCopia(e), t = E.tecnicos.find(x => x.id === e.receptor);
  const reenviar = async () => {
    const nuevo = email.trim();
    if (nuevo && !emailValido(nuevo)) return toast('Correo no válido.', 'err');
    if (!ejecutar({ op: 'reenviarCopia', args: { entrega: e.id, email: nuevo || undefined } })) return;
    setEmail('');
    toast('Copia en cola: se envía en cuanto haya conexión.', 'ok');
    if (E.rol === 'admin') { const err = await procesarAhora(); if (err) toast(err, 'err', 7000); }
  };
  if (estado === 'demo') return <p className="px-5 pb-3 text-body-sm text-secondary">Demostración: en la versión con nube, al firmar se envía la copia en PDF al correo del técnico{t?.email ? ` (${t.email})` : ''}.</p>;
  const texto = { enviada: `Copia enviada a ${ultimo?.destinatarios?.join(', ')}.`, pendiente: `Copia pendiente de envío a ${ultimo?.destinatarios?.join(', ') || t?.email}.`,
    fallida: `No se ha podido enviar la copia${ultimo?.error ? `: ${ultimo.error.slice(0, 160)}` : '.'}`, 'sin-correo': `${t?.nombre || 'El técnico'} no tiene correo: no se ha enviado copia.` }[estado];
  return (
    <div className={`mx-5 mb-3 rounded-xl p-3 flex flex-col gap-2 ${estado === 'fallida' ? 'bg-error-container/50' : estado === 'enviada' ? 'bg-tertiary-fixed/30' : 'bg-surface-container-low'}`}>
      <div className="flex items-center gap-2"><EtiquetaCopia e={e} /><span className="text-body-sm">{texto}</span></div>
      {estado === 'fallida' && /only send testing emails|domain is not verified/i.test(ultimo?.error || '') && <p className="text-body-sm text-amber-800">Resend solo permite enviar a otros correos con un dominio propio verificado (guía, paso 8). Mientras tanto, usa “Compartir PDF”.</p>}
      {estado !== 'pendiente' && <div className="flex flex-wrap gap-2">
        <input value={email} onChange={x => setEmail(x.target.value)} type="email" inputMode="email" placeholder={t?.email || 'correo del técnico'} className={`${INP} h-14 flex-1 min-w-[200px]`} aria-label="Correo para la copia" />
        <button onClick={() => void reenviar()} className={`${BTN_S} h-14 px-4`}><Icon n="forward_to_inbox" className="ico-20" />{estado === 'enviada' ? 'Reenviar copia' : 'Enviar copia'}</button>
      </div>}
    </div>
  );
}

/* ---------- Tallas del técnico (preseleccionan la talla en la cesta) ---------- */
export const abrirTallas = (tecnico: string) => openModal(<EditarTallas tecnico={tecnico} />);
function EditarTallas({ tecnico }: { tecnico: string }) {
  const E = useAlmacen(), t = E.tecnicos.find(x => x.id === tecnico)!;
  const [f, setF] = useState<Tallas>({ ...(t.tallas || {}) });
  const ok = () => { if (ejecutar({ op: 'tallas', args: { tecnico, tallas: f } })) { closeModal(); toast('Tallas guardadas.', 'ok'); } };
  return (<>
    <SheetHead title={`Tallas de ${t.nombre}`} sub="Al entregarle ropa o EPIs, su talla sale preseleccionada (se puede cambiar)." />
    <div className="p-5 grid grid-cols-2 gap-3">{(Object.keys(NOMBRE_TALLA) as TipoTalla[]).map(k =>
      <Campo key={k} label={NOMBRE_TALLA[k]}><input value={f[k] || ''} onChange={e => setF({ ...f, [k]: e.target.value.toUpperCase() })} className={`${INP} h-12 font-mono`} placeholder={k === 'camiseta' ? 'M' : k === 'pantalon' ? '44' : k === 'calzado' ? '42' : '9'} /></Campo>)}</div>
    <SheetFoot><button onClick={ok} className={`${BTN_P} w-full h-12`}><Icon n="save" className="ico-20" />Guardar tallas</button></SheetFoot>
  </>);
}

/* ---------- Informe: qué se ha entregado a cada técnico en un mes ---------- */
export const abrirInformeEntregas = () => openModal(<InformeEntregas />, { ancha: true });
function InformeEntregas() {
  const E = useAlmacen();
  const hoy = new Date();
  const [mes, setMes] = useState(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`);
  const [a, m] = mes.split('-').map(Number), desde = new Date(a, m - 1, 1).getTime(), hasta = new Date(a, m, 1).getTime();
  const filas = useMemo(() => {
    // E-017: por equipo (el destinatario), con quién recogió cada vez
    const g = new Map<string, { equipo: string; entregas: Set<string>; lineas: number; obras: Set<string>; recogen: Set<string> }>();
    for (const e of E.entregas) {
      if ((e.estado ?? 'firmada') !== 'firmada' || e.ts < desde || e.ts >= hasta) continue;
      const f = g.get(e.equipo) || { equipo: E.equipos.find(q => q.id === e.equipo)?.nombre || e.equipo, entregas: new Set<string>(), lineas: 0, obras: new Set<string>(), recogen: new Set<string>() };
      f.entregas.add(e.id); f.lineas += e.lineas.length; if (e.obra) f.obras.add(e.obra);
      const r = E.tecnicos.find(t => t.id === e.receptor)?.nombre; if (r) f.recogen.add(r);
      g.set(e.equipo, f);
    }
    return [...g.values()].sort((x, y) => x.equipo.localeCompare(y.equipo));
  }, [E, desde, hasta]);
  const csv = () => descargarCsv(`entregas-por-equipo-${mes}.csv`, [['Equipo', 'Entregas', 'Líneas', 'Recogido por', 'Obras'],
    ...filas.map(f => [f.equipo, f.entregas.size, f.lineas, [...f.recogen].join(' | '), [...f.obras].join(' | ')])]);
  return (<>
    <SheetHead title="Entregas por equipo" sub="Qué se ha entregado a cada equipo en el mes, quién lo recogió y para qué obras." />
    <div className="p-5 flex flex-col gap-3">
      <Campo label="Mes"><input type="month" value={mes} onChange={e => setMes(e.target.value)} className={`${INP} h-11 !w-48`} /></Campo>
      {filas.length ? <table className="tabla w-full text-body-sm"><thead><tr><th>Equipo</th><th>Entregas</th><th>Líneas</th><th>Recogido por</th><th>Obras</th></tr></thead>
        <tbody>{filas.map((f, i) => <tr key={i}><td>{f.equipo}</td><td>{f.entregas.size}</td><td>{f.lineas}</td><td>{[...f.recogen].join(', ') || '—'}</td><td>{[...f.obras].join(', ') || '—'}</td></tr>)}</tbody></table>
        : <Vacio>No hay entregas firmadas en ese mes.</Vacio>}
    </div>
    <SheetFoot><button onClick={csv} disabled={!filas.length} className={`${BTN_S} w-full h-12`}><Icon n="table" className="ico-20" />Descargar CSV</button></SheetFoot>
  </>);
}

