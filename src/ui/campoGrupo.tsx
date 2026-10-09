/* E-043 · Campos "Grupo de WhatsApp" (equipo o socio): nombre para mostrarlo y enlace de invitación, validado al escribir */
import { normalizarEnlaceGrupo } from '../domain/grupoWhatsapp';
import { Campo, INP } from './base';

export function CamposGrupo({ nombre, enlace, onChange, porDefecto, que = 'los justificantes de entregas y devoluciones' }:
  { nombre: string; enlace: string; onChange: (nombre: string, enlace: string) => void; porDefecto: string; que?: string }) {
  let error = '';
  try { normalizarEnlaceGrupo(enlace); } catch (err) { error = (err as Error).message; }
  return (<div className="sm:col-span-2 flex flex-col gap-2 rounded-xl ring-1 ring-surface-container p-3">
    <span className="font-semibold">Grupo de WhatsApp (opcional)</span>
    <span className="text-body-sm text-secondary">Para enviar al grupo {que} con el PDF. En WhatsApp: el grupo → Invitar mediante enlace → Copiar enlace.</span>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <Campo label="Nombre del grupo"><input value={nombre} onChange={e => onChange(e.target.value, enlace)} className={`${INP} h-12`} placeholder={porDefecto || 'Búfala 2'} /></Campo>
      <Campo label="Enlace de invitación"><input value={enlace} onChange={e => onChange(nombre, e.target.value)} inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
        className={`${INP} h-12 ${error ? 'ring-2 ring-error' : ''}`} placeholder="https://chat.whatsapp.com/…" aria-invalid={!!error} /></Campo>
    </div>
    {error && <span className="text-body-sm text-error">{error}</span>}
  </div>);
}
