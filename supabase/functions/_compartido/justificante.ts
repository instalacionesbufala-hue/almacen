/* E-011 · Justificante de entrega en PDF. Módulo compartido por la app (descargar o compartir, con fotos)
   y por la función "notificar" (adjunto del correo al técnico). Recibe el constructor de jsPDF para no depender
   de cómo lo importa cada entorno (npm en la app, npm: en Deno). Sin precios: solo material, cantidades y firma. */

export interface LineaJustificante { nombre: string; codigo: string; cantidad: string; series: string[]; foto?: string | null }
export interface DatosJustificante {
  numero: string; fecha: number; empresa?: string;
  equipo: string; receptor: string; dni?: string; obra?: string;
  lineas: LineaJustificante[];
  firma?: string | null; hash?: string | null; operador?: string;
}

interface Doc {
  setFontSize(n: number): unknown; setFont(f: string, s?: string): unknown; setTextColor(r: number, g?: number, b?: number): unknown;
  text(t: string | string[], x: number, y: number, o?: { align?: string }): unknown; addImage(d: string, f: string, x: number, y: number, w: number, h: number): unknown;
  splitTextToSize(t: string, w: number): string[]; addPage(): unknown; line(x1: number, y1: number, x2: number, y2: number): unknown;
  setDrawColor(r: number, g?: number, b?: number): unknown; output(t: 'arraybuffer'): ArrayBuffer;
}
export type ConstructorPdf = new (o?: { unit?: string; format?: string }) => Doc;

export const fechaEs = (ts: number) => new Date(ts).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
export const nombreArchivo = (numero: string) => `${(numero || 'entrega').replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;

export function construirJustificante(J: ConstructorPdf, d: DatosJustificante): ArrayBuffer {
  const doc = new J({ unit: 'mm', format: 'a4' });
  const X = 15, ANCHO = 180, FIN = 280;
  let y = 20;
  const salto = (alto: number) => { if (y + alto > FIN) { doc.addPage(); y = 20; } };

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(`Albarán de entrega ${d.numero}`, X, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(86, 94, 116);
  y += 7; doc.text(`${d.empresa || 'Almacén Búfala'} · ${fechaEs(d.fecha)}`, X, y);
  doc.setTextColor(11, 28, 48);
  y += 8;
  for (const t of [`Equipo: ${d.equipo}`, `Recibe: ${d.receptor}${d.dni ? ` · DNI ${d.dni}` : ''}`, d.obra ? `Obra: ${d.obra}` : '']) if (t) { doc.text(t, X, y); y += 6; }
  y += 2; doc.setDrawColor(196, 197, 215); doc.line(X, y, X + ANCHO, y); y += 7;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('Material', X + 14, y); doc.text('Cantidad', X + ANCHO, y, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); y += 6;
  for (const l of d.lineas) {
    const texto = doc.splitTextToSize(l.nombre, 130);
    const extra = [l.codigo, l.series.length ? `S/N ${l.series.join(', ')}` : ''].filter(Boolean).join(' · ');
    const alto = Math.max(12, texto.length * 5 + (extra ? 5 : 0) + 2);
    salto(alto);
    if (l.foto) { try { doc.addImage(l.foto, 'JPEG', X, y - 4, 11, 11); } catch { /* imagen no válida: se omite */ } }
    doc.text(texto, X + 14, y);
    doc.setFont('helvetica', 'bold'); doc.text(l.cantidad, X + ANCHO, y, { align: 'right' }); doc.setFont('helvetica', 'normal');
    if (extra) { doc.setFontSize(8); doc.setTextColor(86, 94, 116); doc.text(doc.splitTextToSize(extra, 150), X + 14, y + texto.length * 5); doc.setFontSize(10); doc.setTextColor(11, 28, 48); }
    y += alto;
  }

  salto(55);
  y += 4; doc.line(X, y, X + ANCHO, y); y += 6;
  if (d.firma?.startsWith('data:image/')) { try { doc.addImage(d.firma, d.firma.includes('image/jpeg') ? 'JPEG' : 'PNG', X, y, 70, 27); } catch { /* firma ilegible */ } }
  y += 32; doc.text(`Firma de ${d.receptor}`, X, y);
  y += 6; doc.setFontSize(8); doc.setTextColor(86, 94, 116);
  doc.text('Aceptación de la entrega por el receptor: comprueba el material y firma su recepción.', X, y);
  if (d.operador) { y += 4; doc.text(`Registrado por ${d.operador}.`, X, y); }
  y += 5; doc.setFontSize(7); doc.text(doc.splitTextToSize(`Huella SHA-256: ${d.hash || 'se calcula en el servidor al sincronizar'}`, ANCHO), X, y);
  return doc.output('arraybuffer');
}
