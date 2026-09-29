/* Gestión de usuarios (administrador, solo en modo nube): alta con contraseña, rol, activación y cambio de contraseña */
import { useState } from 'react';
import type { Rol } from '../../data/tipos';
import { ejecutar, useAlmacen } from '../../store/almacen';
import { supabase } from '../../store/nube/cliente';
import { recargar, sesion } from '../../store/nube/sync';
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

export function Usuarios() {
  const E = useAlmacen(), yo = sesion.use().perfil?.id;
  return (
    <div className="flex flex-col gap-2">
      {E.perfiles.map(u => (
        <div key={u.id} className={`flex flex-wrap items-center gap-3 rounded-xl p-3 ${u.activo ? 'bg-surface-container-low' : 'bg-surface-container-low opacity-60'}`}>
          <Avatar n={u.nombre} />
          <div className="flex-1 min-w-[140px]"><div className="font-semibold">{u.nombre}{u.id === yo ? ' (tú)' : ''}</div><div className="font-mono text-label-sm text-secondary">{u.email}</div></div>
          <Tag c={u.rol === 'admin' ? 'bg-primary-fixed text-primary' : 'bg-surface-container-high text-secondary'}>{u.rol === 'admin' ? 'Administrador' : 'Almacén'}</Tag>
          {!u.activo && <Tag c="bg-error-container text-error">Desactivado</Tag>}
          <button onClick={() => openModal(<EditarUsuario id={u.id} />)} className="text-primary text-body-sm font-semibold">Editar</button>
        </div>))}
      <button onClick={() => openModal(<NuevoUsuario />)} className={`${BTN_P} h-12`}><Icon n="person_add" className="ico-20" />Dar de alta un usuario</button>
    </div>
  );
}

function NuevoUsuario() {
  const [f, setF] = useState({ nombre: '', email: '', rol: 'almacen' as Rol, clave: '' }), [enviando, setEnviando] = useState(false);
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
      <Campo label="Rol"><select value={f.rol} onChange={e => setF({ ...f, rol: e.target.value as Rol })} className={`${INP} h-12`}><option value="almacen">Almacén (operativa diaria, sin precios)</option><option value="admin">Administrador (todo)</option></select></Campo>
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
      <Campo label="Rol"><select value={f.rol} onChange={e => setF({ ...f, rol: e.target.value as Rol })} className={`${INP} h-12`}><option value="almacen">Almacén</option><option value="admin">Administrador</option></select></Campo>
      <label className="flex items-center gap-3 bg-surface-container-low rounded-lg px-3 h-12"><input type="checkbox" checked={f.activo} onChange={e => setF({ ...f, activo: e.target.checked })} className="w-5 h-5 accent-primary" />Puede entrar en la app</label>
      <div className="flex gap-2 items-end"><Campo label="Nueva contraseña" className="flex-1"><input value={clave} onChange={e => setClave(e.target.value)} className={`${INP} h-12 font-mono`} autoComplete="new-password" /></Campo>
        <button onClick={cambiarClave} disabled={!clave} className={`${BTN_S} h-12 px-4`}>Cambiar</button></div>
    </div>
    <SheetFoot className="flex gap-2"><button onClick={closeModal} className={`${BTN_S} h-12 px-5`}>Cerrar</button><button onClick={() => void guardar()} className={`${BTN_P} h-12 flex-1`}><Icon n="save" className="ico-20" />Guardar</button></SheetFoot>
  </>);
}
