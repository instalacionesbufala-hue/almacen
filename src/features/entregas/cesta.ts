/* E-011 · Cesta de entrega en curso. Vive en el estado (se guarda en el dispositivo: si se cierra la app, se conserva).
   Las reglas están en src/domain/entregas.ts; aquí solo se guardan los cambios y se avisa. */
import type { Cesta } from '../../data/tipos';
import * as D from '../../domain/entregas';
import { guardar, S } from '../../store/almacen';
import { toast } from '../../ui/toast';

export const cesta = (): Cesta => { const E = S(); E.cesta.obra ??= ''; E.cesta.paso ??= 1; return E.cesta; };
const hecho = (r: D.Resultado, silencio = false) => { guardar(); if (r.aviso && !silencio) toast(r.aviso, r.ok ? 'ok' : 'warn'); return r; };

export const anadirACesta = (sku: string) => hecho(D.anadir(S(), cesta(), sku));
export const sumarUno = (sku: string) => hecho(D.sumar(S(), cesta(), sku));
export const quitarDeCesta = (sku: string) => { D.restar(S(), cesta(), sku); guardar(); };
export const fijarCantidad = (sku: string, q: number) => hecho(D.fijar(S(), cesta(), sku, q));
export const cambiarTalla = (sku: string, nuevo: string) => hecho(D.cambiarTalla(S(), cesta(), sku, nuevo));
/** Lectura del escáner seguido: devuelve el resultado para que la pantalla lo muestre en su registro */
export const escanearEnCesta = (raw: string) => hecho(D.escanear(S(), cesta(), raw), true);
export const disponible = (sku: string) => { const E = S(), p = E.products.find(x => x.sku === sku); return p ? D.disponibleEnCesta(E, cesta(), p) : 0; };

export function paraQuien(receptor: string) {
  const E = S(), c = cesta(), eq = E.equipos.find(e => e.tecnicos.includes(receptor));
  c.receptor = receptor; c.equipo = eq?.id || '';
  guardar();
}
export const irAPaso = (paso: 1 | 2 | 3) => { cesta().paso = paso; guardar(); };
export const fijarObra = (obra: string) => { cesta().obra = obra; guardar(); };
export function vaciarCesta() { const c = cesta(); c.lineas = []; c.obra = ''; c.paso = 1; guardar(); }
