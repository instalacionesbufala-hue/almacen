/* E-013 · Paso a datos reales (solo administrador): borrar los datos de ejemplo una vez, importar el catálogo (CSV) y completar los mínimos */
import { useRef, useState } from 'react';
import { UNIT, catDe } from '../../data/catalogo';
import { parsearCatalogo, type VistaCatalogo } from '../../domain/catalogoCsv';
import { diferencias } from '../../domain/fichas';
import { find } from '../../domain/reglas';
import { BUCKET_FOTOS } from '../../domain/fotos';
import { fechaHora } from '../../domain/formato';
import { ejecutar, useAlmacen } from '../../store/almacen';
import { modoNube, supabase } from '../../store/nube/cliente';
import { recargar } from '../../store/nube/sync';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_BASE, BTN_P, BTN_S, Icon, INP, LBL, Tag } from '../../ui/base';
import { abrirMinimos } from '../reposicion/Minimos';

const FRASE = 'BORRAR DEMO';

export function DatosReales() {
  const E = useAlmacen(), archivo = useRef<HTMLInputElement>(null);
  const sinMinimo = E.products.filter(p => p.minimoDefinido === false).length;
  const leerCsv = async (f?: File) => {
    if (!f) return;
    const vista = parsearCatalogo(await f.text(), E);
    if (vista.errorGeneral) return toast(vista.errorGeneral, 'err', 7000);
    openModal(<VistaImportar vista={vista} nombre={f.name} />, { ancha: true });
  };
  return (<>
    {E.configApp.modoDemo
      ? <div className="rounded-xl bg-error-container/40 p-3 flex flex-col gap-2">
          <p className="text-body-sm"><b>Ahora hay datos de ejemplo</b> (artículos, equipos, técnicos, vehículos, movimientos y entregas inventados). Antes de trabajar con el material real, bórralos: se hace <b>una sola vez</b>. Se conservan los usuarios, la configuración de avisos y Esmove.</p>
          <button onClick={() => openModal(<BorrarDemo />)} className={`${BTN_BASE} h-12 text-on-error bg-error hover:bg-error/90`}><Icon n="delete_forever" className="ico-20" />Borrar datos de ejemplo</button>
        </div>
      : <p className="text-body-sm text-secondary flex items-center gap-2"><Icon n="check_circle" className="ico-20 text-tertiary" />Datos de ejemplo borrados{E.configApp.demoBorrada ? ` el ${fechaHora(E.configApp.demoBorrada)}` : ''}{E.configApp.demoBorradaPor ? ` por ${E.configApp.demoBorradaPor}` : ''}.</p>}
    <div className="flex flex-wrap gap-2">
      <button onClick={() => archivo.current?.click()} className={`${BTN_S} h-12 px-4`}><Icon n="upload_file" className="ico-20" />Importar catálogo (CSV)</button>
      {sinMinimo > 0 && <button onClick={() => abrirMinimos({ soloSinMinimo: true })} className={`${BTN_S} h-12 px-4 text-amber-800`}><Icon n="rule" className="ico-20" />Completar mínimo ({sinMinimo})</button>}
    </div>
    <p className="text-body-sm text-secondary">El CSV lleva la cabecera <span className="font-mono text-label-sm break-all">sku;ref_proveedor;nombre;categoria;propiedad;propietario;proveedor;unidad;contenido_unidad;stock_inicial;minimo;albaranes</span>. Lo que ya existe no se toca y el inventario de apertura entra una sola vez, así que repetir la importación no duplica nada.</p>
    <input ref={archivo} type="file" accept=".csv,text/csv" className="hidden" onChange={e => { void leerCsv(e.target.files?.[0]); e.target.value = ''; }} />
  </>);
}

function BorrarDemo() {
  const E = useAlmacen();
  const [frase, setFrase] = useState(''), [enCurso, setEnCurso] = useState(false);
  const borrar = async () => {
    if (frase.trim().toUpperCase() !== FRASE) return;
    if (!modoNube || !supabase) {
      if (ejecutar({ op: 'limpiarDemo', args: {} })) { closeModal(); toast('Datos de ejemplo borrados. Ya puedes importar el catálogo real.', 'ok', 7000); }
      return;
    }
    // En la nube se hace en directo (no en la cola): necesita conexión y devuelve las fotos que hay que quitar del almacenamiento
    setEnCurso(true);
    const { data, error } = await supabase.rpc('limpiar_demostracion');
    if (error) { setEnCurso(false); return toast(error.message, 'err', 8000); }
    const fotos = ((data as { fotos?: string[] })?.fotos) || [];
    for (let i = 0; i < fotos.length; i += 100) await supabase.storage.from(BUCKET_FOTOS).remove(fotos.slice(i, i + 100));
    await recargar();
    closeModal(); toast(`Datos de ejemplo borrados${fotos.length ? ` (y ${fotos.length} fotos)` : ''}. Ya puedes importar el catálogo real.`, 'ok', 7000);
  };
  return (<>
    <SheetHead title="Borrar datos de ejemplo" sub="Solo se puede hacer una vez" />
    <div className="p-4 flex flex-col gap-3">
      <p className="text-body-md">Se borrarán <b>{E.products.length} artículos</b>, {E.movements.length} movimientos, {E.entregas.length} entregas, {E.equipos.length} equipos, {E.tecnicos.length} técnicos, {E.vehiculos.length} vehículos y {E.herramientas.length} fichas de dotación, con sus fotos.</p>
      <p className="text-body-sm text-secondary">Se conservan los usuarios, la configuración de avisos y los propietarios (Esmove). El historial vuelve a quedar protegido nada más terminar. Exporta una copia antes si quieres guardar algo.</p>
      <label className="flex flex-col gap-1"><span className={LBL}>Escribe {FRASE} para confirmar</span>
        <input value={frase} onChange={e => setFrase(e.target.value)} className={`${INP} font-mono`} autoFocus autoComplete="off" /></label>
    </div>
    <SheetFoot><button onClick={closeModal} className={`${BTN_S} h-12 px-4`}>Cancelar</button>
      <button disabled={frase.trim().toUpperCase() !== FRASE || enCurso} onClick={() => void borrar()} className={`${BTN_BASE} h-12 px-4 flex-1 text-on-error bg-error hover:bg-error/90 disabled:opacity-40`}><Icon n="delete_forever" className="ico-20" />{enCurso ? 'Borrando…' : 'Borrar definitivamente'}</button></SheetFoot>
  </>);
}

function VistaImportar({ vista, nombre }: { vista: VistaCatalogo; nombre: string }) {
  const E = useAlmacen();
  const [ver, setVer] = useState<'nuevo' | 'existe' | 'error'>(vista.conError ? 'error' : 'nuevo');
  const [actualizar, setActualizar] = useState(false);
  const validas = vista.filas.filter(f => !f.errores.length);
  // E-016: qué cambiaría en cada ficha existente (nombre, categoría, proveedor, unidad y contenido); el stock nunca
  const cambiosDe = (f: VistaCatalogo['filas'][number]) => { const p = find(E, f.fila.sku); return p ? diferencias(p, { name: f.fila.nombre, cat: f.fila.categoria, supplier: f.fila.proveedor || p.supplier, unit: f.fila.unidad, contenido: f.fila.contenido }) : []; };
  const conCambios = validas.filter(f => f.estado === 'existe' && cambiosDe(f).length).length;
  const lista = vista.filas.filter(f => ver === 'error' ? f.errores.length : !f.errores.length && f.estado === ver);
  const importar = () => {
    if (!validas.length) return;
    if (ejecutar({ op: 'importarCatalogo', args: { filas: validas.map(f => f.fila), actualizar } })) {
      closeModal();
      const sinMin = validas.filter(f => f.fila.minimo === null && f.estado === 'nuevo').length;
      toast(`Catálogo importado: ${vista.nuevos} artículos nuevos${vista.existentes ? `, ${vista.existentes} ya existían (${actualizar ? `${conCambios} fichas actualizadas, sin tocar el stock` : 'no se tocan'})` : ''}.${sinMin ? ` ${sinMin} quedan con el mínimo por completar.` : ''}`, 'ok', 8000);
    }
  };
  const TAB = (k: typeof ver, t: string, n: number, c = '') => <button onClick={() => setVer(k)} className={`h-10 px-3 rounded-lg text-body-sm font-semibold ${ver === k ? 'bg-primary text-on-primary' : `bg-surface-container-low ${c}`}`}>{t} · {n}</button>;
  return (<>
    <SheetHead title="Importar catálogo" sub={nombre} />
    <div className="p-4 flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">{TAB('nuevo', 'Nuevos', vista.nuevos)}{TAB('existe', 'Ya existen', vista.existentes)}{TAB('error', 'Con errores', vista.conError, vista.conError ? 'text-error' : '')}</div>
      {vista.existentes > 0 && <label className="flex items-start gap-2 rounded-xl bg-primary-fixed/30 p-3 text-body-md"><input type="checkbox" checked={actualizar} onChange={e => setActualizar(e.target.checked)} className="w-5 h-5 mt-0.5 accent-primary" />
        <span><b>Actualizar fichas existentes</b> ({conCambios} con cambios): nombre, categoría, proveedor, unidad y contenido. <b>El stock no se toca ni se convierte</b>: el número ya es el del albarán (3 botes, 400 m).</span></label>}
      {ver === 'existe' && <p className="text-body-sm text-secondary">Estos SKU ya están en el catálogo. {actualizar ? 'Se aplicarán los cambios que ves en cada fila.' : 'Sin la casilla, no se cambian.'}</p>}
      {ver === 'error' && vista.conError > 0 && <p className="text-body-sm text-error">Estas filas no se importan. Corrige el CSV y vuelve a importarlo (lo ya importado no se duplica).</p>}
      <div className="max-h-[50vh] overflow-auto rounded-lg ring-1 ring-surface-container-high">
        <table className="w-full text-body-sm"><thead className="sticky top-0 bg-surface-container-low"><tr className="text-left">
          <th className="p-2">Artículo</th><th className="p-2">Unidad</th><th className="p-2 text-right">Stock inicial</th><th className="p-2">Mínimo</th></tr></thead>
          <tbody>{lista.map(f => <tr key={f.linea} className="border-t border-surface-container-high align-top">
            <td className="p-2"><div className="font-medium">{f.fila.nombre || '—'}</div><div className="font-mono text-label-sm text-secondary">{f.fila.sku || '—'} · {catDe(f.fila.categoria).label}{f.fila.propiedad === 'custodia' ? ` · custodia ${f.fila.propietario}` : ''}</div>
              {f.errores.map(e => <div key={e} className="text-error text-label-sm">Línea {f.linea}: {e}</div>)}
              {f.estado === 'existe' && !f.errores.length && cambiosDe(f).map(d => <div key={d.campo} className={`text-label-sm ${actualizar ? 'text-primary' : 'text-secondary'}`}>{d.etiqueta}: <s>{String(d.antes ?? '—')}</s> → <b>{String(d.despues ?? '—')}</b></div>)}
              {f.estado === 'existe' && actualizar && E.aBordo.some(b => b.sku === f.fila.sku && b.unidades) && cambiosDe(f).some(d => d.campo === 'contenido') && <div className="text-amber-800 text-label-sm">Hay material de este artículo en vehículos: revisa su recuento tras cambiar el contenido.</div>}</td>
            <td className="p-2 whitespace-nowrap">{UNIT[f.fila.unidad] || f.fila.unidad}{f.fila.contenido > 1 ? ` de ${f.fila.contenido}` : ''}</td>
            <td className="p-2 text-right font-mono">{f.fila.stock_inicial}</td>
            <td className="p-2">{f.fila.minimo === null ? <Tag c="bg-amber-100 text-amber-800">por completar</Tag> : f.fila.minimo}</td></tr>)}</tbody></table>
        {!lista.length && <p className="text-secondary text-center py-6">Nada en esta lista.</p>}
      </div>
    </div>
    <SheetFoot><button onClick={closeModal} className={`${BTN_S} h-12 px-4`}>Cancelar</button>
      <button disabled={!validas.length} onClick={importar} className={`${BTN_P} h-12 px-4 flex-1 disabled:opacity-40`}><Icon n="download_done" className="ico-20" />Importar {validas.length} fila{validas.length === 1 ? '' : 's'}</button></SheetFoot>
  </>);
}
