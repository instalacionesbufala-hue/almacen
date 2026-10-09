/* E-045 · Instalación SOLAR con un cargador que no es V2C (o desconocido): el medidor bidireccional no siempre se instala.
   "Sí, monofásico / trifásico" añade la línea como "Corregir cierre" (E-035, con su versión); "No" lo marca como revisado. */
import type { CierreApp } from '../../data/tipos';
import { descInstalacion, medidorDe } from '../../domain/cierres';
import { find } from '../../domain/reglas';
import { ejecutar, useAlmacen } from '../../store/almacen';
import { toast } from '../../ui/toast';
import { BTN_S, Icon } from '../../ui/base';

export function AvisoMedidor({ c, puede, compacto = false }: { c: CierreApp; puede: boolean; compacto?: boolean }) {
  const E = useAlmacen(), cargador = c.hardware || 'un cargador sin identificar';
  const fase = String(c.datos?.fase || c.datosWizard?.fase || '').toLowerCase();
  const si = (f: 'mono' | 'trif') => {
    const sku = medidorDe(E, f);
    if (!find(E, sku)) return toast(`El medidor ${sku} no está en el catálogo: revisa las reglas de equivalencias.`, 'err');
    if (ejecutar({ op: 'corregirCierre', args: { id: c.id, correccion: { fijar: { descInstalacion: [{ sku, cantidad: 1 }] } } } }))
      toast(`Medidor bidireccional ${f === 'mono' ? 'monofásico' : 'trifásico'} añadido al cierre ${c.numInst}.`, 'ok');
  };
  const no = () => { if (ejecutar({ op: 'revisarMedidorSolar', args: { id: c.id, nota: '' } })) toast('Marcado como revisado: no se instaló medidor.', 'ok'); };
  return (<div className={`text-body-sm rounded-lg p-3 flex flex-col gap-2 bg-amber-50 ${compacto ? '' : 'ring-1 ring-amber-200'}`}>
    <span><Icon n="solar_power" className="ico-18 align-middle text-amber-800" /> <b>Instalación SOLAR con {cargador}:</b> ¿se instaló medidor bidireccional?
      {!compacto && <span className="block text-secondary">{descInstalacion(c)}. Con cargadores V2C se descuenta solo; con otros, decide aquí.</span>}</span>
    {puede && <div className="flex flex-wrap gap-2">
      <button onClick={() => si('mono')} className={`${BTN_S} h-11 px-3 ${fase === 'mono' ? 'ring-2 ring-primary' : ''}`}>Sí, monofásico</button>
      <button onClick={() => si('trif')} className={`${BTN_S} h-11 px-3 ${fase === 'trif' ? 'ring-2 ring-primary' : ''}`}>Sí, trifásico</button>
      <button onClick={no} className={`${BTN_S} h-11 px-3`}>No</button>
    </div>}
  </div>);
}
