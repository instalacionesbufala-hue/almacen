/* E-022 · Borrar (solo sin rastro) o archivar una referencia, la lista de archivados y las operaciones rechazadas por el servidor */
import { useState } from 'react';
import { motivoNoArchivar, rastro } from '../../domain/archivo';
import { fechaHora, hace } from '../../domain/formato';
import { find } from '../../domain/reglas';
import { ejecutar, useAlmacen } from '../../store/almacen';
import { cola, descartar, reintentar } from '../../store/nube/sync';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, Campo, Icon, INP, Tile, Vacio } from '../../ui/base';

/** "Borrar o archivar…": sin ningún rastro se borra definitivamente; si no, se archiva (con stock 0) y el historial se conserva */
export const abrirRetirar = (sku: string) => openModal(<Retirar sku={sku} />);
function Retirar({ sku }: { sku: string }) {
  const E = useAlmacen(), p = E.products.find(x => x.sku === sku);
  const [motivo, setMotivo] = useState('');
  if (!p) return <SheetHead title="Referencia no encontrada" />;
  const r = rastro(E, sku), noArchivar = motivoNoArchivar(E, p);
  const borrar = () => { if (confirm(`¿Borrar ${sku} definitivamente? No tiene historial ni nada que la retenga.`) && ejecutar({ op: 'borrarProducto', args: { sku } })) { closeModal(); toast(`${sku} borrada.`, 'ok'); } };
  const archivar = () => { if (ejecutar({ op: 'archivarProducto', args: { sku, motivo: motivo.trim() } })) { closeModal(); toast(`${sku} archivada: ya no sale en listas, buscador, escáner ni entregas. Está en Configuración → Archivados.`, 'ok', 7000); } };
  return (<>
    <SheetHead title={r.borrable ? 'Borrar la referencia' : 'Archivar la referencia'} sub={`${p.sku} · ${p.name}`} />
    <div className="p-5 flex flex-col gap-3">
      {r.borrable ? <p className="text-body-md">No tiene movimientos, entregas, pendientes ni nada que la retenga: se puede <b>borrar definitivamente</b>.</p>
        : <><p className="text-body-md bg-surface-container-low rounded-lg p-3"><b>{r.texto}.</b> No se puede borrar definitivamente.</p>
          <p className="text-body-sm text-secondary"><b>Archivar</b>: deja de salir en listas, buscador, escáner y entregas; el historial la conserva y la puedes restaurar desde Configuración → Archivados. Su código queda libre para otro artículo (al usarlo, se reactiva).</p>
          {noArchivar ? <p className="text-body-md bg-error-container text-error rounded-lg p-3">{noArchivar}.</p>
            : <Campo label="Motivo (opcional)"><input value={motivo} onChange={e => setMotivo(e.target.value)} className={`${INP} h-12`} placeholder="Ya no se usa" /></Campo>}</>}
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Cancelar</button>
      {r.borrable ? <button onClick={borrar} className={`${BTN_P} h-12 flex-1 !bg-error`}><Icon n="delete" className="ico-20" />Borrar definitivamente</button>
        : <button onClick={archivar} disabled={!!noArchivar} className={`${BTN_P} h-12 flex-1 disabled:opacity-40`}><Icon n="inventory_2" className="ico-20" />Archivar</button>}</SheetFoot>
  </>);
}

/** Configuración → Archivados (administrador): de qué se fusionó y en cuál, cuándo y quién; restaurar, deshacer fusión o borrar */
export function Archivados() {
  const E = useAlmacen(), lista = [...(E.archivados || [])].sort((a, b) => (b.archivadoTs ?? 0) - (a.archivadoTs ?? 0));
  if (!lista.length) return <Vacio>No hay referencias archivadas.</Vacio>;
  const hacer = (op: 'restaurarProducto' | 'deshacerFusion' | 'borrarProducto', sku: string, ok: string, pregunta: string) => { if (confirm(pregunta) && ejecutar({ op, args: { sku } })) toast(ok, 'ok', 6000); };
  return (
    <ul className="flex flex-col">{lista.map(a => { const destino = a.fusionadoEn ? find(E, a.fusionadoEn) : undefined, r = rastro(E, a.sku); return (
      <li key={a.sku} className="flex flex-wrap items-center gap-3 py-3 border-b border-surface-container">
        <Tile p={a} size="w-10 h-10" />
        <div className="flex-1 min-w-[200px]"><div className="font-medium">{a.name}</div>
          <div className="text-body-sm text-secondary"><span className="font-mono">{a.sku}</span>{a.fusionadoEn ? <> · fusionado en <b className="font-mono">{a.fusionadoEn}</b>{destino ? ` (${destino.name})` : ''}</> : ' · archivado'}
            {a.archivadoTs ? <> · <span title={fechaHora(a.archivadoTs)}>{hace(a.archivadoTs)}</span></> : null}{a.archivadoPor ? ` · ${a.archivadoPor}` : ''}</div></div>
        <div className="flex flex-wrap gap-2">
          {a.fusionadoEn && <button onClick={() => hacer('deshacerFusion', a.sku, `Fusión deshecha: ${a.sku} vuelve con lo que pasó a ${a.fusionadoEn}.`, `¿Deshacer la fusión de ${a.sku} en ${a.fusionadoEn}? Lo que pasó a ${a.fusionadoEn} vuelve a ${a.sku}.`)} className={`${BTN_S} h-11 px-3`}>Deshacer fusión</button>}
          <button onClick={() => hacer('restaurarProducto', a.sku, `${a.sku} restaurada.`, `¿Restaurar ${a.sku}? Vuelve a estar activa con su código${a.fusionadoEn ? ' y con stock 0 (lo que tenía sigue en ' + a.fusionadoEn + ')' : ''}.`)} className={`${BTN_S} h-11 px-3`}>Restaurar</button>
          {r.borrable && <button onClick={() => hacer('borrarProducto', a.sku, `${a.sku} borrada.`, `¿Borrar ${a.sku} definitivamente? No tiene historial.`)} className="h-11 px-3 text-error font-semibold">Borrar</button>}
        </div>
      </li>); })}</ul>
  );
}

/** Bandeja → Operaciones rechazadas por el servidor (de este dispositivo): el cambio ya se deshizo en pantalla; reintentar o descartar */
export function Rechazadas() {
  const c = cola.use(), lista = c.map((it, i) => ({ it, i })).filter(x => x.it.estado === 'rechazada');
  if (!lista.length) return null;
  return (
    <div className="flex flex-col gap-2"><div className="font-mono text-label-sm uppercase tracking-wider text-secondary">Operaciones rechazadas ({lista.length})</div>
      {lista.map(({ it, i }) => <div key={it.ts + ':' + i} className="rounded-xl bg-error-container/30 p-3 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]"><div className="font-semibold">{it.desc}</div>
          <div className="text-body-sm text-secondary">{it.motivo} · el cambio se deshizo en pantalla · <span title={fechaHora(it.ts)}>{hace(it.ts)}</span></div></div>
        <div className="flex gap-2"><button onClick={() => descartar(i)} className="h-12 px-4 rounded-lg bg-white font-semibold text-secondary">Descartar</button>
          <button onClick={() => reintentar(i)} className="h-12 px-4 rounded-lg bg-white font-semibold text-primary">Reintentar</button></div></div>)}
    </div>
  );
}
