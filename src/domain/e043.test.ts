/* E-043 · "Enviar al grupo de WhatsApp" del equipo con el PDF: el enlace de invitación validado, el grupo del equipo (o del socio
   en las retiradas), el texto preparado, móvil u ordenador, y la "copia enviada al grupo" en el historial. Datos inventados; reloj fijo. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fresh } from '../data/semilla';
import type { Entrega, Producto } from '../data/tipos';
import { aplicarLocal } from '../store/ops';
import { esMovil, grupoDe, grupoValido, normalizarEnlaceGrupo, textoGrupo } from './grupoWhatsapp';
import type { DatosRetirada } from './retiradas';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 8, 20, 0, 0)); });
afterEach(() => { vi.useRealTimers(); });

const ENLACE = 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOp', CARG = 'T-ESM-CARG';
function estado() {
  const S = fresh(); S.rol = 'admin';
  S.products.push({ sku: CARG, name: 'Cargador de Esmove', cat: 'cargadores', unit: 'ud', contenido: 1, stock: 5, min: 0, supplier: '', propiedad: 'custodia', propietario: 'ESMOVE' } as Producto);
  const e: Entrega = { id: 'ENT-2026-0017', numero: 'ENT-2026-0017', ts: Date.now() - 3600e3, equipo: 'F02', receptor: S.tecnicos.find(t => t.id !== 'T1')!.id, lineas: Array.from({ length: 7 }, (_, i) => ({ sku: `X${i}`, qty: 1, serials: [] })), firma: 'data:image/png;base64,AA', operator: 'Oficina', estado: 'firmada' } as Entrega;
  S.entregas.unshift(e);
  return { S, e };
}

describe('el enlace del grupo', () => {
  it('acepta la invitación con o sin https y con "?…" detrás; rechaza otra cosa; vacío = sin grupo', () => {
    expect(normalizarEnlaceGrupo('chat.whatsapp.com/AbCdEfGhIjKlMnOp?mode=r_c')).toBe(ENLACE);
    expect(normalizarEnlaceGrupo(` ${ENLACE} `)).toBe(ENLACE);
    expect(normalizarEnlaceGrupo('')).toBeNull();
    expect(() => normalizarEnlaceGrupo('https://wa.me/34600000000')).toThrow(/invitación de WhatsApp/);
    expect(grupoValido({ nombre: '', enlace: ENLACE }, 'Búfala 2')).toEqual({ nombre: 'Búfala 2', enlace: ENLACE });
    expect(grupoValido({ nombre: 'Algo', enlace: '' }, 'Búfala 2')).toBeUndefined();
  });

  it('se guarda en el equipo (y en el socio); si no viene, se conserva; null lo quita', () => {
    const { S } = estado(), eq = () => S.equipos.find(x => x.id === 'F02')!;
    aplicarLocal(S, { op: 'equipo', args: { id: 'F02', nombre: eq().nombre, estado: eq().estado, grupoWhatsapp: { nombre: '', enlace: 'chat.whatsapp.com/AbCdEfGhIjKlMnOp' } } });
    expect(eq().grupoWhatsapp).toEqual({ nombre: eq().nombre, enlace: ENLACE });
    aplicarLocal(S, { op: 'equipo', args: { id: 'F02', nombre: eq().nombre, estado: 'depot' } });
    expect(eq().grupoWhatsapp?.enlace).toBe(ENLACE);
    expect(() => aplicarLocal(S, { op: 'equipo', args: { id: 'F02', nombre: eq().nombre, estado: 'depot', grupoWhatsapp: { nombre: 'x', enlace: 'hola' } } })).toThrow(/invitación/);
    aplicarLocal(S, { op: 'equipo', args: { id: 'F02', nombre: eq().nombre, estado: 'depot', grupoWhatsapp: null } });
    expect(eq().grupoWhatsapp).toBeUndefined();
    const o = S.propietarios.find(x => x.id === 'ESMOVE')!;
    aplicarLocal(S, { op: 'propietario', args: { ...o, grupoWhatsapp: { nombre: 'Esmove · almacén', enlace: ENLACE } } });
    expect(S.propietarios.find(x => x.id === 'ESMOVE')!.grupoWhatsapp).toEqual({ nombre: 'Esmove · almacén', enlace: ENLACE });
  });
});

describe('enviar al grupo', () => {
  it('el grupo del equipo de la entrega y el texto preparado; sin grupo, nada (queda "Compartir PDF")', () => {
    const { S, e } = estado();
    expect(grupoDe(S, { tipo: 'entrega', doc: e })).toBeUndefined();
    S.equipos.find(x => x.id === 'F02')!.grupoWhatsapp = { nombre: 'Búfala 2', enlace: ENLACE };
    expect(grupoDe(S, { tipo: 'entrega', doc: e })).toEqual({ nombre: 'Búfala 2', enlace: ENLACE });
    const t = S.tecnicos.find(x => x.id === e.receptor)!.nombre, eq = S.equipos.find(x => x.id === 'F02')!.nombre;
    expect(textoGrupo(S, { tipo: 'entrega', doc: e })).toBe(`Entrega ENT-2026-0017 · ${eq} · 08/10/2026 · 7 líneas · recogido por ${t}`);
  });

  it('retirada: el grupo del socio, y la copia queda en su historial', () => {
    const { S } = estado();
    S.propietarios.find(x => x.id === 'ESMOVE')!.grupoWhatsapp = { nombre: 'Esmove', enlace: ENLACE };
    const datos: DatosRetirada = { socio: 'ESMOVE', recoge: 'Persona inventada', enNombre: 'socio', motivo: 'traslado', firma: 'data:image/png;base64,AA', lineas: [{ sku: CARG, cantidad: 1 }] } as DatosRetirada;
    aplicarLocal(S, { op: 'retirada', args: { id: 'R1', datos } });
    const r = S.retiradas!.find(x => x.id === 'R1')!;
    expect(grupoDe(S, { tipo: 'retirada', doc: r })?.nombre).toBe('Esmove');
    expect(textoGrupo(S, { tipo: 'retirada', doc: r })).toMatch(/^Retirada .* · Esmove · 08\/10\/2026 · 1 línea · recogido por Persona inventada$/);
    aplicarLocal(S, { op: 'copiaRetirada', args: { id: 'C1', retirada: 'R1', canal: 'grupo_whatsapp', destino: 'Esmove' } });
    expect(S.copias[0]).toMatchObject({ retirada: 'R1', canal: 'grupo_whatsapp', destino: 'Esmove' });
  });

  it('copia de la entrega al grupo en su historial (canal grupo_whatsapp); solo de firmadas; idempotente', () => {
    const { S, e } = estado();
    aplicarLocal(S, { op: 'copiaJustificante', args: { id: 'C1', tipo: 'entrega', ref: e.id, canal: 'grupo_whatsapp', destino: 'Búfala 2' } });
    aplicarLocal(S, { op: 'copiaJustificante', args: { id: 'C1', tipo: 'entrega', ref: e.id, canal: 'grupo_whatsapp', destino: 'Búfala 2' } });
    expect(S.copias.filter(c => c.entrega === e.id)).toEqual([expect.objectContaining({ canal: 'grupo_whatsapp', destino: 'Búfala 2' })]);
    e.estado = 'anulada';
    expect(() => aplicarLocal(S, { op: 'copiaJustificante', args: { id: 'C2', tipo: 'entrega', ref: e.id, canal: 'grupo_whatsapp', destino: '' } })).toThrow(/firmadas/);
  });

  it('móvil (menú de compartir) u ordenador (descargar y abrir el grupo)', () => {
    expect(esMovil({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }, false)).toBe(true);
    expect(esMovil({ userAgent: 'Mozilla/5.0 (Linux; Android 15)' }, false)).toBe(true);
    expect(esMovil({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }, true)).toBe(true);     // iPad que se presenta como Mac
    expect(esMovil({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0 }, false)).toBe(false);
  });
});
