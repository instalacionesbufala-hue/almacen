/* Operaciones de escritura. Cada una sabe:
   - aplicarse en local (validación previa con src/domain y respuesta inmediata en pantalla), y
   - traducirse a su función SQL del servidor (la fuente de verdad en modo nube).
   En modo nube la operación se guarda en la cola y se reaplica en local hasta que el servidor la confirma. */
import type { OrigenFoto, Tallas, ConfigAvisos, Propietario, Rol, CatId, EstadoEquipo, Estado, Herramienta, LineaEntrega, Producto, TipoIncidencia, TipoMov } from '../data/tipos';
import { applyMovement, find, delta, disponibleReal, formatoEntero, vehiculoDeEquipo } from '../domain/reglas';
import { emailValido, herramientasLibres } from '../domain/entregas';
import { redondea } from '../domain/formato';
import { asignarHerramienta, registrarIncidencia } from '../domain/herramientas';
import { fotoDe, grupoFoto } from '../domain/fotos';
import { normalizarTelefono } from '../domain/whatsapp';

export interface OpMovimiento { id: string; sku: string; tipo: TipoMov; qty: number; motivo: string; ref: string; series: string[]; equipo?: string; vehiculo?: string }
export interface OpAlbaran { id: string; cabecera: { numero: string; proveedor: string; cif: string; fecha: string; confianza: number; modo: 'ia' | 'sim' }; lineas: { sku: string; cantidad: number; series: string[] }[] }
export interface OpProducto { producto: Producto; nuevo: boolean; stockInicial: number }
/** Fila del CSV del catálogo (E-013), ya interpretada */
export interface FilaCatalogo { sku: string; ref_proveedor: string; nombre: string; categoria: CatId; propiedad: 'propia' | 'custodia'; propietario: string; proveedor: string; unidad: Producto['unit']; contenido: number; stock_inicial: number; minimo: number | null; albaranes: string }
export interface OpIncidencia { id: string; dotacion: string; tipo: TipoIncidencia; nota: string; coste?: number; serieNueva?: string; caducaNueva?: string }

export type Op =
  | { op: 'movimiento'; args: OpMovimiento }
  | { op: 'albaran'; args: OpAlbaran }
  | { op: 'producto'; args: OpProducto }
  | { op: 'pedido'; args: { sku: string; qty: number; proveedor?: string } }
  | { op: 'equipo'; args: { id: string; nombre: string; estado: EstadoEquipo } }
  | { op: 'vehiculo'; args: { id: string; matricula: string; modelo: string } }
  | { op: 'asignarVehiculo'; args: { vehiculo: string; equipo?: string } }
  | { op: 'bajaTecnico'; args: { id: string } }
  | { op: 'bajaVehiculo'; args: { id: string } }
  | { op: 'mermaVista'; args: { id: string } }
  | { op: 'limpiarDemo'; args: Record<string, never> }
  | { op: 'importarCatalogo'; args: { filas: FilaCatalogo[] } }
  | { op: 'estadoEquipo'; args: { id: string; estado: EstadoEquipo } }
  | { op: 'retirarEquipo'; args: { id: string; destino?: string } }
  | { op: 'tecnico'; args: { id: string; nombre: string; rol: string; dni: string; equipo?: string; email?: string; codigo?: string; telefono?: string } }
  | { op: 'asignarTecnico'; args: { tecnico: string; equipo?: string } }
  | { op: 'altaDotacion'; args: Herramienta }
  | { op: 'asignarDotacion'; args: { id: string; dotacion: string; equipo?: string; tecnico?: string } }
  | { op: 'incidencia'; args: OpIncidencia }
  | { op: 'recuento'; args: { id: string; pasillo: string; lineas: { sku: string; contado: number }[] } }
  | { op: 'validarPendiente'; args: { id: string; aprobar: boolean; nota: string } }
  | { op: 'borrador'; args: { sku: string; ean: string; nombre: string; cat: CatId } }
  | { op: 'borradorArticulo'; args: { producto: Producto; stockInicial: number } }
  | { op: 'borrarProducto'; args: { sku: string } }
  | { op: 'perfil'; args: { id: string; nombre: string; rol: Rol; activo: boolean } }
  | { op: 'minimos'; args: { cambios: { sku: string; minimo: number; objetivo?: number | null; proveedorHabitual?: string }[] } }
  | { op: 'minimoHerramienta'; args: { modelo: string; minimo: number; objetivo?: number; proveedor: string } }
  | { op: 'pedidoHerramienta'; args: { modelo: string; qty: number; proveedor?: string } }
  | { op: 'configAvisos'; args: ConfigAvisos }
  | { op: 'propietario'; args: Propietario }
  | { op: 'cambiarPropiedad'; args: { sku: string; propiedad: 'propia' | 'custodia'; propietario?: string } }
  | { op: 'envio'; args: { canal: 'correo' | 'push' | 'telegram'; tipo: 'prueba' | 'solicitud' | 'informe'; asunto: string; cuerpo: string; destinatarios: string[]; csv?: string } }
  | { op: 'prepararEntrega'; args: { id: string; equipo: string; receptor: string; obra: string; lineas: LineaEntrega[]; numero?: string; caduca?: number } }
  | { op: 'confirmarEntrega'; args: { id: string; firma: string; hash?: string } }
  | { op: 'anularEntrega'; args: { id: string } }
  | { op: 'emailTecnico'; args: { tecnico: string; email: string } }
  | { op: 'reenviarCopia'; args: { entrega: string; email?: string } }
  | { op: 'tallas'; args: { tecnico: string; tallas: Tallas } }
  | { op: 'telefonoTecnico'; args: { tecnico: string; telefono: string } }
  | { op: 'enlacePortal'; args: { tecnico: string; hash: string; entrega?: string } }
  | { op: 'revocarPortal'; args: { tecnico: string } }
  | { op: 'copiaEntrega'; args: { id: string; entrega: string; canal: 'whatsapp' | 'compartir'; destino: string } }
  | { op: 'foto'; args: { sku: string; foto: string; mini: string; origen: OrigenFoto } }
  | { op: 'quitarFoto'; args: { sku: string } }
  | { op: 'acta'; args: { id: string; propietario: string; representante: string; firma: string; lineas: { sku: string; contado: number }[] } };

type Def<A> = { local: (S: Estado, a: A) => void; rpc: (a: A) => [string, Record<string, unknown>]; desc: (S: Estado, a: A) => string };
type Defs = { [K in Op['op']]: Def<Extract<Op, { op: K }>['args']> };

const nombreProd = (S: Estado, sku: string) => find(S, sku)?.name || sku;

export const OPS: Defs = {
  movimiento: {
    local: (S, a) => {
      if (a.tipo === 'ajuste' && S.rol !== 'admin') throw new Error('Solo el administrador puede hacer ajustes');
      if ((a.tipo === 'traspaso' || a.tipo === 'devolucion') && !a.vehiculo) throw new Error('Indica el vehículo');
      applyMovement(S, { id: a.id, sku: a.sku, type: a.tipo, qty: a.qty, reason: a.motivo, ref: a.ref, equipo: a.equipo, vehiculo: a.vehiculo });
      // E-013: las mermas se aplican al momento y se informa al administrador (en la nube, también por sus canales)
      if (a.tipo === 'merma') S.pendientes.unshift({ id: nuevoId(), ts: Date.now(), tipo: 'merma', sku: a.sku, qty: a.qty, reason: a.motivo,
        ref: a.ref + (a.vehiculo ? ` · vehículo ${S.vehiculos.find(v => v.id === a.vehiculo)?.matricula || a.vehiculo}` : ''), serials: [], operator: S.operator, estado: 'aplicada' });
    },
    rpc: a => ['registrar_movimiento', { p_id: a.id, p_sku: a.sku, p_tipo: a.tipo, p_cantidad: a.qty, p_motivo: a.motivo, p_referencia: a.ref, p_series: [], p_equipo: a.equipo ?? null, p_corrige: null, p_vehiculo: a.vehiculo ?? null }],
    desc: (S, a) => `${a.tipo} de ${a.qty} · ${nombreProd(S, a.sku)}`,
  },
  albaran: {
    local: (S, a) => {
      const copia = JSON.stringify(S.products);
      try { for (const l of a.lineas) applyMovement(S, { sku: l.sku, type: 'entrada', qty: l.cantidad, reason: find(S, l.sku)?.propiedad === 'custodia' ? 'Recepción en custodia' : 'Compra a proveedor', ref: `Alb. ${a.cabecera.numero || 's/n'}` }); }
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
      if (formatoEntero(p) && stockInicial !== Math.trunc(stockInicial)) throw new Error(`El stock inicial de ${p.name} va en ${p.unit} enteros`);
      if (actual) {
        // E-015: completar (aprobar) un borrador mete su stock inicial (la app lo envía precargado con lo que contó el almacén)
        const { stock, borrador } = actual;
        Object.assign(actual, p, { stock, borrador: false, stockPropuesto: undefined, propuestoPor: undefined });
        const inicial = borrador ? stockInicial : 0;
        if (borrador && inicial > 0) applyMovement(S, { sku: p.sku, type: 'entrada', qty: inicial, reason: 'Alta de artículo', ref: 'Borrador aprobado' });
      } else {
        S.products.push({ ...p, stock: 0 });
        if (stockInicial > 0) applyMovement(S, { sku: p.sku, type: 'entrada', qty: stockInicial, reason: 'Alta de artículo', ref: 'Stock inicial' });
      }
    },
    rpc: ({ producto: p, nuevo, stockInicial }) => ['guardar_producto', { p_producto: {
      sku: p.sku, nuevo, ean: p.ean ?? '', ref_proveedor: p.supplierRef ?? '', nombre: p.name, categoria: p.cat, unidad: p.unit, contenido: p.contenido ?? 1,
      formato_texto: p.packLabel ?? '', minimo: p.minimoDefinido === false ? '' : p.min, proveedor: p.supplier, stock_inicial: stockInicial,
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
      if (S.rol !== 'admin') throw new Error('Solo el administrador gestiona los equipos');
      if (!a.nombre.trim()) throw new Error('Indica el nombre del equipo (como lo envía el wizard: "Búfala 1")');
      const e = S.equipos.find(x => x.id === a.id);
      if (e) Object.assign(e, { nombre: a.nombre.trim(), estado: a.estado });
      else S.equipos.push({ id: a.id, nombre: a.nombre.trim(), estado: a.estado, tecnicos: [] });
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
      if (e.vehiculo) OPS.asignarVehiculo.local(S, { vehiculo: e.vehiculo });
      S.herramientas.forEach(h => { if (h.equipo === a.id) h.equipo = a.destino; });
      S.equipos = S.equipos.filter(x => x !== e);
    },
    rpc: a => ['retirar_equipo', { p_equipo: a.id, p_destino: a.destino ?? null }],
    desc: (_S, a) => `Retirar vehículo ${a.id}`,
  },
  tecnico: {
    local: (S, a) => {
      const t = S.tecnicos.find(x => x.id === a.id);
      if (a.email && !emailValido(a.email)) throw new Error(`Correo no válido: ${a.email}`);
      const email = a.email === undefined ? t?.email : a.email.trim().toLowerCase() || undefined;
      const extra = { ...(a.codigo !== undefined ? { codigo: a.codigo.trim().toUpperCase() || undefined } : {}), ...(a.telefono !== undefined ? { telefono: a.telefono.trim() || undefined } : {}) };
      if (t) Object.assign(t, { nombre: a.nombre, rol: a.rol, dni: a.dni, email }, extra);
      else S.tecnicos.push({ id: a.id, nombre: a.nombre, rol: a.rol, dni: a.dni, email, ...extra });
      if (a.equipo !== undefined) OPS.asignarTecnico.local(S, { tecnico: a.id, equipo: a.equipo });
    },
    rpc: a => ['guardar_tecnico', { p_tecnico: { id: a.id, nombre: a.nombre, rol: a.rol, dni_mascara: a.dni, equipo_id: a.equipo ?? '', ...(a.email !== undefined ? { email: a.email } : {}), ...(a.codigo !== undefined ? { codigo: a.codigo } : {}), ...(a.telefono !== undefined ? { telefono: a.telefono } : {}) } }],
    desc: (_S, a) => `Técnico ${a.nombre}`,
  },
  asignarTecnico: {
    local: (S, a) => {
      if (a.equipo && !S.equipos.some(x => x.id === a.equipo)) throw new Error('Equipo no encontrado');
      const ahora = Date.now();
      S.equipos.forEach(e => { e.tecnicos = e.tecnicos.filter(t => t !== a.tecnico); });
      S.asignaciones.forEach(x => { if (x.tipo === 'tecnico' && x.sujeto === a.tecnico && x.hasta === undefined) x.hasta = ahora; });
      if (a.equipo) { S.equipos.find(x => x.id === a.equipo)!.tecnicos.push(a.tecnico); S.asignaciones.push({ tipo: 'tecnico', sujeto: a.tecnico, equipo: a.equipo, desde: ahora }); }
    },
    rpc: a => ['asignar_tecnico', { p_tecnico: a.tecnico, p_equipo: a.equipo ?? null }],
    desc: (S, a) => `Asignar ${S.tecnicos.find(t => t.id === a.tecnico)?.nombre || a.tecnico}`,
  },
  vehiculo: {
    local: (S, a) => {
      if (S.rol !== 'admin') throw new Error('Solo el administrador gestiona los vehículos');
      const m = a.matricula.trim().toUpperCase(); if (!m) throw new Error('Indica la matrícula');
      if (S.vehiculos.some(v => v.matricula === m && v.id !== a.id)) throw new Error(`Ya hay un vehículo con la matrícula ${m}`);
      const v = S.vehiculos.find(x => x.id === a.id);
      if (v) Object.assign(v, { matricula: m, modelo: a.modelo.trim() }); else S.vehiculos.push({ id: a.id, matricula: m, modelo: a.modelo.trim() });
    },
    rpc: a => ['guardar_vehiculo', { p_vehiculo: { id: a.id, matricula: a.matricula, modelo: a.modelo } }],
    desc: (_S, a) => `Vehículo ${a.matricula}`,
  },
  asignarVehiculo: {
    // vehículo → equipo (o sin equipo). Un equipo lleva un solo vehículo; el material va con el vehículo.
    local: (S, a) => {
      const v = S.vehiculos.find(x => x.id === a.vehiculo); if (!v) throw new Error('Vehículo no encontrado');
      if (a.equipo && !S.equipos.some(x => x.id === a.equipo)) throw new Error('Equipo no encontrado');
      if ((v.equipo || undefined) === (a.equipo || undefined)) return;
      const ahora = Date.now(), soltar = (id: string) => {
        const x = S.vehiculos.find(y => y.id === id)!; const e = S.equipos.find(y => y.id === x.equipo); if (e) e.vehiculo = undefined; x.equipo = undefined;
        S.asignaciones.forEach(h => { if (h.tipo === 'vehiculo' && h.sujeto === id && h.hasta === undefined) h.hasta = ahora; });
      };
      const otro = S.equipos.find(e => e.id === a.equipo)?.vehiculo; if (otro && otro !== v.id) soltar(otro);
      soltar(v.id);
      if (a.equipo) { v.equipo = a.equipo; S.equipos.find(e => e.id === a.equipo)!.vehiculo = v.id; S.asignaciones.push({ tipo: 'vehiculo', sujeto: v.id, equipo: a.equipo, desde: ahora }); }
    },
    rpc: a => ['asignar_vehiculo', { p_vehiculo: a.vehiculo, p_equipo: a.equipo ?? null }],
    desc: (S, a) => `Vehículo ${S.vehiculos.find(v => v.id === a.vehiculo)?.matricula || a.vehiculo} → ${S.equipos.find(e => e.id === a.equipo)?.nombre || 'sin equipo'}`,
  },
  bajaTecnico: {
    local: (S, a) => { if (S.rol !== 'admin') throw new Error('Solo el administrador da de baja'); OPS.asignarTecnico.local(S, { tecnico: a.id }); S.tecnicos = S.tecnicos.filter(t => t.id !== a.id); },
    rpc: a => ['baja_tecnico', { p_tecnico: a.id }],
    desc: (S, a) => `Baja de ${S.tecnicos.find(t => t.id === a.id)?.nombre || a.id}`,
  },
  bajaVehiculo: {
    local: (S, a) => {
      if (S.rol !== 'admin') throw new Error('Solo el administrador da de baja');
      if (S.aBordo.some(x => x.vehiculo === a.id && x.unidades > 0)) throw new Error('El vehículo aún lleva material: devuélvelo al almacén antes de darlo de baja');
      OPS.asignarVehiculo.local(S, { vehiculo: a.id }); S.vehiculos = S.vehiculos.filter(v => v.id !== a.id);
    },
    rpc: a => ['baja_vehiculo', { p_vehiculo: a.id }],
    desc: (S, a) => `Baja del vehículo ${S.vehiculos.find(v => v.id === a.id)?.matricula || a.id}`,
  },
  mermaVista: {
    local: (S, a) => { const p = S.pendientes.find(x => x.id === a.id); if (p && p.estado === 'aplicada') { p.estado = 'vista'; p.resueltoPor = S.operator; } },
    rpc: a => ['marcar_merma_vista', { p_pendiente: a.id }],
    desc: () => 'Merma vista',
  },
  telefonoTecnico: {
    // E-014: como el correo, cualquier usuario activo lo puede escribir (desde la pantalla de firma); se guarda en formato +34…
    local: (S, a) => {
      const t = S.tecnicos.find(x => x.id === a.tecnico); if (!t) throw new Error('Técnico no encontrado');
      const n = a.telefono.trim() ? normalizarTelefono(a.telefono) : '';
      if (n === null) throw new Error('Teléfono no válido: escríbelo con 9 cifras o con el prefijo del país (+34 600 000 000)');
      t.telefono = n || undefined;
    },
    rpc: a => ['guardar_telefono_tecnico', { p_tecnico: a.tecnico, p_telefono: a.telefono.trim() ? normalizarTelefono(a.telefono) : '' }],
    desc: (S, a) => `Teléfono de ${S.tecnicos.find(t => t.id === a.tecnico)?.nombre || a.tecnico}`,
  },
  enlacePortal: {
    // E-014: el token lo genera este dispositivo; solo viaja y se guarda su hash
    local: (S, a) => {
      if (!/^[0-9a-f]{64}$/.test(a.hash)) throw new Error('Enlace no válido');
      if (!S.tecnicos.some(t => t.id === a.tecnico)) throw new Error('Técnico no encontrado');
      if (!S.portalEnlaces.some(e => e.hash === a.hash)) S.portalEnlaces.push({ tecnico: a.tecnico, entrega: a.entrega, creado: Date.now(), creadoPor: S.operator, hash: a.hash });
    },
    rpc: a => ['crear_enlace_portal', { p_tecnico: a.tecnico, p_hash: a.hash, p_entrega: a.entrega && /^[0-9a-f-]{36}$/.test(a.entrega) ? a.entrega : null }],
    desc: (S, a) => `Enlace del portal para ${S.tecnicos.find(t => t.id === a.tecnico)?.nombre || a.tecnico}`,
  },
  revocarPortal: {
    local: (S, a) => {
      if (S.rol !== 'admin') throw new Error('Solo el administrador revoca los enlaces del portal');
      for (const e of S.portalEnlaces) if (e.tecnico === a.tecnico && !e.revocado) e.revocado = Date.now();
    },
    rpc: a => ['revocar_enlaces_portal', { p_tecnico: a.tecnico }],
    desc: (S, a) => `Revocar los enlaces de ${S.tecnicos.find(t => t.id === a.tecnico)?.nombre || a.tecnico}`,
  },
  copiaEntrega: {
    local: (S, a) => {
      const e = S.entregas.find(x => x.id === a.entrega);
      if (!e || (e.estado ?? 'firmada') !== 'firmada') throw new Error('Solo se envían copias de entregas firmadas');
      if (!S.copias.some(c => c.id === a.id)) S.copias.unshift({ id: a.id, entrega: a.entrega, canal: a.canal, destino: a.destino, ts: Date.now(), operator: S.operator });
    },
    rpc: a => ['registrar_copia_entrega', { p_id: a.id, p_entrega: a.entrega, p_canal: a.canal, p_destino: a.destino }],
    desc: (_S, a) => `Copia por ${a.canal === 'whatsapp' ? 'WhatsApp' : 'PDF compartido'}`,
  },
  limpiarDemo: {
    // E-013: una sola vez. Conserva los usuarios, la configuración de avisos y el propietario Esmove.
    local: S => {
      if (S.rol !== 'admin') throw new Error('Solo el administrador puede borrar los datos de ejemplo');
      if (!S.configApp.modoDemo) throw new Error('Los datos de ejemplo ya se borraron');
      Object.assign(S, { products: [], movements: [], albaranes: [], equipos: [], tecnicos: [], entregas: [], herramientas: [], pendientes: [], avisos: [], minimosHerramienta: [],
        envios: [], actas: [], vehiculos: [], asignaciones: [], aBordo: [], portalEnlaces: [], copias: [], pedidos: {}, cesta: { equipo: '', receptor: null, lineas: [], obra: '', paso: 1 }, seq: { ent: 0 } });
      S.configApp = { modoDemo: false, demoBorrada: Date.now(), demoBorradaPor: S.operator };
    },
    rpc: () => ['limpiar_demostracion', {}],
    desc: () => 'Borrar los datos de ejemplo',
  },
  importarCatalogo: {
    // E-013: idempotente por SKU (no toca lo que ya existe) y por albaranes (el inventario de apertura entra una sola vez)
    local: (S, a) => {
      if (S.rol !== 'admin') throw new Error('Solo el administrador importa el catálogo');
      for (const f of a.filas) {
        const sku = f.sku.trim().toUpperCase(); if (!sku) throw new Error('Hay una fila sin SKU');
        const prop = f.propiedad === 'custodia' ? S.propietarios.find(o => o.id.toUpperCase() === f.propietario.trim().toUpperCase() || o.nombre.toLowerCase() === f.propietario.trim().toLowerCase())?.id : undefined;
        if (f.propiedad === 'custodia' && !prop) throw new Error(`Propietario desconocido en ${sku}: ${f.propietario}`);
        if (!find(S, sku)) S.products.push({ sku, supplierRef: f.ref_proveedor || undefined, name: f.nombre.trim(), cat: f.categoria, unit: f.unidad, contenido: f.contenido || 1,
          stock: 0, min: f.minimo ?? 0, minimoDefinido: f.minimo !== null, supplier: f.proveedor, propiedad: prop ? 'custodia' : 'propia', propietario: prop });
        const ref = 'Albaranes ' + (f.albaranes.trim() || 'sin albarán');
        if (f.stock_inicial > 0 && !S.movements.some(m => m.sku === sku && m.reason === 'Inventario de apertura' && m.ref === ref))
          applyMovement(S, { sku, type: 'entrada', qty: f.stock_inicial, reason: 'Inventario de apertura', ref });
      }
    },
    rpc: a => ['importar_catalogo', { p_filas: a.filas }],
    desc: (_S, a) => `Importar catálogo (${a.filas.length} artículos)`,
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
  borradorArticulo: {
    // E-015: el almacén crea el artículo completo como borrador; el stock no entra hasta que el administrador lo aprueba
    local: (S, { producto: p, stockInicial }) => {
      const code = (v?: string) => String(v || '').toUpperCase();
      const otro = S.products.find(x => x.sku === code(p.sku) || (p.ean && x.ean === p.ean) || (p.supplierRef && code(x.supplierRef) === code(p.supplierRef)));
      if (otro) throw new Error(`Ya existe una referencia con ese código: ${otro.sku} (${otro.name})`);
      if (!p.name.trim()) throw new Error('Indica el nombre del artículo');
      if (formatoEntero(p) && stockInicial !== Math.trunc(stockInicial)) throw new Error(`El stock inicial va en ${p.unit} enteros`);
      S.products.push({ ...p, sku: code(p.sku), stock: 0, min: 0, minimoDefinido: false, borrador: true, stockPropuesto: stockInicial, propuestoPor: S.operator });
    },
    rpc: ({ producto: p, stockInicial }) => ['crear_borrador_articulo', { p: {
      sku: p.sku, ean: p.ean ?? '', ref_proveedor: p.supplierRef ?? '', nombre: p.name, categoria: p.cat, unidad: p.unit, contenido: p.contenido ?? 1,
      proveedor: p.supplier, stock_inicial: stockInicial, propiedad: p.propiedad || 'propia', propietario_id: p.propiedad === 'custodia' ? p.propietario : null,
      modelo: p.modelo ?? '', talla: p.talla ?? '' } }],
    desc: (_S, a) => `Borrador ${a.producto.sku} · ${a.producto.name}`,
  },
  borrador: {
    local: (S, a) => {
      const sku = (a.sku || (a.ean ? 'BORR-' + a.ean : '')).trim().toUpperCase();
      if (!sku) throw new Error('Escanea o escribe el código');
      if (S.products.some(p => p.sku === sku || (a.ean && p.ean === a.ean))) throw new Error('Ya existe una referencia con ese código');
      S.products.push({ sku, ean: a.ean || undefined, name: a.nombre.trim() || `Borrador ${sku}`, cat: a.cat, unit: 'ud', stock: 0, min: 0, minimoDefinido: false, supplier: '', borrador: true });
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
        p.min = c.minimo; p.minimoDefinido = true; if (c.objetivo !== undefined) p.objetivo = c.objetivo ?? undefined; if (c.proveedorHabitual !== undefined) p.proveedorHabitual = c.proveedorHabitual || undefined;
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
      telegram_chat_id: a.telegramChatId, dias_recordatorio: a.diasRecordatorio, custodia_envio: a.custodiaEnvio, informe_custodia: a.informeCustodia,
      horas_reserva: a.horasReserva, copia_entregas_admin: !!a.copiaEntregasAdmin } }],
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
      p.propiedad = a.propiedad; p.propietario = a.propiedad === 'custodia' ? a.propietario : undefined;
    },
    rpc: a => ['cambiar_propiedad', { p_sku: a.sku, p_propiedad: a.propiedad, p_propietario: a.propietario ?? null }],
    desc: (_S, a) => `Propiedad de ${a.sku}`,
  },
  foto: {
    local: (S, a) => {
      const p = find(S, a.sku); if (!p) throw new Error('Producto no encontrado');
      const actual = fotoDe(S, p);
      if (S.rol !== 'admin' && actual && actual.foto !== a.foto) throw new Error('Este artículo ya tiene foto: solo el administrador puede sustituirla');
      for (const x of grupoFoto(S, a.sku)) { x.foto = a.foto; x.fotoMini = a.mini; x.fotoOrigen = a.origen; }
    },
    rpc: a => ['poner_foto', { p_sku: a.sku, p_foto: a.foto, p_mini: a.mini, p_origen: a.origen }],
    desc: (S, a) => `Foto de ${nombreProd(S, a.sku)}`,
  },
  quitarFoto: {
    local: (S, a) => {
      if (S.rol !== 'admin') throw new Error('Solo el administrador puede quitar una foto');
      if (!find(S, a.sku)) throw new Error('Producto no encontrado');
      for (const x of grupoFoto(S, a.sku)) { x.foto = undefined; x.fotoMini = undefined; x.fotoOrigen = undefined; }
    },
    rpc: a => ['quitar_foto', { p_sku: a.sku }],
    desc: (S, a) => `Quitar la foto de ${nombreProd(S, a.sku)}`,
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
  prepararEntrega: {
    local: (S, a) => {
      if (S.entregas.some(e => e.id === a.id)) return;
      const eq = S.equipos.find(e => e.id === a.equipo); if (!eq) throw new Error('Equipo no encontrado');
      const t = S.tecnicos.find(x => x.id === a.receptor); if (!t) throw new Error('Receptor no encontrado');
      if (!eq.tecnicos.includes(t.id)) throw new Error(`${t.nombre} no pertenece a ese equipo`);
      if (!a.lineas.length) throw new Error('La entrega no tiene material');
      for (const l of a.lineas) {
        if (l.tipo === 'herramienta') {
          const h = S.herramientas.find(x => x.id === l.dotacion); if (!h) throw new Error('Herramienta no encontrada');
          if (!h.modelo || !herramientasLibres(S, h.modelo).some(x => x.id === h.id)) throw new Error(`${h.nombre} (${h.serie}) no está libre en el almacén`);
          continue;
        }
        const p = find(S, l.sku); if (!p) throw new Error('Producto no encontrado: ' + l.sku);
        if (p.borrador) throw new Error(`${p.sku} está en borrador`);
        if (!(l.qty > 0)) throw new Error(`Cantidad no válida en ${p.name}`);
        const disp = disponibleReal(S, p);
        if (disp < l.qty) throw new Error(`Solo hay ${Math.max(disp, 0)} disponibles de ${p.name} (el resto está reservado o no hay stock)`);
        if (formatoEntero(p) && l.qty !== Math.trunc(l.qty)) throw new Error(`${p.name} se entrega por ${p.unit} entero`);
        if (p.cat !== 'ropa' && p.cat !== 'epis' && !vehiculoDeEquipo(S, eq.id)) throw new Error(`El equipo ${eq.nombre} no tiene vehículo asignado: asígnale uno en Equipos para entregarle material de instalación`);
      }
      const numero = a.numero || (/^ENT-/.test(a.id) ? a.id : undefined);
      S.entregas.unshift({ id: a.id, numero, ts: Date.now(), equipo: a.equipo, receptor: a.receptor, dni: t.dni, lineas: JSON.parse(JSON.stringify(a.lineas)), firma: '', operator: S.operator,
        estado: 'preparada', obra: a.obra, vehiculo: vehiculoDeEquipo(S, eq.id), caduca: a.caduca || Date.now() + (S.configAvisos.horasReserva || 48) * 3600e3 });
    },
    rpc: a => ['preparar_entrega', { p_id: a.id, p_equipo: a.equipo, p_receptor: a.receptor, p_obra: a.obra, p_plantilla: null,
      p_lineas: a.lineas.map(l => l.tipo === 'herramienta' ? { tipo: 'herramienta', dotacion_id: l.dotacion } : { tipo: 'stock', sku: l.sku, cantidad: l.qty }) }],
    desc: (S, a) => `Preparar entrega para ${S.tecnicos.find(t => t.id === a.receptor)?.nombre || a.receptor}`,
  },
  confirmarEntrega: {
    local: (S, a) => {
      const e = S.entregas.find(x => x.id === a.id); if (!e) throw new Error('Entrega no encontrada');
      if (e.estado === 'firmada' || !e.estado) return;
      if (e.estado === 'anulada') throw new Error('La entrega está anulada');
      if ((e.caduca ?? 0) <= Date.now()) throw new Error('La reserva ha caducado: prepárala de nuevo');
      if (!a.firma) throw new Error('Falta la firma del receptor');
      const copia = JSON.stringify({ products: S.products, herramientas: S.herramientas, movements: S.movements, aBordo: S.aBordo });
      const veh = vehiculoDeEquipo(S, e.equipo), ref = (e.numero || 'Entrega') + (e.obra ? ' · ' + e.obra : '');
      try {
        for (const l of e.lineas) {
          if (l.tipo === 'herramienta') {
            const h = S.herramientas.find(x => x.id === l.dotacion);
            if (!h || h.estado !== 'operativa') throw new Error('Una herramienta de la entrega ya no está disponible');
            h.equipo = e.equipo; h.tecnico = e.receptor;
            h.historial.push({ id: nuevoId(), ts: Date.now(), tipo: 'asignacion', nota: `Entregada en ${e.numero || 'entrega'}`, operator: S.operator });
            continue;
          }
          const p = find(S, l.sku);
          const personal = !!p && (p.cat === 'ropa' || p.cat === 'epis');
          // E-013: el material de instalación entra en el vehículo del equipo; la dotación personal sale del almacén y va al técnico
          if (!personal && !veh) throw new Error('El equipo ya no tiene vehículo asignado: asígnale uno antes de firmar');
          applyMovement(S, personal ? { sku: l.sku, type: 'salida', qty: l.qty, reason: 'Entrega de dotación personal', ref, equipo: e.equipo, entrega: e.id }
            : { sku: l.sku, type: 'traspaso', qty: l.qty, reason: 'Entrega a equipo', ref, equipo: e.equipo, entrega: e.id, vehiculo: veh });
          if (p && personal) S.herramientas.push({ id: (p.cat === 'epis' ? 'E' : 'R') + nuevoId().slice(0, 6).toUpperCase(), clase: p.cat === 'epis' ? 'epi' : 'ropa', nombre: p.modelo || p.name,
            marca: p.supplier, serie: '', talla: p.talla, cantidad: Math.ceil(l.qty), valor: 0, estado: 'operativa', equipo: e.equipo, tecnico: e.receptor,
            historial: [{ id: nuevoId(), ts: Date.now(), tipo: 'alta', nota: `Entregada en ${e.numero || 'entrega'}`, operator: S.operator }] });
        }
      } catch (err) { const c = JSON.parse(copia); S.products = c.products; S.herramientas = c.herramientas; S.movements = c.movements; S.aBordo = c.aBordo; throw err; }
      e.vehiculo = veh;
      e.estado = 'firmada'; e.firma = a.firma; e.ts = Date.now(); e.hash = a.hash; e.caduca = undefined;
    },
    rpc: a => ['confirmar_entrega', { p_id: a.id, p_firma: a.firma }],
    desc: (S, a) => `Firma de la entrega ${S.entregas.find(e => e.id === a.id)?.numero || ''}`,
  },
  anularEntrega: {
    local: (S, a) => {
      const e = S.entregas.find(x => x.id === a.id); if (!e || e.estado === 'anulada') return;
      if (e.estado !== 'preparada') throw new Error('Una entrega firmada no se anula: corrígela con una devolución');
      e.estado = 'anulada'; e.caduca = undefined;
    },
    rpc: a => ['anular_entrega', { p_id: a.id }],
    desc: () => 'Anular entrega preparada',
  },
  emailTecnico: {
    // E-011: el almacén puede escribir el correo del técnico al firmar (única edición de la ficha que se le permite)
    local: (S, a) => {
      const t = S.tecnicos.find(x => x.id === a.tecnico); if (!t) throw new Error('Técnico no encontrado');
      const e = a.email.trim().toLowerCase();
      if (e && !emailValido(e)) throw new Error(`Correo no válido: ${a.email}`);
      t.email = e || undefined;
    },
    rpc: a => ['guardar_email_tecnico', { p_tecnico: a.tecnico, p_email: a.email.trim() }],
    desc: (S, a) => `Correo de ${S.tecnicos.find(t => t.id === a.tecnico)?.nombre || a.tecnico}`,
  },
  reenviarCopia: {
    local: (S, a) => {
      const e = S.entregas.find(x => x.id === a.entrega); if (!e) throw new Error('Entrega no encontrada');
      if ((e.estado ?? 'firmada') !== 'firmada') throw new Error('Solo se envía copia de una entrega firmada');
      const t = S.tecnicos.find(x => x.id === e.receptor);
      if (a.email?.trim()) { if (!emailValido(a.email)) throw new Error(`Correo no válido: ${a.email}`); if (t) t.email = a.email.trim().toLowerCase(); }
      if (!t?.email && !S.configAvisos.copiaEntregasAdmin) throw new Error('El técnico no tiene correo: escríbelo para enviar la copia');
      // lo anterior deja de reintentarse; la copia nueva queda pendiente hasta que la envíe el servidor
      for (const x of S.envios) if (x.entrega === e.id && (x.estado === 'pendiente' || x.estado === 'error')) x.estado = 'descartado';
      S.envios.unshift({ id: nuevoId(), ts: Date.now(), canal: 'correo', tipo: 'entrega', asunto: `Entrega de material n.º ${e.numero || ''}`, estado: 'pendiente', entrega: e.id, destinatarios: t?.email ? [t.email] : [], reintentos: 0 });
    },
    rpc: a => ['reenviar_copia_entrega', { p_entrega: a.entrega, p_email: a.email?.trim() || null }],
    desc: (S, a) => `Reenviar la copia de ${S.entregas.find(e => e.id === a.entrega)?.numero || 'la entrega'}`,
  },
  tallas: {
    local: (S, a) => { if (S.rol !== 'admin') throw new Error('Solo el administrador edita las tallas'); const t = S.tecnicos.find(x => x.id === a.tecnico); if (!t) throw new Error('Técnico no encontrado'); t.tallas = { ...a.tallas }; },
    rpc: a => ['guardar_tallas', { p_tecnico: a.tecnico, p_camiseta: a.tallas.camiseta ?? '', p_pantalon: a.tallas.pantalon ?? '', p_calzado: a.tallas.calzado ?? '', p_guantes: a.tallas.guantes ?? '' }],
    desc: (S, a) => `Tallas de ${S.tecnicos.find(t => t.id === a.tecnico)?.nombre || a.tecnico}`,
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
