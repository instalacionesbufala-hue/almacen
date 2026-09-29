/* CSV para Excel en español: separador ";" y coma decimal */

export function csvTexto(rows: (string | number | undefined | null)[][]): string {
  const cell = (v: unknown) => {
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n');
}

export function descargar(nombre: string, contenido: string, tipo: string) {
  const blob = new Blob([contenido], { type: tipo }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const descargarCsv = (nombre: string, rows: (string | number | undefined | null)[][]) =>
  descargar(nombre, csvTexto(rows), 'text/csv;charset=utf-8');
