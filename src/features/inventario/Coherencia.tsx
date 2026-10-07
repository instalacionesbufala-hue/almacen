/* E-036 · Aviso de la comprobación de formatos (solo el administrador): artículos cuya unidad, contenido y stock no cuadran,
   con el arreglo propuesto (un ajuste en la furgoneta) que se aplica solo si lo confirmas. */
import { incoherenciasFormato, type Incoherencia } from '../../domain/coherencia';
import { contenidoDe, find, nombreVehiculo, unidadesABordo } from '../../domain/reglas';
import { num, redondea } from '../../domain/formato';
import { ucDe } from '../../domain/formatos';
import { ejecutar, S, useAlmacen } from '../../store/almacen';
import { nuevoId } from '../../store/ops';
import { usePermisos } from '../../store/permisos';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, Icon } from '../../ui/base';
import { abrirFicha } from './hojas';

export function AvisoCoherencia() {
  const E = useAlmacen(), perm = usePermisos();
  if (E.rol !== 'admin' || !perm.mod('inventario')) return null;
  const lista = incoherenciasFormato(E); if (!lista.length) return null;
  const n = new Set(lista.map(i => i.sku)).size;
  return <div className="px-4 lg:px-gutter pt-4"><button onClick={() => openModal(<Revision />, { ancha: true })} className="w-full text-left flex items-center gap-3 bg-amber-50 text-amber-900 rounded-xl p-3 ring-1 ring-amber-200">
    <Icon n="rule" className="ico-24 shrink-0" /><span className="flex-1 min-w-0"><b>{n} artículo{n === 1 ? '' : 's'} con unidad, contenido o stock que no cuadran</b>
      <span className="block text-body-sm truncate">{lista[0].nombre}: {lista[0].texto}</span></span><span className="font-semibold text-body-sm shrink-0">Revisar</span></button></div>;
}

function Revision() {
  const E = useAlmacen(), lista = incoherenciasFormato(E);
  return (<>
    <SheetHead title="Comprobación de formatos" sub="Artículos cuya unidad, contenido y stock no cuadran. Nada se cambia sin que lo confirmes." />
    <div className="p-5 flex flex-col gap-3">
      {lista.length ? lista.map((i, k) => <Fila key={k} i={i} />) : <p className="text-secondary">Todo cuadra.</p>}
    </div>
    <SheetFoot><button onClick={closeModal} className={`${BTN_S} h-12 w-full`}>Cerrar</button></SheetFoot>
  </>);
}

function Fila({ i }: { i: Incoherencia }) {
  const E = S(), p = find(E, i.sku)!;
  const arreglar = () => {
    const a = i.arreglo!, ahora = unidadesABordo(E, a.vehiculo, p.sku), despues = redondea(ahora + a.unidades), u = ucDe(p);
    if (!confirm(`¿Ajustar ${p.name} en ${nombreVehiculo(E, a.vehiculo)}? Pasa de ${num(ahora)} ${u} a ${num(despues)} ${u} (${a.unidades > 0 ? '+' : ''}${num(a.unidades)} ${u}). Es un ajuste de conversión, sin cambio físico, y queda en los movimientos.`)) return;
    if (ejecutar({ op: 'ajuste', args: { id: nuevoId(), sku: p.sku, qty: redondea(a.unidades / contenidoDe(p)), motivo: a.motivo, vehiculo: a.vehiculo } }))
      toast(`Ajustado: ${nombreVehiculo(E, a.vehiculo)} lleva ${num(despues)} ${u} de ${p.name}.`, 'ok', 6000);
  };
  return <div className="rounded-lg bg-surface-container-low p-3 flex flex-col gap-2">
    <button onClick={() => { closeModal(); abrirFicha(p.sku); }} className="text-left"><span className="font-semibold">{p.name}</span> <span className="font-mono text-label-sm text-secondary">{p.sku}</span></button>
    <p className="text-body-sm">{i.texto}</p>
    {i.arreglo && <button onClick={arreglar} className={`${BTN_P} h-11 px-4 self-start`}><Icon n="build" className="ico-20" />Corregir: {i.arreglo.unidades > 0 ? '+' : ''}{num(i.arreglo.unidades)} {ucDe(p)} en {nombreVehiculo(E, i.arreglo.vehiculo).split(' · ')[0]}</button>}
  </div>;
}
