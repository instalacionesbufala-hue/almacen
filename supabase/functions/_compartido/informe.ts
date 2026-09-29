/* E-008 · Informe de material en custodia para el propietario (Esmove). SIN IMPORTES: no recibe precios y no los muestra.
   Módulo puro, compartido por la app (vista previa, CSV y PDF) y por la función de servidor "notificar" (envío por correo). */

export interface ProductoInforme { sku: string; nombre: string; unidad: string; stock: number; minimo: number; codigoModelo?: string; conSerie: boolean }
export interface MovimientoInforme { ts: number; sku: string; tipo: 'entrada' | 'salida' | 'merma' | 'ajuste'; cantidad: number; motivo: string; referencia: string; series: string[]; operario: string; equipo?: string }
export interface ActaInforme { numero: string; ts: number; representante: string; lineas: { sku: string; sistema: number; contado: number }[] }
export interface DatosInforme { propietario: string; desde: number; hasta: number; productos: ProductoInforme[]; movimientos: MovimientoInforme[]; actas: ActaInforme[]; generado?: number }

export interface Seccion { titulo: string; columnas: string[]; filas: (string | number)[][] }
export interface Informe { titulo: string; periodo: string; secciones: Seccion[]; resumen: { referencias: number; unidades: number; entradas: number; salidas: number; incidencias: number; bajoMinimo: number } }

const fecha = (ts: number) => new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Madrid' });
const fechaHora = (ts: number) => new Date(ts).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
const numero = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(n);

export function construirInforme(d: DatosInforme): Informe {
  const skus = new Set(d.productos.map(p => p.sku));
  const nombre = new Map(d.productos.map(p => [p.sku, p.nombre]));
  const mov = d.movimientos.filter(m => skus.has(m.sku) && m.ts >= d.desde && m.ts < d.hasta).sort((a, b) => a.ts - b.ts);
  const entradas = mov.filter(m => m.tipo === 'entrada');
  const salidas = mov.filter(m => m.tipo === 'salida');
  const incidencias = mov.filter(m => m.tipo === 'merma');
  const ajustes = mov.filter(m => m.tipo === 'ajuste');
  const actas = d.actas.filter(a => a.ts >= d.desde && a.ts < d.hasta);
  const fila = (m: MovimientoInforme, destino: string) => [fechaHora(m.ts), m.sku, nombre.get(m.sku) || m.sku, numero(Math.abs(m.cantidad)), m.series.join(' '), destino, m.operario];
  const secciones: Seccion[] = [
    { titulo: 'Stock actual por referencia', columnas: ['Referencia', 'Descripción', 'Código modelo', 'Stock', 'Unidad', 'Mínimo', 'Situación'],
      filas: [...d.productos].sort((a, b) => a.sku.localeCompare(b.sku)).map(p => [p.sku, p.nombre, p.codigoModelo || '', numero(p.stock), p.unidad, numero(p.minimo),
        p.stock < p.minimo ? 'Bajo mínimo: solicitar reposición' : p.stock < p.minimo * 1.5 ? 'Bajo' : 'Correcto']) },
    { titulo: 'Entradas recibidas', columnas: ['Fecha', 'Referencia', 'Descripción', 'Cantidad', 'N.º de serie', 'Albarán / origen', 'Registrado por'],
      filas: entradas.map(m => fila(m, m.referencia || m.motivo)) },
    { titulo: 'Salidas por obra', columnas: ['Fecha', 'Referencia', 'Descripción', 'Cantidad', 'N.º de serie', 'Obra o destino', 'Registrado por'],
      filas: salidas.map(m => fila(m, [m.referencia, m.equipo ? `equipo ${m.equipo}` : ''].filter(Boolean).join(' · ') || m.motivo)) },
    { titulo: 'Incidencias (daños y pérdidas)', columnas: ['Fecha', 'Referencia', 'Descripción', 'Cantidad', 'N.º de serie', 'Motivo', 'Registrado por'],
      filas: incidencias.map(m => fila(m, [m.motivo, m.referencia].filter(Boolean).join(' · '))) },
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
    resumen: { referencias: d.productos.length, unidades: d.productos.reduce((a, p) => a + p.stock, 0), entradas: entradas.length, salidas: salidas.length,
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
export function informeHtml(inf: Informe, empresa = 'Almacén Búfala'): string {
  const r = inf.resumen;
  return `<div style="font-family:system-ui,sans-serif;color:#0b1c30;font-size:13px">
<h2 style="margin:0 0 4px">${esc(inf.titulo)}</h2><p style="margin:0 0 12px;color:#565e74">${esc(empresa)} · Periodo ${esc(inf.periodo)}</p>
<p>${r.referencias} referencias · ${numero(r.unidades)} unidades en custodia · ${r.entradas} entradas · ${r.salidas} salidas · ${r.incidencias} incidencias · ${r.bajoMinimo} bajo mínimo.</p>
${inf.secciones.map(s => `<h3 style="margin:16px 0 6px">${esc(s.titulo)}</h3>${s.filas.length ? `<table style="border-collapse:collapse;width:100%"><thead><tr>${s.columnas.map(c => `<th style="text-align:left;border-bottom:1px solid #c4c5d7;padding:4px 6px;font-size:11px">${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.filas.map(f => `<tr>${f.map(v => `<td style="border-bottom:1px solid #e5eeff;padding:4px 6px">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p style="color:#565e74">Sin registros en el periodo.</p>'}`).join('')}
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
