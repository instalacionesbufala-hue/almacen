/* Modelo de datos (ver CLAUDE.md → "Modelo de datos") */

export type CatId = 'cargadores' | 'cuadros' | 'epis' | 'ropa' | 'cables' | 'tubos' | 'fijaciones' | 'aparamenta' | 'fontaneria';
export type Unidad = 'm' | 'ud';
/** 'ajuste' lleva la cantidad con signo (+ suma, − resta) y exige motivo; solo el administrador */
export type TipoMov = 'entrada' | 'salida' | 'merma' | 'ajuste';
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
  /** Alta rápida desde el escáner (rol almacén): el administrador debe completarla */
  borrador?: boolean;
  /** E-008: material propio o en custodia de un depositante (sin precio) */
  propiedad?: 'propia' | 'custodia';
  propietario?: string;
  /** E-006: stock al que se repone (por defecto 2 × mínimo) y proveedor al que se pide */
  objetivo?: number;
  proveedorHabitual?: string;
  /** Ropa y EPIs de almacén: modelo común a varias tallas */
  modelo?: string;
  talla?: string;
}

export type Rol = 'admin' | 'almacen';
export interface PerfilUsuario { id: string; nombre: string; email: string | null; rol: Rol; activo: boolean }
/** Merma o diferencia de recuento del almacén que espera la validación del administrador (E-004) */
export interface Pendiente {
  id: string; ts: number; tipo: 'merma' | 'recuento'; sku: string; qty: number; reason: string; ref: string; serials: string[];
  operator: string; estado: 'pendiente' | 'aprobado' | 'rechazado'; resueltoPor?: string; nota?: string; valor?: number;
  /** creado en este dispositivo y aún sin respuesta del servidor */
  provisional?: boolean;
}

/** E-006: aviso de reposición (nace en el servidor al cruzar el mínimo; uno abierto por artículo) */
export interface AvisoReposicion {
  id: string; sku?: string; modeloHerramienta?: string; destino: 'proveedor' | 'propietario'; grupo: string;
  estado: 'abierto' | 'pedido' | 'cerrado'; creado: number; cantidadPedida?: number; proveedorPedido?: string; pedidoTs?: number; pedidoPor?: string;
}
export interface MinimoHerramienta { modelo: string; minimo: number; objetivo?: number; proveedor: string }
export type ModoEnvio = 'inmediato' | 'resumen';
export interface ConfigAvisos {
  correoActivo: boolean; correoModo: ModoEnvio; correoHora: string; correoRemitente: string; correoDestinatarios: string[];
  pushActivo: boolean; pushModo: ModoEnvio; pushHora: string;
  telegramActivo: boolean; telegramModo: ModoEnvio; telegramHora: string; telegramChatId: string;
  diasRecordatorio: number; custodiaEnvio: 'manual' | 'automatico'; informeCustodia: 'semanal' | 'mensual' | 'ninguno';
}
export interface EnvioAviso { id: string; ts: number; canal: 'correo' | 'push' | 'telegram'; tipo: string; asunto: string; estado: 'pendiente' | 'enviado' | 'error' | 'descartado'; error?: string }
export interface ActaCustodia { id: string; numero?: string; ts: number; propietario: string; representante: string; firma: string; lineas: { sku: string; sistema: number; contado: number }[]; hash?: string; operator: string }

export interface Propietario { id: string; nombre: string; contacto: string; correosReposicion: string[]; correosInformes: string[] }

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
  /** Entrega a la que pertenece */
  entrega?: string;
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
  /** En la nube es un UUID generado en el cliente; en modo local, el propio número */
  id: string;
  /** ENT-AAAA-NNNN asignado por el servidor (vacío mientras está pendiente de envío) */
  numero?: string;
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
  /** E-006: modelo para contar repuestos (herramientas operativas sin asignar) */
  modelo?: string;
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
  propietarios: Propietario[];
  pendientes: Pendiente[];
  perfiles: PerfilUsuario[];
  /** Rol del usuario con sesión (en modo demo, administrador) */
  rol: Rol;
  operator: string;
  pedidos: Record<string, Pedido>;
  avisos: AvisoReposicion[];
  minimosHerramienta: MinimoHerramienta[];
  configAvisos: ConfigAvisos;
  envios: EnvioAviso[];
  actas: ActaCustodia[];
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
