/* E-035 · "Corregir cierre" (administrador): datos (fase, tipo de línea, sección, equipo), cargador instalado y cada partida de
   material, aunque la haya resuelto una regla. Lo corregido manda sobre lo automático hasta "Volver a lo automático". */
import { useMemo, useState } from 'react';
import type { CierreApp, LineaCierre } from '../../data/tipos';
import { efectivoCorregido, lineasCorregidas, type Correccion, type DatosCorregidos } from '../../domain/corregir';
import { conductoresSueltos, datosLinea } from '../../domain/resolucion';
import { esCustodia, find } from '../../domain/reglas';
import { num, toNum } from '../../domain/formato';
import { ejecutar, useAlmacen } from '../../store/almacen';
import { nuevoId } from '../../store/ops';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, Campo, Icon, INP, Tag } from '../../ui/base';
import { SelectorArticulo } from '../../ui/selectorArticulo';

type Fila = { id: string; sku: string | null; cantidad: string };
type Partida = { filas: Fila[]; quitada: boolean; manual: boolean; tocada: boolean; soltar: boolean };
const CAMPOS_DATOS: [keyof DatosCorregidos, string][] = [['fase', 'Fase'], ['tipoLinea', 'Tipo de línea'], ['seccion', 'Sección (mm²)'], ['equipo', 'Equipo']];

export const abrirCorregirCierre = (id: string) => openModal(<CorregirCierre id={id} />, { ancha: true });

function partidasDe(lineas: LineaCierre[]): Record<string, Partida> {
  const out: Record<string, Partida> = {};
  for (const l of lineas) {
    const p = out[l.campo] ||= { filas: [], quitada: false, manual: false, tocada: false, soltar: false };
    p.manual ||= !!l.manual;
    if (l.estado === 'quitada') { p.quitada = true; continue; }
    p.filas.push({ id: l.id, sku: l.sku || null, cantidad: String(l.cantidad) });
  }
  return out;
}

function CorregirCierre({ id }: { id: string }) {
  const E = useAlmacen(), c = E.cierres.find(x => x.id === id) as CierreApp;
  const lineasActuales = useMemo(() => E.lineasCierre.filter(l => l.cierre === id), [E.lineasCierre, id]);
  const auto = useMemo(() => efectivoCorregido(c, null), [c]);
  const [datos, setDatos] = useState<DatosCorregidos>({ ...(c.correccion || {}) });
  const [partidas, setPartidas] = useState<Record<string, Partida>>(() => partidasDe(lineasActuales));
  const cambiarPartida = (campo: string, f: (p: Partida) => Partida) => setPartidas(ps => ({ ...ps, [campo]: { ...f(ps[campo]), tocada: true } }));
  const efectivo = efectivoCorregido(c, datos);
  const { fase, seccion } = datosLinea({ datos: efectivo as Record<string, unknown> });
  const cargador = partidas.hardware?.filas[0]?.sku || null;

  const guardar = () => {
    const p: Correccion = {};
    const limpio = Object.fromEntries(Object.entries(datos).filter(([, v]) => String(v ?? '').trim())) as DatosCorregidos;
    if (JSON.stringify(limpio) !== JSON.stringify(Object.fromEntries(Object.entries(c.correccion || {}).filter(([, v]) => String(v ?? '').trim())))) p.datos = Object.keys(limpio).length ? limpio : null;
    const fijar: NonNullable<Correccion['fijar']> = {}, soltar: string[] = [];
    for (const [campo, x] of Object.entries(partidas)) {
      if (x.soltar) { soltar.push(campo); continue; }
      if (!x.tocada) continue;
      if (x.filas.some(f => !f.sku || !(toNum(f.cantidad) > 0))) return toast(`${campo}: elige el artículo y la cantidad de cada fila (o quítala).`, 'err');
      fijar[campo] = x.quitada ? [] : x.filas.map(f => ({ sku: f.sku!, cantidad: toNum(f.cantidad) }));
    }
    if (Object.keys(fijar).length) p.fijar = fijar;
    if (soltar.length) p.soltar = soltar;
    if (!('datos' in p) && !p.fijar && !p.soltar) return toast('No has cambiado nada.', 'warn');
    p.lineas = lineasCorregidas(E, c, 'datos' in p ? p.datos : c.correccion);
    if (ejecutar({ op: 'corregirCierre', args: { id, correccion: p } })) { closeModal(); toast('Cierre corregido: se ha recalculado y la diferencia queda en la versión «Corrección manual».', 'ok', 6000); }
  };

  const campos = Object.keys(partidas).filter(k => k !== 'hardware').sort();
  return (<>
    <SheetHead title={`Corregir el cierre ${c.numInst || ''}`} sub="Lo que corrijas aquí manda sobre lo que llegue después (wizard, histórico o prefactura) hasta que pulses «Volver a lo automático»." />
    <div className="p-5 flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Datos del cierre</h3>
          {c.correccion && <button onClick={() => setDatos({})} className="text-primary text-body-sm font-semibold h-10">Volver a lo automático</button>}</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">{CAMPOS_DATOS.map(([k, t]) => {
          const a = String(auto[k] ?? ''), v = datos[k] ?? '';
          const set = (x: string) => setDatos({ ...datos, [k]: x });
          return <Campo key={k} label={`${t}${v ? ' · corregido' : ''}`}>
            {k === 'fase' ? <select value={v} onChange={e => set(e.target.value)} className={`${INP} h-12`}><option value="">Automático ({a || '—'})</option><option value="mono">Monofásica</option><option value="trif">Trifásica</option></select>
              : k === 'tipoLinea' ? <select value={v} onChange={e => set(e.target.value)} className={`${INP} h-12`}><option value="">Automático ({a || '—'})</option><option value="tubo">Bajo tubo (conductores)</option><option value="manguera">Manguera</option></select>
              : k === 'equipo' ? <select value={v} onChange={e => set(e.target.value)} className={`${INP} h-12`}><option value="">Automático ({a || '—'})</option>{E.equipos.map(e => <option key={e.id} value={e.nombre}>{e.nombre}</option>)}</select>
              : <input value={v} onChange={e => set(e.target.value)} inputMode="decimal" placeholder={`Automático (${a || '—'})`} className={`${INP} h-12`} />}
          </Campo>; })}</div>
        <p className="text-body-sm text-secondary">Al guardar, el cierre se recalcula con estos datos (p. ej., trifásica bajo tubo = 5 conductores). Si cambia el equipo, lo descontado vuelve a su furgoneta y se descuenta de la nueva.</p>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Cargador instalado</h3>
          {partidas.hardware?.manual && <button onClick={() => cambiarPartida('hardware', x => ({ ...x, soltar: !x.soltar }))} className="text-primary text-body-sm font-semibold h-10">{partidas.hardware.soltar ? 'Mantener lo corregido' : 'Volver a lo automático'}</button>}</div>
        {partidas.hardware?.soltar ? <p className="text-body-sm text-secondary">Volverá a la regla automática ({c.hardware || 'sin modelo'}).</p>
          : <div className="flex gap-2 items-center"><SelectorArticulo valor={cargador} onChange={sku => setPartidas(ps => ({ ...ps, hardware: { filas: sku ? [{ id: nuevoId(), sku, cantidad: '1' }] : [], quitada: !sku, manual: true, tocada: true, soltar: false } }))}
              filtro={p => p.cat === 'cargadores' || esCustodia(p)} vacio="— Ninguno (no descuenta cargador) —" className="flex-1" />{partidas.hardware?.manual && <Tag c="bg-primary-fixed text-primary">corregido</Tag>}</div>}
        <p className="text-body-sm text-secondary">Del calendario: «{c.hardware || 'sin modelo'}». Si es material en custodia, el informe del socio refleja el artículo corregido.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-semibold">Materiales</h3>
        {campos.map(campo => { const x = partidas[campo]; return (
          <div key={campo} className="rounded-lg bg-surface-container-low p-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2"><span className="font-mono font-semibold">{campo}</span>{x.manual && !x.soltar && <Tag c="bg-primary-fixed text-primary">corregido</Tag>}{x.quitada && !x.soltar && <Tag>quitada: no descuenta</Tag>}
              <span className="flex-1" />
              {x.manual && <button onClick={() => cambiarPartida(campo, y => ({ ...y, soltar: !y.soltar }))} className="text-primary text-body-sm font-semibold h-10">{x.soltar ? 'Mantener lo corregido' : 'Volver a lo automático'}</button>}
              {!x.soltar && <button onClick={() => cambiarPartida(campo, y => ({ ...y, quitada: !y.quitada }))} className="text-error text-body-sm font-semibold h-10">{x.quitada ? 'Volver a descontar' : 'Quitar (no descontar)'}</button>}</div>
            {!x.soltar && !x.quitada && <>
              {campo === 'metrosLinea' && <button onClick={() => { const m = toNum(x.filas[0]?.cantidad || '0') || Number(auto.metrosLinea) || 0; cambiarPartida(campo, y => ({ ...y, filas: conductoresSueltos(E, seccion, fase, m).map(p => ({ id: nuevoId(), sku: p.sku || null, cantidad: String(p.cantidad) })) })); }}
                className={`${BTN_S} h-10 px-3 text-body-sm self-start`}>Conductores sueltos ({fase === 'trif' ? 5 : 3} × {seccion ?? '?'} mm²)</button>}
              {x.filas.map((f, i) => <div key={f.id} className="flex gap-2 items-start">
                <SelectorArticulo valor={f.sku} onChange={sku => cambiarPartida(campo, y => ({ ...y, filas: y.filas.map((g, j) => j === i ? { ...g, sku } : g) }))} className="flex-1 min-w-0" alto="h-11" />
                <input value={f.cantidad} onChange={e => cambiarPartida(campo, y => ({ ...y, filas: y.filas.map((g, j) => j === i ? { ...g, cantidad: e.target.value } : g) }))} inputMode="decimal" className={`${INP} h-11 !w-24 text-right`} aria-label="Cantidad" />
                <button onClick={() => cambiarPartida(campo, y => ({ ...y, filas: y.filas.filter((_, j) => j !== i) }))} className="h-11 w-11 shrink-0 text-secondary" aria-label="Quitar artículo"><Icon n="close" className="ico-20" /></button></div>)}
              <button onClick={() => cambiarPartida(campo, y => ({ ...y, filas: [...y.filas, { id: nuevoId(), sku: null, cantidad: y.filas[0]?.cantidad || '1' }] }))} className={`${BTN_S} h-10 px-3 text-body-sm self-start`}><Icon n="add" className="ico-18" />Añadir artículo</button>
            </>}
            {x.tocada && !x.soltar && <p className="text-label-sm text-secondary">Quedará fijada a mano{x.quitada ? ': no descuenta' : `: ${x.filas.map(f => `${num(toNum(f.cantidad))} × ${f.sku ? find(E, f.sku)?.name || f.sku : '¿?'}`).join(' + ')}`}.</p>}
          </div>); })}
      </section>
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Cancelar</button><button onClick={guardar} className={`${BTN_P} h-12 flex-1`}><Icon n="save" className="ico-20" />Guardar y recalcular</button></SheetFoot>
  </>);
}
