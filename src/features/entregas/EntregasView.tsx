/* Entrega de material a una furgoneta con firma del receptor */
import { useEffect, useState } from 'react';
import { CATS, MARCA, UNIT } from '../../data/catalogo';
import { find, numEntrega, qtyTxt, searchProducts, status } from '../../domain/reglas';
import { fechaHora, num } from '../../domain/formato';
import { hashEntrega } from '../../domain/hash';
import { avisoEstado, ejecutar, guardar, useAlmacen } from '../../store/almacen';
import { nuevoId, type OpEntrega } from '../../store/ops';
import { modoNube } from '../../store/nube/cliente';
import { ir } from '../../store/ui';
import { openModal, SheetFoot, SheetHead, closeModal } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, CARD, ESTADO_EQ, FirmaImg, Icon, INP, LBL, Tag, TagCustodia } from '../../ui/base';
import { alternarSerie, anadirACesta, disponible, fijarCantidad, quitarDeCesta } from './cesta';
import { Firma, firmaPNG, type Trazo } from '../../ui/firma';
import { abrirInformeEntregas, abrirPlantillas, abrirPreparar, enviarJustificante, Preparadas } from './Plantillas';
import { usePermisos } from '../../store/permisos';


export default function EntregasView() {
  const E = useAlmacen(), perm = usePermisos();
  const [cat, setCat] = useState('cargadores'), [q, setQ] = useState(''), [verSN, setVerSN] = useState<string | null>(null);
  const [firma, setFirma] = useState<Trazo[]>([]), [certifica, setCertifica] = useState(false);
  let eq = E.equipos.find(e => e.id === E.cesta.equipo);
  if (!eq && E.equipos[0]) { eq = E.equipos[0]; E.cesta.equipo = eq.id; }
  const recs = eq ? eq.tecnicos.map(t => E.tecnicos.find(x => x.id === t)).filter(Boolean) as typeof E.tecnicos : [];
  if (!recs.find(t => t.id === E.cesta.receptor)) E.cesta.receptor = recs[0]?.id ?? null;
  const rec = E.tecnicos.find(t => t.id === E.cesta.receptor);
  const prods = searchProducts(E, q, { cat: q ? 'all' : cat }).slice(0, 12);
  const lineas = E.cesta.lineas.filter(l => find(E, l.sku));
  // E-007: las entregas preparadas se firman desde su lista; aquí sigue la entrega directa (cesta + firma)
  const nextId = modoNube ? 'se asigna al enviar' : `ENT-${new Date().getFullYear()}-${String(E.seq.ent + 1).padStart(4, '0')}`;
  const firmado = firma.length > 0, puede = !!(lineas.length && rec && firmado && certifica);

  const confirmar = async () => {
    if (!eq || !rec) return;
    const antes = lineas.map(l => { const p = find(E, l.sku)!; return { p, before: status(p) }; });
    // en la nube el número y la huella los pone el servidor; en modo local se calculan aquí
    const args: OpEntrega = { id: modoNube ? nuevoId() : nextId, numero: modoNube ? undefined : nextId, ts: Date.now(), equipo: eq.id, receptor: rec.id, dni: rec.dni,
      lineas: JSON.parse(JSON.stringify(lineas)), firma: firmaPNG(firma) };
    if (!modoNube) args.hash = await hashEntrega({ ...args, operator: E.operator });
    if (!ejecutar({ op: 'entrega', args })) return;
    if (!modoNube) E.seq.ent++;
    E.cesta.lineas = []; guardar(); setFirma([]); setCertifica(false); setVerSN(null);
    toast(modoNube ? `Entrega firmada por ${rec.nombre}. Stock descontado; el número y la huella llegan al sincronizar.` : `Entrega ${nextId} firmada por ${rec.nombre}. Stock descontado.`, 'ok', 6000);
    antes.forEach(a => avisoEstado({ ...a, after: status(a.p) }));
    abrirRecibo(args.id);
  };

  return (
    <div className="px-4 lg:px-gutter py-4 lg:py-space-lg flex flex-col gap-4 lg:gap-space-lg max-w-[1600px]">
      <div className="hidden lg:flex items-end justify-between"><div><span className={LBL}>Custodia de material · almacén → furgoneta</span><h1 className="text-headline-lg font-bold">Entrega y firma de material</h1></div>
        <button onClick={() => ir('equipos')} className={`${BTN_S} px-4 h-11`}><Icon n="verified_user" className="ico-20" />Auditoría de entregas</button></div>
      <div className="lg:hidden flex items-center justify-between gap-2 bg-surface-container-low rounded-xl px-3 py-2.5 font-mono text-label-sm"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-tertiary-container pulso" />SYNC LOCAL</span><span className="text-primary">{eq?.id} · Doc #{nextId}</span></div>
      <div className="flex flex-wrap gap-2"><button onClick={() => abrirPreparar(E.cesta.equipo)} className={`${BTN_P} h-12 px-4`}><Icon n="playlist_add_check" className="ico-20" />Preparar desde plantilla</button>
        {perm.admin && <button onClick={abrirPlantillas} className={`${BTN_S} h-12 px-4`}><Icon n="list_alt" className="ico-20" />Plantillas</button>}
        <button onClick={abrirInformeEntregas} className={`${BTN_S} h-12 px-4`}><Icon n="summarize" className="ico-20" />Entregas por técnico</button></div>
      <Preparadas />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-space-lg items-start">
        <div className="lg:col-span-7 flex flex-col gap-4 lg:gap-space-lg">
          <section className={`${CARD} p-4 lg:p-space-md flex flex-col gap-3`}>
            <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-3"><span className="w-10 h-10 rounded-lg bg-surface-container-low text-primary grid place-items-center"><Icon n="local_shipping" /></span><h2 className="text-headline-md font-semibold">Unidad receptora</h2></div>
              <button onClick={() => ir('equipos')} className="font-mono text-label-sm text-primary">Gestionar equipos →</button></div>
            {eq ? <div className="flex items-center gap-3 bg-surface-container-low rounded-xl p-3">
              <span className="w-12 h-12 rounded-full bg-white grid place-items-center font-mono font-semibold text-primary shrink-0">{eq.id}</span>
              <div className="flex-1 min-w-0"><div className="font-semibold truncate">{eq.flota} · {eq.nombre}</div><div className="text-body-sm text-secondary truncate">{recs.map(t => t.nombre).join(' · ')} · {eq.matricula}</div></div>
              <span className={`font-mono text-label-sm px-2 py-1 rounded-full whitespace-nowrap ${ESTADO_EQ[eq.estado].c}`}>{ESTADO_EQ[eq.estado].t}</span></div>
              : <p className="text-secondary">Crea primero un equipo.</p>}
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">{E.equipos.map(e =>
              <button key={e.id} onClick={() => { E.cesta.equipo = e.id; guardar(); }} className={`shrink-0 px-4 h-11 rounded-full text-body-sm font-semibold ${e.id === E.cesta.equipo ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface-variant'}`}>{e.id === E.cesta.equipo ? '✓ ' : ''}{e.id} {e.nombre.replace('Equipo ', '')}{e.tecnicos.length === 1 ? ' (1)' : ''}</button>)}</div>
          </section>

          <section className={`${CARD} p-4 lg:p-space-md flex flex-col gap-3`}>
            <div className="flex items-center justify-between"><h2 className="text-headline-md font-semibold flex items-center gap-2"><Icon n="add_box" className="text-primary" />Añadir al despacho</h2><span className="text-body-sm text-secondary">Toca para sumar</span></div>
            <div className="relative"><Icon n="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline ico-20" /><input value={q} onChange={e => setQ(e.target.value)} type="search" className={`${INP} pl-10 h-12`} placeholder="Buscar en todo el catálogo" /></div>
            {!q && <div className="flex bg-surface-container-low rounded-lg p-1 overflow-x-auto no-scrollbar">{Object.entries(CATS).map(([k, c]) =>
              <button key={k} onClick={() => setCat(k)} className={`shrink-0 px-3 h-10 rounded-md text-body-sm font-semibold ${cat === k ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant'}`}>{c.label}</button>)}</div>}
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">{prods.length ? prods.map(p => { const d = disponible(p.sku); return (
              <button key={p.sku} onClick={() => anadirACesta(p.sku)} disabled={d <= 0} className="text-left bg-surface-container-low hover:bg-surface-container rounded-xl p-3 flex flex-col gap-1 disabled:opacity-40 relative">
                <span className="absolute top-2.5 right-2.5 text-primary"><Icon n="add_circle" /></span>
                <span className="self-start flex flex-wrap gap-1"><Tag c="bg-white text-secondary">{p.packLabel || CATS[p.cat].label}</Tag><TagCustodia p={p} /></span>
                <span className="font-semibold leading-snug line-clamp-2 pr-5">{p.name}</span>
                <span className="font-mono text-label-sm text-secondary truncate">{p.serialized ? `SN: ${(p.serials || [])[0] || '—'}` : p.loc}</span>
                <span className="flex justify-between items-end mt-1"><span className="font-mono text-label-sm">Disp: <b>{num(d)}</b> {UNIT[p.unit]}</span><span className="font-mono text-label-sm text-primary">+{p.unit === 'm' ? 10 : 1}</span></span>
              </button>); }) : <p className="text-secondary col-span-2">Sin resultados.</p>}</div>
          </section>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-4 lg:gap-space-lg lg:sticky lg:top-20">
          <section className={`${CARD} p-4 lg:p-space-md flex flex-col gap-3`}>
            <div className="flex items-center justify-between"><h2 className="text-headline-md font-semibold flex items-center gap-2"><span className="w-7 h-7 rounded-md bg-primary-container text-white grid place-items-center font-mono text-label-md">{lineas.length}</span>Material en cesta de entrega</h2>
              {lineas.length > 0 && <button onClick={() => { E.cesta.lineas = []; guardar(); }} className="text-error text-body-sm flex items-center gap-1"><Icon n="delete" className="ico-18" />Limpiar</button>}</div>
            {lineas.length ? lineas.map(l => { const p = find(E, l.sku)!; return (
              <div key={l.sku} className="bg-surface-container-low rounded-xl p-3 flex flex-col gap-2">
                <div className="flex items-center gap-3"><div className="flex-1 min-w-0"><div className="font-semibold leading-snug">{p.name} <TagCustodia p={p} /></div>
                  <div className="font-mono text-label-sm text-secondary">{p.serialized ? <>S/N: {l.serials.map(s => <span key={s} className="bg-primary-fixed text-primary px-1 rounded mr-1">{s}</span>)}</> : `${p.loc} · ${p.packLabel || ''}`}</div></div>
                  <div className="flex items-center bg-white rounded-lg shrink-0">
                    <button onClick={() => quitarDeCesta(p.sku)} className="w-11 h-11 grid place-items-center" aria-label="Menos"><Icon n="remove" /></button>
                    {p.serialized ? <span className="w-10 text-center font-bold">{l.qty}</span>
                      : <CantidadCesta sku={p.sku} qty={l.qty} />}
                    <button onClick={() => anadirACesta(p.sku)} className="w-11 h-11 grid place-items-center bg-primary text-white rounded-r-lg" aria-label="Más"><Icon n="add" /></button></div></div>
                {p.serialized && <><button onClick={() => setVerSN(verSN === p.sku ? null : p.sku)} className="self-start font-mono text-label-sm text-primary">{verSN === p.sku ? 'Ocultar' : 'Elegir n.º de serie'}</button>
                  {verSN === p.sku && <div className="flex flex-wrap gap-1.5">{(p.serials || []).map(s => <button key={s} onClick={() => alternarSerie(p.sku, s)} className={`px-2.5 h-9 rounded-lg font-mono text-label-sm ${l.serials.includes(s) ? 'bg-primary text-white' : 'bg-white'}`}>{s}</button>)}</div>}</>}
              </div>); }) : <div className="text-center text-secondary py-6 bg-surface-container-low rounded-xl">La cesta está vacía. Añade material desde el catálogo o desde el inventario.</div>}
          </section>

          <section className={`${CARD} p-4 lg:p-space-md flex flex-col gap-3`}>
            <div className="flex items-center justify-between gap-2"><h2 className="text-headline-md font-semibold flex items-center gap-2"><span className="w-9 h-9 rounded-lg bg-tertiary-fixed/40 text-tertiary grid place-items-center"><Icon n="signature" /></span>Firma digital del receptor</h2>
              <button onClick={() => setFirma([])} className="text-body-sm text-secondary flex items-center gap-1"><Icon n="refresh" className="ico-18" />Borrar</button></div>
            <label className="flex items-center gap-3 bg-surface-container-low rounded-xl p-3"><Icon n="badge" className="text-secondary" />
              <span className="flex-1 min-w-0"><span className={`${LBL} block`}>Firmante designado</span>
                <select value={E.cesta.receptor ?? ''} onChange={e => { E.cesta.receptor = e.target.value; guardar(); }} className="bg-transparent font-semibold focus:outline-none w-full">{recs.map(t => <option key={t.id} value={t.id}>{t.nombre} (DNI {t.dni})</option>)}</select></span>
              {rec && <Tag c="bg-white text-secondary">{rec.rol.split(' ')[0]}</Tag>}</label>
            <div className="relative"><Firma trazos={firma} onChange={setFirma} />
              <span className={`absolute top-2 right-2 font-mono text-label-sm px-2 py-0.5 rounded-full pointer-events-none ${firmado ? 'bg-tertiary-fixed text-on-tertiary-fixed' : 'bg-white text-secondary'}`}>● {firmado ? 'Trazo capturado' : 'Esperando trazo'}</span>
              {!firmado && <span className="absolute bottom-3 left-4 font-mono text-label-sm text-outline pointer-events-none">✕ Firma táctil requerida</span>}</div>
            <label className="flex items-start gap-3 bg-surface-container-low rounded-xl p-3 cursor-pointer"><input type="checkbox" checked={certifica} onChange={e => setCertifica(e.target.checked)} className="w-6 h-6 mt-0.5 accent-primary shrink-0" />
              <span className="text-body-sm">Certifico que el material relacionado se entrega revisado, completo, con precintos intactos y sin desperfectos visibles.</span></label>
            <div className="flex justify-between font-mono text-label-sm text-secondary"><span className="flex items-center gap-1"><Icon n="lock" className="ico-16" />Huella SHA-256 + fecha y hora</span><span>Doc #{nextId}</span></div>
          </section>

          <button onClick={confirmar} disabled={!puede} className={`${BTN_P} w-full h-16 text-headline-sm`}><Icon n="check_circle" className="ico-fill" />Confirmar entrega y descontar stock</button>
          {!puede && <p className="text-body-sm text-secondary text-center">{!lineas.length ? 'Añade material a la cesta.' : !rec ? 'Elige quién recibe.' : !firmado ? 'Falta la firma del receptor.' : 'Marca la casilla de conformidad.'}</p>}
        </div>
      </div>
    </div>
  );
}

function CantidadCesta({ sku, qty }: { sku: string; qty: number }) {
  const [v, setV] = useState(String(qty));
  useEffect(() => setV(String(qty)), [qty]);
  return <input value={v} onChange={e => setV(e.target.value)} onBlur={() => fijarCantidad(sku, Number(v.replace(',', '.')))} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    inputMode="decimal" className="w-14 text-center font-bold bg-transparent focus:outline-none" aria-label="Cantidad" />;
}

export const abrirRecibo = (id: string) => openModal(<Recibo id={id} />);
function Recibo({ id }: { id: string }) {
  const E = useAlmacen(), e = E.entregas.find(x => x.id === id);
  if (!e) return <SheetHead title="Entrega no encontrada" />;
  const eq = E.equipos.find(x => x.id === e.equipo), rec = E.tecnicos.find(t => t.id === e.receptor);
  return (<>
    <SheetHead title={`Albarán de entrega ${numEntrega(e)}`} sub={fechaHora(e.ts)} />
    <div id="impresion" className="p-5 flex flex-col gap-3 bg-white">
      <div className="flex justify-between"><div><div className="font-bold">{MARCA.nombre}</div><div className="text-body-sm text-secondary">{MARCA.nave}</div></div><div className="text-right font-mono text-label-md">{numEntrega(e)}<br />{fechaHora(e.ts)}</div></div>
      <div className="grid grid-cols-2 gap-2 text-body-sm">
        <div className="bg-surface-container-low rounded-lg p-2.5"><div className={LBL}>Equipo / vehículo</div>{eq ? `${eq.nombre} · ${eq.flota} (${eq.matricula})` : e.equipo}</div>
        <div className="bg-surface-container-low rounded-lg p-2.5"><div className={LBL}>Recibe</div>{rec?.nombre} · DNI {e.dni || rec?.dni}</div></div>
      <table className="w-full text-body-sm"><thead><tr className={`text-left ${LBL}`}><th className="py-1">Material</th><th>S/N</th><th className="text-right">Cant.</th></tr></thead>
        <tbody>{e.lineas.map(l => { const p = find(E, l.sku); return <tr key={l.sku} className="border-t border-surface-container"><td className="py-1.5">{p ? p.name : l.sku}<div className="font-mono text-label-sm text-secondary">{l.sku}</div></td><td className="font-mono text-label-sm">{(l.serials || []).map(s => <div key={s}>{s}</div>)}</td><td className="text-right font-semibold">{p ? qtyTxt(p, l.qty) : num(l.qty)}</td></tr>; })}</tbody></table>
      <div className="flex items-end justify-between gap-3 border-t border-surface-container pt-3"><div><FirmaImg f={e.firma} className="h-16 w-44" /><div className="text-body-sm text-secondary">Firma del receptor</div></div>
        <div className="font-mono text-[9px] text-secondary break-all max-w-[55%] text-right">Huella SHA-256<br />{e.hash || 'Se calcula en el servidor al sincronizar'}</div></div>
      {(e.obra || e.plantilla) && <p className="text-body-sm">{e.obra ? <>Obra: <b>{e.obra}</b></> : null}{e.plantilla ? <> · Plantilla: {E.plantillas.find(p => p.id === e.plantilla)?.nombre || '—'}</> : null}</p>}
      <p className="text-body-sm text-secondary">Aceptación de la entrega por el receptor. Registrado por {e.operator}.</p>
    </div>
    <SheetFoot className="flex flex-wrap gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Cerrar</button><button onClick={() => void enviarJustificante(e)} className={`${BTN_S} h-12 px-4`}><Icon n="cloud_upload" className="ico-20" />{modoNube ? 'Justificante PDF (guardar y enviar)' : 'Descargar PDF'}</button><button onClick={() => print()} className={`${BTN_P} h-12 flex-1`}><Icon n="print" className="ico-20" />Imprimir o guardar PDF</button></SheetFoot>
  </>);
}
