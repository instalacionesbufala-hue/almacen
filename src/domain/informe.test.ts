/* E-008 · El informe para Esmove no contiene ningún importe */
import { describe, expect, it } from 'vitest';
import { fresh } from '../data/semilla';
import { applyMovement } from './reglas';
import { datosInformeCustodia } from './custodia';
import { construirInforme, informeCsv, informeHtml, periodoAnterior } from '../../supabase/functions/_compartido/informe';

describe('informe de custodia', () => {
  const S = fresh();
  // precio "trampa" en un artículo de custodia: aunque existiera, no debe salir
  S.products.find(p => p.sku === 'WBX-PULSAR-22')!.price = 889.55;
  applyMovement(S, { sku: 'ESM-CPVE-MONO', type: 'entrada', qty: 2, reason: 'Recepción en custodia', ref: 'Alb. Esmove 77' });
  applyMovement(S, { sku: 'WBX-PULSAR-22', type: 'salida', qty: 1, reason: 'Instalado en obra', ref: 'Garaje C/ Recogidas 12', serials: ['WBX-22-899281'] });
  applyMovement(S, { sku: 'ESM-CPVE-TRI', type: 'merma', qty: 1, reason: 'Rotura o daño', ref: 'Caída en la carga' });
  applyMovement(S, { sku: 'BF-FIX-SX8', type: 'salida', qty: 10, reason: 'Obra', ref: 'C/ Eros 10' }); // material propio: no entra
  const ahora = Date.now();
  const inf = construirInforme(datosInformeCustodia(S, 'ESMOVE', ahora - 864e5, ahora + 864e5));
  const csv = informeCsv(inf), html = informeHtml(inf);

  it('solo incluye material del propietario, con sus entradas, salidas por obra con S/N e incidencias', () => {
    const [stock, entradas, salidas, incidencias] = inf.secciones;
    expect(stock.filas.every(f => String(f[0]).match(/^(ESM-|WBX|BF-VE|CIR)/))).toBe(true);
    expect(entradas.filas.some(f => f[1] === 'ESM-CPVE-MONO' && f[5] === 'Alb. Esmove 77')).toBe(true);
    expect(salidas.filas.find(f => f[4] === 'WBX-22-899281')).toEqual(expect.arrayContaining(['WBX-PULSAR-22', 'WBX-22-899281', 'Garaje C/ Recogidas 12']));
    expect(incidencias.filas.some(f => f[1] === 'ESM-CPVE-TRI')).toBe(true);
    expect(csv).not.toMatch(/BF-FIX-SX8/);
  });
  it('no contiene ningún importe ni símbolo de moneda', () => {
    for (const texto of [csv, html, JSON.stringify(inf)]) {
      expect(texto).not.toMatch(/€|EUR|precio|coste|valor/i);
      expect(texto).not.toMatch(/889/);
    }
  });
  it('E-009: con fotos, el stock por referencia lleva una miniatura por artículo (el CSV no)', () => {
    const conFotos = informeHtml(inf, undefined, { 'ESM-CPVE-MONO': 'https://x.supabase.co/storage/v1/object/sign/fotos-articulos/productos/ESM-CPVE-MONO/a-mini.webp?token=t' });
    expect(conFotos).toMatch(/<th[^>]*>Foto<\/th>/);
    expect(conFotos).toMatch(/<img src="https:\/\/x\.supabase\.co[^"]*ESM-CPVE-MONO[^"]*"/);
    expect(conFotos.match(/<img /g)).toHaveLength(1);
    expect(conFotos).not.toMatch(/€|precio|coste|valor/i);
    expect(html).not.toMatch(/<img /);
    expect(informeCsv(inf)).not.toMatch(/Foto|supabase/);
  });
  it('el periodo por defecto es el mes natural anterior', () => {
    const p = periodoAnterior('mensual', new Date(2026, 9, 5));
    expect(new Date(p.desde).getMonth()).toBe(8);
    expect(new Date(p.hasta).getMonth()).toBe(9);
    const s = periodoAnterior('semanal', new Date(2026, 9, 1)); // jueves
    expect(new Date(s.desde).getDay()).toBe(1);
    expect((s.hasta - s.desde) / 864e5).toBe(7);
  });
});
