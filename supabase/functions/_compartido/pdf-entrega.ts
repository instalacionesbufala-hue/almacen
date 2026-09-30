// PDF firmado de una entrega (justificante), generado en el servidor. SOLO Deno (usa npm:jspdf): lo usan "notificar" (adjunto del correo)
// y "portal-tecnico" (PDF que ve el técnico). Sin fotos: el servidor no convierte WebP; el PDF de la app sí las lleva.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { jsPDF } from 'npm:jspdf@3.0.4';
import { construirJustificante, nombreArchivo, type ConstructorPdf } from './justificante.ts';

export function base64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
const cifra = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(n);

export async function pdfEntrega(db: SupabaseClient, id: string): Promise<{ numero: string; nombre: string; pdf: ArrayBuffer }> {
  const { data: e, error } = await db.from('entregas').select('*').eq('id', id).single();
  if (error || !e) throw new Error('Entrega no encontrada para el justificante');
  const { data: lineas } = await db.from('entrega_lineas').select('*').eq('entrega_id', id).order('n');
  const skus = (lineas || []).map(l => l.sku).filter(Boolean);
  const dots = (lineas || []).map(l => l.dotacion_id).filter(Boolean);
  const [{ data: prods }, { data: dotacion }, { data: t }, { data: eq }, { data: veh }] = await Promise.all([
    db.from('productos').select('sku, nombre, unidad').in('sku', skus.length ? skus : ['-']),
    db.from('dotacion').select('id, nombre, serie').in('id', dots.length ? dots : ['-']),
    db.from('tecnicos').select('nombre').eq('id', e.receptor_id).single(),
    db.from('equipos').select('nombre').eq('id', e.equipo_id).single(),
    db.from('vehiculos').select('matricula, modelo').eq('id', e.vehiculo_id || '-').maybeSingle(),
  ]);
  const p = new Map((prods || []).map(x => [x.sku, x]));
  const d = new Map((dotacion || []).map(x => [x.id, x]));
  const pdf = construirJustificante(jsPDF as unknown as ConstructorPdf, {
    numero: e.numero, fecha: new Date(e.firmada_ts || e.ts).getTime(),
    equipo: [eq?.nombre || e.equipo_id, veh ? `vehículo ${veh.matricula}${veh.modelo ? ' (' + veh.modelo + ')' : ''}` : ''].filter(Boolean).join(' · '), receptor: t?.nombre || e.receptor_id, dni: e.dni, obra: e.obra || undefined,
    lineas: (lineas || []).map(l => l.tipo === 'herramienta'
      ? { nombre: d.get(l.dotacion_id)?.nombre || l.dotacion_id, codigo: d.get(l.dotacion_id)?.serie || '', cantidad: '1 ud', series: [] }
      : { nombre: p.get(l.sku)?.nombre || l.sku, codigo: l.sku, cantidad: `${cifra(Number(l.cantidad))} ${p.get(l.sku)?.unidad || 'ud'}`, series: [] }),
    firma: e.firma, hash: e.hash, operador: e.operario,
  });
  return { numero: e.numero, nombre: nombreArchivo(e.numero), pdf };
}
