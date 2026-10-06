/* E-035 · Corregir un cierre a mano en todo (= corregir_cierre del servidor): datos (fase, tipo de línea, sección, equipo), partidas
   fijadas a mano (artículos y cantidades, o "quitada"), "volver a lo automático"; la diferencia con lo descontado se aplica con
   ajustes enlazados y queda una versión "Corrección manual por …". */
import type { CierreApp, Estado, LineaCierre } from '../data/tipos';
import { aplicarCorreccion, cierreEfectivo, normalizarCierre, type Cierre, type LineaTraducida } from '../../supabase/functions/_compartido/cierres';
import { estadoLinea, sincronizarCierreLocal, traducirEnApp } from './cierres';
import { applyMovement, contenidoDe, find, vehiculoDeEquipo } from './reglas';
import { redondea, uid } from './formato';

export type DatosCorregidos = Partial<Record<'fase' | 'tipoLinea' | 'seccion' | 'equipo', string>>;
export interface Correccion {
  /** ausente = sin cambio; null = volver a lo automático en los datos */
  datos?: DatosCorregidos | null;
  /** partida → artículos (lista vacía = quitar: no descuenta) */
  fijar?: Record<string, { sku: string; cantidad: number }[]>;
  /** volver a lo automático en estas partidas */
  soltar?: string[];
  /** la traducción automática con los datos ya corregidos */
  lineas?: LineaTraducida[];
}

/** Datos con los que se calcula el cierre: lo automático (wizard + prefactura) con la corrección encima */
export function efectivoCorregido(c: Pick<CierreApp, 'datosWizard' | 'datos' | 'holded'>, datos: DatosCorregidos | null | undefined): Cierre {
  const base = c.datosWizard || c.holded ? cierreEfectivo(c.datosWizard || null, c.holded || null) : normalizarCierre(c.datos || {});
  return aplicarCorreccion(base, datos || null);
}
/** La traducción automática que se envía junto con la corrección */
export const lineasCorregidas = (S: Estado, c: CierreApp, datos: DatosCorregidos | null | undefined) => traducirEnApp(S, efectivoCorregido(c, datos));

const consumoDe = (S: Estado, id: string) => { const m = new Map<string, number>(); for (const x of S.movements) if (x.cierre === id) m.set(x.sku, redondea((m.get(x.sku) || 0) - (x.unidades || 0))); return m; };
const limpio = (d?: DatosCorregidos | null) => { const o = Object.fromEntries(Object.entries(d || {}).filter(([k, v]) => ['fase', 'tipoLinea', 'seccion', 'equipo'].includes(k) && String(v ?? '').trim())); return Object.keys(o).length ? o as DatosCorregidos : null; };

export function corregirCierreLocal(S: Estado, id: string, p: Correccion, operario: string) {
  const ci = S.cierres.find(c => c.id === id); if (!ci) throw new Error('Cierre no encontrado');
  if (ci.estado === 'ignorado') throw new Error('Este cierre es anterior a la apertura del inventario: no descuenta');
  for (const arts of Object.values(p.fijar || {})) for (const a of arts) {
    const pr = find(S, a.sku); if (!pr || pr.borrador || pr.archivado) throw new Error(`Artículo no encontrado: ${a.sku}`);
    if (!(a.cantidad > 0)) throw new Error(`La cantidad de ${a.sku} debe ser mayor que 0`);
  }
  const antes = consumoDe(S, id), resumen: string[] = [];
  if ('datos' in p) {
    const corr = limpio(p.datos);
    ci.correccion = corr || undefined;
    resumen.push(corr ? `datos: ${Object.entries(corr).map(([k, v]) => `${k} = ${v}`).join(', ')}` : 'datos: vuelta a lo automático');
    const nombre = (corr?.equipo || String(ci.datosWizard?.equipo || '') || ci.equipoWizard).trim().toLowerCase();
    const eq = S.equipos.find(e => e.nombre.trim().toLowerCase() === nombre), veh = eq ? vehiculoDeEquipo(S, eq.id, ci.fecha) : undefined;
    if (veh && veh !== ci.vehiculo) {
      // todo lo que el cierre descontó vuelve a su furgoneta antes de pasarlo a la nueva
      const porVeh = new Map<string, number>();
      for (const m of S.movements) if (m.cierre === id && m.vehiculo) porVeh.set(`${m.vehiculo}|${m.sku}`, redondea((porVeh.get(`${m.vehiculo}|${m.sku}`) || 0) + (m.unidades || 0)));
      for (const [k, u] of porVeh) if (u) {
        const [v, sku] = k.split('|'), pr = find(S, sku)!, op = S.operator;
        S.operator = 'Corrección manual';
        try { applyMovement(S, { sku, type: 'ajuste', qty: -u / contenidoDe(pr), reason: 'Corrección de cierre', ref: `${ci.numInst} · cambio de vehículo`, equipo: ci.equipo, vehiculo: v, cierre: id }); } finally { S.operator = op; }
      }
      Object.assign(ci, { equipo: eq!.id, equipoWizard: corr?.equipo || ci.equipoWizard, vehiculo: veh });
    }
  }
  if (p.soltar?.length) { S.lineasCierre = S.lineasCierre.filter(l => l.cierre !== id || !l.manual || !p.soltar!.includes(l.campo)); resumen.push(`vuelta a lo automático: ${p.soltar.join(', ')}`); }
  for (const [campo, arts] of Object.entries(p.fijar || {})) {
    S.lineasCierre = S.lineasCierre.filter(l => l.cierre !== id || l.campo !== campo);
    if (!arts.length) {
      S.lineasCierre.push({ id: uid('L'), cierre: id, campo, formula: 'directa', valor: 0, cantidad: 0, estimada: false, estado: 'quitada', nota: `quitada a mano por ${operario}: no descuenta`, manual: true });
      resumen.push(`${campo}: quitada`);
    } else {
      for (const a of arts) S.lineasCierre.push({ id: uid('L'), cierre: id, campo, formula: 'directa', valor: a.cantidad, sku: a.sku.toUpperCase(), cantidad: a.cantidad, estimada: false, estado: 'resuelta', nota: `corregida a mano por ${operario}`, manual: true });
      resumen.push(`${campo}: ${arts.map(a => `${a.cantidad} × ${find(S, a.sku)?.name || a.sku}`).join(' + ')}`);
    }
  }
  if (p.lineas) {
    const fijadas = new Set(S.lineasCierre.filter(l => l.cierre === id && l.manual).map(l => l.campo));
    const cubiertos = new Set(p.lineas.filter(l => l.estado === 'aplicable' && l.sku && find(S, l.sku) && !find(S, l.sku)!.borrador).map(l => l.campo));
    S.lineasCierre = S.lineasCierre.filter(l => l.cierre !== id || l.manual || (l.estado === 'resuelta' && !cubiertos.has(l.campo)));
    const resueltos = new Set(S.lineasCierre.filter(l => l.cierre === id && l.estado === 'resuelta').map(l => l.campo));
    for (const l of p.lineas) {
      if (fijadas.has(l.campo) || (l.estado !== 'aplicable' && resueltos.has(l.campo))) continue;
      const sku = l.sku && find(S, l.sku) && !find(S, l.sku)!.borrador ? l.sku : undefined;
      S.lineasCierre.push({ id: uid('L'), cierre: id, campo: l.campo, formula: l.formula, valor: l.valor, sku, cantidad: l.cantidad, estimada: l.estimada, estado: estadoLinea(l, sku), nota: l.nota } as LineaCierre);
    }
  }
  sincronizarCierreLocal(S, id);
  const despues = consumoDe(S, id);
  const diferencia = [...new Set([...antes.keys(), ...despues.keys()])].sort().map(sku => ({ sku, unidades: redondea((despues.get(sku) || 0) - (antes.get(sku) || 0)) })).filter(d => d.unidades);
  ci.version++;
  (ci.versiones ||= []).push({ n: ci.version, origen: 'admin', documento: `Corrección manual por ${operario}${resumen.length ? `: ${resumen.join(' · ')}` : ''}`, recibido: Date.now(), diferencia });
  return diferencia;
}
