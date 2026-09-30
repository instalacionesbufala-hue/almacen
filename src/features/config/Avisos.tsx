/* E-006 · Configuración → Avisos: canales (app, correo, push, Telegram), modo de envío, prueba y registro de envíos */
import { useState } from 'react';
import type { ConfigAvisos, ModoEnvio } from '../../data/tipos';
import { hace } from '../../domain/formato';
import { ejecutar, useAlmacen } from '../../store/almacen';
import { modoNube } from '../../store/nube/cliente';
import { activarPush, procesarAhora, pushDisponible } from '../../store/nube/avisos';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, Campo, Icon, INP, LBL, Tag } from '../../ui/base';

const CANALES = [
  { k: 'correo', t: 'Correo (Resend)', icon: 'mail', ayuda: 'Capa gratuita de Resend: unos 100 correos al día.' },
  { k: 'push', t: 'Notificación en el móvil', icon: 'notifications_active', ayuda: 'En iPhone solo con la app añadida a la pantalla de inicio (iOS 16.4 o posterior).' },
  { k: 'telegram', t: 'Telegram (opcional)', icon: 'send', ayuda: 'Bot propio y gratis: pega su chat_id aquí y el token en los secretos de Supabase.' },
] as const;

export function ConfigAvisosPanel() {
  const E = useAlmacen();
  const [c, setC] = useState<ConfigAvisos>({ ...E.configAvisos });
  const [dest, setDest] = useState(E.configAvisos.correoDestinatarios.join(', '));
  const cambiado = JSON.stringify({ ...c, correoDestinatarios: dest.split(/[,;\s]+/).filter(Boolean) }) !== JSON.stringify(E.configAvisos);
  const guardar = () => { if (ejecutar({ op: 'configAvisos', args: { ...c, correoDestinatarios: dest.split(/[,;\s]+/).filter(Boolean) } })) toast('Configuración de avisos guardada.', 'ok'); };
  const probar = async (canal: 'correo' | 'push' | 'telegram') => {
    if (!modoNube) return toast('En la demostración no se envían mensajes reales: conecta Supabase (guía de puesta en marcha).', 'warn', 6000);
    // la prueba usa la configuración guardada: si hay cambios sin guardar, se guardan antes (van en orden en la cola)
    if (cambiado && !ejecutar({ op: 'configAvisos', args: { ...c, correoDestinatarios: dest.split(/[,;\s]+/).filter(Boolean) } })) return;
    if (!ejecutar({ op: 'envio', args: { canal, tipo: 'prueba', asunto: 'Prueba de avisos del almacén', cuerpo: 'Si lees esto, el canal funciona.', destinatarios: [] } })) return;
    const e = await procesarAhora(); e ? toast(e, 'err', 7000) : toast('Prueba enviada. Mira el registro de envíos.', 'ok');
  };
  const push = async () => { const e = await activarPush(); e ? toast(e, 'err', 8000) : toast('Este dispositivo recibirá las notificaciones.', 'ok'); };
  const ultimo = (canal: string) => E.envios.find(x => x.canal === canal && !x.entrega);
  const campoModo = (k: 'correo' | 'push' | 'telegram') => {
    const modo = c[`${k}Modo`] as ModoEnvio, hora = c[`${k}Hora`] as string;
    return <div className="flex flex-wrap items-center gap-2">
      <select value={modo} onChange={e => setC({ ...c, [`${k}Modo`]: e.target.value })} className={`${INP} !w-auto h-10`} aria-label="Modo de envío"><option value="inmediato">Inmediato para críticos</option><option value="resumen">Resumen diario</option></select>
      {modo === 'resumen' && <label className="flex items-center gap-1 text-body-sm">a las<input type="time" value={hora} onChange={e => setC({ ...c, [`${k}Hora`]: e.target.value })} className={`${INP} !w-28 h-10`} /></label>}
    </div>;
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl bg-tertiary-fixed/20 p-3 flex items-center gap-3"><Icon n="notifications" className="text-tertiary" /><div className="text-body-sm"><b>En la app</b> (siempre activo): campana con contador en tiempo real y bandeja de reposición.</div></div>
      {CANALES.map(ch => { const u = ultimo(ch.k), activo = c[`${ch.k}Activo`] as boolean; return (
        <div key={ch.k} className="rounded-xl bg-surface-container-low p-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={activo} onChange={e => setC({ ...c, [`${ch.k}Activo`]: e.target.checked })} className="w-5 h-5 accent-primary" /><Icon n={ch.icon} className="text-primary ico-20" />{ch.t}</label>
            {u ? <Tag c={u.estado === 'enviado' ? 'bg-tertiary-fixed/30 text-tertiary' : u.estado === 'error' ? 'bg-error-container text-error' : ''}>Último: {u.estado} · {hace(u.ts)}</Tag> : <Tag>Sin envíos</Tag>}
          </div>
          <p className="text-body-sm text-secondary">{ch.ayuda}</p>
          {activo && <>
            {campoModo(ch.k)}
            {ch.k === 'correo' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Campo label="Destinatarios (separados por comas)"><input value={dest} onChange={e => setDest(e.target.value)} className={`${INP} h-10`} placeholder="admin@empresa.es" /></Campo>
              <Campo label="Remitente (dominio verificado en Resend)"><input value={c.correoRemitente} onChange={e => setC({ ...c, correoRemitente: e.target.value })} className={`${INP} h-10`} placeholder="Almacén <avisos@tudominio.es>" /></Campo>
              <label className="sm:col-span-2 flex items-start gap-2 text-body-sm"><input type="checkbox" checked={!!c.copiaEntregasAdmin} onChange={e => setC({ ...c, copiaEntregasAdmin: e.target.checked })} className="w-5 h-5 mt-0.5 accent-primary" />
                <span>Copia de cada <b>entrega firmada</b> (PDF) también a estos destinatarios. Al técnico le llega siempre que tenga correo en su ficha.</span></label></div>}
            {ch.k === 'telegram' && <Campo label="chat_id"><input value={c.telegramChatId} onChange={e => setC({ ...c, telegramChatId: e.target.value })} className={`${INP} h-10 font-mono !w-56`} /></Campo>}
            {ch.k === 'push' && <button onClick={() => void push()} disabled={modoNube && !pushDisponible()} className={`${BTN_S} self-start h-10 px-3 text-body-sm`}><Icon n="phonelink_ring" className="ico-18" />Activar en este dispositivo</button>}
            {u?.estado === 'error' && u.error && <p className="text-body-sm text-error">{u.error}</p>}
            <button onClick={() => void probar(ch.k)} className="self-start text-primary text-body-sm font-semibold">Enviar prueba</button>
          </>}
        </div>); })}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Campo label="Reenviar si un pedido no llega en (días)"><input type="number" min={1} max={90} value={c.diasRecordatorio} onChange={e => setC({ ...c, diasRecordatorio: Number(e.target.value) || 7 })} className={`${INP} h-10`} /></Campo>
        <Campo label="Solicitudes a Esmove"><select value={c.custodiaEnvio} onChange={e => setC({ ...c, custodiaEnvio: e.target.value as ConfigAvisos['custodiaEnvio'] })} className={`${INP} h-10`}><option value="manual">Las reviso y envío con un toque</option><option value="automatico">Automático al correo de Esmove</option></select></Campo>
        <Campo label="Informe de custodia"><select value={c.informeCustodia} onChange={e => setC({ ...c, informeCustodia: e.target.value as ConfigAvisos['informeCustodia'] })} className={`${INP} h-10`}><option value="mensual">Mensual (día 1)</option><option value="semanal">Semanal (lunes)</option><option value="ninguno">Solo a mano</option></select></Campo>
      </div>
      <button onClick={guardar} disabled={!cambiado} className={`${BTN_P} h-12`}><Icon n="save" className="ico-20" />Guardar configuración de avisos</button>
      {E.envios.length > 0 && <div><div className={`${LBL} mb-1`}>Registro de envíos</div>{E.envios.slice(0, 8).map(e =>
        <div key={e.id} className="flex justify-between gap-2 text-body-sm py-1.5 border-b border-surface-container"><span className="truncate">{e.canal} · {e.asunto}</span><span className={`shrink-0 ${e.estado === 'error' ? 'text-error' : 'text-secondary'}`}>{e.estado} · {hace(e.ts)}</span></div>)}</div>}
    </div>
  );
}
