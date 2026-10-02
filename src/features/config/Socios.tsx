/* E-024 · Configuración → Socios de custodia (administrador): crear, editar y desactivar socios (Esmove, Instant Box…).
   Un socio con artículos no se desactiva: antes hay que pasarlos a otro socio o a material propio. */
import { useState } from 'react';
import type { Propietario } from '../../data/tipos';
import { COLORES_SOCIO, colorSocio, idSocio, motivoNoDesactivar } from '../../domain/socios';
import { esCustodia } from '../../domain/reglas';
import { ejecutar, useAlmacen } from '../../store/almacen';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, Campo, Icon, INP, Tag } from '../../ui/base';

export function Socios() {
  const E = useAlmacen();
  const cambiarActivo = (o: Propietario, activo: boolean) => {
    if (!activo) { const m = motivoNoDesactivar(E, o.id); if (m) return toast(m, 'warn', 6000); if (!confirm(`¿Desactivar a ${o.nombre}? No se podrá poner material nuevo a su nombre; su historial se conserva.`)) return; }
    if (ejecutar({ op: 'propietario', args: { ...o, activo } })) toast(activo ? `${o.nombre} activado.` : `${o.nombre} desactivado.`, 'ok');
  };
  return (<div className="flex flex-col gap-2">
    {E.propietarios.map(o => { const n = E.products.filter(p => esCustodia(p) && p.propietario === o.id).length, activo = o.activo !== false; return (
      <div key={o.id} className={`flex flex-wrap items-center gap-3 rounded-xl p-2 ${activo ? 'bg-surface-container-low' : 'opacity-60'}`}>
        <span className={`w-10 h-10 rounded-lg grid place-items-center ${colorSocio(o).c}`}><Icon n="handshake" className="ico-20" /></span>
        <span className="flex-1 min-w-[140px]"><b>{o.nombre}</b> <span className="text-body-sm text-secondary">· {n} artículo{n === 1 ? '' : 's'}{o.contacto ? ` · ${o.contacto}` : ''}</span>{!activo && <Tag c="ml-1">desactivado</Tag>}
          {(o.correosReposicion.length > 0 || o.correosInformes.length > 0) && <span className="block font-mono text-label-sm text-secondary truncate">{[...new Set([...o.correosReposicion, ...o.correosInformes])].join(', ')}</span>}</span>
        <button onClick={() => abrirSocio(o)} className="text-primary font-semibold h-10 px-2">Editar</button>
        {activo ? <button onClick={() => cambiarActivo(o, false)} className="text-error font-semibold h-10 px-2">Desactivar</button>
          : <button onClick={() => cambiarActivo(o, true)} className="text-primary font-semibold h-10 px-2">Activar</button>}
      </div>); })}
    <button onClick={() => abrirSocio()} className={`${BTN_S} h-12 self-start px-4`}><Icon n="add" className="ico-20" />Nuevo socio</button>
  </div>);
}

export const abrirSocio = (o?: Propietario) => openModal(<FormSocio o={o} />);
function FormSocio({ o }: { o?: Propietario }) {
  const E = useAlmacen();
  const [f, setF] = useState({ nombre: o?.nombre || '', contacto: o?.contacto || '', repo: (o?.correosReposicion || []).join(', '), inf: (o?.correosInformes || []).join(', '), color: o?.color || 'naranja' });
  const lista = (s: string) => s.split(/[,;\s]+/).filter(Boolean);
  const guardar = () => {
    const id = o?.id || idSocio(f.nombre, E.propietarios.map(x => x.id));
    const args: Propietario = { id, nombre: f.nombre.trim(), contacto: f.contacto.trim(), correosReposicion: lista(f.repo), correosInformes: lista(f.inf), color: f.color, activo: o ? o.activo !== false : true };
    if (ejecutar({ op: 'propietario', args })) { closeModal(); toast(o ? 'Socio guardado.' : `${args.nombre} dado de alta como socio de custodia.`, 'ok'); }
  };
  return (<>
    <SheetHead title={o ? `Editar ${o.nombre}` : 'Nuevo socio de custodia'} sub="Empresa que deja material en el almacén (sin precios): se controla por modelo y cantidad, con sus informes y actas." />
    <div className="p-5 flex flex-col gap-3">
      <Campo label="Nombre"><input autoFocus value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} className={`${INP} h-12`} placeholder="Instant Box" /></Campo>
      <Campo label="Contacto"><input value={f.contacto} onChange={e => setF({ ...f, contacto: e.target.value })} className={`${INP} h-12`} placeholder="Nombre y teléfono" /></Campo>
      <Campo label="Correos para solicitudes de reposición"><input value={f.repo} onChange={e => setF({ ...f, repo: e.target.value })} type="text" inputMode="email" className={`${INP} h-12`} placeholder="pedidos@ejemplo.com" /></Campo>
      <Campo label="Correos para informes"><input value={f.inf} onChange={e => setF({ ...f, inf: e.target.value })} type="text" inputMode="email" className={`${INP} h-12`} placeholder="informes@ejemplo.com" /></Campo>
      <Campo label="Color de la etiqueta"><div className="flex flex-wrap gap-2">{Object.entries(COLORES_SOCIO).map(([k, c]) =>
        <button key={k} type="button" onClick={() => setF({ ...f, color: k })} aria-pressed={f.color === k} className={`h-10 px-3 rounded-lg font-mono text-label-md ${c.c} ${f.color === k ? 'ring-2 ring-primary' : ''}`}>{c.t}</button>)}</div></Campo>
      <p className="text-body-sm text-secondary">Vista previa: <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-label-sm ${(COLORES_SOCIO[f.color] || COLORES_SOCIO.violeta).c}`}><Icon n="handshake" className="ico-16" />Custodia {f.nombre.trim() || '…'}</span></p>
    </div>
    <SheetFoot><button onClick={guardar} disabled={!f.nombre.trim()} className={`${BTN_P} h-12 w-full disabled:opacity-40`}><Icon n="save" className="ico-20" />Guardar</button></SheetFoot>
  </>);
}

/** Desplegable del socio de un artículo en custodia: los activos (y el actual aunque esté desactivado); vacío = sin elegir */
export function SelectorSocio({ value, onChange, className = `${INP} h-12` }: { value: string; onChange: (id: string) => void; className?: string }) {
  const E = useAlmacen();
  const lista = E.propietarios.filter(o => o.activo !== false || o.id === value);
  return <select value={value} onChange={e => onChange(e.target.value)} className={className} aria-label="Socio de custodia" required>
    {!value && <option value="">Elige el socio…</option>}
    {lista.map(o => <option key={o.id} value={o.id}>{o.nombre}{o.activo === false ? ' (desactivado)' : ''}</option>)}</select>;
}
