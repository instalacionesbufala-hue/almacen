/* Gestión de usuarios y roles (administrador). E-004: alta con contraseña, rol, activación y cambio de contraseña (solo en modo nube).
   E-027: roles configurables con una matriz Ver / Modificar por apartado, roles de sistema fijos (se duplican para personalizarlos)
   y "Probar como este rol" para ver la app como la ve ese usuario. */
import { useState } from 'react';
import type { RolApp } from '../../data/tipos';
import { APARTADOS, rolDe, rolesDe } from '../../domain/permisos';
import { idRol, normalizarPermisos } from '../../../supabase/functions/_compartido/permisos';
import { ejecutar, useAlmacen } from '../../store/almacen';
import { supabase, modoNube } from '../../store/nube/cliente';
import { recargar, sesion } from '../../store/nube/sync';
import { probarComo } from '../../store/permisos';
import { ir } from '../../store/ui';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { Avatar, BTN_P, BTN_S, Campo, Icon, INP, Tag } from '../../ui/base';

async function llamar(cuerpo: Record<string, string>): Promise<string | null> {
  if (!supabase) return 'La nube no está configurada';
  const { data, error } = await supabase.functions.invoke('usuarios', { body: cuerpo });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    try { const j = ctx ? await ctx.json() : null; if (j?.error) return j.error; } catch { /* sin cuerpo */ }
    return error.message;
  }
  return (data as { error?: string })?.error || null;
}

const colorRol = (id: string) => (id === 'admin' ? 'bg-primary-fixed text-primary' : id === 'lectura' ? 'bg-amber-100 text-amber-800' : 'bg-surface-container-high text-secondary');

/** Configuración → Usuarios y permisos: pestañas Usuarios y Roles */
export function UsuariosYRoles() {
  const [pest, setPest] = useState<'usuarios' | 'roles'>(modoNube ? 'usuarios' : 'roles');
  const b = (k: typeof pest, t: string, i: string) => <button onClick={() => setPest(k)} aria-pressed={pest === k} className={`flex items-center gap-2 px-4 h-11 rounded-lg font-semibold ${pest === k ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant'}`}><Icon n={i} className="ico-20" />{t}</button>;
  return (<div className="flex flex-col gap-3">
    <div className="inline-flex self-start bg-surface-container-low p-1 rounded-xl" role="tablist">{modoNube && b('usuarios', 'Usuarios', 'group')}{b('roles', 'Roles', 'admin_panel_settings')}</div>
    {pest === 'usuarios' ? <Usuarios /> : <Roles />}
  </div>);
}

export function Usuarios() {
  const E = useAlmacen(), yo = sesion.use().perfil?.id, roles = rolesDe(E);
  const cambiarRol = (id: string, rol: string) => {
    const u = E.perfiles.find(x => x.id === id)!, r = rolDe(E, rol);
    if (!confirm(`¿Pasar a ${u.nombre} al rol «${r?.nombre || rol}»? El cambio es inmediato: su app se recarga sola.`)) return;
    if (ejecutar({ op: 'perfil', args: { id, nombre: u.nombre, rol, activo: u.activo } })) toast(`${u.nombre} ahora tiene el rol «${r?.nombre || rol}».`, 'ok');
  };
  return (
    <div className="flex flex-col gap-2">
      {E.perfiles.map(u => (
        <div key={u.id} className={`flex flex-wrap items-center gap-3 rounded-xl p-3 ${u.activo ? 'bg-surface-container-low' : 'bg-surface-container-low opacity-60'}`}>
          <Avatar n={u.nombre} />
          <div className="flex-1 min-w-[140px]"><div className="font-semibold">{u.nombre}{u.id === yo ? ' (tú)' : ''}</div><div className="font-mono text-label-sm text-secondary">{u.email}</div></div>
          {u.id === yo ? <Tag c={colorRol(u.rol)}>{rolDe(E, u.rol)?.nombre || u.rol}</Tag>
            : <select value={u.rol} onChange={e => cambiarRol(u.id, e.target.value)} className={`${INP} h-10 !w-auto`} aria-label={`Rol de ${u.nombre}`}>
              {roles.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select>}
          {!u.activo && <Tag c="bg-error-container text-error">Desactivado</Tag>}
          <button onClick={() => openModal(<EditarUsuario id={u.id} />)} className="text-primary text-body-sm font-semibold h-10">Editar</button>
        </div>))}
      <button onClick={() => openModal(<NuevoUsuario />)} className={`${BTN_P} h-12`}><Icon n="person_add" className="ico-20" />Dar de alta un usuario</button>
    </div>
  );
}

function NuevoUsuario() {
  const E = useAlmacen();
  const [f, setF] = useState({ nombre: '', email: '', rol: 'almacen', clave: '' }), [enviando, setEnviando] = useState(false);
  const crear = async () => {
    setEnviando(true); const err = await llamar({ accion: 'crear', ...f }); setEnviando(false);
    if (err) return toast(err, 'err');
    closeModal(); toast(`Usuario creado. Dale a ${f.nombre} su correo y la contraseña; podrá entrar ya.`, 'ok', 7000); void recargar();
  };
  return (<>
    <SheetHead title="Nuevo usuario" sub="Nadie se registra por su cuenta: das tú el acceso." />
    <div className="p-5 grid grid-cols-1 gap-3">
      <Campo label="Nombre y apellidos"><input autoFocus value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} className={`${INP} h-12`} /></Campo>
      <Campo label="Correo (será su usuario)"><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} className={`${INP} h-12`} /></Campo>
      <Campo label="Rol"><select value={f.rol} onChange={e => setF({ ...f, rol: e.target.value })} className={`${INP} h-12`}>{rolesDe(E).map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></Campo>
      <p className="text-body-sm text-secondary -mt-1">{rolDe(E, f.rol)?.descripcion}</p>
      <Campo label="Contraseña inicial (10 caracteres, letras y números)"><input value={f.clave} onChange={e => setF({ ...f, clave: e.target.value })} className={`${INP} h-12 font-mono`} autoComplete="new-password" /></Campo>
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Cancelar</button><button onClick={crear} disabled={enviando} className={`${BTN_P} h-12 flex-1`}>{enviando ? 'Creando…' : 'Crear usuario'}</button></SheetFoot>
  </>);
}

function EditarUsuario({ id }: { id: string }) {
  const E = useAlmacen(), u = E.perfiles.find(x => x.id === id)!;
  const [f, setF] = useState({ nombre: u.nombre, rol: u.rol, activo: u.activo }), [clave, setClave] = useState('');
  const guardar = async () => {
    if (!ejecutar({ op: 'perfil', args: { id, ...f } })) return;
    if (f.activo !== u.activo) { const err = await llamar({ accion: 'bloqueo', id, activo: String(f.activo) }); if (err) toast(`Perfil guardado, pero no se pudo bloquear el acceso: ${err}`, 'warn', 7000); }
    closeModal(); toast(f.activo ? 'Usuario actualizado.' : 'Usuario desactivado: ya no puede entrar y su historial se conserva.', 'ok', 6000);
  };
  const cambiarClave = async () => { const err = await llamar({ accion: 'clave', id, clave }); if (err) return toast(err, 'err'); setClave(''); toast('Contraseña cambiada.', 'ok'); };
  return (<>
    <SheetHead title={u.nombre} sub={u.email || ''} />
    <div className="p-5 grid grid-cols-1 gap-3">
      <Campo label="Nombre"><input value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} className={`${INP} h-12`} /></Campo>
      <Campo label="Rol"><select value={f.rol} onChange={e => setF({ ...f, rol: e.target.value })} className={`${INP} h-12`}>{rolesDe(E).map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></Campo>
      <label className="flex items-center gap-3 bg-surface-container-low rounded-lg px-3 h-12"><input type="checkbox" checked={f.activo} onChange={e => setF({ ...f, activo: e.target.checked })} className="w-5 h-5 accent-primary" />Puede entrar en la app</label>
      <div className="flex gap-2 items-end"><Campo label="Nueva contraseña" className="flex-1"><input value={clave} onChange={e => setClave(e.target.value)} className={`${INP} h-12 font-mono`} autoComplete="new-password" /></Campo>
        <button onClick={cambiarClave} disabled={!clave} className={`${BTN_S} h-12 px-4`}>Cambiar</button></div>
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Cerrar</button><button onClick={() => void guardar()} className={`${BTN_P} h-12 flex-1`}><Icon n="save" className="ico-20" />Guardar</button></SheetFoot>
  </>);
}

/* ---------- E-027 · Roles ---------- */
function Roles() {
  const E = useAlmacen(), roles = rolesDe(E);
  const borrar = (r: RolApp) => { if (confirm(`¿Borrar el rol «${r.nombre}»?`) && ejecutar({ op: 'borrarRol', args: { id: r.id } })) toast('Rol borrado.', 'ok'); };
  const probar = (r: RolApp) => { probarComo(r.id); ir('stock'); toast(`Viendo la app como «${r.nombre}». Para salir, «Dejar de probar» arriba.`, 'ok', 6000); };
  return (<div className="flex flex-col gap-2">
    <p className="text-body-sm text-secondary">Cada rol dice qué apartados ve cada usuario y en cuáles puede modificar. Los de sistema no se cambian: <b>duplícalos</b> para hacer uno a tu medida. Usuarios y roles son siempre solo del administrador.</p>
    {roles.map(r => { const n = E.perfiles.filter(p => p.rol === r.id).length; return (
      <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl p-3 bg-surface-container-low">
        <div className="flex-1 min-w-[200px]"><div className="font-semibold flex items-center gap-2">{r.nombre}{r.sistema && <Tag>de sistema</Tag>}<span className="font-mono text-label-sm text-secondary">· {n} usuario{n === 1 ? '' : 's'}</span></div>
          <div className="text-body-sm text-secondary">{r.descripcion}</div></div>
        <button onClick={() => openModal(<FormRol id={r.id} />, { ancha: true })} className="text-primary text-body-sm font-semibold h-10 px-1">{r.sistema ? 'Ver permisos' : 'Editar'}</button>
        <button onClick={() => openModal(<FormRol base={r} />, { ancha: true })} className="text-primary text-body-sm font-semibold h-10 px-1">Duplicar</button>
        {r.id !== 'admin' && <button onClick={() => probar(r)} className="text-primary text-body-sm font-semibold h-10 px-1">Probar como este rol</button>}
        {!r.sistema && <button onClick={() => borrar(r)} disabled={n > 0} title={n ? 'Lo usa algún usuario: cámbiales el rol antes' : undefined} className="text-error text-body-sm font-semibold h-10 px-1 disabled:opacity-40">Borrar</button>}
      </div>); })}
    <button onClick={() => openModal(<FormRol />, { ancha: true })} className={`${BTN_S} h-12 self-start px-4`}><Icon n="add" className="ico-20" />Nuevo rol</button>
  </div>);
}

/** Matriz Ver / Modificar. Con `id`: editar (o solo ver, si es de sistema). Con `base`: duplicar. Sin nada: rol nuevo. */
function FormRol({ id, base }: { id?: string; base?: RolApp }) {
  const E = useAlmacen(), actual = id ? rolDe(E, id) : undefined, fijo = !!actual?.sistema;
  const origen = actual || base;
  const [f, setF] = useState({ nombre: actual ? actual.nombre : base ? `${base.nombre} (copia)` : '', descripcion: origen?.descripcion || '',
    permisos: normalizarPermisos(origen?.id === 'admin' ? Object.fromEntries(APARTADOS.flatMap(a => [[`${a.id}.ver`, true], [`${a.id}.modificar`, true]])) : origen?.permisos || {}) });
  const marca = (clave: string, v: boolean) => {
    const [ap, ac] = clave.split('.');
    const p = { ...f.permisos, [clave]: v };
    if (ac === 'modificar' && v) p[`${ap}.ver`] = true;            // modificar implica ver
    if (ac === 'ver' && !v) p[`${ap}.modificar`] = false;
    setF({ ...f, permisos: p });
  };
  const guardar = () => {
    const rid = actual?.id || idRol(f.nombre, rolesDe(E).map(r => r.id));
    if (ejecutar({ op: 'guardarRol', args: { id: rid, nombre: f.nombre, descripcion: f.descripcion, sistema: false, permisos: f.permisos } })) { closeModal(); toast(actual ? 'Rol guardado.' : `Rol «${f.nombre.trim()}» creado.`, 'ok'); }
  };
  const esAdmin = actual?.id === 'admin';
  return (<>
    <SheetHead title={fijo ? actual!.nombre : actual ? `Editar ${actual.nombre}` : 'Nuevo rol'} sub={fijo ? 'Rol de sistema: no se cambia. Duplícalo para hacer uno a tu medida.' : '«Modificar» incluye «Ver». Usuarios y roles son siempre solo del administrador.'} />
    <div className="p-5 flex flex-col gap-3">
      {!fijo && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo label="Nombre"><input autoFocus value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} className={`${INP} h-12`} placeholder="Jefe de obra" /></Campo>
        <Campo label="Descripción"><input value={f.descripcion} onChange={e => setF({ ...f, descripcion: e.target.value })} className={`${INP} h-12`} placeholder="Qué hace quien tiene este rol" /></Campo></div>}
      <div className="overflow-x-auto"><table className="w-full text-body-sm">
        <thead><tr className="text-left font-mono text-label-sm uppercase text-secondary"><th className="py-2">Apartado</th><th className="text-center w-20">Ver</th><th className="text-center w-24">Modificar</th></tr></thead>
        <tbody>{APARTADOS.map(a => { const bloqueado = fijo || !!a.soloAdmin, v = esAdmin || !!f.permisos[`${a.id}.ver`], m = esAdmin || !!f.permisos[`${a.id}.modificar`]; return (
          <tr key={a.id} className="border-t border-surface-container">
            <td className="py-2 pr-2"><div className="font-semibold">{a.nombre}</div><div className="text-secondary">{a.ver}{a.modificar && !a.soloAdmin ? ` · ${a.modificar}` : ''}</div></td>
            <td className="text-center"><input type="checkbox" checked={v} disabled={bloqueado} onChange={e => marca(`${a.id}.ver`, e.target.checked)} className="w-6 h-6 accent-primary" aria-label={`Ver ${a.nombre}`} /></td>
            <td className="text-center">{a.modificar ? <input type="checkbox" checked={m} disabled={bloqueado} onChange={e => marca(`${a.id}.modificar`, e.target.checked)} className="w-6 h-6 accent-primary" aria-label={`Modificar ${a.nombre}`} /> : <span className="text-secondary">—</span>}</td>
          </tr>); })}</tbody></table></div>
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>{fijo ? 'Cerrar' : 'Cancelar'}</button>
      {fijo ? <button onClick={() => { closeModal(); openModal(<FormRol base={actual} />, { ancha: true }); }} className={`${BTN_P} h-12 flex-1`}><Icon n="content_copy" className="ico-20" />Duplicar</button>
        : <button onClick={guardar} disabled={!f.nombre.trim()} className={`${BTN_P} h-12 flex-1`}><Icon n="save" className="ico-20" />Guardar</button>}</SheetFoot>
  </>);
}
