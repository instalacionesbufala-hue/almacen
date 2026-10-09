/* E-043 · Botón "Enviar al grupo de <equipo>" en los justificantes (entregas ENT-, devoluciones DEV-, retiradas RET-).
   Móvil: menú de compartir con el PDF y un texto preparado (el usuario elige WhatsApp y el grupo). Si no puede compartir archivos,
   o en el ordenador: descarga el PDF, abre el grupo (WhatsApp Web o la aplicación) y copia el texto, con el aviso "Arrastra el PDF al chat".
   Sin grupo configurado, el botón es el "Compartir PDF" de siempre. Cada envío queda como "copia enviada al grupo". */
import type { CopiaEntrega } from '../../data/tipos';
import { esMovil, grupoDe, textoGrupo, type Justificante } from '../../domain/grupoWhatsapp';
import { fechaHora } from '../../domain/formato';
import { numEntrega } from '../../domain/reglas';
import { numDevolucion } from '../../domain/devoluciones';
import { numRetirada } from '../../domain/retiradas';
import { ejecutar, S, useAlmacen } from '../../store/almacen';
import { nuevoId } from '../../store/ops';
import { usePermisos } from '../../store/permisos';
import { toast } from '../../ui/toast';
import { BTN_P, Icon, LBL } from '../../ui/base';
import { nombreArchivo } from '../../../supabase/functions/_compartido/justificante';
import { justificantePdf } from './justificante';
import { devolucionPdf } from './devolucionPdf';
import { retiradaPdf } from '../custodia/retiradaPdf';

const numero = (j: Justificante) => j.tipo === 'entrega' ? numEntrega(j.doc) : j.tipo === 'devolucion' ? numDevolucion(j.doc) : numRetirada(j.doc);
const pdfDe = (j: Justificante) => j.tipo === 'entrega' ? justificantePdf(j.doc) : j.tipo === 'devolucion' ? devolucionPdf(j.doc) : retiradaPdf(j.doc);
const firmado = (j: Justificante) => (j.doc.estado ?? 'firmada') === 'firmada';

function descargar(b: Blob, archivo: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = archivo; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
async function copiarTexto(t: string) { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } }

/** Deja la copia en el historial del justificante (solo los firmados, y si el rol puede) */
function registrarCopia(j: Justificante, canal: 'compartir' | 'grupo_whatsapp', destino: string, puede: boolean) {
  if (!firmado(j) || !puede) return;
  if (j.tipo === 'retirada') ejecutar({ op: 'copiaRetirada', args: { id: nuevoId(), retirada: j.doc.id, canal, destino } });
  else ejecutar({ op: 'copiaJustificante', args: { id: nuevoId(), tipo: j.tipo, ref: j.doc.id, canal, destino } });
}

/** Envía el justificante al grupo de WhatsApp de su equipo (o socio). Devuelve si se envió (o se preparó para arrastrarlo). */
export async function enviarAlGrupo(j: Justificante, puede: boolean): Promise<boolean> {
  const E = S(), g = grupoDe(E, j); if (!g) return false;
  const texto = textoGrupo(E, j), archivo = nombreArchivo(numero(j));
  // en el ordenador el grupo se abre ya, con el clic (si se espera al PDF, el navegador lo bloquea como ventana emergente)
  const movil = esMovil();
  if (!movil) window.open(g.enlace, '_blank', 'noopener');
  try {
    const b = await pdfDe(j);
    if (movil) {
      const f = new File([b], archivo, { type: 'application/pdf' }), nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (nav.canShare?.({ files: [f] })) {
        await navigator.share({ files: [f], title: texto, text: texto });
        registrarCopia(j, 'grupo_whatsapp', g.nombre, puede);
        return true;
      }
      window.open(g.enlace, '_blank', 'noopener');
    }
    descargar(b, archivo);
    const copiado = await copiarTexto(texto);
    toast(`PDF descargado. Arrastra el PDF al chat de ${g.nombre}${copiado ? ' y pega el texto (ya está copiado)' : ''}.`, 'ok', 9000);
    registrarCopia(j, 'grupo_whatsapp', g.nombre, puede);
    return true;
  } catch (err) { if ((err as Error).name !== 'AbortError') toast((err as Error).message, 'err'); return false; }
}

/** El botón: "Enviar al grupo de Búfala 2" si el equipo (o socio) tiene grupo; si no, nada (queda el "Compartir PDF" de siempre) */
export function BotonGrupo({ j, className = `${BTN_P} h-12`, compacto = false }: { j: Justificante; className?: string; compacto?: boolean }) {
  const E = useAlmacen(), perm = usePermisos(), g = grupoDe(E, j);
  if (!g) return null;
  const puede = j.tipo === 'retirada' ? perm.mod('movimientos') : perm.mod('entregas');
  const txt = `Enviar al grupo de ${g.nombre}`;
  if (compacto) return <button onClick={() => void enviarAlGrupo(j, puede)} className="shrink-0 w-12 min-h-12 grid place-items-center rounded-lg text-emerald-700 hover:bg-emerald-50" aria-label={txt} title={txt}><Icon n="groups" /></button>;
  return <button onClick={() => void enviarAlGrupo(j, puede)} className={className}><Icon n="groups" className="ico-20" />{txt}</button>;
}

/** Texto de una copia en el historial */
export const etiquetaCopia = (c: Pick<CopiaEntrega, 'canal' | 'destino'>) =>
  `${c.canal === 'whatsapp' ? 'WhatsApp' : c.canal === 'grupo_whatsapp' ? 'Copia enviada al grupo' : c.canal === 'correo' ? 'Correo' : 'PDF compartido'}${c.destino ? ` · ${c.destino}` : ''}`;
export const iconoCopia = (c: Pick<CopiaEntrega, 'canal'>) => c.canal === 'whatsapp' ? 'chat' : c.canal === 'grupo_whatsapp' ? 'groups' : c.canal === 'correo' ? 'mail' : 'share';

/** Copias enviadas de una devolución o una retirada */
export function CopiasJustificante({ devolucion, retirada }: { devolucion?: string; retirada?: string }) {
  const E = useAlmacen();
  const filas = E.copias.filter(c => (devolucion && c.devolucion === devolucion) || (retirada && c.retirada === retirada));
  if (!filas.length) return null;
  return (<div><div className={`${LBL} mb-1`}>Copias enviadas</div>
    {filas.map(c => <div key={c.id} className="flex items-center gap-2 py-1.5 border-b border-surface-container text-body-sm"><Icon n={iconoCopia(c)} className="ico-18 text-secondary" />
      <span className="flex-1 min-w-0 truncate">{etiquetaCopia(c)}</span><span className="text-secondary whitespace-nowrap">{fechaHora(c.ts)} · {c.operator}</span></div>)}
  </div>);
}
