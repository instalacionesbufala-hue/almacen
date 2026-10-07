/* E-038 · "Albarán de retirada de material en custodia" (RET-AAAA-NNNN) en PDF, con la misma presentación que el justificante de
   entrega (E-011): socio, quién recoge y en nombre de quién, líneas en formato y unidad base, motivo, referencia y firma. */
import type { Retirada } from '../../data/tipos';
import { find } from '../../domain/reglas';
import { cantTxt } from '../../domain/formatos';
import { num } from '../../domain/formato';
import { MOTIVO_RETIRADA, numRetirada } from '../../domain/retiradas';
import { fechaEs, nombreArchivo } from '../../../supabase/functions/_compartido/justificante';
import { S } from '../../store/almacen';
import { toast } from '../../ui/toast';

export async function retiradaPdf(r: Retirada): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const E = S(), socio = E.propietarios.find(o => o.id === r.socio)?.nombre || r.socio;
  const veh = r.vehiculo ? E.vehiculos.find(v => v.id === r.vehiculo) : undefined;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const X = 15, ANCHO = 180, FIN = 280;
  let y = 20;
  const salto = (alto: number) => { if (y + alto > FIN) { doc.addPage(); y = 20; } };
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(`Albarán de retirada de material en custodia ${numRetirada(r)}`, X, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(86, 94, 116);
  y += 7; doc.text(`Almacén Búfala · ${fechaEs(r.ts)}`, X, y);
  if (r.estado === 'anulada') { doc.setTextColor(186, 26, 26); y += 6; doc.text(`ANULADA${r.anuladaTs ? ` el ${fechaEs(r.anuladaTs)}` : ''}${r.anuladaPor ? ` por ${r.anuladaPor}` : ''}: ${r.anulacionMotivo || ''}`, X, y); }
  doc.setTextColor(11, 28, 48); y += 8;
  const datos = [
    `Material en custodia de: ${socio}`,
    `Sale de: ${veh ? `vehículo ${veh.matricula}` : 'almacén'}`,
    `Recoge y firma: ${r.recoge}${r.recogeDoc ? ` · ${r.recogeDoc}` : ''}`,
    `En nombre de: ${r.enNombre === 'tercero' ? `${r.tercero}${r.terceroEmpresa ? ` (${r.terceroEmpresa})` : ''}, tercero autorizado por ${socio}` : socio}`,
    `Motivo: ${MOTIVO_RETIRADA[r.motivo]}${r.motivoTexto ? ` · ${r.motivoTexto}` : ''}`,
    r.referencia ? `Referencia del socio: ${r.referencia}` : '', r.transporte ? `Matrícula o transportista: ${r.transporte}` : '', r.notas ? `Notas: ${r.notas}` : '',
  ].filter(Boolean);
  for (const t of datos) { const l = doc.splitTextToSize(t, ANCHO); doc.text(l, X, y); y += 6 * l.length; }
  y += 2; doc.setDrawColor(196, 197, 215); doc.line(X, y, X + ANCHO, y); y += 7;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('Material', X, y); doc.text('Cantidad', X + ANCHO, y, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); y += 6;
  for (const l of r.lineas) {
    const p = find(E, l.sku), texto = doc.splitTextToSize(l.nombre || p?.name || l.sku, 125), alto = Math.max(11, texto.length * 5 + 6);
    salto(alto);
    doc.text(texto, X, y);
    doc.setFont('helvetica', 'bold'); doc.text(p ? cantTxt(p, l.cantidad) : num(l.cantidad), X + ANCHO, y, { align: 'right' }); doc.setFont('helvetica', 'normal');
    doc.setFontSize(8); doc.setTextColor(86, 94, 116); doc.text(l.sku, X, y + texto.length * 5); doc.setFontSize(10); doc.setTextColor(11, 28, 48);
    y += alto;
  }
  salto(55);
  y += 4; doc.line(X, y, X + ANCHO, y); y += 6;
  if (r.firma?.startsWith('data:image/')) { try { doc.addImage(r.firma, r.firma.includes('image/jpeg') ? 'JPEG' : 'PNG', X, y, 70, 27); } catch { /* firma ilegible */ } }
  y += 32; doc.text(`Firma de ${r.recoge}`, X, y);
  y += 6; doc.setFontSize(8); doc.setTextColor(86, 94, 116);
  doc.text(doc.splitTextToSize(`Quien firma recoge el material descrito, propiedad de ${socio}${r.enNombre === 'tercero' ? `, en nombre de ${r.tercero}` : ''}, y lo ha comprobado completo. Búfala deja de custodiarlo desde este momento.`, ANCHO), X, y);
  y += 9; doc.text(`Registrado por ${r.operator}.`, X, y);
  y += 5; doc.setFontSize(7); doc.text(doc.splitTextToSize(`Huella SHA-256: ${r.hash || 'se calcula en el servidor al sincronizar'}`, ANCHO), X, y);
  return new Blob([doc.output('arraybuffer')], { type: 'application/pdf' });
}

export async function descargarRetirada(r: Retirada) {
  try {
    const b = await retiradaPdf(r), a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = nombreArchivo(numRetirada(r)); a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  } catch (err) { toast((err as Error).message, 'err'); }
}

export async function compartirRetirada(r: Retirada) {
  try {
    const b = await retiradaPdf(r), archivo = new File([b], nombreArchivo(numRetirada(r)), { type: 'application/pdf' });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.canShare?.({ files: [archivo] })) { await navigator.share({ files: [archivo], title: `Retirada ${numRetirada(r)}`, text: `Albarán de retirada ${numRetirada(r)}` }); return; }
    toast('Este navegador no permite compartir archivos: se descarga el PDF para enviarlo a mano.', 'warn', 6000);
    await descargarRetirada(r);
  } catch (err) { if ((err as Error).name !== 'AbortError') toast((err as Error).message, 'err'); }
}
