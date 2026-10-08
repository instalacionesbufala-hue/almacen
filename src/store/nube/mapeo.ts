/* Filas de Supabase → estado de la app (src/data/tipos.ts) */
import type { ActaCustodia, Retirada, Devolucion, AvisoReposicion, ConfigAvisos, EnvioAviso, MinimoHerramienta, Pendiente, PerfilUsuario, Rol, Albaran, CatId, ClaseDotacion, Entrega, Equipo, EstadoEquipo, EstadoHerramienta, Estado, Herramienta, Movimiento, Producto, Tecnico, TipoIncidencia, TipoMov, Unidad, Vehiculo, Asignacion, StockVehiculo, CopiaEntrega, EnlacePortal, ArticuloRegla, CierreApp, Equivalencia, Integracion, LineaCierre, Categoria, PropuestaFicha, CodigoArticulo } from '../../data/tipos';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Fila = Record<string, any>;
export interface Tablas {
  productos: Fila[]; equipos: Fila[]; tecnicos: Fila[]; movimientos: Fila[];
  albaranes: Fila[]; entregas: Fila[]; entrega_lineas: Fila[]; dotacion: Fila[];
  dotacion_historial: Fila[]; avisos_reposicion: Fila[]; propietarios: Fila[];
  vehiculos: Fila[]; asignaciones_tecnico: Fila[]; asignaciones_vehiculo: Fila[]; stock_vehiculo: Fila[]; config_app: Fila[]; portal_enlaces: Fila[]; copias_entrega: Fila[]; categorias: Fila[]; propuestas_ficha: Fila[]; cierres: Fila[]; cierre_lineas: Fila[]; cierre_versiones: Fila[]; roles: Fila[]; equivalencias_cierre: Fila[]; kits_fijacion: Fila[]; integraciones: Fila[]; codigos_articulo: Fila[];
  minimos_herramienta: Fila[]; config_avisos: Fila[]; envios_aviso: Fila[]; actas_custodia: Fila[]; retiradas: Fila[]; devoluciones: Fila[];
  tallas_tecnico: Fila[];
  perfiles: Fila[]; pendientes: Fila[]; valores_pendientes?: Fila[];
}
// E-013: sin precios ni series (costes_* y series ya no se leen)
export const TABLAS: (keyof Tablas)[] = ['productos', 'equipos', 'tecnicos', 'movimientos', 'albaranes', 'entregas',
  'entrega_lineas', 'dotacion', 'dotacion_historial', 'avisos_reposicion', 'propietarios', 'perfiles', 'pendientes',
  'minimos_herramienta', 'config_avisos', 'envios_aviso', 'actas_custodia', 'retiradas', 'devoluciones', 'tallas_tecnico',
  'vehiculos', 'asignaciones_tecnico', 'asignaciones_vehiculo', 'stock_vehiculo', 'config_app', 'categorias', 'propuestas_ficha', 'portal_enlaces', 'copias_entrega', 'cierres', 'cierre_lineas', 'cierre_versiones', 'roles', 'equivalencias_cierre', 'kits_fijacion', 'integraciones', 'codigos_articulo'];
/** Columnas legibles por cada rol (en pendientes el importe se lee aparte, solo el administrador) */
export const COLUMNAS: Partial<Record<keyof Tablas, string>> = {
  portal_enlaces: 'tecnico_id, entrega_id, creado, creado_por, revocado',
  integraciones: 'id, nombre, creado, creado_por, revocado, ultimo_uso',
  cierres: 'id, clave, version, num_inst, cliente, direccion, fecha_cierre, equipo_wizard, equipo_id, vehiculo_id, hardware, desp_fallido, estado, origen, recibido, datos_wizard, holded, material_especial, material_revisado, correccion',
  cierre_versiones: 'id, cierre_id, n, origen, documento, recibido, diferencia',
  pendientes: 'id, ts, tipo, sku, cantidad, motivo, referencia, series, operario, estado, resuelto_por, nota_resolucion, vehiculo_id',
};

const ms = (t: string) => new Date(t).getTime();
const n = (v: unknown) => Number(v ?? 0);

export function aEstado(t: Tablas, base: Pick<Estado, 'cesta' | 'seq'>, operador: string, rol: Rol = 'almacen'): Estado {
  const todos: (Producto & { archivado?: boolean })[] = t.productos.map(p => ({
    sku: p.sku, ean: p.ean ?? undefined, supplierRef: p.ref_proveedor ?? undefined, name: p.nombre, cat: p.categoria as CatId, unit: p.unidad as Unidad,
    contenido: n(p.contenido) || 1, ...(p.unidad_contenido === 'm' ? { unidadContenido: 'm' as const } : {}), ...(p.metros_sueltos ? { metrosSueltos: true } : {}), ...(p.mostrar_formato ? { mostrarFormato: true } : {}), ...(p.pieza_entera ? { piezaEntera: true } : {}), packLabel: p.formato_texto || undefined, stock: n(p.stock), min: n(p.minimo), minimoDefinido: p.minimo_definido !== false, supplier: p.proveedor || '',
    borrador: !!p.borrador, stockPropuesto: p.stock_propuesto == null ? undefined : n(p.stock_propuesto), propuestoPor: p.propuesto_por || undefined,
    propiedad: p.propiedad === 'custodia' ? 'custodia' : 'propia', propietario: p.propietario_id ?? undefined,
    objetivo: p.objetivo == null ? undefined : n(p.objetivo), proveedorHabitual: p.proveedor_habitual ?? undefined, modelo: p.modelo ?? undefined, talla: p.talla ?? undefined,
    foto: p.foto ?? undefined, fotoMini: p.foto_mini ?? undefined, fotoOrigen: p.foto_origen ?? undefined,
    ...(p.notas ? { notas: p.notas } : {}), ...(p.archivado ? { archivado: true, fusionadoEn: p.fusionado_en ?? undefined, archivadoTs: p.archivado_ts ? ms(p.archivado_ts) : undefined, archivadoPor: p.archivado_por ?? undefined } : {}),
  }));
  // E-016: los archivados (fusionados en otro) no salen en las listas, pero el historial los sigue encontrando
  const products: Producto[] = todos.filter(p => !p.archivado), archivados: Producto[] = todos.filter(p => p.archivado);
  const categorias: Categoria[] = (t.categorias || []).map(c => ({ id: c.id, nombre: c.nombre, icono: c.icono, color: c.color, orden: c.orden, activa: !!c.activa })).sort((a, b) => a.orden - b.orden);
  const codigos: CodigoArticulo[] = (t.codigos_articulo || []).map(x => ({ codigo: x.codigo, sku: x.sku, tipo: x.tipo, ts: ms(x.creado), operator: x.operario }));
  const propuestas: PropuestaFicha[] = (t.propuestas_ficha || []).map(x => ({ id: x.id, sku: x.sku, cambios: x.cambios || {}, ts: ms(x.ts), operator: x.operario, estado: x.estado }));
  const activos = t.equipos.filter(e => e.activo);
  const vehiculosActivos = t.vehiculos.filter(v => v.activo);
  const equipos: Equipo[] = activos.map(e => ({ id: e.id, nombre: e.nombre, estado: e.estado as EstadoEquipo,
    tecnicos: t.tecnicos.filter(x => x.activo && x.equipo_id === e.id).map(x => x.id), vehiculo: vehiculosActivos.find(v => v.equipo_id === e.id)?.id }));
  const vehiculos: Vehiculo[] = vehiculosActivos.map(v => ({ id: v.id, matricula: v.matricula, modelo: v.modelo || '', equipo: v.equipo_id ?? undefined }));
  const asignaciones: Asignacion[] = [
    ...t.asignaciones_tecnico.map((a): Asignacion => ({ id: a.id, tipo: 'tecnico', sujeto: a.tecnico_id, equipo: a.equipo_id, desde: ms(a.desde), hasta: a.hasta ? ms(a.hasta) : undefined })),
    ...t.asignaciones_vehiculo.map((a): Asignacion => ({ id: a.id, tipo: 'vehiculo', sujeto: a.vehiculo_id, equipo: a.equipo_id, desde: ms(a.desde), hasta: a.hasta ? ms(a.hasta) : undefined }))];
  const aBordo: StockVehiculo[] = t.stock_vehiculo.map(x => ({ vehiculo: x.vehiculo_id, sku: x.sku, unidades: n(x.unidades) }));
  const ca = t.config_app[0];
  const portalEnlaces: EnlacePortal[] = (t.portal_enlaces || []).map(e => ({ tecnico: e.tecnico_id, entrega: e.entrega_id ?? undefined, creado: ms(e.creado), creadoPor: e.creado_por, revocado: e.revocado ? ms(e.revocado) : undefined }));
  const copias: CopiaEntrega[] = (t.copias_entrega || []).map(c => ({ id: c.id, entrega: c.entrega_id, canal: c.canal, destino: c.destino || '', ts: ms(c.ts), operator: c.operario }));
  const cierres: CierreApp[] = (t.cierres || []).map(c => ({ id: c.id, clave: c.clave, version: c.version, numInst: c.num_inst, cliente: c.cliente, direccion: c.direccion, fecha: ms(c.fecha_cierre),
    equipoWizard: c.equipo_wizard, equipo: c.equipo_id ?? undefined, vehiculo: c.vehiculo_id ?? undefined, hardware: c.hardware, despFallido: !!c.desp_fallido, estado: c.estado, origen: c.origen, recibido: ms(c.recibido),
    datosWizard: c.datos_wizard ?? undefined, holded: c.holded ?? undefined, ...(c.correccion ? { correccion: c.correccion } : {}), materialEspecial: c.material_especial || '', materialRevisado: c.material_revisado !== false,
    versiones: (t.cierre_versiones || []).filter(v => v.cierre_id === c.id).map(v => ({ n: v.n, origen: v.origen, documento: v.documento || '', recibido: ms(v.recibido), diferencia: (v.diferencia || []).map((d: Fila) => ({ sku: d.sku, unidades: n(d.unidades) })) })).sort((x, y) => x.n - y.n) }))
    .sort((a, b) => b.fecha - a.fecha);
  const lineasCierre: LineaCierre[] = (t.cierre_lineas || []).map(l => ({ id: l.id, cierre: l.cierre_id, campo: l.campo, formula: l.formula, valor: n(l.valor), sku: l.sku ?? undefined, cantidad: n(l.cantidad), estimada: !!l.estimada, estado: l.estado, nota: l.nota || '', ...(l.manual ? { manual: true } : {}),
    ...(l.resolucion ? { resolucion: l.resolucion } : {}), ...(l.previo ? { previo: { estado: l.previo.estado, sku: l.previo.sku ?? undefined, cantidad: n(l.previo.cantidad), nota: l.previo.nota || '' } } : {}) }));
  const equivalencias: Equivalencia[] = (t.equivalencias_cierre || []).map(r => ({ id: r.id, campo: r.campo, formula: r.formula, condiciones: r.condiciones || {}, articulos: r.articulos || [], kit: r.kit, estimada: !!r.estimada, activa: !!r.activa, orden: r.orden, nota: r.nota || '', confirmada: !!r.confirmada, ...(r.sin_descuento ? { sinDescuento: r.sin_descuento } : {}) }))
    .sort((a, b) => a.orden - b.orden);
  const kits: Record<string, ArticuloRegla[]> = Object.fromEntries((t.kits_fijacion || []).map(k => [k.kit, k.articulos || []]));
  const integraciones: Integracion[] = (t.integraciones || []).map(i => ({ id: i.id, nombre: i.nombre, creado: ms(i.creado), creadoPor: i.creado_por, revocado: i.revocado ? ms(i.revocado) : undefined, ultimoUso: i.ultimo_uso ? ms(i.ultimo_uso) : undefined }));
  const configApp = { modoDemo: ca ? !!ca.modo_demo : false, demoBorrada: ca?.demo_borrada ? ms(ca.demo_borrada) : undefined, demoBorradaPor: ca?.demo_borrada_por ?? undefined,
    kitFijacion: (ca?.kit_fijacion || 'A') as 'A' | 'B' | 'C', aperturaCierres: ca?.apertura_cierres ? ms(ca.apertura_cierres) : undefined, cargadoresABordoHasta: ca?.cargadores_a_bordo_hasta ? ms(ca.cargadores_a_bordo_hasta) : undefined };
  const tallas = new Map(t.tallas_tecnico.map(x => [x.tecnico_id, { camiseta: x.camiseta ?? undefined, pantalon: x.pantalon ?? undefined, calzado: x.calzado ?? undefined, guantes: x.guantes ?? undefined }]));
  const tecnicos: Tecnico[] = t.tecnicos.filter(x => x.activo).map(x => ({ id: x.id, nombre: x.nombre, rol: x.rol, dni: x.dni_mascara, tallas: tallas.get(x.id), email: x.email ?? undefined, codigo: x.codigo ?? undefined, telefono: x.telefono ?? undefined }));
  const movements: Movimiento[] = t.movimientos.map(m => ({ id: m.id, ts: ms(m.ts), sku: m.sku, type: m.tipo as TipoMov, qty: n(m.cantidad), reason: m.motivo,
    ref: m.referencia || '', operator: m.operario, serials: [], equipo: m.equipo_id ?? undefined, entrega: m.entrega_id ?? undefined, ...(m.albaran_id ? { albaran: m.albaran_id } : {}), ...(m.corrige ? { corrige: m.corrige } : {}),
    vehiculo: m.vehiculo_id ?? undefined, unidades: m.unidades == null ? undefined : n(m.unidades), ...(m.cierre_id ? { cierre: m.cierre_id } : {}), ...(m.retirada_id ? { retirada: m.retirada_id } : {}), ...(m.devolucion_id ? { devolucion: m.devolucion_id } : {}) })).sort((a, b) => b.ts - a.ts);
  const albaranes: Albaran[] = t.albaranes.map(a => ({ id: a.id, delegacion: a.delegacion || undefined, numero: a.numero, proveedor: a.proveedor, fecha: a.fecha, lineas: a.lineas, unidades: n(a.unidades),
    ts: ms(a.ts), operator: a.operario, confianza: a.confianza == null ? .95 : n(a.confianza), modo: a.modo, codigos: a.codigos || [], paginas: a.paginas || [] })).sort((a, b) => b.ts - a.ts);
  const lineas = new Map<string, Fila[]>();
  for (const l of t.entrega_lineas) lineas.set(l.entrega_id, [...(lineas.get(l.entrega_id) || []), l]);
  const entregas: Entrega[] = t.entregas.map(e => ({ id: e.id, numero: e.numero, ts: ms(e.firmada_ts || e.ts), equipo: e.equipo_id, receptor: e.receptor_id, dni: e.dni, firma: e.firma || '', hash: e.hash ?? undefined, operator: e.operario,
    estado: e.estado, obra: e.obra || undefined, caduca: e.caduca ? ms(e.caduca) : undefined, vehiculo: e.vehiculo_id ?? undefined,
    lineas: (lineas.get(e.id) || []).sort((a, b) => a.n - b.n).map(l => ({ sku: l.sku ?? '', qty: n(l.cantidad), serials: [], tipo: l.tipo, dotacion: l.dotacion_id ?? undefined })) })).sort((a, b) => b.ts - a.ts);
  const hist = new Map<string, Fila[]>();
  for (const h of t.dotacion_historial) hist.set(h.dotacion_id, [...(hist.get(h.dotacion_id) || []), h]);
  const herramientas: Herramienta[] = t.dotacion.map(d => ({
    id: d.id, clase: d.clase as ClaseDotacion, modelo: d.modelo ?? undefined, nombre: d.nombre, marca: d.marca, serie: d.serie, talla: d.talla ?? undefined, cantidad: d.cantidad, caduca: d.caduca ?? undefined,
    valor: 0, estado: d.estado as EstadoHerramienta, equipo: d.equipo_id ?? undefined, tecnico: d.tecnico_id ?? undefined,
    historial: (hist.get(d.id) || []).sort((a, b) => ms(a.ts) - ms(b.ts)).map(h => ({ id: h.id, ts: ms(h.ts), tipo: h.tipo as TipoIncidencia, nota: h.nota, operator: h.operario,
      serieAnterior: h.serie_anterior ?? undefined })),
  }));
  const avisos: AvisoReposicion[] = t.avisos_reposicion.map(a => ({ id: a.id, sku: a.sku ?? undefined, modeloHerramienta: a.modelo_herramienta ?? undefined, destino: a.destino, grupo: a.grupo, estado: a.estado,
    creado: ms(a.creado), cantidadPedida: a.cantidad_pedida == null ? undefined : n(a.cantidad_pedida), proveedorPedido: a.proveedor_pedido ?? undefined, pedidoTs: a.pedido_ts ? ms(a.pedido_ts) : undefined, pedidoPor: a.pedido_por ?? undefined }));
  // compatibilidad: "pedido en curso" por artículo
  const pedidos = Object.fromEntries(avisos.filter(a => a.estado === 'pedido' && a.sku).map(a => [a.sku!, { ts: a.pedidoTs || a.creado, qty: a.cantidadPedida || 0 }]));
  const minimosHerramienta: MinimoHerramienta[] = t.minimos_herramienta.map(m => ({ modelo: m.modelo, minimo: m.minimo, objetivo: m.objetivo ?? undefined, proveedor: m.proveedor || '' }));
  const c = t.config_avisos[0];
  const configAvisos: ConfigAvisos = c ? { correoActivo: c.correo_activo, correoModo: c.correo_modo, correoHora: String(c.correo_hora).slice(0, 5), correoRemitente: c.correo_remitente, correoDestinatarios: c.correo_destinatarios || [],
    pushActivo: c.push_activo, pushModo: c.push_modo, pushHora: String(c.push_hora).slice(0, 5), telegramActivo: c.telegram_activo, telegramModo: c.telegram_modo, telegramHora: String(c.telegram_hora).slice(0, 5),
    telegramChatId: c.telegram_chat_id, diasRecordatorio: c.dias_recordatorio, custodiaEnvio: c.custodia_envio, informeCustodia: c.informe_custodia, horasReserva: c.horas_reserva ?? 48, copiaEntregasAdmin: !!c.copia_entregas_admin }
    : { correoActivo: false, correoModo: 'resumen', correoHora: '08:00', correoRemitente: '', correoDestinatarios: [], pushActivo: true, pushModo: 'inmediato', pushHora: '08:00', telegramActivo: false, telegramModo: 'inmediato', telegramHora: '08:00', telegramChatId: '', diasRecordatorio: 7, custodiaEnvio: 'manual', informeCustodia: 'mensual', horasReserva: 48 };
  const envios: EnvioAviso[] = t.envios_aviso.map(e => ({ id: e.id, ts: ms(e.ts), canal: e.canal, tipo: e.tipo, asunto: e.asunto, estado: e.estado, error: e.error ?? undefined,
    entrega: e.entrega_id ?? undefined, destinatarios: e.destinatarios || [], reintentos: n(e.reintentos) })).sort((a, b) => b.ts - a.ts);
  const actas: ActaCustodia[] = t.actas_custodia.map(a => ({ id: a.id, numero: a.numero, ts: ms(a.ts), propietario: a.propietario_id, representante: a.representante, firma: a.firma,
    lineas: (a.lineas || []).map((l: Fila) => ({ sku: l.sku, sistema: n(l.sistema), contado: n(l.contado) })), hash: a.hash, operator: a.operario })).sort((a, b) => b.ts - a.ts);
  const retiradas: Retirada[] = (t.retiradas || []).map(r => ({ id: r.id, numero: r.numero, ts: ms(r.ts), socio: r.propietario_id, ...(r.vehiculo_id ? { vehiculo: r.vehiculo_id } : {}),
    recoge: r.recoge_nombre, recogeDoc: r.recoge_doc || '', enNombre: r.en_nombre, tercero: r.tercero_nombre || '', terceroEmpresa: r.tercero_empresa || '', motivo: r.motivo, motivoTexto: r.motivo_texto || '',
    referencia: r.referencia || '', transporte: r.transporte || '', notas: r.notas || '', lineas: (r.lineas || []).map((l: Fila) => ({ sku: l.sku, nombre: l.nombre, cantidad: n(l.cantidad), unidades: n(l.unidades) })),
    firma: r.firma || '', hash: r.hash || '', estado: r.estado, ...(r.anulada_ts ? { anuladaTs: ms(r.anulada_ts), anuladaPor: r.anulada_por, anulacionMotivo: r.anulacion_motivo } : {}), operator: r.operario || 'Búfala' })).sort((a, b) => b.ts - a.ts);
  const devoluciones: Devolucion[] = (t.devoluciones || []).map(d => ({ id: d.id, numero: d.numero, ts: ms(d.ts), vehiculo: d.vehiculo_id, equipo: d.equipo_id ?? undefined, tecnico: d.tecnico_id ?? undefined,
    motivo: d.motivo, motivoTexto: d.motivo_texto || '', obra: d.obra || '', firma: d.firma || '', hash: d.hash || '', estado: d.estado, operator: d.operario || 'Búfala',
    lineas: (d.lineas || []).map((l: Fila) => ({ sku: l.sku, nombre: l.nombre, unidades: n(l.unidades), cantidad: n(l.cantidad), estado: l.estado, ...(l.motivoDefecto ? { motivoDefecto: l.motivoDefecto } : {}) })),
    ...(d.anulada_ts ? { anuladaTs: ms(d.anulada_ts), anuladaPor: d.anulada_por, anulacionMotivo: d.anulacion_motivo } : {}) })).sort((a, b) => b.ts - a.ts);
  const propietarios = t.propietarios.map(o => ({ id: o.id, nombre: o.nombre, contacto: o.contacto || '', correosReposicion: o.correos_reposicion || [], correosInformes: o.correos_informes || [], activo: o.activo !== false, color: o.color || 'violeta' })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const pendientes: Pendiente[] = t.pendientes.map(p => ({ id: p.id, ts: ms(p.ts), tipo: p.tipo, sku: p.sku, qty: n(p.cantidad), reason: p.motivo, ref: p.referencia || '',
    serials: p.series || [], operator: p.operario, estado: p.estado, resueltoPor: p.resuelto_por ?? undefined, nota: p.nota_resolucion ?? undefined, ...(p.vehiculo_id ? { vehiculo: p.vehiculo_id } : {}) })).sort((a, b) => b.ts - a.ts);
  const perfiles: PerfilUsuario[] = t.perfiles.map(p => ({ id: p.id, nombre: p.nombre, email: p.email ?? null, rol: p.rol, activo: !!p.activo, ...(p.propietario_id ? { propietario: p.propietario_id } : {}) }));
  const roles = (t.roles || []).map(r => ({ id: r.id, nombre: r.nombre, descripcion: r.descripcion || '', sistema: !!r.sistema, permisos: r.permisos || {} }));
  return { v: 3, roles, products, movements, albaranes, equipos, tecnicos, entregas, herramientas, propietarios, pendientes, perfiles, rol, avisos, minimosHerramienta, configAvisos, envios, actas, retiradas, devoluciones, vehiculos, asignaciones, aBordo, configApp, categorias, archivados, codigos, propuestas, portalEnlaces, copias, cierres, lineasCierre, equivalencias, kits, integraciones, operator: operador, pedidos, cesta: base.cesta, seq: base.seq };
}
