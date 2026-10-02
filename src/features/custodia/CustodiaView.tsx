/* E-008 / E-024 · Material en custodia de cada socio (Esmove, Instant Box…): stock, solicitud de reposición, informe sin importes y acta de recuento firmada */
import { useMemo, useState } from 'react';
import { UNIT } from '../../data/catalogo';
import { esCustodia, qtyTxt, status, stockTotal } from '../../domain/reglas';
import { fechaHora, hoyISO, num, toNum } from '../../domain/formato';
import { datosInformeCustodia, gruposReposicion } from '../../domain/custodia';
import { descargar } from '../../domain/csv';
import { construirInforme, informeCsv, informeHtml, periodoAnterior } from '../../../supabase/functions/_compartido/informe';
import { ejecutar, useAlmacen } from '../../store/almacen';
import { usePermisos } from '../../store/permisos';
import { nuevoId } from '../../store/ops';
import { modoNube } from '../../store/nube/cliente';
import { enviarInforme } from '../../store/nube/avisos';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { Firma, firmaPNG, type Trazo } from '../../ui/firma';
import { BTN_P, BTN_S, BTN_T, CARD, Campo, FirmaImg, Icon, INP, LBL, Pill, Tag, Vacio } from '../../ui/base';
import { abrirFicha, Ubicaciones } from '../inventario/hojas';
import { abrirReposicion } from '../reposicion/Reposicion';
import { fotosInforme } from '../fotos/servicio';
import { colorSocio } from '../../domain/socios';
import { ir } from '../../store/ui';

export default function CustodiaView() {
  const E = useAlmacen(), perm = usePermisos();
  // E-024: una pestaña por socio (los activos y los desactivados que aún tengan material)
  const socios = E.propietarios.filter(o => o.activo !== false || E.products.some(p => esCustodia(p) && p.propietario === o.id));
  const [elegido, setProp] = useState(socios[0]?.id || 'ESMOVE');
  const prop = socios.some(o => o.id === elegido) ? elegido : socios[0]?.id || elegido;
  const o = E.propietarios.find(x => x.id === prop);
  const prods = E.products.filter(p => esCustodia(p) && p.propietario === prop).sort((a, b) => a.name.localeCompare(b.name));
  const solicitud = gruposReposicion(E).find(g => g.destino === 'propietario' && g.grupo === prop);
  const rojos = prods.filter(p => status(p) === 'red').length, amarillos = prods.filter(p => status(p) === 'amber').length;
  return (
    <div className="px-4 lg:px-gutter py-4 lg:py-space-lg flex flex-col gap-4 lg:gap-space-lg max-w-[1400px]">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div><span className={LBL}>Material que no es nuestro · sin precios</span><h1 className="text-headline-lg-mobile lg:text-headline-lg font-bold">En custodia de {o?.nombre || prop}</h1>
          <p className="text-secondary">{prods.length} referencias · {num(prods.reduce((a, p) => a + p.stock, 0))} unidades · {rojos} en rojo · {amarillos} bajas</p></div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => openModal(<Informe prop={prop} />, { ancha: true })} className={`${BTN_S} px-4 h-11`}><Icon n="summarize" className="ico-20" />Informe</button>
          {perm.mod('custodia') && <button onClick={() => openModal(<Acta prop={prop} />, { ancha: true })} className={`${BTN_P} px-4 h-11`}><Icon n="fact_check" className="ico-20" />Recuento con {o?.nombre || 'el propietario'}</button>}
        </div>
      </div>
      {socios.length > 0 && <div role="tablist" aria-label="Socios de custodia" className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 lg:mx-0 lg:px-0 pb-1">
        {socios.map(x => { const n = E.products.filter(p => esCustodia(p) && p.propietario === x.id).length, act = x.id === prop; return (
          <button key={x.id} role="tab" aria-selected={act} onClick={() => setProp(x.id)} className={`shrink-0 inline-flex items-center gap-2 px-4 h-11 rounded-full font-semibold ${act ? 'bg-primary text-white' : `${colorSocio(x).c}`}`}>
            {x.nombre}<span className={`px-1.5 rounded font-mono text-label-sm ${act ? 'bg-white/20' : 'bg-white/60'}`}>{n}</span>{x.activo === false && <span className="text-label-sm">(desactivado)</span>}</button>); })}
        {perm.admin && <button onClick={() => ir('config')} className="shrink-0 inline-flex items-center gap-1 px-3 h-11 rounded-full text-primary font-semibold"><Icon n="add" className="ico-20" />Socio</button>}
      </div>}
      {solicitud && <section className={`${CARD} p-4 flex flex-wrap items-center justify-between gap-3 bg-violet-50`}>
        <div className="flex items-center gap-3"><Icon n="handshake" className="text-violet-800" /><div><div className="font-semibold">{solicitud.lineas.length} referencia{solicitud.lineas.length === 1 ? '' : 's'} bajo mínimo</div><div className="text-body-sm text-secondary">La solicitud de reposición a {o?.nombre} está preparada, sin importes.</div></div></div>
        <button onClick={abrirReposicion} className={`${BTN_T} h-11 px-4`}>{perm.admin ? 'Revisar y enviar' : 'Ver solicitud'}</button></section>}
      <section className={`${CARD} overflow-x-auto`}><table className="tabla w-full min-w-[720px]">
        <thead className="bg-surface-container-low"><tr><th>Referencia</th><th>Código modelo</th><th>Almacén</th><th>En vehículos</th><th>Mínimo</th><th>Estado</th><th>Dónde está</th></tr></thead>
        <tbody>{prods.length ? prods.map(p => <tr key={p.sku} onClick={() => abrirFicha(p.sku)} className="cursor-pointer">
          <td><div className="font-medium">{p.name}</div><div className="font-mono text-label-sm text-secondary whitespace-nowrap">{p.sku}</div></td>
          <td className="font-mono text-label-md">{p.supplierRef || '—'}</td>
          <td className="font-semibold whitespace-nowrap">{qtyTxt(p, p.stock)}</td><td className="whitespace-nowrap text-violet-800">{qtyTxt(p, Math.round((stockTotal(E, p) - p.stock) * 1000) / 1000)}</td><td className="font-mono">{num(p.min)}</td><td><Pill p={p} /></td>
          <td className="text-body-sm"><Ubicaciones p={p} /></td></tr>) : <tr><td colSpan={7}><Vacio>No hay material en custodia de este propietario.</Vacio></td></tr>}</tbody></table></section>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className={`${CARD} p-4 flex flex-col gap-2`}><h2 className="text-headline-sm font-semibold">Actas de recuento</h2>
          {E.actas.filter(a => a.propietario === prop).slice(0, 6).map(a => <button key={a.id} onClick={() => openModal(<VerActa id={a.id} />)} className="flex justify-between items-center gap-2 py-2 border-b border-surface-container text-left">
            <span><b className="font-mono">{a.numero || 'Pendiente de envío'}</b> · {a.representante}</span><span className="text-body-sm text-secondary">{fechaHora(a.ts)} · {a.lineas.filter(l => l.contado !== l.sistema).length} diferencias</span></button>)}
          {!E.actas.some(a => a.propietario === prop) && <p className="text-body-sm text-secondary">Cuando {o?.nombre} venga a verificar, genera el acta con lo contado y su firma.</p>}</section>
        {perm.admin && o && <DatosPropietario id={o.id} />}
      </div>
    </div>
  );
}

function DatosPropietario({ id }: { id: string }) {
  const E = useAlmacen(), o = E.propietarios.find(x => x.id === id)!;
  const [f, setF] = useState({ contacto: o.contacto, repo: o.correosReposicion.join(', '), inf: o.correosInformes.join(', ') });
  const lista = (s: string) => s.split(/[,;\s]+/).filter(Boolean);
  const guardar = () => { if (ejecutar({ op: 'propietario', args: { ...o, contacto: f.contacto, correosReposicion: lista(f.repo), correosInformes: lista(f.inf) } })) toast('Datos del propietario guardados.', 'ok'); };
  return <section className={`${CARD} p-4 flex flex-col gap-2`}><h2 className="text-headline-sm font-semibold">Datos del propietario</h2>
    <Campo label="Contacto"><input value={f.contacto} onChange={e => setF({ ...f, contacto: e.target.value })} className={`${INP} h-10`} placeholder="Nombre y teléfono" /></Campo>
    <Campo label="Correos para solicitudes de reposición"><input value={f.repo} onChange={e => setF({ ...f, repo: e.target.value })} className={`${INP} h-10`} /></Campo>
    <Campo label="Correos para informes"><input value={f.inf} onChange={e => setF({ ...f, inf: e.target.value })} className={`${INP} h-10`} /></Campo>
    <button onClick={guardar} className={`${BTN_S} h-11 self-start px-4`}><Icon n="save" className="ico-20" />Guardar</button></section>;
}

function Informe({ prop }: { prop: string }) {
  const E = useAlmacen(), perm = usePermisos(), o = E.propietarios.find(x => x.id === prop);
  const ahora = new Date(), mesActual = { desde: new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime(), hasta: new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1).getTime() };
  const [periodo, setPeriodo] = useState<'actual' | 'anterior'>('actual');
  const rango = periodo === 'actual' ? mesActual : periodoAnterior('mensual', ahora);
  const inf = useMemo(() => construirInforme(datosInformeCustodia(E, prop, rango.desde, rango.hasta)), [E, prop, rango.desde, rango.hasta]);
  const nombre = `informe-custodia-${prop.toLowerCase()}-${hoyISO()}`;
  const pdf = async () => {
    // abrir la ventana antes de esperar a las fotos (si no, el navegador la bloquea)
    const w = window.open('', '_blank', 'width=900,height=1000'); if (!w) return toast('El navegador ha bloqueado la ventana.', 'warn');
    w.document.write('<p style="font-family:system-ui;padding:24px">Preparando el informe…</p>');
    const fotos = await fotosInforme(E, prop);
    w.document.open(); w.document.write(`<!doctype html><meta charset="utf-8"><title>${inf.titulo}</title><body style="padding:24px">${informeHtml(inf, undefined, fotos)}<script>setTimeout(()=>print(),300)<\/script>`); w.document.close(); };
  const enviar = async () => {
    if (!modoNube) return toast('En la demostración no se envía: descarga el PDF o el CSV.', 'warn');
    if (!o?.correosInformes.length) return toast(`Añade el correo de informes de ${o?.nombre} en Datos del propietario.`, 'warn', 6000);
    const e = await enviarInforme(prop, rango.desde, rango.hasta, o.correosInformes); e ? toast(e, 'err', 7000) : toast(`Informe enviado a ${o.correosInformes.join(', ')}.`, 'ok');
  };
  return (<>
    <SheetHead title={inf.titulo} sub={`Periodo ${inf.periodo} · sin importes`} />
    <div className="p-5 flex flex-col gap-3">
      <div className="inline-flex self-start bg-surface-container-low rounded-lg p-1">{(['actual', 'anterior'] as const).map(k => <button key={k} onClick={() => setPeriodo(k)} className={`px-3 h-10 rounded-md text-body-sm font-semibold ${periodo === k ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant'}`}>{k === 'actual' ? 'Este mes' : 'Mes anterior'}</button>)}</div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">{([['Referencias', inf.resumen.referencias], ['Unidades', num(inf.resumen.unidades)], ['Entradas', inf.resumen.entradas], ['Salidas', inf.resumen.salidas], ['Incidencias', inf.resumen.incidencias]] as [string, string | number][]).map(([k, v]) =>
        <div key={k} className="bg-surface-container-low rounded-lg p-2"><div className={LBL}>{k}</div><div className="text-headline-md font-bold">{v}</div></div>)}</div>
      {inf.secciones.slice(1).map(s => <div key={s.titulo}><div className={`${LBL} mb-1`}>{s.titulo} ({s.filas.length})</div>
        {s.filas.length ? <div className="overflow-x-auto"><table className="tabla w-full text-body-sm"><thead><tr>{s.columnas.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{s.filas.slice(0, 20).map((f, i) => <tr key={i}>{f.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody></table></div>
          : <p className="text-body-sm text-secondary">Sin registros en el periodo.</p>}</div>)}
    </div>
    <SheetFoot className="flex flex-wrap gap-2">
      {perm.exportar && <button onClick={() => descargar(nombre + '.csv', informeCsv(inf), 'text/csv;charset=utf-8')} className={`${BTN_S} h-12 px-4`}><Icon n="table" className="ico-20" />CSV</button>}
      {perm.exportar && <button onClick={() => void pdf()} className={`${BTN_S} h-12 px-4`}><Icon n="picture_as_pdf" className="ico-20" />PDF</button>}
      {perm.admin && <button onClick={() => void enviar()} className={`${BTN_P} h-12 flex-1`}><Icon n="send" className="ico-20" />Enviar a {o?.nombre}</button>}
    </SheetFoot>
  </>);
}

function Acta({ prop }: { prop: string }) {
  const E = useAlmacen(), o = E.propietarios.find(x => x.id === prop);
  const prods = E.products.filter(p => esCustodia(p) && p.propietario === prop).sort((a, b) => a.name.localeCompare(b.name));
  const [cont, setCont] = useState<Record<string, string>>({}), [rep, setRep] = useState(''), [firma, setFirma] = useState<Trazo[]>([]);
  const firmar = () => {
    if (prods.some(p => (cont[p.sku] ?? '').trim() === '')) return toast('Anota lo contado en todas las referencias (0 si no hay).', 'err');
    const id = nuevoId();
    if (!ejecutar({ op: 'acta', args: { id, propietario: prop, representante: rep, firma: firma.length ? firmaPNG(firma) : '', lineas: prods.map(p => ({ sku: p.sku, contado: toNum(cont[p.sku]) })) } })) return;
    closeModal(); toast('Acta firmada y guardada. Las diferencias aparecen en el informe; si procede, ajústalas con un recuento.', 'ok', 7000);
    openModal(<VerActa id={id} />);
  };
  return (<>
    <SheetHead title={`Recuento de custodia con ${o?.nombre}`} sub="Contad juntos; el stock del sistema se toma al firmar. Firma solo el representante del propietario." />
    <div className="p-5 flex flex-col gap-3">
      {prods.map(p => { const d = (cont[p.sku] ?? '') === '' ? 0 : toNum(cont[p.sku]) - p.stock; return (
        <div key={p.sku} className="flex items-center gap-3 py-2 border-b border-surface-container">
          <div className="flex-1 min-w-0"><div className="font-medium truncate">{p.name}</div><div className="font-mono text-label-sm text-secondary">{p.sku} · en almacén {qtyTxt(p, p.stock)}</div></div>
          {d !== 0 && <Tag c={d < 0 ? 'bg-error-container text-error' : 'bg-tertiary-fixed/30 text-tertiary'}>{d > 0 ? '+' : ''}{num(d)}</Tag>}
          <input value={cont[p.sku] ?? ''} onChange={e => setCont({ ...cont, [p.sku]: e.target.value })} inputMode="decimal" placeholder={num(p.stock)} className={`${INP} !w-24 h-12 text-center font-mono`} aria-label={`Contado de ${p.name}`} />
        </div>); })}
      <Campo label={`Representante de ${o?.nombre}`}><input value={rep} onChange={e => setRep(e.target.value)} className={`${INP} h-12`} placeholder="Nombre y apellidos" /></Campo>
      <div><div className={`${LBL} mb-1`}>Firma del representante</div><Firma trazos={firma} onChange={setFirma} /><button onClick={() => setFirma([])} className="text-body-sm text-secondary mt-1">Borrar firma</button></div>
    </div>
    <SheetFoot><button onClick={firmar} disabled={!rep.trim() || !firma.length} className={`${BTN_P} w-full h-14`}><Icon n="draw" className="ico-fill" />Firmar y guardar el acta</button></SheetFoot>
  </>);
}

function VerActa({ id }: { id: string }) {
  const E = useAlmacen(), a = E.actas.find(x => x.id === id);
  if (!a) return <SheetHead title="Acta no encontrada" />;
  const o = E.propietarios.find(x => x.id === a.propietario), nombre = (sku: string) => E.products.find(p => p.sku === sku)?.name || sku;
  const unidad = (sku: string) => { const p = E.products.find(x => x.sku === sku); return p ? UNIT[p.unit] : ''; };
  return (<>
    <SheetHead title={`Acta de recuento ${a.numero || '(pendiente de número)'}`} sub={`${o?.nombre} · ${fechaHora(a.ts)}`} />
    <div id="impresion" className="p-5 flex flex-col gap-3 bg-white">
      <div className="flex justify-between"><div><div className="font-bold">Almacén Búfala</div><div className="text-body-sm text-secondary">Material en custodia de {o?.nombre}</div></div><div className="text-right font-mono text-label-md">{a.numero || 'Pendiente'}<br />{fechaHora(a.ts)}</div></div>
      <table className="w-full text-body-sm"><thead><tr className={`text-left ${LBL}`}><th className="py-1">Referencia</th><th className="text-right">Sistema</th><th className="text-right">Contado</th><th className="text-right">Diferencia</th></tr></thead>
        <tbody>{a.lineas.map(l => <tr key={l.sku} className="border-t border-surface-container"><td className="py-1.5">{nombre(l.sku)}<div className="font-mono text-label-sm text-secondary">{l.sku}</div></td>
          <td className="text-right">{num(l.sistema)} {unidad(l.sku)}</td><td className="text-right font-semibold">{num(l.contado)}</td><td className={`text-right ${l.contado !== l.sistema ? 'text-error font-semibold' : ''}`}>{l.contado === l.sistema ? '—' : `${l.contado > l.sistema ? '+' : ''}${num(l.contado - l.sistema)}`}</td></tr>)}</tbody></table>
      <div className="flex items-end justify-between gap-3 border-t border-surface-container pt-3"><div><FirmaImg f={a.firma} className="h-16 w-44" /><div className="text-body-sm text-secondary">{a.representante} · representante de {o?.nombre}</div></div>
        <div className="font-mono text-[9px] text-secondary break-all max-w-[50%] text-right">Huella SHA-256<br />{a.hash || 'Se calcula en el servidor al sincronizar'}</div></div>
      <p className="text-body-sm text-secondary">Registrado por {a.operator}. Documento de verificación del material en custodia; no es una firma certificada.</p>
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Cerrar</button><button onClick={() => print()} className={`${BTN_P} h-12 flex-1`}><Icon n="print" className="ico-20" />Imprimir o guardar PDF</button></SheetFoot>
  </>);
}
