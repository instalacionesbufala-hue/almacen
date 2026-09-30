/* E-014 · Teléfono del técnico y enlace wa.me */
import { describe, expect, it } from 'vitest';
import { enlaceWhatsApp, normalizarTelefono, textoWhatsApp } from './whatsapp';

describe('teléfono', () => {
  it('acepta los formatos habituales y los deja en +34…', () => {
    for (const t of ['600 123 456', '600123456', '+34 600 123 456', '+34600123456', '0034 600 12 34 56', '34600123456', '(+34) 600-123-456', '600.123.456'])
      expect(normalizarTelefono(t), t).toBe('+34600123456');
    expect(normalizarTelefono('912 345 678')).toBe('+34912345678');          // fijo
    expect(normalizarTelefono('722 11 22 33')).toBe('+34722112233');
    expect(normalizarTelefono('+44 7700 900123')).toBe('+447700900123');     // extranjero con prefijo
    expect(normalizarTelefono('0033 6 12 34 56 78')).toBe('+33612345678');
  });
  it('rechaza lo que no es un teléfono', () => {
    for (const t of ['', '   ', '123', '60012345', '6001234567', '+34 512 345 678', '+34 600 12', 'abc', '500123456'])
      expect(normalizarTelefono(t), t).toBeNull();
  });
});

describe('enlace de WhatsApp', () => {
  it('wa.me sin "+" y con el texto codificado', () => {
    const url = enlaceWhatsApp('600 123 456', 'Hola Luis: entrega ENT-2026-0001 → https://x.github.io/almacen/#/tecnico/abc');
    expect(url).toBe('https://wa.me/34600123456?text=' + encodeURIComponent('Hola Luis: entrega ENT-2026-0001 → https://x.github.io/almacen/#/tecnico/abc'));
    expect(new URL(url!).searchParams.get('text')).toMatch(/#\/tecnico\/abc$/);
    expect(enlaceWhatsApp('+44 7700 900123', 'x')).toBe('https://wa.me/447700900123?text=x');
    expect(enlaceWhatsApp('', 'x')).toBeNull();
    expect(enlaceWhatsApp('123', 'x')).toBeNull();
  });
  it('texto breve con número, fecha, líneas y el enlace al portal', () => {
    const t = textoWhatsApp({ nombre: 'Luis Martín', numero: 'ENT-2026-0007', fecha: new Date(2026, 8, 30, 10).getTime(), lineas: 3, enlace: 'https://app/#/tecnico/tok' });
    expect(t).toBe('Hola Luis: entrega de material ENT-2026-0007 del 30/09/2026 (3 líneas), firmada. Aquí tienes tus entregas, el PDF y lo que lleva tu vehículo: https://app/#/tecnico/tok');
    expect(t.length).toBeLessThan(250);
    expect(t).not.toMatch(/€/);
  });
});
