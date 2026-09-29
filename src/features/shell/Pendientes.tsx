/* Bandeja "Pendientes de validar" del administrador (E-004): mermas grandes o de custodia y diferencias de recuento */
import { useState } from 'react';
import { UNIT } from '../../data/catalogo';
import { find } from '../../domain/reglas';
import { eur, fechaHora, hace, num } from '../../domain/formato';
import { ejecutar, useAlmacen } from '../../store/almacen';
import { usePermisos } from '../../store/permisos';
import { openModal, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, Icon, INP, Tag, Vacio } from '../../ui/base';

export function BotonPendientes() {
  const E = useAlmacen(), { validar } = usePermisos();
  const n = E.pendientes.filter(p => p.estado === 'pendiente').length;
  if (!validar || !n) return null;
  return <button onClick={abrirPendientes} className="relative p-2 rounded-lg text-amber-800 hover:bg-amber-100" aria-label={`${n} pendientes de validar`} title="Pendientes de validar">
    <Icon n="pending_actions" /><span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-amber-500 text-black font-mono text-[10px] leading-4">{n}</span></button>;
}

export const abrirPendientes = () => openModal(<Bandeja />, { ancha: true });
function Bandeja() {
  const E = useAlmacen(), { validar } = usePermisos();
  const abiertos = E.pendientes.filter(p => p.estado === 'pendiente'), resueltos = E.pendientes.filter(p => p.estado !== 'pendiente').slice(0, 10);
  return (<>
    <SheetHead title="Pendientes de validar" sub="Mermas de más de 50 € o de material en custodia, y diferencias de recuento registradas por el almacén." />
    <div className="p-5 flex flex-col gap-3">
      {abiertos.length ? abiertos.map(p => <Fila key={p.id} id={p.id} puede={validar} />) : <Vacio>No hay nada pendiente.</Vacio>}
      {resueltos.length > 0 && <div className="mt-2"><div className="font-mono text-label-sm uppercase tracking-wider text-secondary mb-1">Resueltos recientemente</div>
        {resueltos.map(p => { const pr = find(E, p.sku); return <div key={p.id} className="flex justify-between gap-2 py-2 border-b border-surface-container text-body-sm">
          <span className="truncate">{p.tipo === 'merma' ? 'Merma' : 'Recuento'} · {pr?.name || p.sku} · {num(p.qty)} {pr ? UNIT[pr.unit] : ''}</span>
          <Tag c={p.estado === 'aprobado' ? 'bg-tertiary-fixed/30 text-tertiary' : 'bg-error-container text-error'}>{p.estado === 'aprobado' ? 'Aprobado' : 'Rechazado'}{p.resueltoPor ? ` · ${p.resueltoPor}` : ''}</Tag></div>; })}</div>}
    </div>
  </>);
}

function Fila({ id, puede }: { id: string; puede: boolean }) {
  const E = useAlmacen(), p = E.pendientes.find(x => x.id === id)!, pr = find(E, p.sku);
  const [nota, setNota] = useState('');
  const resolver = (aprobar: boolean) => { if (ejecutar({ op: 'validarPendiente', args: { id, aprobar, nota } })) toast(aprobar ? 'Aprobado: stock actualizado.' : 'Rechazado: el stock no cambia.', 'ok'); };
  return (
    <div className="rounded-xl bg-surface-container-low p-4 flex flex-col gap-2">
      <div className="flex flex-wrap justify-between gap-2">
        <div className="min-w-0"><div className="font-semibold">{p.tipo === 'merma' ? 'Merma' : 'Diferencia de recuento'} · {pr?.name || p.sku}</div>
          <div className="text-body-sm text-secondary">{p.reason}{p.ref ? ` · ${p.ref}` : ''} · {p.operator} · <span title={fechaHora(p.ts)}>{hace(p.ts)}</span>{p.serials.length ? ` · S/N ${p.serials.join(', ')}` : ''}</div></div>
        <div className="text-right"><div className={`text-headline-sm font-bold ${p.qty < 0 || p.tipo === 'merma' ? 'text-error' : 'text-tertiary'}`}>{p.tipo === 'merma' ? '−' : p.qty > 0 ? '+' : '−'}{num(Math.abs(p.qty))} {pr ? UNIT[pr.unit] : ''}</div>
          <div className="font-mono text-label-sm text-secondary">{pr?.propiedad === 'custodia' ? 'Custodia Esmove · sin precio' : p.valor != null ? `≈ ${eur(Math.abs(p.valor))}` : ''}</div></div>
      </div>
      {p.provisional && <p className="text-body-sm text-amber-800">Aún no ha llegado al servidor.</p>}
      {puede && !p.provisional && <div className="flex flex-col sm:flex-row gap-2">
        <input value={nota} onChange={e => setNota(e.target.value)} placeholder="Nota (opcional)" className={`${INP} h-11 flex-1`} aria-label="Nota de la validación" />
        <button onClick={() => resolver(false)} className={`${BTN_S} h-11 px-4`}><Icon n="close" className="ico-20" />Rechazar</button>
        <button onClick={() => resolver(true)} className={`${BTN_P} h-11 px-4`}><Icon n="check" className="ico-20" />Aprobar</button></div>}
    </div>
  );
}
