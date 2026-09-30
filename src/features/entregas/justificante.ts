/* E-011 · Justificante de entrega en PDF desde la app: el mismo documento que recibe el técnico por correo
   (supabase/functions/_compartido/justificante.ts), aquí con la miniatura de cada artículo. Se genera sin conexión. */
import type { Entrega } from '../../data/tipos';
import { find, numEntrega, qtyTxt } from '../../domain/reglas';
import { num } from '../../domain/formato';
import { fotoDe, fotoDeHerramienta } from '../../domain/fotos';
import { construirJustificante, nombreArchivo, type ConstructorPdf } from '../../../supabase/functions/_compartido/justificante';
import { S } from '../../store/almacen';
import { urlFoto } from '../fotos/servicio';
import { aJpegDataUrl } from '../fotos/imagen';
import { toast } from '../../ui/toast';

export async function justificantePdf(e: Entrega): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const E = S(), eq = E.equipos.find(q => q.id === e.equipo), t = E.tecnicos.find(x => x.id === e.receptor);
  const lineas = await Promise.all(e.lineas.map(async l => {
    const p = find(E, l.sku), h = E.herramientas.find(x => x.id === l.dotacion);
    const f = h ? fotoDeHerramienta(E, h) : fotoDe(E, p);
    const foto = f ? await urlFoto(f.mini).then(u => (u ? aJpegDataUrl(u) : null)) : null;
    return h ? { nombre: h.nombre, codigo: h.serie, cantidad: '1 ud', series: [], foto }
      : { nombre: p?.name || l.sku, codigo: l.sku, cantidad: p ? qtyTxt(p, l.qty) : num(l.qty), series: l.serials, foto };
  }));
  const pdf = construirJustificante(jsPDF as unknown as ConstructorPdf, {
    numero: numEntrega(e), fecha: e.ts, equipo: eq ? `${eq.nombre} · ${eq.flota} (${eq.matricula})` : e.equipo,
    receptor: t?.nombre || e.receptor, dni: e.dni || t?.dni, obra: e.obra, lineas, firma: e.firma, hash: e.hash, operador: e.operator,
  });
  return new Blob([pdf], { type: 'application/pdf' });
}

export async function descargarJustificante(e: Entrega) {
  try {
    const b = await justificantePdf(e), a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = nombreArchivo(numEntrega(e)); a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  } catch (err) { toast((err as Error).message, 'err'); }
}

/** Compartir nativo del móvil (WhatsApp, correo…). Si el navegador no puede compartir archivos, se descarga. */
export async function compartirJustificante(e: Entrega) {
  try {
    const b = await justificantePdf(e), archivo = new File([b], nombreArchivo(numEntrega(e)), { type: 'application/pdf' });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.canShare?.({ files: [archivo] })) {
      await navigator.share({ files: [archivo], title: `Entrega de material ${numEntrega(e)}`, text: `Justificante de la entrega ${numEntrega(e)}` });
      return;
    }
    toast('Este navegador no permite compartir archivos: se descarga el PDF para enviarlo a mano.', 'warn', 6000);
    await descargarJustificante(e);
  } catch (err) { if ((err as Error).name !== 'AbortError') toast((err as Error).message, 'err'); }
}
