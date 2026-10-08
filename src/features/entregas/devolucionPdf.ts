/* E-041 · "Albarán de devolución" DEV-AAAA-NNNN en PDF, con la presentación del justificante de entrega: furgoneta, equipo, quién
   devuelve y quién recibe, líneas (en unidad base y formato) con su estado, motivo y firma. */
import type { Devolucion } from '../../data/tipos';
import { find, nombreVehiculo, qtyTxt } from '../../domain/reglas';
import { num } from '../../domain/formato';
import { MOTIVO_DEVOLUCION, numDevolucion } from '../../domain/devoluciones';
import { fechaEs, nombreArchivo } from '../../../supabase/functions/_compartido/justificante';
import { S } from '../../store/almacen';
import { toast } from '../../ui/toast';

export async function devolucionPdf(d: Devolucion): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const E = S(), eq = E.equipos.find(x => x.id === d.equipo), tec = E.tecnicos.find(t => t.id === d.tecnico);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const X = 15, ANCHO = 180, FIN = 280;
  let y = 20;
  const salto = (alto: number) => { if (y + alto > FIN) { doc.addPage(); y = 20; } };
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(`Albarán de devolución ${numDevolucion(d)}`, X, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(86, 94, 116);
  y += 7; doc.text(`Almacén Búfala · ${fechaEs(d.ts)}`, X, y);
  if (d.estado === 'anulada') { doc.setTextColor(186, 26, 26); y += 6; doc.text(`ANULADA${d.anuladaTs ? ` el ${fechaEs(d.anuladaTs)}` : ''}${d.anuladaPor ? ` por ${d.anuladaPor}` : ''}: ${d.anulacionMotivo || ''}`, X, y); }
  doc.setTextColor(11, 28, 48); y += 8;
  for (const t of [`Devuelve la furgoneta ${nombreVehiculo(E, d.vehiculo)}${eq ? ` (equipo ${eq.nombre})` : ''}`, `Devuelve y firma: ${tec?.nombre || 'técnico del equipo'}`,
    `Recibe en el almacén: ${d.operator}`, `Motivo: ${MOTIVO_DEVOLUCION[d.motivo]}${d.motivoTexto ? ` · ${d.motivoTexto}` : ''}`, d.obra ? `Obra: ${d.obra}` : '']) if (t) { doc.text(doc.splitTextToSize(t, ANCHO), X, y); y += 6; }
  y += 2; doc.setDrawColor(196, 197, 215); doc.line(X, y, X + ANCHO, y); y += 7;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('Material', X, y); doc.text('Estado', X + 120, y); doc.text('Cantidad', X + ANCHO, y, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); y += 6;
  for (const l of d.lineas) {
    const p = find(E, l.sku), texto = doc.splitTextToSize(l.nombre || p?.name || l.sku, 112), alto = Math.max(11, texto.length * 5 + (l.motivoDefecto ? 10 : 6));
    salto(alto);
    doc.text(texto, X, y);
    doc.text(l.estado === 'bien' ? 'Bien (al stock)' : 'Defectuoso', X + 120, y);
    doc.setFont('helvetica', 'bold'); doc.text(p ? qtyTxt(p, l.cantidad).split(' · ')[0] : num(l.unidades), X + ANCHO, y, { align: 'right' }); doc.setFont('helvetica', 'normal');
    doc.setFontSize(8); doc.setTextColor(86, 94, 116);
    doc.text([l.sku, ...(p && qtyTxt(p, l.cantidad).includes(' · ') ? [qtyTxt(p, l.cantidad).split(' · ')[1]] : [])].join(' · '), X, y + texto.length * 5);
    if (l.motivoDefecto) doc.text(`Defecto: ${l.motivoDefecto}`, X, y + texto.length * 5 + 4);
    doc.setFontSize(10); doc.setTextColor(11, 28, 48);
    y += alto;
  }
  salto(55);
  y += 4; doc.line(X, y, X + ANCHO, y); y += 6;
  if (d.firma?.startsWith('data:image/')) { try { doc.addImage(d.firma, d.firma.includes('image/jpeg') ? 'JPEG' : 'PNG', X, y, 70, 27); } catch { /* firma ilegible */ } }
  y += 32; doc.text(`Firma de ${tec?.nombre || 'quien devuelve'}`, X, y);
  y += 6; doc.setFontSize(8); doc.setTextColor(86, 94, 116);
  doc.text(doc.splitTextToSize(`El material marcado "Bien" vuelve al stock del almacén; el defectuoso queda registrado como merma. Recibido por ${d.operator}.`, ANCHO), X, y);
  y += 9; doc.setFontSize(7); doc.text(doc.splitTextToSize(`Huella SHA-256: ${d.hash || 'se calcula en el servidor al sincronizar'}`, ANCHO), X, y);
  return new Blob([doc.output('arraybuffer')], { type: 'application/pdf' });
}

export async function descargarDevolucion(d: Devolucion) {
  try { const b = await devolucionPdf(d), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nombreArchivo(numDevolucion(d)); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); }
  catch (err) { toast((err as Error).message, 'err'); }
}
export async function compartirDevolucion(d: Devolucion) {
  try {
    const b = await devolucionPdf(d), archivo = new File([b], nombreArchivo(numDevolucion(d)), { type: 'application/pdf' });
    const nav = navigator as Navigator & { canShare?: (x: { files: File[] }) => boolean };
    if (nav.canShare?.({ files: [archivo] })) { await navigator.share({ files: [archivo], title: `Devolución ${numDevolucion(d)}`, text: `Albarán de devolución ${numDevolucion(d)}` }); return; }
    toast('Este navegador no permite compartir archivos: se descarga el PDF para enviarlo a mano.', 'warn', 6000);
    await descargarDevolucion(d);
  } catch (err) { if ((err as Error).name !== 'AbortError') toast((err as Error).message, 'err'); }
}
