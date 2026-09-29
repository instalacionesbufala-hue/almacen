/* Cesta de entrega (almacén → furgoneta). Se guarda en el estado para no perderla al cambiar de pantalla. */
import { find, qtyTxt } from '../../domain/reglas';
import { redondea } from '../../domain/formato';
import { guardar, S } from '../../store/almacen';
import { toast } from '../../ui/toast';

export function disponible(sku: string) {
  const E = S(), p = find(E, sku); if (!p) return 0;
  const l = E.cesta.lineas.find(x => x.sku === sku);
  return redondea(p.stock - (l ? l.qty : 0));
}

export function anadirACesta(sku: string, n?: number) {
  const E = S(), p = find(E, sku); if (!p) return;
  const paso = n ?? (p.unit === 'm' ? 10 : 1);
  let l = E.cesta.lineas.find(x => x.sku === sku);
  if (!l) { l = { sku, qty: 0, serials: [] }; E.cesta.lineas.push(l); }
  if (p.serialized) {
    const libre = (p.serials || []).find(s => !l!.serials.includes(s));
    if (!libre) toast(`No quedan más ${p.name} en stock.`, 'warn');
    else { l.serials.push(libre); l.qty = l.serials.length; }
  } else if (l.qty + paso > p.stock) { toast(`Solo hay ${qtyTxt(p, p.stock)} de ${p.name}.`, 'warn'); l.qty = p.stock; }
  else l.qty = redondea(l.qty + paso);
  E.cesta.lineas = E.cesta.lineas.filter(x => x.qty > 0);
  guardar();
}

export function quitarDeCesta(sku: string) {
  const E = S(), p = find(E, sku), l = E.cesta.lineas.find(x => x.sku === sku); if (!p || !l) return;
  if (p.serialized) { l.serials.pop(); l.qty = l.serials.length; }
  else l.qty = Math.max(0, redondea(l.qty - (p.unit === 'm' ? 10 : 1)));
  E.cesta.lineas = E.cesta.lineas.filter(x => x.qty > 0);
  guardar();
}

export function fijarCantidad(sku: string, q: number) {
  const E = S(), p = find(E, sku), l = E.cesta.lineas.find(x => x.sku === sku); if (!p || !l || !(q >= 0)) return;
  l.qty = Math.min(q, p.stock);
  E.cesta.lineas = E.cesta.lineas.filter(x => x.qty > 0);
  guardar();
}

export function alternarSerie(sku: string, s: string) {
  const E = S(), l = E.cesta.lineas.find(x => x.sku === sku); if (!l) return;
  l.serials = l.serials.includes(s) ? l.serials.filter(x => x !== s) : [...l.serials, s];
  l.qty = l.serials.length;
  E.cesta.lineas = E.cesta.lineas.filter(x => x.qty > 0);
  guardar();
}
