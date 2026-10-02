/* E-016 · Detalle de un albarán ya ingresado: sus líneas (entradas) y, para el administrador, "Reasignar línea" del artículo A al B
   con ajustes enlazados (−A y +B), sin borrar nada del historial. */
import { useEffect, useState } from 'react';
import { pendienteDeReasignar } from '../../domain/fichas';
import { fechaHora, num, toNum } from '../../domain/formato';
import { find, qtyTxt } from '../../domain/reglas';
import { ejecutar, useAlmacen } from '../../store/almacen';
import { nuevoId } from '../../store/ops';
import { usePermisos } from '../../store/permisos';
import { openModal, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, Icon, INP, LBL, Tile, Vacio } from '../../ui/base';
import { SelectorArticulo } from '../../ui/selectorArticulo';
import { rutaPagina, urlPagina } from './colaLectura';

export const abrirDetalleAlbaran = (id: string) => openModal(<DetalleAlbaran id={id} />, { ancha: true });

function DetalleAlbaran({ id }: { id: string }) {
  const E = useAlmacen(), { editarCatalogo: catalogo, mod } = usePermisos(), editarCatalogo = catalogo && mod('albaranes');
  const al = E.albaranes.find(a => a.id === id);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [f, setF] = useState({ destino: '', cantidad: '' });
  if (!al) return <SheetHead title="Albarán no encontrado" />;
  const entradas = E.movements.filter(m => m.albaran === id && m.type === 'entrada');
  const ajustes = E.movements.filter(m => m.albaran === id && m.reason === 'Reasignación de línea de albarán');
  const reasignar = (mov: string) => {
    const q = f.cantidad.trim() ? toNum(f.cantidad) : undefined;
    if (!f.destino) return toast('Elige el artículo correcto.', 'err');
    if (ejecutar({ op: 'reasignarLinea', args: { id: nuevoId(), movimiento: mov, destino: f.destino, cantidad: q } })) {
      toast('Línea reasignada: la cantidad pasa al artículo correcto con dos ajustes enlazados.', 'ok', 6000);
      setAbierta(null); setF({ destino: '', cantidad: '' });
    }
  };
  return (<>
    <SheetHead title={`Albarán ${al.numero}`} sub={`${al.proveedor}${al.delegacion ? ` · ${al.delegacion}` : ''} · ${fechaHora(al.ts)} · ${al.operator}`} />
    <div className="p-5 flex flex-col gap-3">
      {!!al.paginas?.length && <PaginasAlbaran id={al.id!} paginas={al.paginas} />}
      {!entradas.length && <Vacio>Las líneas de este albarán no están en este dispositivo (se registraron antes de guardar el enlace con el albarán).</Vacio>}
      {entradas.map(m => { const p = find(E, m.sku), queda = pendienteDeReasignar(E, m.id); return (
        <div key={m.id} className="rounded-xl ring-1 ring-surface-container-high p-3 flex flex-col gap-2">
          <div className="flex items-center gap-3">{p && <Tile p={p} size="w-11 h-11" />}
            <div className="flex-1 min-w-0"><div className="font-medium">{p?.name || m.sku}</div><div className="font-mono text-label-sm text-secondary">{m.sku}{p?.fusionadoEn ? ` · archivado, ahora ${p.fusionadoEn}` : ''}</div></div>
            <b className="whitespace-nowrap">+{p ? qtyTxt(p, m.qty) : num(m.qty)}</b></div>
          {queda < m.qty && <p className="text-body-sm text-secondary">Reasignado: {num(m.qty - queda)} de {num(m.qty)}.</p>}
          {editarCatalogo && queda > 0 && (abierta === m.id
            ? <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_auto] gap-2 items-end">
                <div className="flex flex-col gap-1 min-w-0"><span className={LBL}>Era en realidad…</span><SelectorArticulo valor={f.destino || null} onChange={sku => setF({ ...f, destino: sku || '' })} filtro={x => x.sku !== m.sku} ariaLabel="Era en realidad" /></div>
                <label className="flex flex-col gap-1"><span className={LBL}>Cantidad</span><input value={f.cantidad} onChange={e => setF({ ...f, cantidad: e.target.value })} placeholder={num(queda)} inputMode="decimal" className={`${INP} h-12`} /></label>
                <div className="flex gap-2"><button onClick={() => setAbierta(null)} className={`${BTN_S} h-12 px-3`}>Cancelar</button><button onClick={() => reasignar(m.id)} className={`${BTN_P} h-12 px-4`}>Reasignar</button></div>
              </div>
            : <button onClick={() => { setAbierta(m.id); setF({ destino: '', cantidad: '' }); }} className={`${BTN_S} h-11 px-3 self-start`}><Icon n="swap_horiz" className="ico-18" />Reasignar línea</button>)}
        </div>); })}
      {ajustes.length > 0 && <div><div className={`${LBL} mb-1`}>Reasignaciones (ajustes enlazados)</div>
        {ajustes.map(m => <div key={m.id} className="flex justify-between gap-2 py-1.5 border-b border-surface-container text-body-sm"><span className="truncate">{find(E, m.sku)?.name || m.sku} · {m.ref}</span><b className={m.qty < 0 ? 'text-error' : 'text-tertiary'}>{m.qty > 0 ? '+' : ''}{num(m.qty)}</b></div>)}</div>}
    </div>
  </>);
}

/** E-024 · Las páginas escaneadas del albarán (bucket privado; con URL firmadas, o la copia de este dispositivo) */
function PaginasAlbaran({ id, paginas }: { id: string; paginas: string[] }) {
  const [urls, setUrls] = useState<(string | null)[]>([]);
  useEffect(() => {
    let vivo = true; const hechas: string[] = [];
    void Promise.all(paginas.map(p => urlPagina(rutaPagina(id, p)))).then(u => { if (vivo) setUrls(u); u.forEach(x => x?.startsWith('blob:') && hechas.push(x)); });
    return () => { vivo = false; hechas.forEach(u => URL.revokeObjectURL(u)); };
  }, [id, paginas]);
  return (<div><div className={`${LBL} mb-1`}>Albarán escaneado · {paginas.length} página{paginas.length === 1 ? '' : 's'}</div>
    <div className="flex gap-2 overflow-x-auto pb-1">{paginas.map((p, i) => { const u = urls[i]; return u
      ? <a key={p} href={u} target="_blank" rel="noreferrer" className="shrink-0 w-28 rounded-lg overflow-hidden ring-1 ring-surface-container-high bg-white" aria-label={`Abrir la página ${i + 1}`}>
          {p.endsWith('.pdf') ? <div className="h-36 grid place-items-center text-secondary"><Icon n="picture_as_pdf" className="ico-32" /></div> : <img src={u} alt={`Página ${i + 1}`} className="w-full h-36 object-cover object-top" />}</a>
      : <div key={p} className="shrink-0 w-28 h-36 rounded-lg bg-surface-container-low grid place-items-center text-body-sm text-secondary text-center p-2">{urls.length ? 'Aún no subida' : '…'}</div>; })}</div></div>);
}
