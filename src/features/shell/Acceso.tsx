/* Acceso con usuario y contraseña (solo en modo nube). Nadie se registra por su cuenta: el administrador da de alta a los usuarios. */
import { useState } from 'react';
import { MARCA } from '../../data/catalogo';
import { entrar, sesion } from '../../store/nube/sync';
import { BTN_P, Campo, Icon, INP } from '../../ui/base';

export default function Acceso() {
  const s = sesion.use();
  const [email, setEmail] = useState(''), [clave, setClave] = useState(''), [error, setError] = useState(s.error || ''), [enviando, setEnviando] = useState(false);
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault(); if (!email || !clave) return setError('Escribe tu correo y tu contraseña.');
    setEnviando(true); setError('');
    const r = await entrar(email, clave);
    setEnviando(false); if (r) setError(r);
  };
  if (s.estado === 'cargando') return <div className="min-h-screen grid place-items-center text-secondary"><div className="flex flex-col items-center gap-3"><Icon n="progress_activity" className="ico-40 girar text-primary" />Conectando…</div></div>;
  return (
    <div className="min-h-screen grid place-items-center p-4 bg-surface">
      <form onSubmit={enviar} className="w-full max-w-sm bg-surface-container-lowest rounded-2xl shadow-sm p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3"><span className="w-11 h-11 rounded-xl bg-primary-container text-white grid place-items-center"><Icon n="bolt" className="ico-fill" /></span>
          <div><div className="text-headline-md font-semibold">{MARCA.nombre}</div><div className="font-mono text-label-sm uppercase tracking-wider text-secondary">{MARCA.sub}</div></div></div>
        <p className="text-body-sm text-secondary">Entra con el usuario que te ha dado el administrador. Cada movimiento quedará registrado a tu nombre.</p>
        <Campo label="Correo"><input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} className={`${INP} h-12`} autoFocus /></Campo>
        <Campo label="Contraseña"><input type="password" autoComplete="current-password" value={clave} onChange={e => setClave(e.target.value)} className={`${INP} h-12`} /></Campo>
        {error && <p role="alert" className="text-body-sm text-error bg-error-container/50 rounded-lg p-3">{error}</p>}
        <button disabled={enviando} className={`${BTN_P} h-14 text-body-lg`}><Icon n={enviando ? 'progress_activity' : 'login'} className={enviando ? 'girar' : ''} />{enviando ? 'Entrando…' : 'Entrar'}</button>
        <p className="text-body-sm text-secondary">¿Has olvidado la contraseña? Pídele al administrador que te la cambie.</p>
      </form>
    </div>
  );
}
