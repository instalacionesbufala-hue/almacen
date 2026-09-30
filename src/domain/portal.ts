/* E-014 · Portal del técnico en la app: enlace personal y, en modo demostración, los mismos datos calculados en este navegador */
import type { Estado } from '../data/tipos';
import type { DatosPortal } from '../../supabase/functions/_compartido/portal';
import { contenidoDe, find, vehiculoDeEquipo } from './reglas';

export { generarToken, hashToken, tokenDeRuta, type DatosPortal } from '../../supabase/functions/_compartido/portal';

/** Dirección del portal: la de la app con #/tecnico/<token> */
export const enlacePortal = (token: string, base: { origin: string; pathname: string } = location) => `${base.origin}${base.pathname}#/tecnico/${token}`;

/** Demostración (sin Supabase): lo que vería el técnico, con la misma forma que devuelve el servidor. Solo SUS entregas. */
export function datosPortalLocal(S: Estado, tecnicoId: string): DatosPortal | null {
  const t = S.tecnicos.find(x => x.id === tecnicoId); if (!t) return null;
  const eq = S.equipos.find(e => e.tecnicos.includes(t.id));
  const veh = eq ? vehiculoDeEquipo(S, eq.id) : undefined, v = S.vehiculos.find(x => x.id === veh);
  return {
    tecnico: { id: t.id, nombre: t.nombre, equipo: eq?.nombre ?? null },
    entregas: S.entregas.filter(e => e.receptor === t.id && (e.estado ?? 'firmada') === 'firmada').sort((a, b) => b.ts - a.ts).map(e => ({
      id: e.id, numero: e.numero || e.id, fecha: new Date(e.ts).toISOString(), obra: e.obra || '',
      equipo: S.equipos.find(q => q.id === e.equipo)?.nombre ?? null, vehiculo: S.vehiculos.find(x => x.id === e.vehiculo)?.matricula ?? null,
      lineas: e.lineas.map(l => { const p = find(S, l.sku), h = S.herramientas.find(x => x.id === l.dotacion);
        return { nombre: h?.nombre || p?.name || l.sku, codigo: h ? h.serie : l.sku, cantidad: h ? 1 : l.qty, unidad: h ? 'ud' : p?.unit || 'ud', foto: p?.fotoMini ?? null }; }),
    })),
    vehiculo: v ? { matricula: v.matricula, modelo: v.modelo } : null,
    a_bordo: v ? S.aBordo.filter(b => b.vehiculo === v.id && b.unidades !== 0).map(b => { const p = find(S, b.sku)!;
      return { sku: b.sku, nombre: p?.name || b.sku, unidad: p?.unit || 'ud', contenido: p ? contenidoDe(p) : 1, unidades: b.unidades, foto: p?.fotoMini ?? null }; })
      .sort((a, b) => a.nombre.localeCompare(b.nombre)) : [],
  };
}
