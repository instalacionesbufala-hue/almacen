/* E-043 · "Enviar al grupo de WhatsApp" del equipo (o del socio) con el PDF del justificante.
   WhatsApp no deja abrir un grupo con texto o archivo puestos (wa.me solo abre chats con números; chat.whatsapp.com solo abre el
   grupo), y no se usan bots ni servicios no oficiales. Por eso: en el móvil se comparte el PDF con un texto preparado y el usuario
   elige el grupo; en el ordenador se descarga el PDF y se abre el grupo para arrastrarlo. */
import type { Devolucion, Entrega, Estado, GrupoWhatsapp, Retirada } from '../data/tipos';
import { nombreVehiculo, numEntrega } from './reglas';
import { numDevolucion } from './devoluciones';
import { numRetirada } from './retiradas';

/** "chat.whatsapp.com/AbC…", con o sin https y con "?…" detrás → https://chat.whatsapp.com/AbC…; vacío → null; otra cosa → error */
export function normalizarEnlaceGrupo(v: string): string | null {
  const t = (v || '').trim();
  if (!t) return null;
  const m = /^(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{10,40})(?:[/?#].*)?$/i.exec(t);
  if (!m) throw new Error('El enlace del grupo debe ser una invitación de WhatsApp (https://chat.whatsapp.com/…)');
  return `https://chat.whatsapp.com/${m[1]}`;
}
/** Lo que se guarda: sin enlace no hay grupo; sin nombre, el del equipo o socio */
export function grupoValido(g: { nombre?: string; enlace?: string } | null | undefined, porDefecto: string): GrupoWhatsapp | undefined {
  const enlace = normalizarEnlaceGrupo(g?.enlace || '');
  return enlace ? { nombre: (g?.nombre || '').trim() || porDefecto, enlace } : undefined;
}

export type TipoJustificante = 'entrega' | 'devolucion' | 'retirada';
export type Justificante = { tipo: 'entrega'; doc: Entrega } | { tipo: 'devolucion'; doc: Devolucion } | { tipo: 'retirada'; doc: Retirada };

const fecha = (ts: number) => new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
const lineas = (n: number) => `${n} línea${n === 1 ? '' : 's'}`;

/** El grupo al que va: el del equipo (entregas y devoluciones) o el del socio (retiradas) */
export function grupoDe(S: Pick<Estado, 'equipos' | 'propietarios'>, j: Justificante): GrupoWhatsapp | undefined {
  if (j.tipo === 'retirada') return S.propietarios.find(o => o.id === j.doc.socio)?.grupoWhatsapp;
  return S.equipos.find(e => e.id === j.doc.equipo)?.grupoWhatsapp;
}

/** "Entrega ENT-2026-0017 · Búfala 2 · 08/10/2026 · 7 líneas · recogido por …" */
export function textoGrupo(S: Estado, j: Justificante): string {
  if (j.tipo === 'entrega') {
    const e = j.doc, eq = S.equipos.find(x => x.id === e.equipo)?.nombre || e.equipo, t = S.tecnicos.find(x => x.id === e.receptor)?.nombre;
    return [`Entrega ${numEntrega(e)}`, eq, fecha(e.ts), lineas(e.lineas.length), t ? `recogido por ${t}` : '', e.obra ? `obra ${e.obra}` : ''].filter(Boolean).join(' · ');
  }
  if (j.tipo === 'devolucion') {
    const d = j.doc, eq = S.equipos.find(x => x.id === d.equipo)?.nombre || nombreVehiculo(S, d.vehiculo), t = S.tecnicos.find(x => x.id === d.tecnico)?.nombre;
    return [`Devolución ${numDevolucion(d)}`, eq, fecha(d.ts), lineas(d.lineas.length), t ? `devuelto por ${t}` : '', `recibe ${d.operator}`].filter(Boolean).join(' · ');
  }
  const r = j.doc, socio = S.propietarios.find(o => o.id === r.socio)?.nombre || r.socio;
  return [`Retirada ${numRetirada(r)}`, socio, fecha(r.ts), lineas(r.lineas.length), `recogido por ${r.recoge}${r.enNombre === 'tercero' && r.tercero ? ` en nombre de ${r.tercero}` : ''}`].join(' · ');
}

/** ¿Móvil o tableta? (pantalla táctil sin ratón): ahí se comparte el archivo; en el ordenador, descargar y abrir el grupo */
export const esMovil = (nav: { userAgent: string; maxTouchPoints?: number } = navigator, gruesa = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) =>
  /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent) || (gruesa && (nav.maxTouchPoints || 0) > 1);
