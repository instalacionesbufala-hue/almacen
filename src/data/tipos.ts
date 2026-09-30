/* Modelo de datos (ver CLAUDE.md → "Modelo de datos") */

/** E-016: las categorías son configurables (tabla "categorias"); el id es un texto */
export type CatId = string;
export interface Categoria { id: string; nombre: string; icono: string; color: string; orden: number; activa: boolean }
/** E-013: formato de venta. En el almacén se mueven formatos enteros (salvo metros); el contenido cuenta para los consumos (E-012) */
export type Unidad = 'm' | 'ud' | 'bote' | 'sobre' | 'bolsa' | 'pack' | 'caja';
/** 'ajuste' lleva la cantidad con signo (+ suma, − resta) y exige motivo; solo el administrador */
/** E-013: traspaso (almacén → vehículo), devolucion (vehículo → almacén) y consumo (en obra, desde el vehículo; E-012) */
export type TipoMov = 'entrada' | 'salida' | 'merma' | 'ajuste' | 'traspaso' | 'devolucion' | 'consumo';
export type Semaforo = 'red' | 'amber' | 'green';
export type EstadoEquipo = 'ruta' | 'depot' | 'taller';

export interface Producto {
  sku: string;
  ean?: string;
  supplierRef?: string;
  name: string;
  cat: CatId;
  unit: Unidad;
  /** Unidades por formato: bote de 1000 tacos → 1000 (en m y ud, 1) */
  contenido?: number;
  /** Descripción corta opcional ("Monofásico · 40 A") */
  packLabel?: string;
  /** Stock del ALMACÉN en formatos (E-013). Lo de los vehículos está en Estado.aBordo */
  stock: number;
  min: number;
  /** false: importado sin mínimo → tarea "Completar mínimo" del administrador */
  minimoDefinido?: boolean;
  supplier: string;
  /** Alta rápida desde el escáner (rol almacén): el administrador debe completarla */
  borrador?: boolean;
  /** E-016: notas libres; archivado = fusionado en otro artículo (fusionadoEn) */
  notas?: string;
  fusionadoEn?: string;
  /** E-015: stock que contó el almacén al crear el borrador; entra como "Alta de artículo" cuando el administrador lo aprueba */
  stockPropuesto?: number;
  propuestoPor?: string;
  /** E-008: material propio o en custodia de un depositante (sin precio) */
  propiedad?: 'propia' | 'custodia';
  propietario?: string;
  /** E-006: stock al que se repone (por defecto 2 × mínimo) y proveedor al que se pide */
  objetivo?: number;
  proveedorHabitual?: string;
  /** Ropa y EPIs de almacén: modelo común a varias tallas */
  modelo?: string;
  talla?: string;
  /** E-009: foto en el bucket privado (ruta), su miniatura de 200 px y de dónde sale. Las tallas de un modelo la comparten */
  foto?: string;
  fotoMini?: string;
  fotoOrigen?: OrigenFoto;
}
export type OrigenFoto = 'Saltoki' | 'Esmove' | 'fabricante' | 'propia';

export type Rol = 'admin' | 'almacen';
export interface PerfilUsuario { id: string; nombre: string; email: string | null; rol: Rol; activo: boolean }
/** Merma o diferencia de recuento del almacén que espera la validación del administrador (E-004) */
export interface Pendiente {
  id: string; ts: number; tipo: 'merma' | 'recuento' | 'ajuste'; sku: string; qty: number; reason: string; ref: string; serials: string[];
  operator: string; estado: 'pendiente' | 'aprobado' | 'rechazado' | 'aplicada' | 'vista'; resueltoPor?: string; nota?: string; valor?: number;
  /** E-012: recuento de un vehículo (la diferencia va en formatos, puede tener decimales) */
  vehiculo?: string;
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
  /** E-007: horas que dura la reserva de una entrega preparada */
  horasReserva: number;
  /** E-011: copia de cada entrega firmada también a los destinatarios de correo (administración) */
  copiaEntregasAdmin?: boolean;
}
export interface EnvioAviso { id: string; ts: number; canal: 'correo' | 'push' | 'telegram'; tipo: string; asunto: string; estado: 'pendiente' | 'enviado' | 'error' | 'descartado'; error?: string;
  /** E-011: copia de una entrega firmada */
  entrega?: string; destinatarios?: string[]; reintentos?: number }
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
  /** Equipo implicado (informativo) */
  equipo?: string;
  /** E-013: vehículo cuyo stock cambia (traspaso, devolución, merma o ajuste a bordo, consumo) */
  vehiculo?: string;
  /** Efecto en el vehículo, en unidades de contenido (con signo) */
  unidades?: number;
  /** Entrega a la que pertenece */
  entrega?: string;
  /** E-012: cierre de instalación que lo generó */
  cierre?: string;
  /** E-016: albarán de una entrada y movimiento que corrige (reasignación, fusión) */
  albaran?: string;
  corrige?: string;
}

export interface Albaran {
  /** E-016: id (para ver sus líneas y reasignarlas) y delegación del proveedor */
  id?: string;
  delegacion?: string;
  numero: string;
  proveedor: string;
  fecha: string;
  lineas: number;
  unidades: number;
  ts: number;
  operator: string;
  confianza: number;
  modo: 'ia' | 'sim';
  /** E-018: códigos impresos en sus líneas (aunque se emparejaran con otro artículo) */
  codigos?: string[];
}

export type TipoTalla = 'camiseta' | 'pantalon' | 'calzado' | 'guantes';
export type Tallas = Partial<Record<TipoTalla, string>>;

export interface Tecnico {
  id: string;
  nombre: string;
  rol: string;
  /** Solo enmascarado: ***1234-X */
  dni: string;
  /** Tallas: preseleccionan la talla de la ropa y los EPIs en la cesta de entrega */
  tallas?: Tallas;
  /** E-011: correo al que se envía la copia de sus entregas (opcional) */
  email?: string;
  /** E-013: código de empleado (E01…) y teléfono */
  codigo?: string;
  telefono?: string;
}

/** E-013: el equipo es solo un nombre ("Búfala 1", como lo envía el wizard); sus técnicos y su vehículo cambian con el tiempo */
export interface Equipo {
  id: string;
  nombre: string;
  estado: EstadoEquipo;
  tecnicos: string[];
  /** vehículo asignado ahora */
  vehiculo?: string;
}
export interface Vehiculo { id: string; matricula: string; modelo: string; equipo?: string }
/** Historial: técnico → equipo y vehículo → equipo, con fechas */
export interface Asignacion { tipo: 'tecnico' | 'vehiculo'; sujeto: string; equipo: string; desde: number; hasta?: number }
/** Stock a bordo de un vehículo, en UNIDADES de contenido (puede ser negativo: discrepancia) */
export interface StockVehiculo { vehiculo: string; sku: string; unidades: number }

/** E-012 · Cierres de instalación del wizard */
export type EstadoCierre = 'aplicado' | 'parcial' | 'discrepancia' | 'fallido' | 'ignorado' | 'sin_vehiculo';
export interface CierreApp {
  id: string; clave: string; version: number; numInst: string; cliente: string; direccion: string; fecha: number; equipoWizard: string;
  equipo?: string; vehiculo?: string; hardware: string; despFallido: boolean; estado: EstadoCierre; origen: 'integracion' | 'historico'; recibido: number;
  /** datos originales del wizard (en local; en la nube se piden al servidor cuando hacen falta: probar o recalcular) */
  datos?: Record<string, unknown>;
}
export interface LineaCierre {
  id: string; cierre: string; campo: string; formula: string; valor: number; sku?: string; cantidad: number; estimada: boolean;
  estado: 'aplicada' | 'discrepancia' | 'sin_equivalencia' | 'pendiente' | 'resuelta'; nota: string;
}
export interface ArticuloRegla { sku: string | null; factor: number; nombre?: string }
export interface Equivalencia {
  id: string; campo: string; formula: 'directa' | 'manguitos' | 'fijaciones' | 'unidad'; condiciones: Record<string, string | string[]>;
  articulos: ArticuloRegla[]; kit?: string | null; estimada: boolean; activa: boolean; orden: number; nota?: string; confirmada: boolean;
}
export interface Integracion { id: string; nombre: string; creado: number; creadoPor: string; revocado?: number; ultimoUso?: number }

/** E-016: cambio de ficha propuesto por el personal de almacén; lo aplica o descarta el administrador */
export interface PropuestaFicha { id: string; sku: string; cambios: Partial<Producto>; ts: number; operator: string; estado: 'pendiente' | 'aplicada' | 'descartada' }

/** E-014: enlace personal del portal del técnico. Solo se guarda el hash del token. */
export interface EnlacePortal { tecnico: string; entrega?: string; creado: number; creadoPor: string; revocado?: number; hash?: string }
export interface CopiaEntrega { id: string; entrega: string; canal: 'whatsapp' | 'compartir' | 'correo'; destino: string; ts: number; operator: string }

export interface LineaEntrega {
  sku: string;
  qty: number;
  serials: string[];
  /** E-007: línea de herramienta de la dotación (en lugar de stock) */
  tipo?: 'stock' | 'herramienta';
  dotacion?: string;
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
  /** E-007: preparada (stock reservado hasta 'caduca') → firmada | anulada. Sin estado = firmada. */
  estado?: 'preparada' | 'firmada' | 'anulada';
  obra?: string;
  caduca?: number;
  /** E-013: vehículo en el que entró el material al firmar */
  vehiculo?: string;
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

/** E-011 · Cesta libre de entrega: para quién, qué y en qué paso va */
export interface Cesta { equipo: string; receptor: string | null; lineas: LineaEntrega[]; obra?: string; paso?: 1 | 2 | 3 }

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
  /** E-013: vehículos, historial de asignaciones, stock a bordo y estado de la instalación (demostración o datos reales) */
  vehiculos: Vehiculo[];
  asignaciones: Asignacion[];
  aBordo: StockVehiculo[];
  configApp: { modoDemo: boolean; demoBorrada?: number; demoBorradaPor?: string; kitFijacion?: 'A' | 'B' | 'C'; aperturaCierres?: number };
  /** E-012: cierres del wizard, sus líneas traducidas, equivalencias, kits de fijación e integraciones (token del Apps Script) */
  cierres: CierreApp[];
  /** E-016: categorías configurables, artículos archivados (fusionados en otro) y propuestas de cambio de ficha del almacén */
  categorias: Categoria[];
  archivados?: Producto[];
  propuestas: PropuestaFicha[];
  lineasCierre: LineaCierre[];
  equivalencias: Equivalencia[];
  kits: Record<string, ArticuloRegla[]>;
  integraciones: Integracion[];
  /** E-014: enlaces del portal del técnico (en la nube no se lee el hash) y copias enviadas por WhatsApp o compartiendo el PDF */
  portalEnlaces: EnlacePortal[];
  copias: CopiaEntrega[];
  actas: ActaCustodia[];
  /** E-011: entrega en curso (se conserva en el dispositivo si se cierra la app) */
  cesta: Cesta;
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
