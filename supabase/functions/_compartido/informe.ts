/* E-008 · Informe de material en custodia para el propietario (Esmove). SIN IMPORTES: no recibe precios y no los muestra.
   Módulo puro, compartido por la app (vista previa, CSV y PDF) y por la función de servidor "notificar" (envío por correo). */

/** E-013: stock = en el almacén; enVehiculos = a bordo de los vehículos de los equipos. Sin n.º de serie. */
export interface ProductoInforme { sku: string; nombre: string; unidad: string; stock: number; enVehiculos?: number; minimo: number; codigoModelo?: string; conSerie?: boolean }
export interface MovimientoInforme { ts: number; sku: string; tipo: 'entrada' | 'salida' | 'merma' | 'ajuste' | 'traspaso' | 'devolucion' | 'consumo'; cantidad: number; motivo: string; referencia: string; series: string[]; operario: string; equipo?: string; vehiculo?: string }
export interface ActaInforme { numero: string; ts: number; representante: string; lineas: { sku: string; sistema: number; contado: number }[] }
/** E-026: cargadores instalados que no salieron del almacén gestionado (antes del 05/10): constancia para el socio, sin mover el stock */
export interface InstaladoSinGestion { ts: number; sku: string; cantidad: number; referencia: string; equipo?: string }
export interface DatosInforme { propietario: string; desde: number; hasta: number; productos: ProductoInforme[]; movimientos: MovimientoInforme[]; actas: ActaInforme[]; instaladosSinGestion?: InstaladoSinGestion[]; generado?: number }

export interface Seccion { titulo: string; columnas: string[]; filas: (string | number)[][] }
export interface Informe { titulo: string; periodo: string; secciones: Seccion[]; resumen: { referencias: number; unidades: number; entradas: number; salidas: number; incidencias: number; bajoMinimo: number } }

const fecha = (ts: number) => new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Madrid' });
const fechaHora = (ts: number) => new Date(ts).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
const numero = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(n);

export function construirInforme(d: DatosInforme): Informe {
  const skus = new Set(d.productos.map(p => p.sku));
  const nombre = new Map(d.productos.map(p => [p.sku, p.nombre]));
  const enPeriodo = d.movimientos.filter(m => skus.has(m.sku) && m.ts >= d.desde && m.ts < d.hasta).sort((a, b) => a.ts - b.ts);
  // E-038: lo que retiró el socio (o un tercero en su nombre) y sus anulaciones, en su propia sección
  const esRetirada = (m: MovimientoInforme) => m.motivo === 'Retirada por el socio' || (m.motivo || '').startsWith('Anulación de retirada');
  const retiradas = enPeriodo.filter(esRetirada), mov = enPeriodo.filter(m => !esRetirada(m));
  const entradas = mov.filter(m => m.tipo === 'entrada');
  // instalado en obra: salidas del almacén y consumos desde el vehículo (cierres, E-012)
  const salidas = mov.filter(m => m.tipo === 'salida' || m.tipo === 'consumo');
  const traspasos = mov.filter(m => m.tipo === 'traspaso' || m.tipo === 'devolucion');
  const incidencias = mov.filter(m => m.tipo === 'merma');
  const ajustes = mov.filter(m => m.tipo === 'ajuste');
  const actas = d.actas.filter(a => a.ts >= d.desde && a.ts < d.hasta);
  const sinGestion = (d.instaladosSinGestion || []).filter(x => skus.has(x.sku) && x.ts >= d.desde && x.ts < d.hasta).sort((a, b) => a.ts - b.ts);
  const fila = (m: MovimientoInforme, destino: string) => [fechaHora(m.ts), m.sku, nombre.get(m.sku) || m.sku, numero(Math.abs(m.cantidad)), destino, m.operario];
  const secciones: Seccion[] = [
    { titulo: 'Stock actual por referencia', columnas: ['Referencia', 'Descripción', 'Código modelo', 'En almacén', 'En vehículos', 'Unidad', 'Mínimo', 'Situación'],
      filas: [...d.productos].sort((a, b) => a.sku.localeCompare(b.sku)).map(p => [p.sku, p.nombre, p.codigoModelo || '', numero(p.stock), numero(p.enVehiculos || 0), p.unidad, numero(p.minimo),
        p.stock < p.minimo ? 'Bajo mínimo: solicitar reposición' : p.stock < p.minimo * 1.5 ? 'Bajo' : 'Correcto']) },
    { titulo: 'Entradas recibidas', columnas: ['Fecha', 'Referencia', 'Descripción', 'Cantidad', 'Albarán / origen', 'Registrado por'],
      filas: entradas.map(m => fila(m, m.referencia || m.motivo)) },
    { titulo: 'Instalado en obra', columnas: ['Fecha', 'Referencia', 'Descripción', 'Cantidad', 'Obra o destino', 'Registrado por'],
      filas: salidas.map(m => fila(m, [m.referencia, m.vehiculo ? `vehículo ${m.vehiculo}` : ''].filter(Boolean).join(' · ') || m.motivo)) },
    ...(sinGestion.length ? [{ titulo: 'Instalado (antes de la gestión del almacén)', columnas: ['Fecha', 'Referencia', 'Descripción', 'Cantidad', 'Obra', 'Equipo'],
      filas: sinGestion.map(x => [fechaHora(x.ts), x.sku, nombre.get(x.sku) || x.sku, numero(x.cantidad), x.referencia, x.equipo || '']) }] : []),
    ...(retiradas.length ? [{ titulo: 'Retirado por el socio', columnas: ['Fecha', 'Referencia', 'Descripción', 'Cantidad', 'Albarán de retirada', 'Desde'],
      filas: retiradas.map(m => [fechaHora(m.ts), m.sku, nombre.get(m.sku) || m.sku, (m.motivo === 'Retirada por el socio' ? '−' : '+') + numero(Math.abs(m.cantidad)),
        m.motivo === 'Retirada por el socio' ? m.referencia : `${m.motivo} (${m.referencia})`, m.vehiculo ? `vehículo ${m.vehiculo}` : 'almacén']) }] : []),
    { titulo: 'Incidencias (daños y pérdidas)', columnas: ['Fecha', 'Referencia', 'Descripción', 'Cantidad', 'Motivo', 'Registrado por'],
      filas: incidencias.map(m => fila(m, [m.motivo, m.referencia].filter(Boolean).join(' · '))) },
    { titulo: 'Entregado a equipos y devuelto', columnas: ['Fecha', 'Referencia', 'Descripción', 'Cantidad', 'Movimiento', 'Registrado por'],
      filas: traspasos.map(m => fila(m, `${m.tipo === 'traspaso' ? 'Al vehículo' : 'Devuelto al almacén desde'} ${m.vehiculo || ''}${m.referencia ? ' · ' + m.referencia : ''}`)) },
    { titulo: 'Diferencias de recuento', columnas: ['Fecha', 'Referencia', 'Descripción', 'Diferencia', 'Origen', 'Detalle', 'Registrado por'],
      filas: [
        ...ajustes.map(m => [fechaHora(m.ts), m.sku, nombre.get(m.sku) || m.sku, (m.cantidad > 0 ? '+' : '−') + numero(Math.abs(m.cantidad)), 'Ajuste', m.referencia || m.motivo, m.operario]),
        ...actas.flatMap(a => a.lineas.filter(l => l.contado !== l.sistema && skus.has(l.sku)).map(l =>
          [fechaHora(a.ts), l.sku, nombre.get(l.sku) || l.sku, (l.contado - l.sistema > 0 ? '+' : '−') + numero(Math.abs(l.contado - l.sistema)), `Acta ${a.numero}`, `Contado ${numero(l.contado)} / sistema ${numero(l.sistema)} · ${a.representante}`, ''])),
      ] },
  ];
  return {
    titulo: `Informe de material en custodia · ${d.propietario}`,
    periodo: `${fecha(d.desde)} – ${fecha(d.hasta - 1)}`,
    secciones,
    resumen: { referencias: d.productos.length, unidades: d.productos.reduce((a, p) => a + p.stock + (p.enVehiculos || 0), 0), entradas: entradas.length, salidas: salidas.length,
      incidencias: incidencias.length, bajoMinimo: d.productos.filter(p => p.stock < p.minimo).length },
  };
}

const celda = (v: unknown) => { const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function informeCsv(inf: Informe): string {
  const lineas: string[] = [celda(inf.titulo), celda(`Periodo: ${inf.periodo}`), ''];
  for (const s of inf.secciones) { lineas.push(celda(s.titulo), s.columnas.map(celda).join(';'), ...s.filas.map(f => f.map(celda).join(';')), ''); }
  return '﻿' + lineas.join('\r\n');
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** `fotos` (E-009): SKU → URL de la miniatura. Se añade una columna Foto en el stock por referencia (en el CSV no) */
export function informeHtml(inf: Informe, empresa = 'Almacén Búfala', fotos: Record<string, string> = {}): string {
  const r = inf.resumen;
  const conFoto = (i: number) => i === 0 && Object.keys(fotos).length > 0;
  const foto = (sku: unknown) => { const u = fotos[String(sku)]; return `<td style="border-bottom:1px solid #e5eeff;padding:2px 6px;width:52px">${u ? `<img src="${esc(u)}" alt="" width="48" height="48" style="object-fit:contain;display:block;border-radius:4px">` : ''}</td>`; };
  return `<div style="font-family:system-ui,sans-serif;color:#0b1c30;font-size:13px">
<h2 style="margin:0 0 4px">${esc(inf.titulo)}</h2><p style="margin:0 0 12px;color:#565e74">${esc(empresa)} · Periodo ${esc(inf.periodo)}</p>
<p>${r.referencias} referencias · ${numero(r.unidades)} unidades en custodia · ${r.entradas} entradas · ${r.salidas} salidas · ${r.incidencias} incidencias · ${r.bajoMinimo} bajo mínimo.</p>
${inf.secciones.map((s, i) => `<h3 style="margin:16px 0 6px">${esc(s.titulo)}</h3>${s.filas.length ? `<table style="border-collapse:collapse;width:100%"><thead><tr>${conFoto(i) ? '<th style="border-bottom:1px solid #c4c5d7;padding:4px 6px;font-size:11px">Foto</th>' : ''}${s.columnas.map(c => `<th style="text-align:left;border-bottom:1px solid #c4c5d7;padding:4px 6px;font-size:11px">${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.filas.map(f => `<tr>${conFoto(i) ? foto(f[0]) : ''}${f.map(v => `<td style="border-bottom:1px solid #e5eeff;padding:4px 6px">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p style="color:#565e74">Sin registros en el periodo.</p>'}`).join('')}
</div>`;
}

/** Periodo anterior completo (mes natural o semana de lunes a domingo) respecto a una fecha */
export function periodoAnterior(tipo: 'mensual' | 'semanal', ahora = new Date()): { desde: number; hasta: number } {
  if (tipo === 'mensual') {
    const hasta = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    return { desde: new Date(hasta.getFullYear(), hasta.getMonth() - 1, 1).getTime(), hasta: hasta.getTime() };
  }
  const d = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const lunes = new Date(d); lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return { desde: lunes.getTime() - 7 * 864e5, hasta: lunes.getTime() };
}
