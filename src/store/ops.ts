/* Operaciones de escritura. Cada una sabe:
   - aplicarse en local (validación previa con src/domain y respuesta inmediata en pantalla), y
   - traducirse a su función SQL del servidor (la fuente de verdad en modo nube).
   En modo nube la operación se guarda en la cola y se reaplica en local hasta que el servidor la confirma. */
import type { ConfigAvisos, Propietario, Rol, CatId, EstadoEquipo, Estado, Herramienta, LineaEntrega, Producto, TipoIncidencia, TipoMov } from '../data/tipos';
import { applyMovement, find, delta } from '../domain/reglas';
import { redondea } from '../domain/formato';
import { asignarHerramienta, registrarIncidencia } from '../domain/herramientas';

export interface OpMovimiento { id: string; sku: string; tipo: TipoMov; qty: number; motivo: string; ref: string; series: string[]; equipo?: string }
export interface OpEntrega { id: string; numero?: string; ts: number; equipo: string; receptor: string; dni: string; lineas: LineaEntrega[]; firma: string; hash?: string }
export interface OpAlbaran { id: string; cabecera: { numero: string; proveedor: string; cif: string; fecha: string; confianza: number; modo: 'ia' | 'sim' }; lineas: { sku: string; cantidad: number; series: string[] }[] }
export interface OpProducto { producto: Producto; nuevo: boolean; stockInicial: number }
export interface OpIncidencia { id: string; dotacion: string; tipo: TipoIncidencia; nota: string; coste?: number; serieNueva?: string; caducaNueva?: string }

export type Op =
  | { op: 'movimiento'; args: OpMovimiento }
  | { op: 'entrega'; args: OpEntrega }
  | { op: 'albaran'; args: OpAlbaran }
  | { op: 'producto'; args: OpProducto }
  | { op: 'pedido'; args: { sku: string; qty: number; proveedor?: string } }
  | { op: 'equipo'; args: { id: string; nombre: string; flota: string; matricula: string; estado: EstadoEquipo } }
  | { op: 'estadoEquipo'; args: { id: string; estado: EstadoEquipo } }
  | { op: 'retirarEquipo'; args: { id: string; destino?: string } }
  | { op: 'tecnico'; args: { id: string; nombre: string; rol: string; dni: string; equipo?: string } }
  | { op: 'asignarTecnico'; args: { tecnico: string; equipo?: string } }
  | { op: 'altaDotacion'; args: Herramienta }
  | { op: 'asignarDotacion'; args: { id: string; dotacion: string; equipo?: string; tecnico?: string } }
  | { op: 'incidencia'; args: OpIncidencia }
  | { op: 'recuento'; args: { id: string; pasillo: string; lineas: { sku: string; contado: number }[] } }
  | { op: 'validarPendiente'; args: { id: string; aprobar: boolean; nota: string } }
  | { op: 'borrador'; args: { sku: string; ean: string; nombre: string; cat: CatId } }
  | { op: 'borrarProducto'; args: { sku: string } }
  | { op: 'perfil'; args: { id: string; nombre: string; rol: Rol; activo: boolean } }
  | { op: 'minimos'; args: { cambios: { sku: string; minimo: number; objetivo?: number | null; proveedorHabitual?: string }[] } }
  | { op: 'minimoHerramienta'; args: { modelo: string; minimo: number; objetivo?: number; proveedor: string } }
  | { op: 'pedidoHerramienta'; args: { modelo: string; qty: number; proveedor?: string } }
  | { op: 'configAvisos'; args: ConfigAvisos }
  | { op: 'propietario'; args: Propietario }
  | { op: 'cambiarPropiedad'; args: { sku: string; propiedad: 'propia' | 'custodia'; propietario?: string } }
  | { op: 'envio'; args: { canal: 'correo' | 'push' | 'telegram'; tipo: 'prueba' | 'solicitud' | 'informe'; asunto: string; cuerpo: string; destinatarios: string[]; csv?: string } }
  | { op: 'acta'; args: { id: string; propietario: string; representante: string; firma: string; lineas: { sku: string; contado: number }[] } };

type Def<A> = { local: (S: Estado, a: A) => void; rpc: (a: A) => [string, Record<string, unknown>]; desc: (S: Estado, a: A) => string };
type Defs = { [K in Op['op']]: Def<Extract<Op, { op: K }>['args']> };

const nombreProd = (S: Estado, sku: string) => find(S, sku)?.name || sku;

export const OPS: Defs = {
  movimiento: {
    local: (S, a) => {
      if (a.tipo === 'ajuste' && S.rol !== 'admin') throw new Error('Solo el administrador puede hacer ajustes');
      if (a.tipo === 'merma' && S.rol !== 'admin') {
        // el almacén no ve precios: el servidor decide si se aplica (≤ 50 €) o queda pendiente de validar
        const p = find(S, a.sku); if (!p) throw new Error('Producto no encontrado');
        if (!(a.qty > 0)) throw new Error('Indica una cantidad mayor que cero');
        if (a.qty > p.stock) throw new Error(`Solo hay ${p.stock} de ${p.name}`);
        if (!a.motivo.trim()) throw new Error('Indica el motivo del movimiento');
        S.pendientes.unshift({ id: a.id, ts: Date.now(), tipo: 'merma', sku: a.sku, qty: a.qty, reason: a.motivo, ref: a.ref, serials: a.series, operator: S.operator, estado: 'pendiente', provisional: true });
        return;
      }
      applyMovement(S, { id: a.id, sku: a.sku, type: a.tipo, qty: a.qty, reason: a.motivo, ref: a.ref, serials: a.series, equipo: a.equipo });
    },
    rpc: a => ['registrar_movimiento', { p_id: a.id, p_sku: a.sku, p_tipo: a.tipo, p_cantidad: a.qty, p_motivo: a.motivo, p_referencia: a.ref, p_series: a.series, p_equipo: a.equipo ?? null }],
    desc: (S, a) => `${a.tipo} de ${a.qty} · ${nombreProd(S, a.sku)}`,
  },
  entrega: {
    local: (S, a) => {
      const copia = JSON.stringify(S.products);
      try { for (const l of a.lineas) applyMovement(S, { sku: l.sku, type: 'salida', qty: l.qty, reason: 'Entrega a equipo', ref: a.numero || 'Entrega pendiente', serials: l.serials, equipo: a.equipo, entrega: a.id }); }
      catch (e) { S.products = JSON.parse(copia); throw e; }
      S.entregas.unshift({ id: a.id, numero: a.numero, ts: a.ts, equipo: a.equipo, receptor: a.receptor, dni: a.dni, lineas: a.lineas, firma: a.firma, hash: a.hash, operator: S.operator });
    },
    rpc: a => ['registrar_entrega', { p_id: a.id, p_equipo: a.equipo, p_receptor: a.receptor, p_lineas: a.lineas.map(l => ({ sku: l.sku, cantidad: l.qty, series: l.serials })), p_firma: a.firma }],
    desc: (S, a) => `Entrega a ${S.equipos.find(e => e.id === a.equipo)?.nombre || a.equipo} (${a.lineas.length} líneas)`,
  },
  albaran: {
    local: (S, a) => {
      const copia = JSON.stringify(S.products);
      try { for (const l of a.lineas) applyMovement(S, { sku: l.sku, type: 'entrada', qty: l.cantidad, reason: find(S, l.sku)?.propiedad === 'custodia' ? 'Recepción en custodia' : 'Compra a proveedor', ref: `Alb. ${a.cabecera.numero || 's/n'}`, serials: l.series }); }
      catch (e) { S.products = JSON.parse(copia); throw e; }
      S.albaranes.unshift({ numero: a.cabecera.numero || 's/n', proveedor: a.cabecera.proveedor || 'Proveedor', fecha: a.cabecera.fecha, lineas: a.lineas.length,
        unidades: a.lineas.reduce((s, l) => s + l.cantidad, 0), ts: Date.now(), operator: S.operator, confianza: a.cabecera.confianza, modo: a.cabecera.modo });
    },
    rpc: a => ['aprobar_albaran', { p_id: a.id, p_cabecera: a.cabecera, p_lineas: a.lineas }],
    desc: (_S, a) => `Albarán ${a.cabecera.numero} (${a.lineas.length} líneas)`,
  },
  producto: {
    local: (S, { producto: p, nuevo, stockInicial }) => {
      const actual = find(S, p.sku);
      if (nuevo && actual) throw new Error(`Ya existe una referencia con el SKU ${p.sku}`);
      if (actual) { const { stock, serials } = actual; Object.assign(actual, p, { stock, serials: p.serialized ? (serials || []) : serials }); }
      else {
        S.products.push({ ...p, stock: 0, serials: p.serialized ? [] : undefined });
        if (stockInicial > 0 && !p.serialized) applyMovement(S, { sku: p.sku, type: 'ajuste', qty: stockInicial, reason: 'Alta de referencia', ref: 'Stock inicial' });
      }
    },
    rpc: ({ producto: p, nuevo, stockInicial }) => ['guardar_producto', { p_producto: {
      sku: p.sku, nuevo, ean: p.ean ?? '', ref_proveedor: p.supplierRef ?? '', nombre: p.name, categoria: p.cat, unidad: p.unit, formato: p.pack,
      formato_texto: p.packLabel, minimo: p.min, ubicacion: p.loc, proveedor: p.supplier, con_serie: !!p.serialized, precio: p.propiedad === 'custodia' ? null : p.price, stock_inicial: stockInicial,
      propiedad: p.propiedad || 'propia', propietario_id: p.propiedad === 'custodia' ? p.propietario : null,
      objetivo: p.objetivo ?? '', proveedor_habitual: p.proveedorHabitual ?? '', modelo: p.modelo ?? '', talla: p.talla ?? '' } }],
    desc: (_S, a) => `${a.nuevo ? 'Alta' : 'Edición'} de ${a.producto.sku}`,
  },
  pedido: {
    local: (S, a) => {
      if (S.rol !== 'admin') throw new Error('Solo el administrador marca los pedidos');
      if (!(a.qty > 0)) throw new Error('Indica la cantidad pedida');
      S.pedidos[a.sku] = { ts: Date.now(), qty: a.qty };
      const av = S.avisos.find(x => x.sku === a.sku && x.estado !== 'cerrado');
      if (av) Object.assign(av, { estado: 'pedido', cantidadPedida: a.qty, proveedorPedido: a.proveedor || av.grupo, pedidoTs: Date.now(), pedidoPor: S.operator });
    },
    rpc: a => ['marcar_pedido', { p_sku: a.sku, p_cantidad: a.qty, p_proveedor: a.proveedor ?? null }],
    desc: (S, a) => `Pedido de ${nombreProd(S, a.sku)}`,
  },
  equipo: {
    local: (S, a) => {
      if (!a.matricula.trim()) throw new Error('Indica la matrícula del vehículo');
      const e = S.equipos.find(x => x.id === a.id);
      if (e) Object.assign(e, { nombre: a.nombre, flota: a.flota, matricula: a.matricula, estado: a.estado });
      else S.equipos.push({ ...a, tecnicos: [] });
    },
    rpc: a => ['guardar_equipo', { p_equipo: a }],
    desc: (_S, a) => `Equipo ${a.nombre}`,
  },
  estadoEquipo: {
    local: (S, a) => { const e = S.equipos.find(x => x.id === a.id); if (!e) throw new Error('Equipo no encontrado'); e.estado = a.estado; },
    rpc: a => ['cambiar_estado_equipo', { p_equipo: a.id, p_estado: a.estado }],
    desc: (S, a) => `Estado de ${S.equipos.find(x => x.id === a.id)?.nombre || a.id}`,
  },
  retirarEquipo: {
    local: (S, a) => {
      const e = S.equipos.find(x => x.id === a.id); if (!e) throw new Error('Equipo no encontrado');
      if (e.tecnicos.length) throw new Error('El equipo aún tiene técnicos asignados');
      S.herramientas.forEach(h => { if (h.equipo === a.id) h.equipo = a.destino; });
      S.equipos = S.equipos.filter(x => x !== e);
    },
    rpc: a => ['retirar_equipo', { p_equipo: a.id, p_destino: a.destino ?? null }],
    desc: (_S, a) => `Retirar vehículo ${a.id}`,
  },
  tecnico: {
    local: (S, a) => {
      const t = S.tecnicos.find(x => x.id === a.id);
      if (t) Object.assign(t, { nombre: a.nombre, rol: a.rol, dni: a.dni });
      else S.tecnicos.push({ id: a.id, nombre: a.nombre, rol: a.rol, dni: a.dni });
      if (a.equipo !== undefined) OPS.asignarTecnico.local(S, { tecnico: a.id, equipo: a.equipo });
    },
    rpc: a => ['guardar_tecnico', { p_tecnico: { id: a.id, nombre: a.nombre, rol: a.rol, dni_mascara: a.dni, equipo_id: a.equipo ?? '' } }],
    desc: (_S, a) => `Técnico ${a.nombre}`,
  },
  asignarTecnico: {
    local: (S, a) => { S.equipos.forEach(e => { e.tecnicos = e.tecnicos.filter(t => t !== a.tecnico); }); if (a.equipo) { const e = S.equipos.find(x => x.id === a.equipo); if (!e) throw new Error('Equipo no encontrado'); e.tecnicos.push(a.tecnico); } },
    rpc: a => ['asignar_tecnico', { p_tecnico: a.tecnico, p_equipo: a.equipo ?? null }],
    desc: (S, a) => `Asignar ${S.tecnicos.find(t => t.id === a.tecnico)?.nombre || a.tecnico}`,
  },
  altaDotacion: {
    local: (S, h) => { if (S.herramientas.some(x => x.id === h.id)) return; S.herramientas.push(JSON.parse(JSON.stringify(h))); },
    rpc: h => ['alta_dotacion', { p_dotacion: { id: h.id, clase: h.clase, nombre: h.nombre, marca: h.marca, modelo: h.modelo ?? '', serie: h.serie, talla: h.talla ?? '', cantidad: h.cantidad, caduca: h.caduca ?? '', valor: h.valor, equipo_id: h.equipo ?? '', tecnico_id: h.tecnico ?? '' } }],
    desc: (_S, h) => `Alta de ${h.nombre}`,
  },
  asignarDotacion: {
    local: (S, a) => { asignarHerramienta(S, a.dotacion, a.equipo, a.tecnico); },
    rpc: a => ['asignar_dotacion', { p_id: a.id, p_dotacion: a.dotacion, p_equipo: a.equipo ?? null, p_tecnico: a.tecnico ?? null }],
    desc: (S, a) => `Asignar ${S.herramientas.find(h => h.id === a.dotacion)?.nombre || a.dotacion}`,
  },
  incidencia: {
    local: (S, a) => { registrarIncidencia(S, a.dotacion, a.tipo, { nota: a.nota, coste: a.coste, serieNueva: a.serieNueva, caducaNueva: a.caducaNueva }); },
    rpc: a => ['registrar_incidencia', { p_id: a.id, p_dotacion: a.dotacion, p_tipo: a.tipo, p_nota: a.nota, p_coste: a.coste ?? null, p_serie_nueva: a.serieNueva ?? null, p_caduca_nueva: a.caducaNueva ?? null }],
    desc: (S, a) => `${a.tipo} en ${S.herramientas.find(h => h.id === a.dotacion)?.nombre || a.dotacion}`,
  },
  recuento: {
    local: (S, a) => {
      for (const l of a.lineas) {
        const p = find(S, l.sku); if (!p) throw new Error('Producto no encontrado');
        if (!(l.contado >= 0)) throw new Error('La cantidad contada no puede ser negativa');
        const d = redondea(l.contado - p.stock); if (!d) continue;
        if (S.rol === 'admin') applyMovement(S, { sku: p.sku, type: 'ajuste', qty: d, reason: 'Ajuste de inventario', ref: `Recuento pasillo ${a.pasillo}` });
        else S.pendientes.unshift({ id: a.id + ':' + p.sku, ts: Date.now(), tipo: 'recuento', sku: p.sku, qty: d, reason: 'Diferencia de recuento', ref: `Recuento pasillo ${a.pasillo}`, serials: [], operator: S.operator, estado: 'pendiente', provisional: true });
      }
    },
    rpc: a => ['registrar_recuento', { p_id: a.id, p_pasillo: a.pasillo, p_lineas: a.lineas }],
    desc: (_S, a) => `Recuento del pasillo ${a.pasillo}`,
  },
  validarPendiente: {
    local: (S, a) => {
      if (S.rol !== 'admin') throw new Error('Solo el administrador puede validar');
      const pe = S.pendientes.find(x => x.id === a.id); if (!pe || pe.estado !== 'pendiente') return;
      if (a.aprobar) {
        const tipo = pe.tipo === 'merma' ? 'merma' : 'ajuste';
        const p = find(S, pe.sku); if (p && p.stock + delta(tipo, pe.qty) < 0) throw new Error(`Solo hay ${p.stock} de ${p.name}: no se puede aplicar`);
        applyMovement(S, { sku: pe.sku, type: tipo, qty: pe.qty, reason: pe.tipo === 'merma' ? pe.reason : 'Ajuste de inventario (recuento validado)', ref: pe.ref, serials: pe.serials });
      }
      pe.estado = a.aprobar ? 'aprobado' : 'rechazado'; pe.resueltoPor = S.operator; pe.nota = a.nota;
    },
    rpc: a => ['validar_pendiente', { p_pendiente: a.id, p_aprobar: a.aprobar, p_nota: a.nota }],
    desc: (_S, a) => a.aprobar ? 'Aprobar pendiente' : 'Rechazar pendiente',
  },
  borrador: {
    local: (S, a) => {
      const sku = (a.sku || (a.ean ? 'BORR-' + a.ean : '')).trim().toUpperCase();
      if (!sku) throw new Error('Escanea o escribe el código');
      if (S.products.some(p => p.sku === sku || (a.ean && p.ean === a.ean))) throw new Error('Ya existe una referencia con ese código');
      S.products.push({ sku, ean: a.ean || undefined, name: a.nombre.trim() || `Borrador ${sku}`, cat: a.cat, unit: 'ud', pack: 1, packLabel: '', stock: 0, min: 0, loc: 'P00-E00-N0', supplier: '', price: 0,
        serialized: a.cat === 'cargadores', serials: a.cat === 'cargadores' ? [] : undefined, borrador: true });
    },
    rpc: a => ['crear_borrador_producto', { p_sku: a.sku, p_ean: a.ean, p_nombre: a.nombre, p_categoria: a.cat }],
    desc: (_S, a) => `Borrador ${a.sku || a.ean}`,
  },
  borrarProducto: {
    local: (S, a) => {
      if (S.rol !== 'admin') throw new Error('Solo el administrador puede borrar referencias');
      const p = find(S, a.sku); if (!p) return;
      if (S.movements.some(m => m.sku === a.sku)) throw new Error('La referencia tiene historial: no se puede borrar (deja el mínimo a 0 si ya no se usa)');
      if (p.stock !== 0) throw new Error('Solo se puede borrar una referencia sin stock');
      S.products = S.products.filter(x => x !== p);
    },
    rpc: a => ['borrar_producto', { p_sku: a.sku }],
    desc: (_S, a) => `Borrar ${a.sku}`,
  },
  perfil: {
    local: (S, a) => { const u = S.perfiles.find(x => x.id === a.id); if (u) Object.assign(u, { nombre: a.nombre, rol: a.rol, activo: a.activo }); },
    rpc: a => ['actualizar_perfil', { p_id: a.id, p_nombre: a.nombre, p_rol: a.rol, p_activo: a.activo }],
    desc: (_S, a) => `Usuario ${a.nombre}`,
  },
  minimos: {
    local: (S, a) => {
      if (S.rol !== 'admin') throw new Error('Solo el administrador puede cambiar mínimos y objetivos');
      for (const c of a.cambios) {
        if (!(c.minimo >= 0) || (c.objetivo != null && !(c.objetivo >= 0))) throw new Error('Los mínimos y objetivos no pueden ser negativos');
        const p = find(S, c.sku); if (!p) continue;
        p.min = c.minimo; if (c.objetivo !== undefined) p.objetivo = c.objetivo ?? undefined; if (c.proveedorHabitual !== undefined) p.proveedorHabitual = c.proveedorHabitual || undefined;
      }
    },
    rpc: a => ['fijar_minimos', { p_cambios: a.cambios.map(c => ({ sku: c.sku, minimo: c.minimo, ...(c.objetivo !== undefined ? { objetivo: c.objetivo } : {}), ...(c.proveedorHabitual !== undefined ? { proveedor_habitual: c.proveedorHabitual } : {}) })) }],
    desc: (_S, a) => `Mínimos de ${a.cambios.length} referencia${a.cambios.length === 1 ? '' : 's'}`,
  },
  minimoHerramienta: {
    local: (S, a) => {
      if (S.rol !== 'admin') throw new Error('Solo el administrador puede cambiar mínimos');
      S.minimosHerramienta = S.minimosHerramienta.filter(m => m.modelo !== a.modelo);
      if (a.minimo > 0) S.minimosHerramienta.push({ modelo: a.modelo, minimo: a.minimo, objetivo: a.objetivo, proveedor: a.proveedor });
    },
    rpc: a => ['fijar_minimo_herramienta', { p_modelo: a.modelo, p_minimo: a.minimo, p_objetivo: a.objetivo ?? null, p_proveedor: a.proveedor }],
    desc: (_S, a) => `Repuesto mínimo de ${a.modelo}`,
  },
  pedidoHerramienta: {
    local: (S, a) => { if (S.rol !== 'admin') throw new Error('Solo el administrador puede marcar pedidos'); const av = S.avisos.find(x => x.modeloHerramienta === a.modelo && x.estado !== 'cerrado'); if (av) Object.assign(av, { estado: 'pedido', cantidadPedida: a.qty, proveedorPedido: a.proveedor || av.grupo, pedidoTs: Date.now() }); },
    rpc: a => ['marcar_pedido_herramienta', { p_modelo: a.modelo, p_cantidad: a.qty, p_proveedor: a.proveedor ?? null }],
    desc: (_S, a) => `Pedido de ${a.modelo}`,
  },
  configAvisos: {
    local: (S, a) => { if (S.rol !== 'admin') throw new Error('Solo el administrador puede cambiar la configuración'); S.configAvisos = { ...a }; },
    rpc: a => ['guardar_config_avisos', { p: { correo_activo: a.correoActivo, correo_modo: a.correoModo, correo_hora: a.correoHora, correo_remitente: a.correoRemitente, correo_destinatarios: a.correoDestinatarios,
      push_activo: a.pushActivo, push_modo: a.pushModo, push_hora: a.pushHora, telegram_activo: a.telegramActivo, telegram_modo: a.telegramModo, telegram_hora: a.telegramHora,
      telegram_chat_id: a.telegramChatId, dias_recordatorio: a.diasRecordatorio, custodia_envio: a.custodiaEnvio, informe_custodia: a.informeCustodia } }],
    desc: () => 'Configuración de avisos',
  },
  propietario: {
    local: (S, a) => { if (S.rol !== 'admin') throw new Error('Solo el administrador puede editar el propietario'); const o = S.propietarios.find(x => x.id === a.id); if (o) Object.assign(o, a); else S.propietarios.push({ ...a }); },
    rpc: a => ['guardar_propietario', { p: { id: a.id, nombre: a.nombre, contacto: a.contacto, correos_reposicion: a.correosReposicion, correos_informes: a.correosInformes } }],
    desc: (_S, a) => `Propietario ${a.nombre}`,
  },
  cambiarPropiedad: {
    local: (S, a) => {
      if (S.rol !== 'admin') throw new Error('Solo el administrador puede cambiar la propiedad');
      const p = find(S, a.sku); if (!p) throw new Error('Producto no encontrado');
      if (a.propiedad === 'custodia' && !a.propietario) throw new Error('Indica de quién es el material');
      p.propiedad = a.propiedad; p.propietario = a.propiedad === 'custodia' ? a.propietario : undefined; if (a.propiedad === 'custodia') p.price = 0;
    },
    rpc: a => ['cambiar_propiedad', { p_sku: a.sku, p_propiedad: a.propiedad, p_propietario: a.propietario ?? null }],
    desc: (_S, a) => `Propiedad de ${a.sku}`,
  },
  envio: {
    local: (S, a) => {
      if (S.rol !== 'admin') throw new Error('Solo el administrador puede enviar avisos e informes');
      if (a.canal === 'correo' && !a.destinatarios.length && !S.configAvisos.correoDestinatarios.length) throw new Error('No hay destinatarios de correo configurados');
      S.envios.unshift({ id: 'local:' + Date.now(), ts: Date.now(), canal: a.canal, tipo: a.tipo, asunto: a.asunto, estado: 'pendiente' });
    },
    rpc: a => ['encolar_envio', { p_canal: a.canal, p_tipo: a.tipo, p_asunto: a.asunto, p_cuerpo: a.cuerpo, p_destinatarios: a.destinatarios, p_adjunto_csv: a.csv ?? null }],
    desc: (_S, a) => `Envío (${a.canal}): ${a.asunto}`,
  },
  acta: {
    local: (S, a) => {
      if (!a.representante.trim()) throw new Error('Indica el nombre del representante');
      if (!a.firma) throw new Error('Falta la firma del representante');
      const lineas = a.lineas.map(l => { const p = find(S, l.sku); return p && p.propiedad === 'custodia' && p.propietario === a.propietario ? { sku: p.sku, sistema: p.stock, contado: l.contado } : null; }).filter((x): x is { sku: string; sistema: number; contado: number } => !!x);
      if (!lineas.length) throw new Error('El acta no tiene artículos de ese propietario');
      S.actas.unshift({ id: a.id, ts: Date.now(), propietario: a.propietario, representante: a.representante.trim(), firma: a.firma, lineas, operator: S.operator });
    },
    rpc: a => ['registrar_acta_custodia', { p_id: a.id, p_propietario: a.propietario, p_representante: a.representante, p_firma: a.firma, p_lineas: a.lineas }],
    desc: (_S, a) => `Acta de recuento de custodia (${a.lineas.length} referencias)`,
  },
};


export function aplicarLocal(S: Estado, o: Op) { (OPS[o.op].local as (S: Estado, a: unknown) => void)(S, o.args); }
export function rpcDe(o: Op) { return (OPS[o.op].rpc as (a: unknown) => [string, Record<string, unknown>])(o.args); }
export function descripcion(S: Estado, o: Op) { return (OPS[o.op].desc as (S: Estado, a: unknown) => string)(S, o.args); }
/** UUID v4 generado en el cliente: es la clave de idempotencia de cada operación */
export function nuevoId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
