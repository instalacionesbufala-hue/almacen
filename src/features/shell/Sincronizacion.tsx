/* Estado de la sincronización con la nube y cola de operaciones pendientes o rechazadas */
import { hace } from '../../domain/formato';
import { modoNube } from '../../store/nube/cliente';
import { cola, descartar, procesarCola, reintentar, sesion } from '../../store/nube/sync';
import { openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { BTN_P, BTN_S, Icon, Vacio } from '../../ui/base';

export function IndicadorSync({ compacto = false }: { compacto?: boolean }) {
  const s = sesion.use(), c = cola.use();
  if (!modoNube) return null;
  const pend = c.filter(i => i.estado === 'pendiente').length, rech = c.filter(i => i.estado === 'rechazada').length;
  const [icono, texto, color] = rech ? ['sync_problem', `${rech} rechazada${rech === 1 ? '' : 's'}`, 'bg-error-container text-error']
    : s.conexion === 'sin-conexion' ? ['cloud_off', pend ? `Sin conexión · ${pend} en cola` : 'Sin conexión', 'bg-amber-100 text-amber-800']
      : pend ? ['cloud_sync', `Enviando ${pend}…`, 'bg-primary-fixed text-primary'] : ['cloud_done', 'Sincronizado', 'bg-tertiary-fixed/40 text-tertiary'];
  return <button onClick={abrirCola} title="Sincronización con la nube" className={`inline-flex items-center gap-1.5 rounded-full font-mono text-label-sm shrink-0 ${compacto ? 'px-2 py-1' : 'px-2.5 py-1.5'} ${color}`}>
    <Icon n={icono} className="ico-18" />{compacto ? (rech || pend || '') : texto}</button>;
}

export const abrirCola = () => openModal(<Cola />);
function Cola() {
  const s = sesion.use(), c = cola.use();
  return (<>
    <SheetHead title="Sincronización" sub={`${s.conexion === 'en-linea' ? 'Conectado' : 'Sin conexión'}${s.ultimaCarga ? ` · datos de ${hace(s.ultimaCarga)}` : ''}`} />
    <div className="p-5 flex flex-col gap-2">
      <p className="text-body-sm text-secondary">Lo que registras sin cobertura se guarda aquí y se envía solo al volver la conexión, sin duplicarse. Si el servidor rechaza algo (por ejemplo, porque ya no hay stock), aparece como rechazado con el motivo y el stock se corrige con el dato real.</p>
      {c.length ? c.map((it, i) => (
        <div key={i} className={`rounded-xl p-3 flex items-start gap-3 ${it.estado === 'rechazada' ? 'bg-error-container/50' : 'bg-surface-container-low'}`}>
          <Icon n={it.estado === 'rechazada' ? 'block' : 'schedule'} className={it.estado === 'rechazada' ? 'text-error' : 'text-primary'} />
          <div className="flex-1 min-w-0"><div className="font-medium">{it.desc}</div>
            <div className="text-body-sm text-secondary">{it.estado === 'rechazada' ? `Rechazada: ${it.motivo}` : 'Pendiente de enviar'} · {hace(it.ts)}</div></div>
          {it.estado === 'rechazada' && <div className="flex flex-col gap-1 shrink-0">
            <button onClick={() => reintentar(i)} className="text-primary text-body-sm font-semibold">Reintentar</button>
            <button onClick={() => descartar(i)} className="text-error text-body-sm">Descartar</button></div>}
        </div>)) : <Vacio>No hay nada pendiente: todo está en la nube.</Vacio>}
    </div>
    <SheetFoot className="flex gap-2"><button onClick={() => void procesarCola()} className={`${BTN_P} h-12 flex-1`}><Icon n="sync" className="ico-20" />Enviar ahora</button>
      {c.some(i => i.estado === 'rechazada') && <button onClick={() => { for (let i = cola.get().length - 1; i >= 0; i--) if (cola.get()[i].estado === 'rechazada') descartar(i); }} className={`${BTN_S} h-12 px-4`}>Descartar rechazadas</button>}</SheetFoot>
  </>);
}
