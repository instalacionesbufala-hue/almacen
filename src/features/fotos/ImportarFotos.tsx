/* E-009 · Importación de fotos por lote (solo administrador).
   Se sueltan muchos archivos a la vez; cada uno se empareja por su nombre con el SKU, el código del proveedor o el EAN
   (p. ej. 6040615306.webp). Antes de confirmar se ve la vista previa, con las que no casan y las que sustituirían una foto. */
import { useEffect, useMemo, useState } from 'react';
import type { OrigenFoto } from '../../data/tipos';
import { origenesFoto, planImportacion, type Asignacion } from '../../domain/fotos';
import { find } from '../../domain/reglas';
import { useAlmacen } from '../../store/almacen';
import { BTN_P, BTN_S, Icon, LBL, Tag } from '../../ui/base';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { FotoProducto } from '../../ui/foto';
import { guardarFoto } from './servicio';

export const abrirImportarFotos = () => openModal(<ImportarFotos />, { ancha: true });

const ESTADO: Record<Asignacion['estado'], { t: string; c: string }> = {
  nueva: { t: 'Foto nueva', c: 'bg-tertiary-fixed/40 text-tertiary' },
  sustituye: { t: 'Sustituye la actual', c: 'bg-amber-100 text-amber-800' },
  'sin-pareja': { t: 'No casa con ningún artículo', c: 'bg-error-container text-error' },
  repetida: { t: 'Repetida (vale la primera)', c: 'bg-surface-container-high text-secondary' },
  'no-imagen': { t: 'No es una imagen', c: 'bg-error-container text-error' },
};

function ImportarFotos() {
  const E = useAlmacen();
  const [archivos, setArchivos] = useState<File[]>([]);
  const [origen, setOrigen] = useState<OrigenFoto>('Saltoki');
  const [sustituir, setSustituir] = useState(false);
  const [encima, setEncima] = useState(false);
  const [progreso, setProgreso] = useState<{ hechas: number; total: number; fallos: string[] } | null>(null);
  const plan = useMemo(() => planImportacion(archivos, E), [archivos, E]);
  const previas = useMemo(() => archivos.map(f => URL.createObjectURL(f)), [archivos]);
  useEffect(() => () => previas.forEach(u => URL.revokeObjectURL(u)), [previas]);

  const añadir = (fs: FileList | null) => { if (fs?.length) setArchivos(a => [...a, ...[...fs].filter(f => !a.some(x => x.name === f.name && x.size === f.size))]); };
  const aplicables = plan.map((a, i) => ({ a, f: archivos[i] })).filter(({ a }) => a.estado === 'nueva' || (sustituir && a.estado === 'sustituye'));
  const cuenta = (k: Asignacion['estado']) => plan.filter(a => a.estado === k).length;

  const importar = async () => {
    const total = aplicables.length, fallos: string[] = [];
    setProgreso({ hechas: 0, total, fallos });
    // de una en una: en el móvil, comprimir muchas a la vez agota la memoria
    for (let i = 0; i < total; i++) {
      const { a, f } = aplicables[i];
      try { if (!(await guardarFoto(a.sku!, f, origen))) fallos.push(a.archivo); }
      catch (e) { fallos.push(`${a.archivo}: ${(e as Error).message}`); }
      setProgreso({ hechas: i + 1, total, fallos });
    }
    toast(fallos.length ? `${total - fallos.length} fotos importadas, ${fallos.length} con error.` : `${total} fotos importadas.`, fallos.length ? 'warn' : 'ok', 6000);
    if (!fallos.length) closeModal();
  };

  return (<>
    <SheetHead title="Importar fotos por lote" sub="Cada archivo se asigna por su nombre: SKU, código del proveedor o EAN" />
    <div className="p-5 flex flex-col gap-4">
      <label onDragOver={e => { e.preventDefault(); setEncima(true); }} onDragLeave={() => setEncima(false)} onDrop={e => { e.preventDefault(); setEncima(false); añadir(e.dataTransfer.files); }}
        className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center gap-2 text-center cursor-pointer ${encima ? 'border-primary bg-primary-fixed/40' : 'border-outline-variant bg-surface-container-low'}`}>
        <Icon n="add_photo_alternate" className="ico-40 text-primary" />
        <span className="font-semibold">Suelta aquí las fotos o toca para elegirlas</span>
        <span className="text-body-sm text-secondary">Ejemplo: <span className="font-mono">6040615306.webp</span> se asigna al artículo con ese código de Saltoki. Se reducen a 1.000 px antes de subirlas.</span>
        <input type="file" accept="image/*" multiple className="hidden" onChange={e => { añadir(e.target.files); e.target.value = ''; }} />
      </label>

      {plan.length > 0 && <>
        <div className="flex flex-wrap items-center gap-2 text-body-sm">
          <Tag c={ESTADO.nueva.c}>{cuenta('nueva')} nuevas</Tag>
          <Tag c={ESTADO.sustituye.c}>{cuenta('sustituye')} sustituirían una foto</Tag>
          <Tag c={ESTADO['sin-pareja'].c}>{cuenta('sin-pareja') + cuenta('no-imagen')} sin asignar</Tag>
          {cuenta('repetida') > 0 && <Tag>{cuenta('repetida')} repetidas</Tag>}
          <button onClick={() => setArchivos([])} className="ml-auto text-secondary font-semibold">Vaciar</button>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-body-sm">Origen de las fotos
            <select value={origen} onChange={e => setOrigen(e.target.value as OrigenFoto)} className="bg-surface-container-low rounded-lg px-2 py-1.5">{origenesFoto(E).map(o => <option key={o.v} value={o.v}>{o.t}</option>)}</select></label>
          {cuenta('sustituye') > 0 && <label className="flex items-center gap-2 text-body-sm"><input type="checkbox" checked={sustituir} onChange={e => setSustituir(e.target.checked)} className="w-5 h-5 accent-primary" />Sustituir también las fotos existentes ({cuenta('sustituye')})</label>}
        </div>
        <div className="flex flex-col max-h-[50vh] overflow-y-auto">
          {plan.map((a, i) => { const p = a.sku ? find(E, a.sku) : undefined; const va = a.estado === 'nueva' || (sustituir && a.estado === 'sustituye'); return (
            <div key={i} className={`flex items-center gap-3 py-2 border-b border-surface-container ${va ? '' : 'opacity-60'}`}>
              <img src={previas[i]} alt="" className="w-12 h-12 rounded-lg object-contain bg-white ring-1 ring-surface-container-high shrink-0" loading="lazy" />
              <Icon n="arrow_forward" className="ico-18 text-secondary" />
              {p ? <FotoProducto p={p} size="w-12 h-12" icono="ico-20" /> : <div className="w-12 h-12 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="font-mono text-label-md truncate">{a.archivo}</div>
                <div className="text-body-sm truncate">{p ? <>{p.name} <span className="text-secondary">· por {a.por}</span></> : <span className="text-secondary">—</span>}</div>
              </div>
              <Tag c={ESTADO[a.estado].c}>{ESTADO[a.estado].t}</Tag>
            </div>); })}
        </div>
      </>}
      {progreso && <div>
        <div className={`${LBL} mb-1`}>Importando {progreso.hechas} de {progreso.total}</div>
        <div className="h-2 rounded-full bg-surface-container-high overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${progreso.total ? progreso.hechas / progreso.total * 100 : 0}%` }} /></div>
        {progreso.fallos.length > 0 && <ul className="text-body-sm text-error mt-2">{progreso.fallos.map(f => <li key={f}>{f}</li>)}</ul>}
      </div>}
    </div>
    <SheetFoot className="flex gap-2">
      <button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Cerrar</button>
      <button onClick={() => void importar()} disabled={!aplicables.length || (!!progreso && progreso.hechas < progreso.total)} className={`${BTN_P} h-12 flex-1`}><Icon n="cloud_upload" className="ico-20" />Importar {aplicables.length} fotos</button>
    </SheetFoot>
  </>);
}
