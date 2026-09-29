/* Modelo de datos (ver CLAUDE.md → "Modelo de datos") */

export type CatId = 'cargadores' | 'cables' | 'tubos' | 'fijaciones' | 'aparamenta' | 'fontaneria';
export type Unidad = 'm' | 'ud';
export type TipoMov = 'entrada' | 'salida' | 'merma';
export type Semaforo = 'red' | 'amber' | 'green';
export type EstadoEquipo = 'ruta' | 'depot' | 'taller';

export interface Producto {
  sku: string;
  ean?: string;
  supplierRef?: string;
  name: string;
  cat: CatId;
  unit: Unidad;
  pack: number;
  packLabel: string;
  stock: number;
  min: number;
  /** Pasillo-Estantería-Nivel, p. ej. P01-E02-N1 */
  loc: string;
  supplier: string;
  /** Coste neto por unidad base (m o ud) */
  price: number;
  serialized?: boolean;
  serials?: string[];
}

export interface Movimiento {
  id: string;
  ts: number;
  sku: string;
  type: TipoMov;
  qty: number;
  reason: string;
  ref: string;
  operator: string;
  serials: string[];
  /** Furgoneta a la que va (entrega) o de la que vuelve (devolución) */
  equipo?: string;
}

export interface Albaran {
  numero: string;
  proveedor: string;
  fecha: string;
  lineas: number;
  unidades: number;
  ts: number;
  operator: string;
  confianza: number;
  modo: 'ia' | 'sim';
}

export interface Tecnico {
  id: string;
  nombre: string;
  rol: string;
  /** Solo enmascarado: ***1234-X */
  dni: string;
}

export interface Equipo {
  id: string;
  nombre: string;
  flota: string;
  matricula: string;
  estado: EstadoEquipo;
  tecnicos: string[];
}

export interface LineaEntrega {
  sku: string;
  qty: number;
  serials: string[];
}

export interface Entrega {
  id: string;
  ts: number;
  equipo: string;
  receptor: string;
  dni?: string;
  lineas: LineaEntrega[];
  /** Imagen (data:) o trazo SVG de ejemplo */
  firma: string;
  hash?: string;
  operator: string;
}

/* Dotación: herramientas, EPIs y ropa de trabajo, con asignación a equipo y/o técnico e historial de incidencias */
export type ClaseDotacion = 'herramienta' | 'epi' | 'ropa';
export type EstadoHerramienta = 'operativa' | 'deteriorada' | 'rota' | 'perdida' | 'baja';
export type TipoIncidencia = 'alta' | 'asignacion' | 'deterioro' | 'rotura' | 'perdida' | 'reparacion' | 'reposicion' | 'baja';
export interface IncidenciaHerramienta {
  id: string;
  ts: number;
  tipo: TipoIncidencia;
  nota: string;
  operator: string;
  /** Coste de reparación o de la unidad repuesta */
  coste?: number;
  /** En reposiciones: n.º de serie de la unidad retirada */
  serieAnterior?: string;
}
export interface Herramienta {
  id: string;
  clase: ClaseDotacion;
  nombre: string;
  marca: string;
  /** N.º de serie o lote (puede ir vacío en ropa) */
  serie: string;
  /** Ropa y algunos EPIs (guantes, calzado) */
  talla?: string;
  /** Unidades de la ficha (p. ej. 2 pantalones) */
  cantidad: number;
  /** EPIs: fecha de caducidad o próxima revisión (AAAA-MM-DD) */
  caduca?: string;
  valor: number;
  estado: EstadoHerramienta;
  equipo?: string;
  tecnico?: string;
  historial: IncidenciaHerramienta[];
}

export interface Pedido {
  ts: number;
  qty: number;
}

export interface Estado {
  v: number;
  products: Producto[];
  movements: Movimiento[];
  albaranes: Albaran[];
  equipos: Equipo[];
  tecnicos: Tecnico[];
  entregas: Entrega[];
  herramientas: Herramienta[];
  operator: string;
  pedidos: Record<string, Pedido>;
  cesta: { equipo: string; receptor: string | null; lineas: LineaEntrega[] };
  seq: { ent: number };
}

/* Lectura de albaranes */
export interface LineaAlbaranIA {
  codigo?: string;
  descripcion?: string;
  cantidad?: number;
  sku?: string | null;
  series?: string[];
  nota?: string;
  confianza?: number;
}
export interface AlbaranIA {
  proveedor?: string;
  cif?: string;
  numero?: string;
  fecha?: string;
  bultos?: number;
  lineas?: LineaAlbaranIA[];
}
