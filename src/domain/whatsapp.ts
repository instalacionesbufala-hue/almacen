/* E-014 · Copia de la entrega por WhatsApp: teléfono del técnico y enlace wa.me con un texto breve y el enlace a su portal */

/** Normaliza un teléfono a formato internacional (+34600123456). Sin prefijo se entiende España. Devuelve null si no es válido. */
export function normalizarTelefono(t: string | undefined | null): string | null {
  let s = String(t ?? '').trim();
  if (!s) return null;
  s = s.replace(/[\s().\-/]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+')) {
    if (/^34[6789]\d{8}$/.test(s)) s = '+' + s;              // 34 + móvil o fijo español sin "+"
    else if (/^[6789]\d{8}$/.test(s)) s = '+34' + s;          // número español de 9 cifras
    else return null;
  }
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
  if (s.startsWith('+34') && !/^\+34[6789]\d{8}$/.test(s)) return null;   // en España: 9 cifras que empiezan por 6, 7, 8 o 9
  return s;
}

/** Enlace de WhatsApp (abre el chat con el texto escrito). null si el teléfono no es válido. */
export function enlaceWhatsApp(telefono: string | undefined | null, texto: string): string | null {
  const t = normalizarTelefono(telefono);
  return t ? `https://wa.me/${t.slice(1)}?text=${encodeURIComponent(texto)}` : null;
}

export function textoWhatsApp(o: { nombre: string; numero: string; fecha: number; lineas: number; enlace: string }): string {
  const fecha = new Date(o.fecha).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const nombre = o.nombre.split(' ')[0];
  return `Hola ${nombre}: entrega de material ${o.numero} del ${fecha} (${o.lineas} ${o.lineas === 1 ? 'línea' : 'líneas'}), firmada. Aquí tienes las entregas de tu equipo, el PDF y lo que lleva vuestro vehículo: ${o.enlace}`;
}
