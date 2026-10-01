/* E-016 · Edición de fichas: fusionar dos artículos, cambiar el código (SKU) y reasignar una línea de un albarán ya ingresado.
   Misma regla que el servidor (fusionar_productos, cambiar_codigo_producto, reasignar_linea_albaran): nada se borra del historial;
   el stock pasa con ajustes enlazados (el segundo "corrige" al primero). */
import type { Estado, Producto } from '../data/tipos';
import { redondea, uid } from './formato';
import { applyMovement, contenidoDe, find, formatoEntero, reservado } from './reglas';
import { motivoSkuNoValido } from './codigos';
import { reactivarArchivado } from './archivo';

/** Cuánto sería el stock del almacén de A expresado en formatos de B (3 botes de 1000 = 3000 ud) */
export const convertirFormato = (a: Pick<Producto, 'contenido'>, b: Pick<Producto, 'contenido'>, q: number) => redondea(q * contenidoDe(a) / contenidoDe(b));

export function comprobarFusion(S: Estado, origen: string, destino: string): { a: Producto; b: Producto; qb: number } {
  const a = find(S, origen), b = find(S, destino);
  if (!a || !b) throw new Error('Artículo no encontrado');
  if (a.sku === b.sku) throw new Error('Elige dos artículos distintos');
  if (a.fusionadoEn || b.fusionadoEn) throw new Error('Uno de los artículos ya está archivado');
  if (b.borrador) throw new Error(`${b.sku} está en borrador: apruébalo antes de fusionar en él`);
  if (reservado(S, a.sku) > 0) throw new Error(`${a.name} tiene entregas preparadas: fírmalas o anúlalas antes de fusionar`);
  const qb = convertirFormato(a, b, a.stock);
  if (formatoEntero(b) && qb !== Math.trunc(qb)) throw new Error(`No cuadra el formato: ${a.stock} ${a.unit} de ${a.name} serían ${qb} ${b.unit} de ${b.name}`);
  return { a, b, qb };
}

export function fusionarLocal(S: Estado, origen: string, destino: string, motivo = '') {
  const { a, b, qb } = comprobarFusion(S, origen, destino);
  const ref = motivo.trim() || 'Fusión de artículos';
  if (a.stock !== 0) {
    const ida = uid('M');
    applyMovement(S, { id: ida, sku: a.sku, type: 'ajuste', qty: -a.stock, reason: `Fusión en ${b.sku}`, ref });
    applyMovement(S, { sku: b.sku, type: 'ajuste', qty: qb, reason: `Fusión desde ${a.sku}`, ref });
    S.movements[0].corrige = ida;
  }
  for (const x of S.aBordo.filter(y => y.sku === a.sku && y.unidades !== 0)) {
    const u = x.unidades, ida = uid('M');
    applyMovement(S, { id: ida, sku: a.sku, type: 'ajuste', qty: -u / contenidoDe(a), reason: `Fusión en ${b.sku}`, ref: 'Vehículo', vehiculo: x.vehiculo });
    applyMovement(S, { sku: b.sku, type: 'ajuste', qty: u / contenidoDe(b), reason: `Fusión desde ${a.sku}`, ref: 'Vehículo', vehiculo: x.vehiculo });
    S.movements[0].corrige = ida;
  }
  if (!b.foto && a.foto) Object.assign(b, { foto: a.foto, fotoMini: a.fotoMini, fotoOrigen: a.fotoOrigen });
  // E-023: el EAN del que se archiva pasa al destino (si no tiene) o queda como código alternativo: el archivado no lo bloquea
  if (a.ean) {
    const e = a.ean; a.ean = undefined;
    if (!b.ean) b.ean = e;
    else if (e !== b.ean && !(S.codigos || []).some(c => c.codigo.toUpperCase() === e.toUpperCase())) (S.codigos ||= []).push({ codigo: e, sku: b.sku, tipo: 'EAN', ts: Date.now(), operator: S.operator });
  }
  a.fusionadoEn = b.sku; a.archivado = true; a.archivadoTs = Date.now(); a.archivadoPor = S.operator;
  (S.codigos || []).forEach(c => { if (c.sku === a.sku) c.sku = b.sku; });   // E-020: los códigos alternativos pasan al destino
  S.products = S.products.filter(p => p.sku !== a.sku);
  S.archivados = [...(S.archivados || []), a];
  S.avisos.forEach(v => { if (v.sku === a.sku && v.estado !== 'cerrado') v.estado = 'cerrado'; });
  return { destino: b.sku, cantidad: qb };
}

/** Cambiar el código: ficha nueva con el código nuevo y la antigua fusionada en ella (el historial conserva el código con el que se hizo) */
export function cambiarCodigoLocal(S: Estado, sku: string, nuevo: string) {
  const a = find(S, sku), n = nuevo.trim().toUpperCase();
  if (!a) throw new Error('Artículo no encontrado');
  if (!n) throw new Error('Indica el código nuevo');
  const malo = motivoSkuNoValido(n); if (malo) throw new Error(malo);
  // E-020: si el código nuevo era un código alternativo de este mismo artículo, pasa a ser su SKU; si es de otro, no se puede
  const alt = (S.codigos || []).find(c => c.codigo.replace(/\s/g, '').toUpperCase() === n);
  if (alt && alt.sku !== a.sku) throw new Error(`El código ${n} ya está asociado a ${find(S, alt.sku)?.name || alt.sku} (${alt.sku}) como código alternativo`);
  if (alt) S.codigos = S.codigos.filter(c => c !== alt);
  const activo = S.products.find(p => p.sku === n);
  if (activo) throw new Error(`Ya existe un artículo activo con el código ${n}: ${activo.name} (ábrelo o fusiona en él)`);
  // E-022: si el código es de un archivado, ese artículo se reactiva con esta ficha (su historial sigue con su código)
  const reactivado = reactivarArchivado(S, n);
  if (reactivado) Object.assign(reactivado, { ...a, sku: n, stock: 0, fusionadoEn: undefined, archivado: undefined, archivadoTs: undefined, archivadoPor: undefined, foto: a.foto ?? reactivado.foto, fotoMini: a.fotoMini ?? reactivado.fotoMini });
  else S.products.push({ ...a, sku: n, stock: 0, fusionadoEn: undefined });
  a.ean = undefined;
  fusionarLocal(S, a.sku, n, `Cambio de código ${a.sku} → ${n}`);
}

/** Reasignar (parte de) una entrada de albarán de A a B: ajuste −A (corrige la entrada) y +B (enlazado) */
export function reasignarLineaLocal(S: Estado, id: string, movimiento: string, destino: string, cantidad?: number) {
  if (S.movements.some(m => m.id === id)) return;
  const m = S.movements.find(x => x.id === movimiento);
  if (!m || m.type !== 'entrada' || !m.albaran) throw new Error('Esa línea no es una entrada de un albarán');
  const a = find(S, m.sku)!, b = find(S, destino.toUpperCase());
  if (!b) throw new Error(`Artículo no encontrado: ${destino}`);
  if (b.sku === a.sku) throw new Error('Elige otro artículo');
  if (b.borrador || b.fusionadoEn) throw new Error(`${b.sku} no se puede usar (borrador o archivado)`);
  const ya = -S.movements.filter(x => x.corrige === m.id && x.sku === m.sku && x.reason === 'Reasignación de línea de albarán').reduce((s, x) => s + x.qty, 0);
  const q = cantidad ?? redondea(m.qty - ya);
  if (!(q > 0) || q > redondea(m.qty - ya)) throw new Error(`Cantidad no válida: de esa línea quedan ${redondea(m.qty - ya)} por reasignar`);
  if (a.stock < q) throw new Error(`De ${a.name} solo quedan ${a.stock} en el almacén: el resto ya ha salido`);
  const al = S.albaranes.find(x => x.id === m.albaran);
  applyMovement(S, { id, sku: a.sku, type: 'ajuste', qty: -q, reason: 'Reasignación de línea de albarán', ref: `Albarán ${al?.numero || ''} · pasa a ${b.sku}` });
  Object.assign(S.movements[0], { corrige: m.id, albaran: m.albaran });
  applyMovement(S, { sku: b.sku, type: 'ajuste', qty: q, reason: 'Reasignación de línea de albarán', ref: `Albarán ${al?.numero || ''} · venía como ${a.sku}` });
  Object.assign(S.movements[0], { corrige: id, albaran: m.albaran });
}

/** Lo que queda por reasignar de una entrada de albarán */
export const pendienteDeReasignar = (S: Pick<Estado, 'movements'>, movimiento: string) => {
  const m = S.movements.find(x => x.id === movimiento); if (!m) return 0;
  return redondea(m.qty + S.movements.filter(x => x.corrige === m.id && x.sku === m.sku && x.reason === 'Reasignación de línea de albarán').reduce((s, x) => s + x.qty, 0));
};

/** Diferencias campo a campo entre dos fichas (para la vista previa de "Actualizar fichas" y las propuestas) */
export const CAMPOS_FICHA: [keyof Producto, string][] = [['name', 'Nombre'], ['cat', 'Categoría'], ['supplier', 'Proveedor'], ['unit', 'Unidad'], ['contenido', 'Contenido'],
  ['supplierRef', 'Código del proveedor'], ['ean', 'EAN'], ['min', 'Mínimo'], ['propiedad', 'Propiedad'], ['modelo', 'Modelo'], ['talla', 'Talla'], ['notas', 'Notas']];
export function diferencias(antes: Partial<Producto>, despues: Partial<Producto>) {
  return CAMPOS_FICHA.filter(([k]) => despues[k] !== undefined && String(antes[k] ?? '') !== String(despues[k] ?? '')).map(([k, l]) => ({ campo: k, etiqueta: l, antes: antes[k], despues: despues[k] }));
}
