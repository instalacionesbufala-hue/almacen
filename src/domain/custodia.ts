/* E-006 + E-008 · Reposición agrupada (por proveedor o por propietario) e informe de custodia desde el estado de la app */
import type { AvisoReposicion, Estado, Producto } from '../data/tipos';
import { UNIT } from '../data/catalogo';
import type { DatosInforme } from '../../supabase/functions/_compartido/informe';
import { esCustodia, find, nombreVehiculo, pedidoSugerido, stockTotal } from './reglas';
import { redondea } from './formato';
import { caducidad } from './herramientas';

export interface LineaReposicion { sku?: string; modelo?: string; nombre: string; codigo: string; unidad: string; stock: number; minimo: number; sugerida: number; estado: 'abierto' | 'pedido'; pedida?: number }
export interface GrupoReposicion { destino: 'proveedor' | 'propietario'; grupo: string; titulo: string; lineas: LineaReposicion[] }

/** Avisos abiertos. En la nube vienen del servidor; en modo demo se calculan con la misma regla (stock < mínimo). */
function avisosAbiertos(S: Estado): AvisoReposicion[] {
  if (S.avisos.length || S.perfiles.length) return S.avisos.filter(a => a.estado !== 'cerrado');
  const out: AvisoReposicion[] = S.products.filter(p => !p.borrador && p.stock < p.min).map(p => ({
    id: 'local:' + p.sku, sku: p.sku, destino: esCustodia(p) ? 'propietario' : 'proveedor',
    grupo: esCustodia(p) ? (p.propietario || '') : (p.proveedorHabitual || p.supplier || 'Sin proveedor'),
    estado: S.pedidos[p.sku] ? 'pedido' : 'abierto', creado: 0, cantidadPedida: S.pedidos[p.sku]?.qty,
  }));
  for (const m of S.minimosHerramienta) {
    const libres = S.herramientas.filter(h => h.clase === 'herramienta' && h.modelo === m.modelo && h.estado === 'operativa' && !h.equipo && !h.tecnico).length;
    if (libres < m.minimo) out.push({ id: 'local:h:' + m.modelo, modeloHerramienta: m.modelo, destino: 'proveedor', grupo: m.proveedor || 'Sin proveedor', estado: 'abierto', creado: 0 });
  }
  return out;
}

export function gruposReposicion(S: Estado): GrupoReposicion[] {
  const grupos = new Map<string, GrupoReposicion>();
  for (const a of avisosAbiertos(S)) {
    const key = `${a.destino}:${a.grupo}`;
    if (!grupos.has(key)) {
      const nombre = a.destino === 'propietario' ? (S.propietarios.find(o => o.id === a.grupo)?.nombre || a.grupo) : a.grupo;
      grupos.set(key, { destino: a.destino, grupo: a.grupo, titulo: a.destino === 'propietario' ? `Solicitud de reposición a ${nombre}` : `Pedido a ${nombre}`, lineas: [] });
    }
    const g = grupos.get(key)!;
    if (a.sku) {
      const p = find(S, a.sku); if (!p) continue;
      g.lineas.push({ sku: p.sku, nombre: p.name, codigo: p.supplierRef || p.ean || '', unidad: UNIT[p.unit], stock: p.stock, minimo: p.min, sugerida: pedidoSugerido(p), estado: a.estado === 'pedido' ? 'pedido' : 'abierto',
        pedida: a.cantidadPedida });
    } else if (a.modeloHerramienta) {
      const modelo = a.modeloHerramienta, m = S.minimosHerramienta.find(x => x.modelo === modelo);
      const libres = S.herramientas.filter(h => h.clase === 'herramienta' && h.modelo === modelo && h.estado === 'operativa' && !h.equipo && !h.tecnico).length;
      g.lineas.push({ modelo, nombre: `Herramienta de repuesto: ${modelo}`, codigo: '', unidad: 'ud', stock: libres, minimo: m?.minimo || 0, sugerida: Math.max(1, (m?.objetivo ?? m?.minimo ?? 1) - libres), estado: a.estado === 'pedido' ? 'pedido' : 'abierto', pedida: a.cantidadPedida });
    }
  }
  // primero lo que va al propietario (custodia), luego proveedores por nombre
  return [...grupos.values()].filter(g => g.lineas.length).sort((a, b) => (a.destino === b.destino ? a.titulo.localeCompare(b.titulo) : a.destino === 'propietario' ? -1 : 1));
}

/** EPIs asignados que caducan o hay que revisar en 30 días (cuentan como pedido necesario) */
export const episARenovar = (S: Estado) => S.herramientas.filter(h => h.clase === 'epi' && ['vencido', 'proximo'].includes(caducidad(h).estado));

/** Texto del borrador de pedido o solicitud (copiar, correo). Sin importes en las solicitudes de custodia. */
export function textoBorrador(g: GrupoReposicion, empresa = 'Almacén Búfala'): string {
  const cab = g.destino === 'propietario'
    ? `${g.titulo}\n\nOs pedimos reponer el siguiente material en custodia en ${empresa}:\n`
    : `${g.titulo}\n\nHola, necesitamos el siguiente material para ${empresa}:\n`;
  const lineas = g.lineas.map(l => `• ${l.codigo ? l.codigo + ' · ' : ''}${l.nombre}: ${l.pedida ?? l.sugerida} ${l.unidad} (stock actual ${l.stock}, mínimo ${l.minimo})`);
  return `${cab}${lineas.join('\n')}\n\nGracias.`;
}

/** Datos del informe de custodia para un propietario (entre desde y hasta, en ms) */
export function datosInformeCustodia(S: Estado, propietario: string, desde: number, hasta: number): DatosInforme {
  const prods = S.products.filter((p: Producto) => esCustodia(p) && p.propietario === propietario);
  const skus = new Set(prods.map(p => p.sku));
  return {
    propietario: S.propietarios.find(o => o.id === propietario)?.nombre || propietario, desde, hasta,
    productos: prods.map(p => ({ sku: p.sku, nombre: p.name, unidad: UNIT[p.unit], stock: p.stock, enVehiculos: redondea(stockTotal(S, p) - p.stock), minimo: p.min, codigoModelo: p.supplierRef, conSerie: false })),
    movimientos: S.movements.filter(m => skus.has(m.sku)).map(m => ({ ts: m.ts, sku: m.sku, tipo: m.type, cantidad: m.qty, motivo: m.reason, referencia: m.ref, series: [], operario: m.operator, equipo: m.equipo, vehiculo: m.vehiculo ? nombreVehiculo(S, m.vehiculo) : undefined })),
    actas: S.actas.filter(a => a.propietario === propietario).map(a => ({ numero: a.numero || 'pendiente', ts: a.ts, representante: a.representante, lineas: a.lineas })),
  };
}
