/* =========================================================
   Almacén Búfala · control de stock (vanilla JS, sin build)
   Estado en localStorage. Vistas = funciones que devuelven HTML.
   Acciones por data-act (click) y data-in (input/change).
   ========================================================= */
'use strict';

/* ---------- 1. Utilidades ---------- */
const $ = s => document.querySelector(s);
const clone = o => JSON.parse(JSON.stringify(o));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const eur = n => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: n >= 1000 ? 0 : 2 }).format(n || 0);
const num = n => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(n || 0);
const ic = (n, cls = '') => `<span class="material-symbols-outlined ${cls}" aria-hidden="true">${n}</span>`;
const wait = ms => new Promise(r => setTimeout(r, ms));
const isDesk = () => matchMedia('(min-width:1024px)').matches;
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const parseSN = t => String(t || '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);

function hace(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'ahora mismo';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  const d = new Date(ts), hoy = new Date();
  const hm = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === hoy.toDateString()) return `Hoy · ${hm}`;
  const ay = new Date(); ay.setDate(ay.getDate() - 1);
  if (d.toDateString() === ay.toDateString()) return `Ayer · ${hm}`;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) + ' · ' + hm;
}
const fechaHora = ts => new Date(ts).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const esHoy = ts => new Date(ts).toDateString() === new Date().toDateString();

async function sha256(txt) {
  try {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  } catch (e) { // file:// o navegador sin crypto.subtle
    let h = 2166136261; for (const c of txt) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return 'fnv1a-' + (h >>> 0).toString(16);
  }
}

/* ---------- 2. Estado y persistencia ---------- */
const LS = 'almacen-bufala-v3';
const LS_OLD = 'almacen-bufala-v2';

function seedTs(days, h, m) { const x = new Date(); x.setDate(x.getDate() - days); x.setHours(h, m, 0, 0); return x.getTime(); }
function seedMovements() {
  let i = 0;
  const M = (ts, sku, type, qty, reason, ref, operator, serials = [], equipo) => ({ id: 'S' + (++i), ts, sku, type, qty, reason, ref, operator, serials, equipo });
  return [
    M(seedTs(0, 8, 30), 'WBX-PULSAR-22', 'salida', 2, 'Entrega a equipo', 'ENT-2026-0412', 'Oficina', ['WBX-22-899279', 'WBX-22-899280'], 'F01'),
    M(seedTs(0, 8, 30), 'CAB-RZ1K-5G6', 'salida', 150, 'Entrega a equipo', 'ENT-2026-0412', 'Oficina', [], 'F01'),
    M(seedTs(0, 7, 50), 'BF-VE-VIA74', 'salida', 1, 'Entrega a equipo', 'ENT-2026-0410', 'Oficina', ['OB-VU-26A0104'], 'F03'),
    M(seedTs(0, 7, 50), 'BF-TUB-CM20', 'salida', 80, 'Entrega a equipo', 'ENT-2026-0410', 'Oficina', [], 'F03'),
    M(seedTs(0, 9, 5), 'BF-VE-POL74', 'salida', 1, 'Obra / instalación', 'Garaje C/ Eros 10', 'Jorge Ruiz', ['PCH74-26-0398']),
    M(seedTs(0, 10, 40), 'BF-FIX-SX6', 'salida', 120, 'Obra / instalación', 'Av. Monasterio de Silos 38', 'Andrea Pardo'),
    M(seedTs(1, 17, 45), 'CIR-ENEXT-S', 'salida', 2, 'Entrega a equipo', 'ENT-2026-0409', 'Oficina', ['CC-9910', 'CC-9911'], 'F02'),
    M(seedTs(1, 17, 20), '6000650604', 'merma', 6, 'Corte sobrante', 'Final de rollo', 'Luis Martín'),
    M(seedTs(1, 12, 2), '7270020010', 'entrada', 305, 'Compra a proveedor', 'Alb. 2.793.496', 'Oficina'),
    M(seedTs(1, 8, 30), '7280040020', 'salida', 25, 'Obra / instalación', 'C/ Pilar Bardem 5', 'Jorge Ruiz'),
    M(seedTs(2, 16, 45), 'BF-VE-WBX74', 'salida', 1, 'Obra / instalación', 'Chalet Alcobendas', 'Andrea Pardo', ['WBX-PP-883118']),
    M(seedTs(2, 11, 0), '6201020032', 'salida', 120, 'Obra / instalación', 'C/ Eros 10', 'Luis Martín'),
    M(seedTs(3, 9, 15), '7501013532', 'entrada', 2, 'Compra a proveedor', 'Alb. 2.790.456', 'Oficina'),
    M(seedTs(4, 13, 30), '6040615316', 'entrada', 305, 'Compra a proveedor', 'Alb. 2.795.060', 'Oficina'),
    M(seedTs(5, 10, 10), 'BF-FON-MC16', 'salida', 60, 'Obra / instalación', 'Reforma baño C/ Zubeldia 8', 'Jorge Ruiz'),
    M(seedTs(6, 18, 0), '5301012054', 'merma', 50, 'Pérdida o extravío', 'Recuento semanal', 'Andrea Pardo'),
  ];
}
function seedEntregas() {
  return [
    { id: 'ENT-2026-0412', ts: seedTs(0, 8, 30), equipo: 'F01', receptor: 'T1', lineas: [{ sku: 'WBX-PULSAR-22', qty: 2, serials: ['WBX-22-899279', 'WBX-22-899280'] }, { sku: 'CAB-RZ1K-5G6', qty: 150, serials: [] }], firma: FIRMAS_DEMO[0], operator: 'Oficina' },
    { id: 'ENT-2026-0410', ts: seedTs(0, 7, 50), equipo: 'F03', receptor: 'T5', lineas: [{ sku: 'BF-VE-VIA74', qty: 1, serials: ['OB-VU-26A0104'] }, { sku: 'BF-TUB-CM20', qty: 80, serials: [] }], firma: FIRMAS_DEMO[1], operator: 'Oficina' },
    { id: 'ENT-2026-0409', ts: seedTs(1, 17, 45), equipo: 'F02', receptor: 'T3', lineas: [{ sku: 'CIR-ENEXT-S', qty: 2, serials: ['CC-9910', 'CC-9911'] }], firma: FIRMAS_DEMO[2], operator: 'Oficina' },
  ];
}
function seedAlbaranes() {
  return [
    { numero: '2.795.060', proveedor: 'Prysmian Cables Spain', fecha: '', lineas: 1, unidades: 305, ts: seedTs(4, 13, 30), operator: 'Oficina', confianza: .99, modo: 'sim' },
    { numero: '2.793.496', proveedor: 'Saltoki Alcobendas', fecha: '', lineas: 1, unidades: 305, ts: seedTs(1, 12, 2), operator: 'Oficina', confianza: .98, modo: 'sim' },
  ];
}
function fresh() {
  return {
    v: 3, products: clone(SEED_PRODUCTS), movements: seedMovements(), albaranes: seedAlbaranes(),
    equipos: clone(SEED_EQUIPOS), tecnicos: clone(SEED_TECNICOS), entregas: seedEntregas(),
    operator: OFICINA, pedidos: {}, cesta: { equipo: 'F01', receptor: 'T1', lineas: [] }, seq: { ent: 412 },
  };
}
function load() {
  try {
    const r = localStorage.getItem(LS);
    if (r) { const s = JSON.parse(r); if (s && Array.isArray(s.products)) return migrate(s); }
    const old = localStorage.getItem(LS_OLD); // datos de la versión anterior de la app
    if (old) {
      const o = JSON.parse(old), s = fresh();
      if (o && Array.isArray(o.products)) {
        s.products = o.products; s.movements = o.movements || []; s.albaranes = (o.albaranes || []).concat(s.albaranes);
        for (const p of SEED_PRODUCTS) if (!s.products.find(x => x.sku === p.sku)) s.products.push(clone(p));
        return s;
      }
    }
  } catch (e) { }
  return fresh();
}
function migrate(s) {
  const f = fresh();
  for (const k of Object.keys(f)) if (s[k] === undefined) s[k] = f[k];
  return s;
}
function save() { lastSave = Date.now(); try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) { toast('No se ha podido guardar en este navegador (almacenamiento lleno o bloqueado).', 'err'); } }
let S = load();
let lastSave = Date.now();

(async () => { // huellas de las entregas sembradas
  let cambio = false;
  for (const e of S.entregas) if (!e.hash) { e.hash = await hashEntrega(e); cambio = true; }
  if (cambio) { save(); render(); }
})();

let ui = {
  view: 'stock', q: '', est: 'all', pas: 'all', cat: 'all', page: 1, catTab: 'cargadores', filtros: false, almacen: 'central',
  scanMode: 'entrada', scanHit: null, scanQty: 1, scanSN: '', scanSel: [], scanReason: '', scanRef: '', scanLog: [], manual: '',
  eqTab: 'equipos', entCat: 'cargadores', entQ: '', entSN: null, firma: [], certifica: false,
  movType: 'all', movQ: '', movRange: 'all', menu: null,
};

/* ---------- 3. Reglas de negocio ---------- */
const find = sku => S.products.find(p => p.sku === sku);
const tec = id => S.tecnicos.find(t => t.id === id);
const equipo = id => S.equipos.find(e => e.id === id);
function status(p) { if (p.stock < p.min) return 'red'; if (p.stock < p.min * 1.5) return 'amber'; return 'green'; }
const ST = {
  red: { t: 'Stock crítico', s: 'Crítico', c: 'bg-error-container text-error' },
  amber: { t: 'Stock bajo', s: 'Bajo', c: 'bg-amber-100 text-amber-800' },
  green: { t: 'En stock', s: 'En stock', c: 'bg-tertiary-fixed/30 text-tertiary' },
};
const ORD = { red: 0, amber: 1, green: 2 };
const qtyTxt = (p, q) => `${num(q)} ${UNIT[p.unit]}`;
const aisle = loc => String(loc).split('-')[0];
function locTxt(loc) { const [a, b, c] = String(loc).split('-'); return `Pasillo ${(a || '').replace('P', '')} · Est. ${(b || '').replace('E', '')} · Nivel ${(c || '').replace('N', '')}`; }
const critical = () => S.products.filter(p => status(p) === 'red');
const warning = () => S.products.filter(p => status(p) === 'amber');
const invValue = () => S.products.reduce((a, p) => a + p.stock * p.price, 0);
const aisles = () => [...new Set(S.products.map(p => aisle(p.loc)))].sort();
const TIPO = {
  entrada: { t: 'Entrada', icon: 'south_west', c: 'bg-tertiary-fixed/30 text-tertiary', sign: '+' },
  salida: { t: 'Salida', icon: 'north_east', c: 'bg-primary-fixed text-primary', sign: '−' },
  merma: { t: 'Merma', icon: 'report', c: 'bg-error-container text-error', sign: '−' },
};

function applyMovement({ sku, type, qty, reason, ref, serials = [], equipo: eq }) {
  const p = find(sku); if (!p) throw new Error('Producto no encontrado');
  qty = Number(qty);
  if (!(qty > 0)) throw new Error('Indica una cantidad mayor que cero');
  if (type !== 'entrada' && qty > p.stock) throw new Error(`Solo hay ${qtyTxt(p, p.stock)} de ${p.name}`);
  if (p.serialized) {
    if (serials.length !== qty) throw new Error(`${p.name}: indica ${qty} n.º de serie (hay ${serials.length})`);
    if (type === 'entrada') { const d = serials.find(s => (p.serials || []).includes(s)); if (d) throw new Error(`El n.º de serie ${d} ya está en stock`); }
    else { const f = serials.find(s => !(p.serials || []).includes(s)); if (f) throw new Error(`El n.º de serie ${f} no está en stock`); }
  }
  const before = status(p);
  if (type === 'entrada') { p.stock += qty; if (p.serialized) p.serials = [...(p.serials || []), ...serials]; }
  else { p.stock -= qty; if (p.serialized) p.serials = (p.serials || []).filter(s => !serials.includes(s)); }
  p.stock = Math.round(p.stock * 1000) / 1000;
  if (type === 'entrada' && S.pedidos[sku] && p.stock >= p.min) delete S.pedidos[sku];
  const m = { id: uid('M'), ts: Date.now(), sku, type, qty, reason, ref: ref || '', operator: S.operator, serials, equipo: eq };
  S.movements.unshift(m);
  return { p, before, after: status(p), m };
}
function avisoEstado(r) {
  if (r.after === 'red' && r.before !== 'red') toast(`Alerta: ${r.p.name} queda en stock crítico (${qtyTxt(r.p, r.p.stock)}, mínimo ${qtyTxt(r.p, r.p.min)}).`, 'err', 7000);
  else if (r.after === 'amber' && r.before === 'green') toast(`Aviso: ${r.p.name} baja de nivel (${qtyTxt(r.p, r.p.stock)}).`, 'warn', 6000);
}

/* Buscador inteligente: tokens contra nombre, SKU, EAN, ref. proveedor, ubicación, categoría, proveedor y n.º de serie */
function searchProducts(q, { cat = 'all', pas = 'all', est = 'all' } = {}) {
  const toks = norm(q).split(/\s+/).filter(Boolean);
  return S.products.filter(p => {
    if (cat !== 'all' && p.cat !== cat) return false;
    if (pas !== 'all' && aisle(p.loc) !== pas) return false;
    if (est !== 'all' && status(p) !== est) return false;
    if (!toks.length) return true;
    const hay = norm([p.name, p.sku, p.ean, p.supplierRef, p.loc, p.loc.replace(/-/g, ' '), locTxt(p.loc), CATS[p.cat]?.label, p.supplier, (p.serials || []).join(' ')].join(' '));
    return toks.every(t => hay.includes(t) || (t.endsWith('s') && hay.includes(t.slice(0, -1))));
  }).sort((a, b) => ORD[status(a)] - ORD[status(b)] || a.loc.localeCompare(b.loc));
}

/* Emparejado de líneas de albarán con el catálogo */
function matchLine(code, desc) {
  const c = String(code || '').replace(/\s/g, '');
  if (c) {
    const byCode = S.products.find(p => c === p.sku || c === p.ean || c === p.supplierRef || (p.sku.length >= 8 && c.startsWith(p.sku)));
    if (byCode) return { sku: byCode.sku, how: 'código' };
  }
  const tk = s => norm(s).replace(/[(),.×x²]/g, ' ').split(/\s+/).filter(t => t.length >= 2);
  const dt = new Set(tk(desc));
  let best = null, bs = 0;
  for (const p of S.products) {
    const pt = tk(p.name); const hit = pt.filter(t => dt.has(t)).length;
    const sc = hit / Math.max(4, Math.min(pt.length, dt.size));
    if (sc > bs) { bs = sc; best = p; }
  }
  return bs >= 0.5 ? { sku: best.sku, how: 'descripción' } : { sku: null, how: null };
}

/* Resolver un código escaneado: SKU, EAN, ref. proveedor, n.º de serie o etiqueta propia "SKU|SN" */
function resolveCode(raw) {
  const t = String(raw || '').trim(); if (!t) return null;
  const [a, b] = t.split('|');
  const u = x => String(x || '').toUpperCase();
  let p = S.products.find(p => [p.sku, p.ean, p.supplierRef].some(v => v && u(v) === u(a)));
  if (p) return { p, serial: b || '' };
  p = S.products.find(p => (p.serials || []).some(s => u(s) === u(a)));
  if (p) return { p, serial: p.serials.find(s => u(s) === u(a)) };
  // n.º de serie que aún no está en stock pero sigue el patrón de un producto con serie
  p = S.products.find(p => p.serialized && (p.serials || []).some(s => s.split('-').slice(0, 2).join('-') === u(a).split('-').slice(0, 2).join('-')));
  if (p) return { p, serial: u(a), nuevo: true };
  return null;
}

/* Stock a bordo de una furgoneta: entregado − devuelto */
function vanStock(eqId) {
  const m = {};
  for (const e of S.entregas) if (e.equipo === eqId) for (const l of e.lineas) {
    m[l.sku] = m[l.sku] || { sku: l.sku, qty: 0, serials: [] };
    m[l.sku].qty += l.qty; m[l.sku].serials.push(...(l.serials || []));
  }
  for (const mv of S.movements) if (mv.equipo === eqId && mv.type === 'entrada' && mv.reason === 'Devolución de obra' && m[mv.sku]) {
    m[mv.sku].qty -= mv.qty; m[mv.sku].serials = m[mv.sku].serials.filter(s => !(mv.serials || []).includes(s));
  }
  return Object.values(m).filter(x => x.qty > 0 && find(x.sku));
}
async function hashEntrega(e) { return sha256(JSON.stringify({ id: e.id, ts: e.ts, equipo: e.equipo, receptor: e.receptor, dni: e.dni || '', lineas: e.lineas, firma: e.firma })); }

/* ---------- 4. Componentes ---------- */
const CARD = 'bg-surface-container-lowest rounded-xl shadow-sm';
const BTN = 'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_P = `${BTN} bg-primary hover:bg-primary-container text-on-primary shadow-sm`;
const BTN_S = `${BTN} bg-surface-container-lowest hover:bg-surface-container text-on-surface shadow-sm ring-1 ring-surface-container-high`;
const BTN_T = `${BTN} bg-surface-container-low hover:bg-surface-container-high text-primary`;
const LBL = 'mono text-label-sm uppercase tracking-wider text-secondary';
const INP = 'w-full bg-surface-container-low rounded-lg px-3 py-2.5 text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary';

const pill = (p, short) => { const s = status(p); return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full mono text-label-sm uppercase whitespace-nowrap ${ST[s].c}"><span class="w-1.5 h-1.5 rounded-full bg-current ${s === 'red' ? 'pulso' : ''}"></span>${short ? ST[s].s : ST[s].t}</span>`; };
const tile = (p, size = 'w-12 h-12') => `<div class="${size} shrink-0 rounded-xl grid place-items-center ${status(p) === 'red' ? 'bg-error-container text-error' : CATS[p.cat].tile}">${ic(CATS[p.cat].icon, 'ms-28')}</div>`;
const tag = (txt, c = 'bg-surface-container-high text-secondary') => `<span class="inline-flex items-center px-2 py-0.5 rounded mono text-label-sm ${c}">${esc(txt)}</span>`;
const initials = n => String(n || '?').split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
const avatar = (n, c = 'bg-primary-fixed text-primary') => `<span class="w-9 h-9 shrink-0 rounded-full grid place-items-center mono text-label-md font-semibold ${c}">${initials(n)}</span>`;
const firmaSVG = (f, cls = 'h-10 w-28') => f && f.startsWith('data:') ? `<img src="${f}" alt="Firma" class="${cls} object-contain">`
  : `<svg viewBox="0 0 128 50" class="${cls}" aria-label="Firma"><path d="${esc(f || '')}" fill="none" stroke="#0037b0" stroke-width="2.4" stroke-linecap="round"/></svg>`;
const estadoEq = { ruta: { t: 'En ruta', c: 'bg-tertiary-fixed text-on-tertiary-fixed' }, depot: { t: 'En depot (carga)', c: 'bg-primary-fixed text-primary' }, taller: { t: 'En taller', c: 'bg-amber-100 text-amber-800' } };

function kpi({ icon, iconC, badge, badgeC, value, valueC = 'text-on-surface', label, foot, footVal, footC = 'text-on-surface', bar, barC, act }) {
  return `<button ${act || ''} class="text-left p-space-md ${CARD} hover:shadow-md transition-shadow">
    <div class="flex justify-between items-start mb-space-sm">
      <div class="p-2 rounded-lg ${iconC}">${ic(icon)}</div>
      <span class="inline-flex items-center gap-1 mono text-label-sm px-2 py-0.5 rounded-full ${badgeC}">${badge}</span>
    </div>
    <div class="text-headline-xl-mobile xl:text-headline-xl font-bold tracking-tight ${valueC}">${value}</div>
    <div class="text-body-md text-secondary font-medium">${label}</div>
    <div class="mt-space-sm flex items-center justify-between gap-2"><span class="mono text-label-sm text-secondary">${foot}</span><span class="mono text-label-sm font-semibold ${footC}">${footVal}</span></div>
    <div class="w-full bg-surface-container-high h-1 rounded-full mt-1.5 overflow-hidden"><div class="${barC} h-full rounded-full" style="width:${Math.max(0, Math.min(100, bar))}%"></div></div>
  </button>`;
}

/* ---------- 5. Navegación y cabeceras ---------- */
const VIEWS = {
  stock: { label: 'Stock General', mob: 'Inventario', icon: 'inventory_2' },
  albaranes: { label: 'Albaranes & Recepción IA', mob: 'Albaranes IA', icon: 'document_scanner' },
  equipos: { label: 'Equipos & Técnicos', mob: 'Cuadrillas', icon: 'badge' },
  entregas: { label: 'Entregas & Firmas', mob: 'Entrega', icon: 'draw' },
  scan: { label: 'Escanear', mob: 'Escanear', icon: 'qr_code_scanner' },
  movimientos: { label: 'Movimientos', mob: 'Movimientos', icon: 'swap_vert' },
  config: { label: 'Configuración & Auditoría', mob: 'Configuración', icon: 'admin_panel_settings' },
};

function renderShell() {
  const navItem = v => {
    const on = ui.view === v;
    return `<a href="#${v}" class="flex items-center gap-space-sm px-space-md py-2.5 rounded-lg transition-colors ${on ? 'bg-primary-container text-on-primary font-semibold' : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'}">${ic(VIEWS[v].icon, on ? 'ms-fill' : '')}<span class="text-body-md">${VIEWS[v].label}</span>${v === 'stock' && critical().length ? `<span class="ml-auto mono text-label-sm px-1.5 rounded ${on ? 'bg-white/20' : 'bg-error-container text-error'}">${critical().length}</span>` : ''}</a>`;
  };
  $('#side').innerHTML = `<div class="flex flex-col overflow-y-auto no-scrollbar">
      <div class="h-16 px-space-md flex items-center gap-space-sm">
        <div class="w-9 h-9 rounded-lg bg-primary-container text-white grid place-items-center">${ic('bolt', 'ms-fill')}</div>
        <div class="flex flex-col"><span class="text-headline-sm font-semibold tracking-tight leading-none">${MARCA.nombre}</span><span class="${LBL} mt-1">${MARCA.sub}</span></div>
      </div>
      <div class="px-space-md pt-space-md pb-space-xs"><span class="${LBL} text-outline px-space-xs">Operaciones</span></div>
      <nav class="flex flex-col gap-space-xs px-space-sm">${['stock', 'albaranes', 'equipos', 'entregas', 'scan', 'movimientos'].map(navItem).join('')}</nav>
      <div class="px-space-md pt-space-lg pb-space-xs"><span class="${LBL} text-outline px-space-xs">Sistema</span></div>
      <nav class="flex flex-col gap-space-xs px-space-sm">${navItem('config')}</nav>
    </div>
    <div class="p-space-md bg-surface-container-low m-space-sm rounded-xl flex items-center justify-between">
      <div class="flex items-center gap-space-sm"><span class="h-2.5 w-2.5 rounded-full bg-tertiary-container pulso"></span>
        <div class="flex flex-col"><span class="mono text-label-md">${MARCA.nave}</span><span class="mono text-label-sm text-secondary">${aisles().length} pasillos · ${S.equipos.length} furgonetas</span></div></div>
      ${ic('ev_station', 'text-secondary')}
    </div>`;

  const almSel = (cls, mw = 'max-w-[190px]') => `<label class="flex items-center gap-1 bg-surface-container-low rounded-lg px-2.5 py-1.5 ${cls}">${ic('warehouse', 'text-primary ms-20')}
      <select data-in="almacen" aria-label="Almacén" class="bg-transparent mono text-label-md focus:outline-none cursor-pointer ${mw}">
        <option value="central" ${ui.almacen === 'central' ? 'selected' : ''}>${isDesk() ? 'Almacén Central' : 'NAVE'}</option>
        ${S.equipos.map(e => `<option value="${e.id}" ${ui.almacen === e.id ? 'selected' : ''}>${esc(e.flota)} (${esc(e.matricula)})</option>`).join('')}
      </select></label>`;
  const nCrit = critical().length + Object.keys(S.pedidos).length;

  $('#topDesk').innerHTML = `<div class="flex items-center gap-space-md flex-1 max-w-3xl">
      <div class="relative flex-1">${ic('search', 'absolute left-3 top-1/2 -translate-y-1/2 text-outline ms-20')}
        <input id="gq" data-in="gq" value="${esc(ui.q)}" class="w-full pl-10 pr-14 py-2 bg-surface-container-low rounded-lg text-body-sm placeholder:text-on-surface-variant focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary" placeholder="Buscar referencia, SKU, EAN, n.º de serie o ubicación…" type="search" autocomplete="off">
        <span class="absolute right-3 top-1/2 -translate-y-1/2 mono text-label-sm text-outline bg-surface-container-highest px-1.5 py-0.5 rounded">Ctrl K</span></div>
      ${almSel('')}
    </div>
    <div class="flex items-center gap-space-md">
      <button data-act="nuevoAlb" class="${BTN_P} px-space-md py-2">${ic('auto_awesome', 'ms-20')}<span>Nuevo Albarán IA</span></button>
      <button data-act="avisos" class="relative p-2 rounded-lg text-on-surface-variant hover:bg-surface-container-high" aria-label="Avisos de stock">${ic('notifications')}${nCrit ? `<span class="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-error text-white mono text-[10px] leading-4">${nCrit}</span>` : ''}</button>
      <button data-act="perfil" class="flex items-center gap-space-sm pl-space-xs text-left rounded-lg hover:bg-surface-container-low pr-2 py-1">${avatar(S.operator, 'bg-inverse-surface text-white')}
        <span class="hidden xl:flex flex-col"><span class="text-headline-sm font-semibold leading-tight">${esc(S.operator)}</span><span class="mono text-label-sm text-secondary">Operario activo</span></span></button>
    </div>`;

  $('#topMob').innerHTML = `<div class="flex items-center justify-between gap-2 px-4 h-16">
      <a href="#stock" class="flex items-center gap-2 min-w-0"><span class="w-9 h-9 rounded-lg bg-primary-container text-white grid place-items-center shrink-0">${ic('bolt', 'ms-fill')}</span>
        <span class="flex flex-col leading-none min-w-0"><span class="font-bold text-primary text-[15px] truncate">${MARCA.nombre}</span><span class="mono text-[8px] tracking-widest uppercase text-secondary mt-0.5">${MARCA.sub}</span></span></a>
      <div class="flex flex-col items-center shrink-0"><span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary-fixed/40 text-tertiary mono text-label-sm"><span class="w-1.5 h-1.5 rounded-full bg-tertiary pulso"></span>${navigator.onLine ? 'ONLINE' : 'OFFLINE'}</span><span class="mono text-label-sm text-secondary truncate max-w-[90px]">${VIEWS[ui.view].mob}</span></div>
      ${almSel('shrink-0', 'max-w-[72px]')}
      <button data-act="menu" class="relative shrink-0" aria-label="Menú">${avatar(S.operator, 'bg-inverse-surface text-white')}${nCrit ? `<span class="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-error ring-2 ring-white"></span>` : ''}</button>
    </div>`;

  const bi = (v, lbl, iconN) => { const on = ui.view === v; return `<a href="#${v}" class="flex flex-col items-center justify-center gap-1 py-2 min-h-[64px] ${on ? 'text-primary' : 'text-on-surface-variant'}">${ic(iconN, on ? 'ms-fill' : '')}<span class="text-[12px] ${on ? 'font-semibold' : ''}">${lbl}</span></a>`; };
  $('#bottom').innerHTML = `<div class="grid grid-cols-4 items-end px-2">
      ${bi('stock', 'Inventario', 'inventory_2')}
      <a href="#scan" class="flex flex-col items-center -mt-6 pb-2 ${ui.view === 'scan' ? 'text-primary' : 'text-on-surface-variant'}"><span class="w-16 h-16 rounded-2xl bg-primary text-white grid place-items-center shadow-lg shadow-primary/30">${ic('qr_code_scanner', 'ms-32')}</span><span class="text-[12px] font-semibold mt-1">Escanear</span></a>
      ${bi('entregas', 'Entrega', 'assignment_turned_in')}
      ${bi('equipos', 'Cuadrillas', 'local_shipping')}
    </div>`;
}

const VIEW_FN = {};
function renderMain() {
  const a = document.activeElement, id = a && a.id, pos = a && typeof a.selectionStart === 'number' ? a.selectionStart : null;
  if (ui.view === 'scan') { renderScan(); }
  else $('#main').innerHTML = VIEW_FN[ui.view]();
  if (ui.view === 'entregas') setupFirma();
  if (id && id !== 'gq') { const el = document.getElementById(id); if (el) { el.focus(); if (pos !== null) try { el.setSelectionRange(pos, pos); } catch (e) { } } }
}
function render() {
  const a = document.activeElement, headFocus = a && a.id === 'gq', pos = headFocus ? a.selectionStart : null;
  renderShell(); renderMain();
  if (headFocus) { const el = $('#gq'); el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) { } }
}
function go(v) {
  if (!VIEWS[v]) v = 'stock';
  if (ui.view === 'scan' && v !== 'scan') stopCamera();
  ui.view = v; closeModal(); render(); window.scrollTo(0, 0);
  if (v === 'scan') startCamera();
}
window.addEventListener('hashchange', () => go(location.hash.slice(1)));

/* ---------- 6. Vista: Stock general ---------- */
VIEW_FN.stock = function () {
  if (ui.almacen !== 'central') return viewVan();
  return isDesk() ? stockDesk() : stockMob();
};

function stockKpis() {
  const val = invValue(), cargVal = S.products.filter(p => p.cat === 'cargadores').reduce((a, p) => a + p.stock * p.price, 0);
  const crit = critical(), sup = new Set(crit.map(p => p.supplier)).size;
  const entHoy = S.entregas.filter(e => esHoy(e.ts)), firm = entHoy.filter(e => e.firma).length;
  const enRuta = S.equipos.filter(e => e.estado === 'ruta').length;
  const green = S.products.filter(p => status(p) === 'green').length;
  return `<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
    ${kpi({ icon: 'category', iconC: 'bg-surface-container-low text-primary', badge: `${ic('check_circle', 'ms-16')} ${Math.round(green / S.products.length * 100)}% OK`, badgeC: 'text-tertiary bg-tertiary-fixed/30', value: num(S.products.length), label: 'Referencias activas', foot: 'Pasillos en uso', footVal: `${aisles().length} pasillos`, bar: green / S.products.length * 100, barC: 'bg-primary', act: 'data-act="filtroEst" data-v="all"' })}
    ${kpi({ icon: 'payments', iconC: 'bg-surface-container-low text-primary', badge: 'Coste neto', badgeC: 'text-secondary bg-surface-container-high', value: eur(val), label: 'Valor total del inventario', foot: 'Cargadores VE', footVal: `${eur(cargVal)} (${Math.round(cargVal / (val || 1) * 100)}%)`, footC: 'text-primary', bar: cargVal / (val || 1) * 100, barC: 'bg-primary-container' })}
    ${kpi({ icon: 'warning', iconC: 'bg-error-container text-error', badge: crit.length ? 'Urgente' : 'Sin alertas', badgeC: crit.length ? 'text-error font-semibold bg-error-container' : 'text-tertiary bg-tertiary-fixed/30', value: crit.length, valueC: crit.length ? 'text-error' : 'text-on-surface', label: 'Productos en stock crítico', foot: 'Reposición pendiente', footVal: `${sup} proveedor${sup === 1 ? '' : 'es'}`, footC: 'text-error', bar: crit.length / S.products.length * 100 * 4, barC: 'bg-error', act: 'data-act="filtroEst" data-v="red"' })}
    ${kpi({ icon: 'assignment_turned_in', iconC: 'bg-tertiary-fixed/40 text-tertiary', badge: entHoy.length ? `${Math.round(firm / entHoy.length * 100)}% firmadas` : 'Sin entregas hoy', badgeC: 'text-tertiary font-semibold bg-tertiary-fixed/30', value: `${firm} / ${entHoy.length}`, label: 'Entregas firmadas hoy', foot: 'Furgonetas en ruta', footVal: `${enRuta} de ${S.equipos.length}`, footC: 'text-tertiary', bar: entHoy.length ? firm / entHoy.length * 100 : 0, barC: 'bg-tertiary', act: 'data-act="ir" data-v="entregas"' })}
  </div>`;
}

function stockDesk() {
  const lista = searchProducts(ui.q, ui);
  const PER = 8, pages = Math.max(1, Math.ceil(lista.length / PER)); if (ui.page > pages) ui.page = pages;
  const pag = lista.slice((ui.page - 1) * PER, ui.page * PER);
  const catProds = S.products.filter(p => p.cat === ui.catTab).sort((a, b) => ORD[status(a)] - ORD[status(b)] || b.stock * b.price - a.stock * a.price).slice(0, 3);
  const ultAlb = S.albaranes[0], ultEnt = S.entregas.slice().sort((a, b) => b.ts - a.ts)[0];
  const semana = Math.ceil((new Date() - new Date(new Date().getFullYear(), 0, 1)) / 6048e5), pasAud = aisles()[semana % aisles().length];

  return `<div class="px-gutter py-space-lg flex flex-col gap-space-lg max-w-[1600px]">
    <div class="flex flex-col xl:flex-row xl:items-end justify-between gap-space-md">
      <div class="flex flex-col gap-space-xs">
        <div class="flex items-center gap-space-xs flex-wrap">
          <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-tertiary-container/15 text-tertiary ${LBL} !text-tertiary"><span class="w-1.5 h-1.5 rounded-full bg-tertiary-fixed-dim pulso"></span>Guardado local · ${hace(lastSave)}</span>
          <span class="mono text-label-sm text-secondary">| ${MARCA.nave} · ${aisles().length} pasillos · ${S.movements.length} movimientos</span>
        </div>
        <div class="flex items-baseline gap-space-sm"><h1 class="text-headline-lg font-bold tracking-tight">Depot &amp; Control de Stock</h1><span class="mono text-label-md text-primary bg-primary-fixed/40 px-2 py-0.5 rounded">${S.operator}</span></div>
      </div>
      <div class="flex items-center gap-space-sm flex-wrap">
        <a href="#scan" class="${BTN_S} px-space-md py-2.5">${ic('barcode_scanner', 'text-secondary ms-20')}Escanear</a>
        <button data-act="csvStock" class="${BTN_S} px-space-md py-2.5">${ic('file_download', 'text-secondary ms-20')}Exportar CSV</button>
        <button data-act="nuevoProd" class="${BTN_P} px-space-md py-2.5">${ic('add_circle', 'ms-20')}Añadir referencia</button>
      </div>
    </div>
    ${stockKpis()}
    <div class="grid grid-cols-12 gap-space-lg items-start">
      <div class="col-span-12 xl:col-span-8 flex flex-col gap-space-lg min-w-0">
        <section class="${CARD} p-space-md flex flex-col gap-space-md">
          <div class="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-space-sm">
            <div><h2 class="text-headline-md font-semibold">Categorías estratégicas</h2><p class="text-body-sm text-secondary">Lo más urgente de cada familia: primero lo que está en rojo.</p></div>
            <div class="inline-flex bg-surface-container-low p-1 rounded-lg overflow-x-auto no-scrollbar max-w-full">
              ${Object.entries(CATS).map(([k, c]) => `<button data-act="catTab" data-v="${k}" class="px-3 py-1.5 rounded-md whitespace-nowrap text-body-md font-semibold transition-all ${ui.catTab === k ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}">${c.label}</button>`).join('')}
            </div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-space-md">
            ${catProds.map(p => { const r = status(p) === 'red'; return `<button data-act="ficha" data-sku="${esc(p.sku)}" class="text-left p-space-md rounded-xl ${r ? 'bg-error-container/40' : 'bg-surface-container-low'} hover:shadow-md transition-shadow flex flex-col gap-space-sm">
              <div class="flex justify-between items-start gap-2"><span class="mono text-label-sm text-secondary break-all">SKU: ${esc(p.sku)}</span>${pill(p, true)}</div>
              <div class="h-24 rounded-lg ${r ? 'bg-error-container text-error' : CATS[p.cat].tile} grid place-items-center relative">${ic(CATS[p.cat].icon, 'ms-40')}<span class="absolute bottom-2 left-2 mono text-label-sm bg-white/85 text-on-surface px-2 py-0.5 rounded">${esc(p.packLabel || '')}</span></div>
              <div><h3 class="text-headline-sm font-semibold line-clamp-2">${esc(p.name)}</h3><p class="text-body-sm text-secondary">${esc(p.supplier)} · ${esc(p.loc)}</p></div>
              <div class="flex justify-between items-end pt-space-sm border-t border-surface-container-high">
                <div><span class="${LBL}">Stock real</span><div class="text-headline-md font-bold ${r ? 'text-error' : ''}">${num(p.stock)} <span class="text-body-sm font-normal text-secondary">${UNIT[p.unit]}</span></div></div>
                <div class="text-right"><span class="${LBL}">${r ? 'Faltan' : 'Mínimo'}</span><div class="mono text-label-md ${r ? 'text-error font-semibold' : 'text-primary'}">${r ? qtyTxt(p, p.min - p.stock) : qtyTxt(p, p.min)}</div></div>
              </div></button>`; }).join('') || '<p class="text-secondary">Sin productos en esta categoría.</p>'}
          </div>
        </section>

        <section class="${CARD} overflow-hidden">
          <div class="p-space-md flex flex-wrap items-center gap-space-sm">
            <div class="relative flex-1 min-w-[220px]">${ic('search', 'absolute left-3 top-1/2 -translate-y-1/2 text-outline ms-20')}<input id="tq" data-in="q" value="${esc(ui.q)}" type="search" placeholder="Filtrar por nombre, SKU, proveedor, pasillo…" class="${INP} pl-10"></div>
            <select data-in="cat" class="${INP} !w-auto mono text-label-md" aria-label="Categoría"><option value="all">Categoría: todas</option>${Object.entries(CATS).map(([k, c]) => `<option value="${k}" ${ui.cat === k ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
            <select data-in="est" class="${INP} !w-auto mono text-label-md" aria-label="Estado"><option value="all">Estado: todos</option>${['red', 'amber', 'green'].map(s => `<option value="${s}" ${ui.est === s ? 'selected' : ''}>${ST[s].t}</option>`).join('')}</select>
            <select data-in="pas" class="${INP} !w-auto mono text-label-md" aria-label="Pasillo"><option value="all">Pasillo: todos</option>${aisles().map(a => `<option value="${a}" ${ui.pas === a ? 'selected' : ''}>Pasillo ${a.replace('P', '')}</option>`).join('')}</select>
            <span class="mono text-label-sm text-secondary ml-auto">Mostrando ${pag.length} de ${lista.length} referencias</span>
          </div>
          <div class="overflow-x-auto"><table class="tabla w-full min-w-[860px]">
            <thead class="bg-surface-container-low"><tr><th>Referencia / SKU</th><th>Descripción</th><th>Ubicación física</th><th>Disponible</th><th>Estado</th><th class="text-right">Acciones</th></tr></thead>
            <tbody>${pag.map(p => { const r = status(p) === 'red'; return `<tr class="${r ? 'bg-error-container/20' : ''}">
              <td><div class="flex items-center gap-2">${r ? ic('warning', 'text-error ms-20') : ic('qr_code_2', 'text-secondary ms-20')}<div><div class="mono text-label-md ${r ? 'text-error' : ''} break-all">${esc(p.sku)}</div>${p.ean ? `<div class="mono text-label-sm text-secondary">EAN ${esc(p.ean)}</div>` : ''}</div></div></td>
              <td class="max-w-[300px]"><button data-act="ficha" data-sku="${esc(p.sku)}" class="text-left"><div class="font-semibold hover:text-primary">${esc(p.name)}</div><div class="text-body-sm text-secondary">${CATS[p.cat].label} · ${esc(p.supplier)}${p.serialized ? ` · ${(p.serials || []).length} n.º serie` : ''}</div></button>${S.pedidos[p.sku] ? `<span class="mt-1 inline-block">${tag('Pedido en curso', 'bg-amber-100 text-amber-800')}</span>` : ''}</td>
              <td><div class="inline-flex items-center gap-1.5 bg-surface-container-low px-2 py-1 rounded mono text-label-md text-primary">${ic('shelves', 'ms-18')}${esc(p.loc)}</div><div class="mono text-label-sm text-secondary mt-1">${locTxt(p.loc)}</div></td>
              <td><div class="text-headline-sm font-bold ${r ? 'text-error' : ''}">${num(p.stock)} <span class="text-body-sm font-normal text-secondary">${UNIT[p.unit]}</span></div><div class="mono text-label-sm ${r ? 'text-error' : 'text-secondary'}">Mín: ${num(p.min)}</div></td>
              <td>${pill(p)}</td>
              <td class="text-right whitespace-nowrap">
                <button data-act="mov" data-sku="${esc(p.sku)}" data-t="entrada" title="Registrar entrada" class="p-2 rounded-lg text-tertiary hover:bg-tertiary-fixed/30">${ic('add_circle')}</button>
                <button data-act="mov" data-sku="${esc(p.sku)}" data-t="salida" title="Registrar salida" class="p-2 rounded-lg text-primary hover:bg-primary-fixed">${ic('remove_circle')}</button>
                <button data-act="mov" data-sku="${esc(p.sku)}" data-t="merma" title="Registrar merma" class="p-2 rounded-lg text-error hover:bg-error-container">${ic('report')}</button>
              </td></tr>`; }).join('') || `<tr><td colspan="6" class="text-center text-secondary py-10">No hay referencias con esos filtros. <button data-act="limpiarFiltros" class="text-primary font-semibold">Quitar filtros</button></td></tr>`}</tbody>
          </table></div>
          <div class="p-space-md flex items-center justify-between border-t border-surface-container">
            <span class="mono text-label-sm text-secondary">Página ${ui.page} de ${pages}</span>
            <div class="flex items-center gap-1">
              <button data-act="page" data-v="${ui.page - 1}" ${ui.page <= 1 ? 'disabled' : ''} class="px-3 py-1 rounded mono text-label-sm bg-surface-container-low disabled:opacity-40">Anterior</button>
              ${Array.from({ length: pages }, (_, i) => `<button data-act="page" data-v="${i + 1}" class="w-8 h-7 rounded mono text-label-sm ${ui.page === i + 1 ? 'bg-primary text-white' : 'bg-surface-container-low'}">${i + 1}</button>`).join('')}
              <button data-act="page" data-v="${ui.page + 1}" ${ui.page >= pages ? 'disabled' : ''} class="px-3 py-1 rounded mono text-label-sm bg-surface-container-low disabled:opacity-40">Siguiente</button>
            </div>
          </div>
        </section>
      </div>

      <div class="col-span-12 xl:col-span-4 flex flex-col gap-space-lg">
        <section class="${CARD} p-space-md flex flex-col gap-space-md">
          <div class="flex items-start justify-between gap-2"><h2 class="text-headline-md font-semibold flex items-center gap-2">${ic('auto_awesome', 'text-primary')}Recepción IA &amp; entradas</h2><span class="mono text-label-sm px-2 py-0.5 rounded-full bg-primary-fixed text-primary">${iaLive() ? 'CLAUDE VISION' : 'OCR SIMULADO'}</span></div>
          ${ultAlb ? `<div class="rounded-xl bg-surface-container-low p-space-md flex flex-col gap-2">
            <div class="flex justify-between gap-2"><span class="mono text-label-sm text-primary">ALBARÁN #${esc(ultAlb.numero)}</span><span class="mono text-label-sm text-secondary">${hace(ultAlb.ts)}</span></div>
            <div class="flex items-center gap-3"><span class="w-10 h-10 rounded-lg bg-white grid place-items-center font-bold text-primary">${initials(ultAlb.proveedor)}</span><div><div class="font-semibold">${esc(ultAlb.proveedor)}</div><div class="mono text-label-sm text-secondary">${ultAlb.lineas} líneas · ${num(ultAlb.unidades || 0)} unidades ingresadas</div></div></div>
            <div class="flex justify-between items-center pt-1"><span class="mono text-label-sm text-tertiary flex items-center gap-1">${ic('verified', 'ms-16')}Confianza ${Math.round((ultAlb.confianza || .95) * 100)}%</span><a href="#albaranes" class="mono text-label-sm text-primary">Ver albaranes →</a></div>
          </div>` : ''}
          ${ultEnt ? (() => { const eq = equipo(ultEnt.equipo); return `<div class="rounded-xl bg-surface-container-low p-space-md flex flex-col gap-2">
            <div class="flex justify-between gap-2"><span class="${LBL}">Última salida a furgoneta</span><span class="mono text-label-sm text-secondary">${hace(ultEnt.ts)}</span></div>
            <div class="flex items-center gap-3">${ic('local_shipping', 'text-secondary')}<div><div class="font-semibold">${esc(eq ? eq.nombre : ultEnt.equipo)} · ${esc(tec(ultEnt.receptor)?.nombre || '')}</div><div class="mono text-label-sm text-secondary">${esc(eq ? eq.flota + ' · ' + eq.matricula : '')}</div></div></div>
            <div class="bg-white rounded-lg p-2.5 text-body-sm">${ultEnt.lineas.map(l => `${num(l.qty)} ${UNIT[find(l.sku)?.unit] || ''} ${esc(find(l.sku)?.name || l.sku)}`).join('<br>')}<div class="mono text-label-sm text-tertiary mt-1">${ic('draw', 'ms-16')} Firma registrada · ${esc((ultEnt.hash || '').slice(0, 10))}</div></div>
          </div>`; })() : ''}
          <button data-act="nuevoAlb" class="${BTN_P} py-2.5">${ic('document_scanner', 'ms-20')}Leer un albarán</button>
        </section>
        ${donutCard()}
        ${barrasCard()}
        <section class="bg-primary-fixed/50 rounded-xl p-space-md flex items-center justify-between gap-space-md">
          <div><h3 class="text-headline-sm font-semibold">Auditoría cíclica semanal</h3><p class="text-body-sm text-secondary">Pasillo ${pasAud.replace('P', '')} · ${S.products.filter(p => aisle(p.loc) === pasAud).length} referencias a recontar</p></div>
          <button data-act="conteo" data-v="${pasAud}" class="${BTN_S} px-3 py-2 text-body-sm">Iniciar conteo</button>
        </section>
      </div>
    </div>
  </div>`;
}

function donutCard() {
  const tot = invValue() || 1; let acc = 0;
  const seg = Object.entries(CATS).map(([k, c]) => { const v = S.products.filter(p => p.cat === k).reduce((a, p) => a + p.stock * p.price, 0); return { k, c, v }; }).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  const R = 52, C = 2 * Math.PI * R;
  const arcs = seg.map(s => { const len = s.v / tot * C; const d = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${s.c.color}" stroke-width="16" stroke-dasharray="${Math.max(0, len - 2)} ${C}" stroke-dashoffset="${-acc}" transform="rotate(-90 70 70)"/>`; acc += len; return d; }).join('');
  return `<section class="${CARD} p-space-md">
    <div class="flex justify-between items-start"><h2 class="text-headline-md font-semibold">Distribución del valor</h2><span class="mono text-label-sm text-secondary">por categoría</span></div>
    <div class="flex items-center gap-space-md mt-space-sm">
      <svg viewBox="0 0 140 140" class="w-36 h-36 shrink-0" role="img" aria-label="Valor del inventario por categoría"><circle r="${R}" cx="70" cy="70" fill="none" stroke="#e5eeff" stroke-width="16"/>${arcs}
        <text x="70" y="68" text-anchor="middle" font-size="17" font-weight="700" fill="#0b1c30">${eur(tot).replace(/\s?€/, '')}€</text><text x="70" y="84" text-anchor="middle" font-size="8" font-family="JetBrains Mono" fill="#565e74">VALOR TOTAL</text></svg>
      <ul class="flex-1 flex flex-col gap-1.5 min-w-0">${seg.map(s => `<li class="flex items-center gap-2 text-body-sm"><span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${s.c.color}"></span><span class="truncate flex-1">${s.c.label}</span><span class="mono text-label-sm font-semibold">${Math.round(s.v / tot * 100)}%</span></li>`).join('')}</ul>
    </div></section>`;
}
function barrasCard() {
  const rows = Object.entries(CATS).map(([k, c]) => { const ps = S.products.filter(p => p.cat === k); return { k, c, n: ps.length, r: ps.filter(p => status(p) === 'red').length, a: ps.filter(p => status(p) === 'amber').length, g: ps.filter(p => status(p) === 'green').length }; }).filter(x => x.n);
  const max = Math.max(...rows.map(r => r.n));
  return `<section class="${CARD} p-space-md">
    <div class="flex justify-between items-start"><h2 class="text-headline-md font-semibold">Referencias por categoría</h2><span class="mono text-label-sm text-secondary">semáforo</span></div>
    <div class="flex flex-col gap-2.5 mt-space-md">${rows.map(r => `<button data-act="filtroCat" data-v="${r.k}" class="text-left group">
      <div class="flex justify-between text-body-sm mb-1"><span class="font-medium group-hover:text-primary">${r.c.label}</span><span class="mono text-label-sm text-secondary">${r.n} ref.</span></div>
      <div class="flex h-3 rounded-full overflow-hidden bg-surface-container" style="width:${Math.max(18, r.n / max * 100)}%">
        ${r.r ? `<div class="bg-error" style="flex:${r.r}" title="${r.r} en crítico"></div>` : ''}${r.a ? `<div class="bg-amber-400" style="flex:${r.a}" title="${r.a} bajo"></div>` : ''}${r.g ? `<div class="bg-tertiary-container" style="flex:${r.g}" title="${r.g} correcto"></div>` : ''}
      </div></button>`).join('')}</div>
    <div class="flex gap-space-md mt-space-md mono text-label-sm text-secondary"><span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-error"></span>Crítico</span><span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-amber-400"></span>Bajo</span><span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-tertiary-container"></span>Correcto</span></div>
  </section>`;
}

function stockMob() {
  const lista = searchProducts(ui.q, ui);
  const counts = Object.fromEntries(Object.keys(CATS).map(k => [k, S.products.filter(p => p.cat === k).length]));
  const chip = (k, lbl, n) => `<button data-act="filtroCat" data-v="${k}" class="shrink-0 inline-flex items-center gap-2 px-4 h-11 rounded-full mono text-label-md uppercase ${ui.cat === k ? 'bg-primary text-white' : 'bg-surface-container-lowest text-on-surface shadow-sm'}">${lbl}<span class="px-1.5 rounded ${ui.cat === k ? 'bg-white/20' : 'bg-surface-container-high'}">${n}</span></button>`;
  const nCrit = critical().length;
  return `<div class="px-4 pt-4 flex flex-col gap-4">
    <div class="flex items-center gap-3 bg-surface-container-low rounded-xl p-3">
      <span class="w-10 h-10 rounded-lg bg-white grid place-items-center text-primary">${ic('sensors')}</span>
      <div class="flex-1 min-w-0"><div class="font-semibold flex items-center gap-1.5">${MARCA.nave}<span class="w-2 h-2 rounded-full bg-tertiary-container"></span></div><div class="mono text-label-sm text-secondary truncate">Guardado ${hace(lastSave)} · ${S.operator}</div></div>
      ${nCrit ? `<button data-act="filtroEst" data-v="red" class="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-error-container text-error mono text-label-md">${ic('warning', 'ms-18')}${nCrit}</button>` : ''}
    </div>
    <div class="flex gap-2">
      <div class="relative flex-1">${ic('search', 'absolute left-3 top-1/2 -translate-y-1/2 text-outline')}<input id="mq" data-in="q" value="${esc(ui.q)}" type="search" placeholder="Ref, SKU, EAN o estantería" class="w-full h-14 pl-11 pr-3 rounded-xl bg-surface-container-lowest shadow-sm text-body-lg focus:outline-none focus:ring-2 focus:ring-primary"></div>
      <a href="#scan" class="w-14 h-14 rounded-xl bg-primary text-white grid place-items-center shadow-sm" aria-label="Escanear">${ic('barcode_scanner', 'ms-28')}</a>
      <button data-act="toggleFiltros" class="w-14 h-14 rounded-xl ${ui.filtros || ui.est !== 'all' || ui.pas !== 'all' ? 'bg-primary-fixed text-primary' : 'bg-surface-container-low text-on-surface'} grid place-items-center" aria-label="Filtros">${ic('tune', 'ms-28')}</button>
    </div>
    ${ui.filtros ? `<div class="grid grid-cols-2 gap-2 bg-surface-container-lowest rounded-xl p-3 shadow-sm">
      <label class="flex flex-col gap-1"><span class="${LBL}">Estado</span><select data-in="est" class="${INP} h-12">${[['all', 'Todos'], ['red', 'Crítico'], ['amber', 'Bajo'], ['green', 'Correcto']].map(([v, t]) => `<option value="${v}" ${ui.est === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="flex flex-col gap-1"><span class="${LBL}">Pasillo</span><select data-in="pas" class="${INP} h-12"><option value="all">Todos</option>${aisles().map(a => `<option value="${a}" ${ui.pas === a ? 'selected' : ''}>Pasillo ${a.replace('P', '')}</option>`).join('')}</select></label>
      <button data-act="limpiarFiltros" class="col-span-2 ${BTN_T} h-11">Quitar filtros</button>
    </div>` : ''}
    <div class="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">${chip('all', 'Todos', S.products.length)}${Object.entries(CATS).map(([k, c]) => chip(k, c.label, counts[k])).join('')}</div>
    ${ui.est !== 'all' || ui.pas !== 'all' || ui.q ? `<div class="flex items-center justify-between mono text-label-sm text-secondary"><span>${lista.length} resultado${lista.length === 1 ? '' : 's'}${ui.est !== 'all' ? ' · ' + ST[ui.est].t : ''}${ui.pas !== 'all' ? ' · Pasillo ' + ui.pas.replace('P', '') : ''}</span><button data-act="limpiarFiltros" class="text-primary">Limpiar</button></div>` : ''}
    <div class="flex flex-col gap-4">${lista.map(cardMob).join('') || `<div class="text-center text-secondary py-12">Nada coincide con “${esc(ui.q)}”.<br><button data-act="limpiarFiltros" class="text-primary font-semibold mt-2">Ver todo</button></div>`}</div>
  </div>`;
}
function cardMob(p) {
  const s = status(p), r = s === 'red';
  return `<article class="bg-surface-container-lowest rounded-2xl shadow-sm p-4 flex flex-col gap-3 ${r ? 'ring-1 ring-error/25' : ''}">
    <button data-act="ficha" data-sku="${esc(p.sku)}" class="flex gap-3 text-left">
      ${tile(p, 'w-14 h-14')}
      <div class="min-w-0 flex-1">
        <div class="flex justify-between items-start gap-2"><span class="mono text-label-sm ${r ? 'text-error' : 'text-secondary'} truncate">SKU: ${esc(p.sku)}</span>${pill(p, true)}</div>
        <h3 class="text-[17px] font-semibold leading-snug line-clamp-2 mt-0.5">${esc(p.name)}</h3>
        <div class="flex items-center gap-1.5 text-body-sm text-secondary mt-1">${ic('location_on', 'ms-16 text-primary')}<span class="mono text-label-md text-on-surface">${esc(p.loc)}</span><span>·</span><span class="truncate">${esc(p.packLabel || CATS[p.cat].label)}</span></div>
      </div>
    </button>
    ${r ? `<div class="flex items-center gap-3 bg-error-container/50 rounded-xl p-3">${ic('warning', 'text-error')}
        <div class="flex-1 min-w-0"><div class="mono text-label-md text-error font-semibold uppercase">${qtyTxt(p, p.stock)} restante${p.stock === 1 ? '' : 's'} (mín: ${num(p.min)})</div><div class="text-body-sm text-on-surface-variant">${esc(locTxt(p.loc))}</div></div>
        ${S.pedidos[p.sku] ? `<span class="mono text-label-sm text-amber-800 bg-amber-100 px-2 py-1 rounded">PEDIDO</span>` : `<button data-act="pedir" data-sku="${esc(p.sku)}" class="shrink-0 inline-flex items-center gap-1 bg-error text-white px-3 h-10 rounded-lg mono text-label-md">${ic('local_shipping', 'ms-18')}PEDIR</button>`}
      </div>` : ''}
    <div class="grid grid-cols-3 bg-surface-container-low rounded-xl p-3 text-center">
      <div><div class="${LBL}">Disponible</div><div class="text-headline-md font-bold ${r ? 'text-error' : 'text-primary'}">${num(p.stock)} <span class="text-body-sm font-normal text-secondary">${UNIT[p.unit]}</span></div></div>
      <div><div class="${LBL}">Mínimo</div><div class="text-headline-md font-bold">${num(p.min)} <span class="text-body-sm font-normal text-secondary">${UNIT[p.unit]}</span></div></div>
      <div><div class="${LBL}">${p.serialized ? 'N.º serie' : 'Valor'}</div><div class="text-headline-md font-bold text-secondary">${p.serialized ? (p.serials || []).length : `<span class="text-body-lg">${eur(p.stock * p.price)}</span>`}</div></div>
    </div>
    <div class="grid grid-cols-[1fr_auto_auto] gap-2">
      <button data-act="mov" data-sku="${esc(p.sku)}" data-t="salida" ${p.stock <= 0 ? 'disabled' : ''} class="${BTN_P} h-14 text-body-lg">${ic('outbox', 'ms-fill')}Registrar salida</button>
      <button data-act="alCesta" data-sku="${esc(p.sku)}" class="w-14 h-14 rounded-lg bg-surface-container-low text-primary grid place-items-center" aria-label="Añadir a la entrega">${ic('add_shopping_cart')}</button>
      <button data-act="mov" data-sku="${esc(p.sku)}" data-t="entrada" class="w-14 h-14 rounded-lg bg-surface-container-low text-tertiary grid place-items-center" aria-label="Registrar entrada">${ic('move_to_inbox')}</button>
    </div>
  </article>`;
}

function viewVan() {
  const eq = equipo(ui.almacen); if (!eq) { ui.almacen = 'central'; return VIEW_FN.stock(); }
  const vs = vanStock(eq.id), val = vs.reduce((a, x) => a + x.qty * find(x.sku).price, 0);
  return `<div class="px-4 lg:px-gutter py-4 lg:py-space-lg flex flex-col gap-space-md max-w-5xl">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div><span class="${LBL}">Stock a bordo · entregado − devuelto</span><h1 class="text-headline-lg-mobile lg:text-headline-lg font-bold">${esc(eq.flota)} · ${esc(eq.matricula)}</h1><p class="text-secondary">${esc(eq.nombre)} · ${eq.tecnicos.map(t => esc(tec(t)?.nombre)).join(' + ')} · valor ${eur(val)}</p></div>
      <div class="flex gap-2"><button data-act="almacen" data-v="central" class="${BTN_S} px-4 h-11">${ic('warehouse', 'ms-20')}Volver al almacén</button><button data-act="cargar" data-v="${eq.id}" class="${BTN_P} px-4 h-11">${ic('add_shopping_cart', 'ms-20')}Cargar material</button></div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">${vs.map(x => { const p = find(x.sku); return `<article class="${CARD} p-4 flex gap-3 items-center">
      ${tile(p)}<div class="flex-1 min-w-0"><div class="mono text-label-sm text-secondary">${esc(p.sku)}</div><div class="font-semibold truncate">${esc(p.name)}</div>${x.serials.length ? `<div class="mono text-label-sm text-primary truncate">S/N: ${x.serials.map(esc).join(', ')}</div>` : ''}</div>
      <div class="text-right"><div class="text-headline-md font-bold">${num(x.qty)} <span class="text-body-sm text-secondary font-normal">${UNIT[p.unit]}</span></div><button data-act="devolver" data-sku="${esc(p.sku)}" data-v="${eq.id}" class="mono text-label-sm text-primary">Devolver ↩</button></div>
    </article>`; }).join('') || `<div class="${CARD} p-8 text-center text-secondary md:col-span-2">Esta furgoneta no lleva material entregado desde el almacén.</div>`}</div>
  </div>`;
}

/* ---------- 7. Ficha, alta y movimientos (hojas) ---------- */
function openModal(html, { ancha = false } = {}) {
  const m = $('#modal'); m.innerHTML = `<div class="velo" data-act="cerrar"></div><div class="hoja ${ancha ? 'ancha' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  m.classList.remove('hidden'); document.body.style.overflow = 'hidden';
  const f = m.querySelector('[autofocus]'); if (f && isDesk()) f.focus();
}
function closeModal() { const m = $('#modal'); m.classList.add('hidden'); m.innerHTML = ''; document.body.style.overflow = ''; ui.menu = null; }
const sheetHead = (title, sub = '') => `<div class="sticky top-0 bg-white z-10 px-5 pt-3 pb-3 border-b border-surface-container">
  <div class="w-12 h-1.5 rounded-full bg-surface-container-high mx-auto mb-3 lg:hidden"></div>
  <div class="flex items-start justify-between gap-3"><div class="min-w-0"><h2 class="text-headline-md font-semibold">${title}</h2>${sub ? `<p class="text-body-sm text-secondary">${sub}</p>` : ''}</div><button data-act="cerrar" class="p-2 -m-2 rounded-lg hover:bg-surface-container-low" aria-label="Cerrar">${ic('close')}</button></div></div>`;

function openFicha(sku) {
  const p = find(sku); if (!p) return;
  const movs = S.movements.filter(m => m.sku === sku).slice(0, 8);
  openModal(`${sheetHead(esc(p.name), `${CATS[p.cat].label} · ${esc(p.supplier)}`)}
    <div class="p-5 flex flex-col gap-4">
      <div class="flex items-center gap-3">${tile(p, 'w-16 h-16')}<div class="flex-1"><div class="text-headline-lg font-bold ${status(p) === 'red' ? 'text-error' : ''}">${qtyTxt(p, p.stock)}</div><div class="text-body-sm text-secondary">Mínimo ${qtyTxt(p, p.min)} · ${eur(p.price)}/${UNIT[p.unit]} · valor ${eur(p.stock * p.price)}</div></div>${pill(p)}</div>
      <div class="grid grid-cols-2 gap-2 text-body-sm">
        ${[['SKU', p.sku], ['Ubicación', `${p.loc} (${locTxt(p.loc)})`], ['EAN', p.ean || '—'], ['Ref. proveedor', p.supplierRef || '—'], ['Formato', p.packLabel || '—'], ['Unidad base', p.unit === 'm' ? 'metros' : 'unidades']].map(([k, v]) => `<div class="bg-surface-container-low rounded-lg p-2.5"><div class="${LBL}">${k}</div><div class="font-medium break-words">${esc(v)}</div></div>`).join('')}
      </div>
      ${p.serialized ? `<div><div class="${LBL} mb-1">Números de serie en stock (${(p.serials || []).length})</div><div class="flex flex-wrap gap-1.5">${(p.serials || []).map(s => tag(s, 'bg-primary-fixed text-primary')).join('') || '<span class="text-secondary text-body-sm">Ninguno</span>'}</div></div>` : ''}
      <div class="flex items-center gap-4 bg-surface-container-low rounded-xl p-3">
        <div id="qrFicha" class="w-24 h-24 bg-white rounded-lg grid place-items-center shrink-0">${qrSVG(p.sku)}</div>
        <div class="text-body-sm text-secondary">Etiqueta QR de la referencia. Imprímela y pégala en la estantería <b class="text-on-surface">${esc(p.loc)}</b>: el escáner la reconoce al instante.<br><button data-act="etiqueta" data-sku="${esc(p.sku)}" class="text-primary font-semibold mt-1">Imprimir etiqueta</button></div>
      </div>
      <div><div class="${LBL} mb-1">Últimos movimientos</div>${movs.map(movRow).join('') || '<p class="text-secondary text-body-sm">Sin movimientos todavía.</p>'}</div>
    </div>
    <div class="sticky bottom-0 bg-white border-t border-surface-container p-4 grid grid-cols-3 gap-2">
      <button data-act="mov" data-sku="${esc(p.sku)}" data-t="entrada" class="${BTN_T} h-12 !text-tertiary">${ic('add', 'ms-20')}Entrada</button>
      <button data-act="mov" data-sku="${esc(p.sku)}" data-t="salida" class="${BTN_P} h-12">${ic('remove', 'ms-20')}Salida</button>
      <button data-act="editProd" data-sku="${esc(p.sku)}" class="${BTN_S} h-12">${ic('edit', 'ms-20')}Editar</button>
    </div>`);
}
function movRow(m) {
  const p = find(m.sku), t = TIPO[m.type];
  return `<div class="flex items-center gap-3 py-2.5 border-b border-surface-container last:border-0">
    <span class="w-9 h-9 rounded-lg grid place-items-center shrink-0 ${t.c}">${ic(t.icon, 'ms-20')}</span>
    <div class="flex-1 min-w-0"><div class="font-medium truncate">${esc(p ? p.name : m.sku)}</div><div class="text-body-sm text-secondary truncate">${esc(m.reason)}${m.ref ? ' · ' + esc(m.ref) : ''} · ${esc(m.operator)}${m.serials && m.serials.length ? ' · S/N ' + m.serials.map(esc).join(', ') : ''}</div></div>
    <div class="text-right shrink-0"><div class="font-semibold ${m.type === 'entrada' ? 'text-tertiary' : m.type === 'merma' ? 'text-error' : ''}">${t.sign}${num(m.qty)} ${p ? UNIT[p.unit] : ''}</div><div class="mono text-label-sm text-secondary">${hace(m.ts)}</div></div>
  </div>`;
}

/* QR mínimo (usa la librería qrcode-generator si está cargada; si no, muestra el código) */
function qrSVG(txt) {
  if (window.qrcode) { try { const q = qrcode(0, 'M'); q.addData(txt); q.make(); return q.createSvgTag({ cellSize: 3, margin: 2, scalable: true }); } catch (e) { } }
  loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js').then(() => { const el = $('#qrFicha'); if (el && window.qrcode) el.innerHTML = qrSVG(txt); });
  return `<span class="mono text-label-sm text-center break-all p-1">${esc(txt)}</span>`;
}
const _scripts = {};
function loadScript(src) { return _scripts[src] = _scripts[src] || new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); }); }

let mv = null; // hoja de movimiento abierta
function openMove(sku, type, opts = {}) {
  const p = find(sku); if (!p) return;
  mv = { sku, type, qty: p.serialized ? 0 : (opts.qty || 1), reason: opts.reason || REASONS[type][0], ref: opts.ref || '', sel: opts.sel || [], snTxt: opts.snTxt || '', equipo: opts.equipo, max: opts.max, lock: !!opts.lock };
  renderMove();
}
function mvQty() { const p = find(mv.sku); if (!p.serialized) return Number(mv.qty) || 0; return mv.type === 'entrada' ? parseSN(mv.snTxt).length : mv.sel.length; }
function renderMove() {
  const p = find(mv.sku), q = mvQty(), after = mv.type === 'entrada' ? p.stock + q : p.stock - q;
  const tmp = { ...p, stock: after }, bad = (mv.type !== 'entrada' && q > p.stock) || (mv.max && q > mv.max);
  const snPool = mv.equipo ? (vanStock(mv.equipo).find(x => x.sku === p.sku)?.serials || []) : (p.serials || []);
  const steps = p.unit === 'm' ? [1, 10, 50, 100] : p.pack > 1 ? [1, 5, 10, p.pack] : [1, 5, 10];
  openModal(`${sheetHead(`${TIPO[mv.type].t} de material`, esc(p.name))}
    <div class="p-5 flex flex-col gap-4">
      ${mv.lock ? '' : `<div class="grid grid-cols-3 bg-surface-container-low rounded-xl p-1">${['entrada', 'salida', 'merma'].map(t => `<button data-act="mvType" data-v="${t}" class="h-12 rounded-lg font-semibold ${mv.type === t ? 'bg-white shadow-sm ' + (t === 'entrada' ? 'text-tertiary' : t === 'merma' ? 'text-error' : 'text-primary') : 'text-on-surface-variant'}">${TIPO[t].t}</button>`).join('')}</div>`}
      <div class="flex items-center gap-3 bg-surface-container-low rounded-xl p-3">${tile(p)}<div class="flex-1 min-w-0"><div class="mono text-label-sm text-secondary">${esc(p.sku)} · ${esc(p.loc)}</div><div class="text-body-sm">Stock actual <b>${qtyTxt(p, p.stock)}</b> · mín. ${qtyTxt(p, p.min)}</div></div></div>
      ${p.serialized ? (mv.type === 'entrada'
      ? `<label class="flex flex-col gap-1"><span class="${LBL}">Números de serie que entran (uno por línea)</span><textarea id="mvSN" data-in="mvSN" rows="4" class="${INP} mono" placeholder="Escanea o escribe cada n.º de serie">${esc(mv.snTxt)}</textarea><span class="text-body-sm text-secondary">${q} unidad${q === 1 ? '' : 'es'}</span></label>`
      : `<div><div class="${LBL} mb-2">Elige los n.º de serie que salen (${q} seleccionado${q === 1 ? '' : 's'})</div><div class="flex flex-wrap gap-2">${snPool.map(s => `<button data-act="mvSel" data-v="${esc(s)}" class="px-3 h-11 rounded-lg mono text-label-md ${mv.sel.includes(s) ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface'}">${mv.sel.includes(s) ? '✓ ' : ''}${esc(s)}</button>`).join('') || '<span class="text-secondary">No hay unidades con n.º de serie.</span>'}</div></div>`)
      : `<div><div class="${LBL} mb-2">Cantidad (${p.unit === 'm' ? 'metros' : 'unidades'})</div>
        <div class="flex items-stretch gap-2"><div class="flex items-center bg-white ring-1 ring-surface-container-high rounded-xl flex-1">
          <button data-act="mvStep" data-v="-1" class="w-14 h-14 grid place-items-center text-primary" aria-label="Menos">${ic('remove', 'ms-28')}</button>
          <input id="mvQ" data-in="mvQty" inputmode="decimal" value="${esc(mv.qty)}" class="flex-1 min-w-0 text-center text-headline-lg font-bold bg-transparent focus:outline-none" aria-label="Cantidad">
          <button data-act="mvStep" data-v="1" class="w-14 h-14 grid place-items-center text-primary" aria-label="Más">${ic('add', 'ms-28')}</button></div></div>
        <div class="grid grid-cols-4 gap-2 mt-2">${steps.map(s => `<button data-act="mvStep" data-v="${s}" class="h-11 rounded-lg bg-primary-fixed/60 text-primary font-semibold">+${num(s)}</button>`).join('')}</div></div>`}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="flex flex-col gap-1"><span class="${LBL}">Motivo</span><select data-in="mvReason" class="${INP} h-12">${REASONS[mv.type].map(r => `<option ${r === mv.reason ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
        <label class="flex flex-col gap-1"><span class="${LBL}">${mv.type === 'entrada' ? 'Albarán / origen' : 'Obra / referencia'}</span><input id="mvRef" data-in="mvRef" value="${esc(mv.ref)}" class="${INP} h-12" placeholder="${mv.type === 'entrada' ? 'Alb. 2.824.560' : 'C/ Recogidas 12, Granada'}"></label>
      </div>
      <div class="flex items-center justify-between rounded-xl p-3 ${bad ? 'bg-error-container text-error' : 'bg-surface-container-low'}">
        <span class="text-body-sm">${bad ? (mv.max && q > mv.max ? `La furgoneta solo lleva ${qtyTxt(p, mv.max)}` : `No hay tanto stock: quedan ${qtyTxt(p, p.stock)}`) : `Stock pasará de <b>${qtyTxt(p, p.stock)}</b> a <b>${qtyTxt(p, Math.max(0, after))}</b>`}</span>${bad ? '' : pill(tmp, true)}
      </div>
      <p class="text-body-sm text-secondary">Se registra a nombre de <b>${esc(S.operator)}</b> con fecha y hora.</p>
    </div>
    <div class="sticky bottom-0 bg-white border-t border-surface-container p-4"><button data-act="mvOk" ${q > 0 && !bad ? '' : 'disabled'} class="${BTN_P} w-full h-14 text-body-lg">${ic('check_circle', 'ms-fill')}Confirmar ${TIPO[mv.type].t.toLowerCase()} de ${q > 0 ? qtyTxt(p, q) : '…'}</button></div>`);
}
function commitMove() {
  const p = find(mv.sku), q = mvQty();
  const serials = p.serialized ? (mv.type === 'entrada' ? parseSN(mv.snTxt) : mv.sel) : [];
  try {
    const r = applyMovement({ sku: mv.sku, type: mv.type, qty: q, reason: mv.reason, ref: mv.ref.trim(), serials, equipo: mv.equipo });
    save(); closeModal(); render();
    toast(`${TIPO[mv.type].t} registrada: ${qtyTxt(p, q)} de ${p.name}. Stock: ${qtyTxt(p, p.stock)}.`, 'ok');
    avisoEstado(r);
  } catch (e) { toast(e.message, 'err'); }
}

function openPicker(type) {
  ui.pickType = type; ui.pickQ = '';
  openModal(`${sheetHead(`${TIPO[type].t}: elige el material`)}<div class="p-5 flex flex-col gap-3"><input id="pickQ" data-in="pickQ" autofocus type="search" class="${INP} h-12" placeholder="Busca por nombre, SKU o ubicación"><div id="pickList" class="flex flex-col"></div></div>`);
  refreshPicker();
}
function refreshPicker() {
  const el = $('#pickList'); if (!el) return;
  el.innerHTML = searchProducts(ui.pickQ).slice(0, 30).map(p => `<button data-act="mov" data-sku="${esc(p.sku)}" data-t="${ui.pickType}" class="flex items-center gap-3 py-2.5 border-b border-surface-container text-left">${tile(p, 'w-10 h-10')}<div class="flex-1 min-w-0"><div class="font-medium truncate">${esc(p.name)}</div><div class="mono text-label-sm text-secondary">${esc(p.sku)} · ${esc(p.loc)} · ${qtyTxt(p, p.stock)}</div></div>${pill(p, true)}</button>`).join('') || '<p class="text-secondary py-6 text-center">Sin resultados.</p>';
}

let pf = null; // formulario de producto
function openProdForm(sku, preset = {}) {
  const p = sku ? find(sku) : null;
  pf = p ? { ...clone(p), _edit: sku } : { sku: '', name: '', cat: 'fijaciones', unit: 'ud', pack: 1, packLabel: '', stock: 0, min: 10, loc: 'P01-E01-N1', supplier: '', price: 0, ean: '', supplierRef: '', serialized: false, ...preset };
  const [a, b, c] = pf.loc.split('-');
  const f = (k, lbl, attrs = '') => `<label class="flex flex-col gap-1"><span class="${LBL}">${lbl}</span><input data-in="pf" data-k="${k}" value="${esc(pf[k] ?? '')}" class="${INP} h-12" ${attrs}></label>`;
  openModal(`${sheetHead(p ? 'Editar referencia' : 'Nueva referencia', p ? esc(p.sku) : 'Alta en el catálogo del almacén')}
    <div class="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
      ${f('sku', 'SKU / ID *', p ? 'readonly' : 'autofocus')}
      ${f('ean', 'EAN / código de barras', 'inputmode="numeric"')}
      <div class="sm:col-span-2">${f('name', 'Nombre *')}</div>
      <label class="flex flex-col gap-1"><span class="${LBL}">Categoría</span><select data-in="pf" data-k="cat" class="${INP} h-12">${Object.entries(CATS).map(([k, c]) => `<option value="${k}" ${pf.cat === k ? 'selected' : ''}>${c.label}</option>`).join('')}</select></label>
      <label class="flex flex-col gap-1"><span class="${LBL}">Unidad base</span><select data-in="pf" data-k="unit" class="${INP} h-12"><option value="ud" ${pf.unit === 'ud' ? 'selected' : ''}>Unidades</option><option value="m" ${pf.unit === 'm' ? 'selected' : ''}>Metros</option></select></label>
      ${f('packLabel', 'Formato (caja 100 ud, bobina 100 m…)')}
      ${f('pack', 'Unidades por formato', 'inputmode="decimal"')}
      ${p ? '' : f('stock', 'Stock inicial', 'inputmode="decimal"')}
      ${f('min', 'Stock mínimo (alerta)', 'inputmode="decimal"')}
      <div class="sm:col-span-2"><span class="${LBL}">Ubicación (Pasillo · Estantería · Nivel)</span><div class="grid grid-cols-3 gap-2 mt-1">
        ${[['P', a], ['E', b], ['N', c]].map(([k, v]) => `<label class="flex items-center gap-1 ${INP} h-12"><span class="mono text-secondary">${k}</span><input data-in="pfLoc" data-k="${k}" value="${esc(String(v || '').replace(k, ''))}" inputmode="numeric" class="w-full bg-transparent focus:outline-none mono" aria-label="${k === 'P' ? 'Pasillo' : k === 'E' ? 'Estantería' : 'Nivel'}"></label>`).join('')}</div></div>
      ${f('supplier', 'Proveedor')}
      ${f('supplierRef', 'Ref. del proveedor')}
      ${f('price', 'Precio de coste por unidad base (€)', 'inputmode="decimal"')}
      <label class="flex items-center gap-3 bg-surface-container-low rounded-lg px-3 h-12"><input type="checkbox" data-in="pf" data-k="serialized" ${pf.serialized ? 'checked' : ''} class="w-5 h-5 accent-primary"><span>Control por número de serie</span></label>
    </div>
    <div class="sticky bottom-0 bg-white border-t border-surface-container p-4 flex gap-2">
      <button data-act="cerrar" class="${BTN_S} h-12 px-5">Cancelar</button>
      <button data-act="pfOk" class="${BTN_P} h-12 flex-1">${ic('save', 'ms-20')}${p ? 'Guardar cambios' : 'Crear referencia'}</button>
    </div>`);
}
function commitProd() {
  const d = pf, n = v => Number(String(v).replace(',', '.'));
  d.sku = String(d.sku || '').trim().toUpperCase(); d.name = String(d.name || '').trim();
  if (!d.sku || !d.name) return toast('El SKU y el nombre son obligatorios.', 'err');
  if (!d._edit && find(d.sku)) return toast(`Ya existe una referencia con el SKU ${d.sku}.`, 'err');
  if (!/^P\d{1,3}-E\d{1,3}-N\d{1,2}$/.test(d.loc)) return toast('Ubicación incompleta: indica pasillo, estantería y nivel.', 'err');
  for (const k of ['pack', 'min', 'price', 'stock']) { d[k] = n(d[k] || 0); if (!(d[k] >= 0)) return toast('Revisa los números: no pueden ser negativos.', 'err'); }
  const obj = { sku: d.sku, name: d.name, cat: d.cat, unit: d.unit, pack: d.pack || 1, packLabel: d.packLabel, min: d.min, loc: d.loc, supplier: d.supplier, price: d.price, ean: d.ean || undefined, supplierRef: d.supplierRef || undefined, serialized: !!d.serialized };
  if (d._edit) { Object.assign(find(d._edit), obj); if (obj.serialized && !find(d._edit).serials) find(d._edit).serials = []; toast('Referencia actualizada.', 'ok'); }
  else {
    S.products.push({ ...obj, stock: 0, serials: obj.serialized ? [] : undefined });
    if (d.stock > 0 && !obj.serialized) applyMovement({ sku: obj.sku, type: 'entrada', qty: d.stock, reason: 'Ajuste de inventario', ref: 'Alta de referencia' });
    toast(`Referencia ${obj.sku} creada${obj.serialized && d.stock > 0 ? '. Da entrada a las unidades con su n.º de serie.' : '.'}`, 'ok');
    if (pf._albLine !== undefined && alb.lines[pf._albLine]) { alb.lines[pf._albLine].sku = obj.sku; alb.lines[pf._albLine].include = true; alb.lines[pf._albLine].how = 'alta manual'; }
  }
  save(); closeModal(); render();
}

function openConteo(pas) {
  const ps = S.products.filter(p => aisle(p.loc) === pas).sort((a, b) => a.loc.localeCompare(b.loc));
  ui.conteo = { pas, vals: {} };
  openModal(`${sheetHead(`Recuento del pasillo ${pas.replace('P', '')}`, 'Escribe lo que cuentas físicamente. Solo se ajustan las líneas con diferencia, y solo al confirmar.')}
    <div class="p-5 flex flex-col">${ps.map(p => `<div class="flex items-center gap-3 py-2.5 border-b border-surface-container">
      <div class="flex-1 min-w-0"><div class="font-medium truncate">${esc(p.name)}</div><div class="mono text-label-sm text-secondary">${esc(p.loc)} · sistema: ${qtyTxt(p, p.stock)}</div></div>
      <input data-in="conteo" data-sku="${esc(p.sku)}" inputmode="decimal" placeholder="${num(p.stock)}" class="${INP} !w-28 h-12 text-center mono" aria-label="Cantidad contada de ${esc(p.name)}" ${p.serialized ? 'disabled title="Los cargadores se recuentan por n.º de serie con el escáner"' : ''}></div>`).join('')}</div>
    <div class="sticky bottom-0 bg-white border-t border-surface-container p-4"><button data-act="conteoOk" class="${BTN_P} w-full h-14">${ic('fact_check', 'ms-fill')}Confirmar recuento y ajustar diferencias</button></div>`);
}
function commitConteo() {
  let n = 0;
  for (const [sku, v] of Object.entries(ui.conteo.vals)) {
    const p = find(sku), c = Number(String(v).replace(',', '.')); if (v === '' || !(c >= 0) || c === p.stock) continue;
    const d = Math.round((c - p.stock) * 1000) / 1000;
    applyMovement({ sku, type: d > 0 ? 'entrada' : 'merma', qty: Math.abs(d), reason: 'Ajuste de inventario', ref: `Recuento pasillo ${ui.conteo.pas}` }); n++;
  }
  save(); closeModal(); render();
  toast(n ? `Recuento guardado: ${n} ajuste${n === 1 ? '' : 's'} registrado${n === 1 ? '' : 's'}.` : 'Recuento sin diferencias: no se ha ajustado nada.', 'ok');
}

function openAvisos() {
  const crit = critical(), am = warning();
  openModal(`${sheetHead('Avisos de stock', `${crit.length} en crítico · ${am.length} en nivel bajo · ${Object.keys(S.pedidos).length} pedidos en curso`)}
    <div class="p-5 flex flex-col gap-1">${[...crit, ...am].map(p => `<div class="flex items-center gap-3 py-2 border-b border-surface-container">${tile(p, 'w-10 h-10')}
      <button data-act="ficha" data-sku="${esc(p.sku)}" class="flex-1 min-w-0 text-left"><div class="font-medium truncate">${esc(p.name)}</div><div class="mono text-label-sm text-secondary">${qtyTxt(p, p.stock)} / mín. ${qtyTxt(p, p.min)} · ${esc(p.supplier)}</div></button>
      ${S.pedidos[p.sku] ? tag('Pedido', 'bg-amber-100 text-amber-800') : `<button data-act="pedir" data-sku="${esc(p.sku)}" class="${BTN_T} px-3 h-9 text-body-sm">Pedir</button>`}</div>`).join('') || '<p class="text-secondary text-center py-8">Todo el stock está en verde.</p>'}</div>
    ${Object.keys(S.pedidos).length ? `<div class="sticky bottom-0 bg-white border-t border-surface-container p-4"><button data-act="csvPedido" class="${BTN_P} w-full h-12">${ic('file_download', 'ms-20')}Exportar lista de reposición (CSV)</button></div>` : ''}`);
}
function openMenu() {
  const item = (v, extra = '') => `<a href="#${v}" class="flex items-center gap-3 px-4 h-14 rounded-xl ${ui.view === v ? 'bg-primary-fixed text-primary font-semibold' : 'hover:bg-surface-container-low'}">${ic(VIEWS[v].icon)}<span class="flex-1">${VIEWS[v].label}</span>${extra}</a>`;
  openModal(`${sheetHead('Menú', `Operario activo: ${esc(S.operator)}`)}
    <div class="p-3 flex flex-col gap-1">
      ${Object.keys(VIEWS).map(v => item(v)).join('')}
      <button data-act="avisos" class="flex items-center gap-3 px-4 h-14 rounded-xl hover:bg-surface-container-low">${ic('notifications')}<span class="flex-1 text-left">Avisos de stock</span>${critical().length ? tag(critical().length, 'bg-error-container text-error') : ''}</button>
      <button data-act="perfil" class="flex items-center gap-3 px-4 h-14 rounded-xl hover:bg-surface-container-low">${ic('person')}<span class="flex-1 text-left">Cambiar operario</span></button>
    </div>`);
}
function openPerfil() {
  const ops = [OFICINA, ...S.tecnicos.map(t => t.nombre)];
  openModal(`${sheetHead('¿Quién está usando la app?', 'Cada movimiento queda registrado a nombre del operario activo.')}
    <div class="p-4 flex flex-col gap-1">${ops.map(o => `<button data-act="setOp" data-v="${esc(o)}" class="flex items-center gap-3 px-3 h-14 rounded-xl text-left ${S.operator === o ? 'bg-primary-fixed text-primary font-semibold' : 'hover:bg-surface-container-low'}">${avatar(o)}<span class="flex-1">${esc(o)}</span>${S.operator === o ? ic('check') : ''}</button>`).join('')}</div>`);
}

/* ---------- 8. Escáner (cámara real + simulación) ---------- */
let cam = { el: null, video: null, stream: null, timer: null, detector: null, msg: '', torch: false, busy: false, canvas: null, starting: false };
function camElement() {
  if (!cam.el) {
    cam.el = document.createElement('div');
    cam.el.className = 'cam w-full h-full';
    cam.el.innerHTML = `<div class="cam-fondo"></div><video playsinline muted autoplay></video>
      <div class="esq tl"></div><div class="esq tr"></div><div class="esq bl"></div><div class="esq br"></div><div class="laser"></div><div class="cam-ui absolute inset-0"></div>`;
    cam.video = cam.el.querySelector('video');
  }
  return cam.el;
}
function camOverlay() {
  if (!cam.el) return;
  const hit = ui.scanHit, p = hit && find(hit.sku);
  const track = cam.stream && cam.stream.getVideoTracks()[0];
  const canTorch = track && track.getCapabilities && (track.getCapabilities().torch);
  cam.el.querySelector('.laser').style.display = cam.stream && !hit ? '' : 'none';
  cam.el.querySelector('.cam-ui').innerHTML = `
    <span class="absolute top-4 left-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/45 text-tertiary-fixed mono text-label-md"><span class="w-1.5 h-1.5 rounded-full bg-tertiary-fixed ${cam.stream ? 'pulso' : ''}"></span>${cam.stream ? (cam.detector ? 'QR · EAN · CODE128' : 'LECTOR QR') : 'CÁMARA APAGADA'}</span>
    <div class="absolute top-4 right-4 flex flex-col gap-2">
      ${canTorch ? `<button data-act="torch" class="w-12 h-12 rounded-full bg-black/45 text-white grid place-items-center" aria-label="Linterna">${ic(cam.torch ? 'flashlight_off' : 'flashlight_on')}</button>` : ''}
      ${cam.stream ? `<button data-act="camOff" class="w-12 h-12 rounded-full bg-black/45 text-white grid place-items-center" aria-label="Apagar cámara">${ic('videocam_off')}</button>` : ''}
    </div>
    ${hit && p ? `<div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-inverse-surface/85 backdrop-blur text-white rounded-xl px-4 py-3 text-center shadow-xl max-w-[80%]">
        <div class="mono text-label-md text-tertiary-fixed flex items-center justify-center gap-1.5">${ic('verified', 'ms-18')}CÓDIGO RECONOCIDO</div><div class="mono text-label-lg mt-1 break-all">${esc(hit.code)}</div></div>`
      : hit && !p ? `<div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-error/90 text-white rounded-xl px-4 py-3 text-center max-w-[80%]"><div class="mono text-label-md">CÓDIGO DESCONOCIDO</div><div class="mono text-label-lg mt-1 break-all">${esc(hit.code)}</div></div>`
        : !cam.stream ? `<div class="absolute inset-0 grid place-items-center p-6"><div class="text-center text-white flex flex-col items-center gap-3">${ic('photo_camera', 'ms-40 text-tertiary-fixed')}<p class="text-body-md max-w-xs text-white/85">${esc(cam.msg || 'Activa la cámara para leer QR de cargadores, EAN de cajas o etiquetas de estantería.')}</p><button data-act="camOn" class="${BTN} bg-tertiary-fixed text-on-tertiary-fixed h-12 px-5">${ic('videocam')}Activar cámara</button></div></div>` : ''}
    <div class="absolute bottom-3 inset-x-4 flex justify-between mono text-label-sm text-white/70"><span>${cam.stream ? 'Enfoque continuo' : ''}</span><span>${ui.scanLog.length ? `${ui.scanLog.length} bulto${ui.scanLog.length === 1 ? '' : 's'} en esta sesión` : ''}</span></div>`;
}
async function startCamera() {
  if (cam.stream || cam.starting) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { cam.msg = 'Este navegador no permite usar la cámara aquí (hace falta https). Escribe el código o usa los de prueba.'; camOverlay(); return; }
  cam.starting = true;
  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    if (ui.view !== 'scan') { stopCamera(); return; }
    camElement(); cam.video.srcObject = cam.stream; await cam.video.play().catch(() => { });
    if ('BarcodeDetector' in window) {
      try { cam.detector = cam.detector || new BarcodeDetector({ formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'data_matrix'] }); } catch (e) { cam.detector = null; }
    }
    if (!cam.detector) await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js').catch(() => { });
    cam.msg = ''; clearInterval(cam.timer); cam.timer = setInterval(scanTick, 280);
  } catch (e) {
    cam.stream = null;
    cam.msg = e && e.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Actívalo en los ajustes del navegador o escribe el código a mano.' : 'No se ha podido abrir la cámara. Escribe el código o usa los de prueba.';
  }
  cam.starting = false; camOverlay();
}
function stopCamera() {
  clearInterval(cam.timer); cam.timer = null;
  if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
  cam.stream = null; cam.torch = false; if (cam.video) cam.video.srcObject = null;
}
async function scanTick() {
  const h = ui.scanHit, ph = h && find(h.sku), acum = ph && ph.serialized && ui.scanMode === 'entrada';
  if (!cam.stream || (h && !acum) || cam.busy || $('#modal:not(.hidden)')) return;
  const v = cam.video; if (!v || v.readyState < 2) return;
  cam.busy = true;
  try {
    let code = null;
    if (cam.detector) { const r = await cam.detector.detect(v); if (r.length) code = r[0].rawValue; }
    else if (window.jsQR) {
      const w = 480, h = Math.round(w * v.videoHeight / v.videoWidth) || 360;
      cam.canvas = cam.canvas || document.createElement('canvas'); cam.canvas.width = w; cam.canvas.height = h;
      const ctx = cam.canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(v, 0, 0, w, h);
      const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' }); if (r) code = r.data;
    }
    if (code && !(cam.last && cam.last.code === code && Date.now() - cam.last.ts < 2500)) { cam.last = { code, ts: Date.now() }; handleCode(code, 'cámara'); }
  } catch (e) { }
  cam.busy = false;
}
function setScanSerial() {
  const h = ui.scanHit, p = h && find(h.sku); ui.scanSel = []; ui.scanSN = '';
  if (p && p.serialized && h.serial) { ui.scanSN = h.serial; if ((p.serials || []).includes(h.serial)) ui.scanSel = [h.serial]; }
}
function handleCode(raw, via = 'manual') {
  const r = resolveCode(raw);
  const h0 = ui.scanHit, p0 = h0 && find(h0.sku);
  if (p0 && p0.serialized && ui.scanMode === 'entrada' && r && r.p.sku === p0.sku && r.serial) { // cajas seguidas del mismo modelo: se acumulan
    const sn = parseSN(ui.scanSN); if (!sn.includes(r.serial)) { sn.push(r.serial); ui.scanSN = sn.join(String.fromCharCode(10)); toast(`S/N ${r.serial} añadido (${sn.length}).`, 'ok', 2000); if (navigator.vibrate) navigator.vibrate(60); }
    renderScan(); return;
  }
  ui.scanHit = { code: String(raw).trim(), sku: r ? r.p.sku : null, serial: r ? r.serial : '', nuevo: r ? !!r.nuevo : false, via };
  ui.scanQty = 1; ui.scanSel = []; ui.scanSN = ''; ui.scanRef = '';
  if (r) {
    const p = r.p;
    ui.scanReason = REASONS[ui.scanMode === 'consulta' ? 'salida' : ui.scanMode][0];
    setScanSerial();
  }
  if (navigator.vibrate) navigator.vibrate(r ? 60 : [40, 60, 40]);
  renderScan();
}
function renderScan() {
  const main = $('#main');
  if (!main.querySelector('#camSlot')) {
    main.innerHTML = `<div class="lg:px-gutter lg:py-space-lg lg:grid lg:grid-cols-12 lg:gap-space-lg lg:items-start max-w-[1500px]">
      <section class="lg:col-span-7 flex flex-col">
        <div class="px-4 pt-3 lg:px-0 lg:pt-0 hidden lg:flex items-end justify-between mb-4"><div><span class="${LBL}">Lectura QR · EAN · n.º de serie</span><h1 class="text-headline-lg font-bold">Escanear stock con cámara</h1></div></div>
        <div id="scanModes" class="px-4 pt-3 lg:px-0 lg:pt-0"></div>
        <div id="camSlot" class="mt-3 relative h-[44vh] min-h-[280px] lg:h-[520px] lg:rounded-2xl overflow-hidden"></div>
      </section>
      <section id="scanRes" class="lg:col-span-5 relative z-10 -mt-6 lg:mt-0 bg-surface-container-lowest rounded-t-3xl lg:rounded-2xl shadow-[0_-8px_24px_rgba(11,28,48,0.10)] lg:shadow-sm p-4 lg:p-5"></section>
    </div>`;
    $('#camSlot').appendChild(camElement());
    if (cam.stream && cam.video.paused) cam.video.play().catch(() => { });
  }
  $('#scanModes').innerHTML = `<div class="grid grid-cols-3 bg-inverse-surface rounded-xl p-1 gap-1">${[['entrada', 'Entrada stock', 'move_to_inbox'], ['salida', 'Salida', 'outbox'], ['consulta', 'Consulta', 'search']].map(([k, l, i]) => `<button data-act="scanMode" data-v="${k}" class="h-14 rounded-lg flex flex-col items-center justify-center gap-0.5 text-body-sm font-semibold ${ui.scanMode === k ? 'bg-primary-container text-white' : 'text-white/70'}">${ic(i, 'ms-20')}${l}</button>`).join('')}</div>`;
  camOverlay();
  $('#scanRes').innerHTML = scanResultHTML();
}
function scanResultHTML() {
  const hit = ui.scanHit;
  const tests = [['BF-FIX-SX8', 'Caja tacos SX 8'], ['4006209700985', 'EAN tacos SX 6'], ['WBX-22-899281', 'S/N Wallbox 22 kW'], ['WBX-22-899399', 'S/N nuevo Wallbox'], ['CAB-RZ1K-5G6', 'Bobina 5G6'], ['SCH-IC60N-40', 'Magneto iC60N']];
  const manual = `<form data-act="manualForm" class="flex gap-2"><input id="manualCode" data-in="manual" value="${esc(ui.manual)}" class="${INP} h-12 mono" placeholder="Escribe o pega un código" autocomplete="off"><button class="${BTN_P} h-12 px-4" type="submit">${ic('keyboard_return')}</button></form>`;
  if (!hit) return `<div class="w-12 h-1.5 rounded-full bg-surface-container-high mx-auto mb-4 lg:hidden"></div>
    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-3"><span class="w-12 h-12 rounded-xl bg-primary-fixed text-primary grid place-items-center">${ic('center_focus_weak', 'ms-28')}</span><div><div class="font-semibold text-headline-sm">Apunta al código</div><div class="text-body-sm text-secondary">Modo <b>${ui.scanMode === 'entrada' ? 'entrada de stock' : ui.scanMode === 'salida' ? 'salida de material' : 'consulta'}</b>. Al leerlo verás la ficha aquí.</div></div></div>
      ${manual}
      <div><div class="${LBL} mb-2">Códigos de prueba (tócalos para simular la lectura)</div><div class="flex flex-wrap gap-2">${tests.map(([c, l]) => `<button data-act="testCode" data-v="${c}" class="px-3 h-10 rounded-lg bg-surface-container-low text-body-sm hover:bg-surface-container-high">${l}</button>`).join('')}</div></div>
      ${scanLogHTML()}
    </div>`;
  const p = hit.sku && find(hit.sku);
  if (!p) return `<div class="flex flex-col gap-4"><div class="flex items-center gap-3 bg-error-container/60 rounded-xl p-4">${ic('help', 'text-error ms-32')}<div><div class="font-semibold">“${esc(hit.code)}” no está en el catálogo</div><div class="text-body-sm text-secondary">Puedes darlo de alta ahora con este código.</div></div></div>
    <button data-act="altaCodigo" class="${BTN_P} h-14">${ic('add_circle', 'ms-fill')}Crear referencia con este código</button>
    <button data-act="scanNext" class="${BTN_T} h-14 text-body-lg">${ic('skip_next')}Escanear siguiente</button>${manual}</div>`;

  const mode = ui.scanMode, serialIn = p.serialized && mode === 'entrada', serialOut = p.serialized && mode === 'salida';
  const q = p.serialized ? (serialIn ? parseSN(ui.scanSN).length : ui.scanSel.length) : ui.scanQty;
  const bad = mode === 'salida' && q > p.stock;
  const yaEnStock = serialIn && parseSN(ui.scanSN).some(s => (p.serials || []).includes(s));
  const lastMovs = S.movements.filter(m => m.sku === p.sku).slice(0, 3);
  return `<div class="w-12 h-1.5 rounded-full bg-surface-container-high mx-auto mb-4 lg:hidden"></div>
  <div class="flex flex-col gap-3">
    <div class="bg-surface-container-low rounded-2xl p-4 flex gap-3">${tile(p, 'w-14 h-14')}
      <div class="flex-1 min-w-0"><div class="flex justify-between items-center gap-2"><span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed mono text-label-sm">● IDENTIFICADO</span><span class="mono text-label-sm text-secondary">vía ${esc(hit.via)}</span></div>
        <div class="text-headline-sm font-semibold mt-1 leading-snug">${esc(p.name)}</div>
        <div class="mono text-label-sm text-primary mt-0.5">SKU: ${esc(p.sku)} <span class="text-secondary">· Stock ${qtyTxt(p, p.stock)}</span></div></div></div>
    <div class="grid grid-cols-2 gap-3">
      <div class="bg-surface-container-low rounded-xl p-3"><div class="${LBL} flex justify-between">${p.serialized ? 'S/N leído' : 'Código leído'}${ic('check_circle', 'ms-18 text-tertiary')}</div><div class="mono text-label-lg mt-1 break-all">${esc(hit.serial || hit.code)}</div></div>
      <div class="bg-primary-fixed/50 rounded-xl p-3"><div class="${LBL} flex justify-between">Ubicación${ic('location_on', 'ms-18 text-primary')}</div><div class="mono text-label-lg text-primary mt-1">${esc(p.loc)}</div></div>
    </div>
    ${mode === 'consulta' ? `<div class="flex items-center justify-between bg-surface-container-low rounded-xl p-3"><span>${pill(p)}</span><span class="text-body-sm text-secondary">Mín. ${qtyTxt(p, p.min)} · ${esc(p.supplier)}</span></div>
      <div>${lastMovs.map(movRow).join('') || '<p class="text-secondary text-body-sm">Sin movimientos.</p>'}</div>
      <div class="grid grid-cols-2 gap-2"><button data-act="scanMode" data-v="entrada" class="${BTN_T} h-12 !text-tertiary">${ic('move_to_inbox', 'ms-20')}Dar entrada</button><button data-act="scanMode" data-v="salida" class="${BTN_T} h-12">${ic('outbox', 'ms-20')}Dar salida</button></div>
      <button data-act="ficha" data-sku="${esc(p.sku)}" class="${BTN_S} h-12">${ic('description', 'ms-20')}Ver ficha completa</button>`
      : `${serialIn ? `<label class="flex flex-col gap-1 bg-surface-container-low rounded-xl p-3"><span class="${LBL}">N.º de serie que entran · uno por línea</span><textarea id="scanSN" data-in="scanSN" rows="3" class="${INP} mono !bg-white">${esc(ui.scanSN)}</textarea>${yaEnStock ? '<span class="text-body-sm text-error">Alguno de estos n.º de serie ya está en stock.</span>' : `<span class="text-body-sm text-secondary">${q} unidad${q === 1 ? '' : 'es'}. Escanea la siguiente caja para añadir más.</span>`}</label>`
        : serialOut ? `<div class="bg-surface-container-low rounded-xl p-3"><div class="${LBL} mb-2">Unidades que salen (${q})</div><div class="flex flex-wrap gap-2">${(p.serials || []).map(s => `<button data-act="scanSel" data-v="${esc(s)}" class="px-3 h-11 rounded-lg mono text-label-md ${ui.scanSel.includes(s) ? 'bg-primary text-white' : 'bg-white'}">${ui.scanSel.includes(s) ? '✓ ' : ''}${esc(s)}</button>`).join('') || '<span class="text-error">No quedan unidades en stock.</span>'}</div></div>`
          : `<div class="bg-surface-container-low rounded-xl p-3"><div class="flex justify-between items-center mb-2"><span class="${LBL}">${mode === 'entrada' ? 'Unidades recibidas' : 'Cantidad que sale'}</span><span class="mono text-label-sm text-primary">${p.pack > 1 ? `Formato: ${esc(p.packLabel)}` : ''}</span></div>
            <div class="flex gap-2"><div class="flex items-center bg-white rounded-xl flex-1 min-w-0"><button data-act="scanStep" data-v="-1" class="w-12 h-14 grid place-items-center" aria-label="Menos">${ic('remove')}</button><input id="scanQ" data-in="scanQty" inputmode="decimal" value="${esc(ui.scanQty)}" class="w-full min-w-0 text-center text-headline-md font-bold bg-transparent focus:outline-none" aria-label="Cantidad"><span class="text-body-sm text-secondary pr-1">${UNIT[p.unit]}</span><button data-act="scanStep" data-v="1" class="w-12 h-14 grid place-items-center" aria-label="Más">${ic('add')}</button></div>
            ${(p.pack > 1 ? [p.pack, p.pack * 5] : [5, 10]).map(s => `<button data-act="scanStep" data-v="${s}" class="w-14 h-14 shrink-0 rounded-xl bg-primary-fixed/70 text-primary font-semibold text-body-sm">+${num(s)}</button>`).join('')}</div></div>`}
      <div class="grid grid-cols-2 gap-2">
        <select data-in="scanReason" class="${INP} h-12" aria-label="Motivo">${REASONS[mode].map(r => `<option ${r === ui.scanReason ? 'selected' : ''}>${r}</option>`).join('')}</select>
        <input id="scanRef" data-in="scanRef" value="${esc(ui.scanRef)}" class="${INP} h-12" placeholder="${mode === 'entrada' ? 'Albarán' : 'Obra'}" aria-label="Referencia">
      </div>
      ${bad ? `<div class="bg-error-container text-error rounded-xl p-3 text-body-sm">Solo quedan ${qtyTxt(p, p.stock)}.</div>` : ''}
      <button data-act="scanOk" ${q > 0 && !bad && !yaEnStock ? '' : 'disabled'} class="${BTN_P} h-16 text-headline-sm">${ic(mode === 'entrada' ? 'library_add_check' : 'outbox', 'ms-fill')}${mode === 'entrada' ? `Añadir al almacén (+${qtyTxt(p, q)})` : `Registrar salida (−${qtyTxt(p, q)})`}</button>`}
    <button data-act="scanNext" class="${BTN_T} h-14 text-body-lg">${ic('skip_next')}Escanear siguiente</button>
    ${scanLogHTML()}
  </div>`;
}
function scanLogHTML() {
  if (!ui.scanLog.length) return '';
  return `<div class="pt-2"><div class="${LBL} mb-1">Registrado en esta sesión</div>${ui.scanLog.slice(0, 6).map(l => `<div class="flex justify-between text-body-sm py-1.5 border-b border-surface-container"><span class="truncate pr-2">${l.type === 'entrada' ? '+' : '−'}${esc(l.txt)}</span><span class="mono text-label-sm text-secondary shrink-0">${hace(l.ts)}</span></div>`).join('')}</div>`;
}
function commitScan() {
  const hit = ui.scanHit, p = find(hit.sku), mode = ui.scanMode;
  const serials = p.serialized ? (mode === 'entrada' ? parseSN(ui.scanSN) : ui.scanSel) : [];
  const q = p.serialized ? serials.length : Number(String(ui.scanQty).replace(',', '.'));
  try {
    const r = applyMovement({ sku: p.sku, type: mode, qty: q, reason: ui.scanReason || REASONS[mode][0], ref: ui.scanRef.trim(), serials });
    save(); renderShell();
    ui.scanLog.unshift({ ts: Date.now(), type: mode, txt: `${qtyTxt(p, q)} ${p.name}` });
    toast(`${mode === 'entrada' ? 'Entrada' : 'Salida'} registrada: ${qtyTxt(p, q)} · stock ${qtyTxt(p, p.stock)}.`, 'ok');
    avisoEstado(r);
    ui.scanHit = null; renderScan();
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- 9. Albaranes con IA ---------- */
let ai = { sample: null, images: false, checked: false };
const iaLive = () => !!(ai.sample && ai.images);
(async () => { // Claude Vision real solo cuando la app se abre dentro de claude.ai
  try {
    if (window.claude && typeof window.claude.use === 'function') {
      const s = await window.claude.use('sample');
      if (s) { ai.sample = s; const lim = await s.limits().catch(() => null); ai.images = !!(lim && lim.images); }
    }
  } catch (e) { }
  ai.checked = true; if (ui.view === 'albaranes') render();
})();

const PASOS = [
  ['Segmentación de cabecera', 'Proveedor, CIF, n.º de albarán y fecha', 'view_agenda'],
  ['Matriz de líneas y n.º de serie', 'Códigos, cantidades y series por línea', 'qr_code_2'],
  ['Cotejo con el catálogo', 'Emparejado con SKU y detección de modelos nuevos', 'join_inner'],
];
let alb = { stage: 'idle', mode: null, steps: [], doc: null, lines: [], file: null, preview: null, isPdf: false, t0: 0, ms: 0 };
const albReset = () => { alb = { stage: 'idle', mode: null, steps: [], doc: null, lines: [], file: null, preview: null, isPdf: false, t0: 0, ms: 0 }; };

VIEW_FN.albaranes = function () {
  const hist = S.albaranes;
  const avgConf = hist.length ? hist.reduce((a, h) => a + (h.confianza || .95), 0) / hist.length : .98;
  return `<div class="px-4 lg:px-gutter py-4 lg:py-space-lg flex flex-col gap-space-lg max-w-[1600px]">
    <section class="${CARD} p-space-md lg:p-space-lg flex flex-col lg:flex-row gap-space-md lg:items-center justify-between relative overflow-hidden">
      <div class="absolute -right-10 -top-16 w-72 h-72 rounded-full bg-tertiary-fixed/20 blur-3xl pointer-events-none"></div>
      <div class="flex gap-space-md relative">
        <span class="w-12 h-12 shrink-0 rounded-xl bg-primary-container text-white grid place-items-center">${ic('document_scanner', 'ms-28')}</span>
        <div><h1 class="text-headline-lg-mobile lg:text-headline-lg font-bold">Recepción inteligente de albaranes</h1>
          <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full ${iaLive() ? 'bg-tertiary-fixed/40 text-tertiary' : 'bg-surface-container-high text-secondary'} mono text-label-sm mt-1"><span class="w-1.5 h-1.5 rounded-full bg-current ${iaLive() ? 'pulso' : ''}"></span>${!ai.checked ? 'COMPROBANDO IA…' : iaLive() ? 'CLAUDE VISION ACTIVO' : 'MODO SIMULADO'}</span>
          <p class="text-body-md text-secondary mt-2 max-w-2xl">Foto o PDF del albarán en papel. La IA extrae proveedor, líneas, cantidades y números de serie, y los coteja con el catálogo. <b class="text-on-surface">Nada entra en stock hasta que tú lo confirmas.</b></p></div>
      </div>
      <div class="grid grid-cols-2 gap-space-sm relative shrink-0">
        <div class="bg-surface-container-low rounded-xl p-3 flex items-center gap-2">${ic('bolt', 'text-primary')}<div><div class="${LBL}">Último proceso</div><div class="mono text-label-lg">${alb.ms ? (alb.ms / 1000).toFixed(2) + ' s' : '—'}</div></div></div>
        <div class="bg-surface-container-low rounded-xl p-3 flex items-center gap-2">${ic('verified', 'text-tertiary')}<div><div class="${LBL}">Confianza media</div><div class="mono text-label-lg">${(avgConf * 100).toFixed(1)}%</div></div></div>
      </div>
    </section>

    <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
      <section class="lg:col-span-8 ${CARD} p-space-md">
        <label id="drop" for="fileIn" tabindex="0" class="flex flex-col items-center justify-center text-center gap-3 min-h-[220px] rounded-xl border-2 border-dashed border-primary-fixed-dim bg-surface-container-low hover:bg-surface-container cursor-pointer p-6 transition-colors">
          <span class="w-16 h-16 rounded-2xl bg-primary-fixed text-primary grid place-items-center">${ic(alb.stage === 'processing' ? 'progress_activity' : 'cloud_upload', 'ms-32 ' + (alb.stage === 'processing' ? 'girar' : ''))}</span>
          <span class="text-headline-sm font-semibold">${alb.stage === 'processing' ? `Procesando ${esc(alb.file || '')}…` : isDesk() ? 'Arrastra aquí el albarán o selecciónalo de tu equipo' : 'Hacer foto o subir albarán'}</span>
          <span class="text-body-sm text-secondary">PDF, JPG o PNG. En el móvil se abre la cámara directamente.</span>
          <span class="flex flex-wrap justify-center gap-2">${tag('PDF')}${tag('JPG / PNG')}${tag('CÁMARA')}</span>
        </label>
        <div class="mt-space-md"><div class="${LBL} mb-2">¿Sin albarán a mano? Prueba con uno de ejemplo</div>
          <div class="flex flex-wrap gap-2">${Object.entries(DEMOS).map(([k, d]) => `<button data-act="demoAlb" data-v="${k}" ${alb.stage === 'processing' ? 'disabled' : ''} class="${BTN_T} px-3 h-11 text-body-sm">${ic('description', 'ms-18')}${esc(d.proveedor)} · ${d.lineas.length} líneas</button>`).join('')}</div></div>
      </section>
      <section class="lg:col-span-4 ${CARD} p-space-md flex flex-col gap-2">
        <div class="flex justify-between items-center"><span class="${LBL}">Túnel de procesamiento</span><span class="w-2 h-2 rounded-full ${alb.stage === 'processing' ? 'bg-primary pulso' : alb.stage === 'review' ? 'bg-tertiary-container' : 'bg-outline-variant'}"></span></div>
        ${PASOS.map(([t, d, i], k) => { const st = alb.steps[k] || 'wait'; return `<div class="flex gap-3 items-start rounded-lg p-3 ${st === 'run' ? 'bg-primary-fixed/60' : st === 'done' ? 'bg-tertiary-fixed/20' : 'bg-surface-container-low'}">
          <span class="${st === 'done' ? 'text-tertiary' : st === 'run' ? 'text-primary' : 'text-outline'}">${ic(st === 'done' ? 'check_circle' : st === 'run' ? 'progress_activity' : i, st === 'run' ? 'girar' : '')}</span>
          <div><div class="mono text-label-md font-semibold">${t}</div><div class="text-body-sm text-secondary">${d}</div></div></div>`; }).join('')}
        <p class="text-body-sm text-secondary mt-1">${iaLive() ? 'Las fotos se leen con Claude Vision. Los PDF usan el modo simulado.' : 'En GitHub Pages la lectura es simulada con albaranes de ejemplo. Para leer albaranes reales, conecta tu servidor en <code class="mono">leerAlbaranIA()</code> (ver README).'}</p>
      </section>
    </div>

    ${alb.stage === 'review' ? albReview() : ''}

    <section class="${CARD} overflow-hidden">
      <div class="p-space-md"><h2 class="text-headline-md font-semibold">Historial de albaranes procesados</h2><p class="text-body-sm text-secondary">Registro auditable de las entradas confirmadas desde albarán.</p></div>
      ${isDesk() ? `<div class="overflow-x-auto"><table class="tabla w-full"><thead class="bg-surface-container-low"><tr><th>Albarán</th><th>Proveedor</th><th>Fecha y hora</th><th>Líneas</th><th>Confianza</th><th>Estado</th><th>Operario</th></tr></thead><tbody>
        ${hist.map(h => `<tr><td class="mono text-label-md">${ic(h.modo === 'ia' ? 'photo_camera' : 'description', 'ms-18 text-primary')} ${esc(h.numero)}</td><td>${esc(h.proveedor)}</td><td class="mono text-label-sm">${fechaHora(h.ts)}</td><td>${h.lineas} (${num(h.unidades || 0)} uds)</td><td class="mono text-label-sm">${Math.round((h.confianza || .95) * 1000) / 10}%</td><td>${tag('Confirmado', 'bg-tertiary-fixed/30 text-tertiary')}</td><td>${esc(h.operator)}</td></tr>`).join('') || '<tr><td colspan="7" class="text-center text-secondary py-8">Todavía no hay albaranes.</td></tr>'}
      </tbody></table></div>`
      : `<div class="px-4 pb-4">${hist.map(h => `<div class="flex justify-between gap-2 py-3 border-t border-surface-container"><div class="min-w-0"><div class="font-medium truncate">${esc(h.proveedor)}</div><div class="mono text-label-sm text-secondary">#${esc(h.numero)} · ${h.lineas} líneas</div></div><div class="text-right shrink-0">${tag('Confirmado', 'bg-tertiary-fixed/30 text-tertiary')}<div class="mono text-label-sm text-secondary mt-1">${hace(h.ts)}</div></div></div>`).join('') || '<p class="text-secondary py-6 text-center">Todavía no hay albaranes.</p>'}</div>`}
    </section>
  </div>`;
};

function albReview() {
  const d = alb.doc, ok = alb.lines.filter(l => l.include && l.sku);
  const unidades = ok.reduce((a, l) => a + (Number(l.cantidad) || 0), 0);
  const conf = alb.lines.length ? alb.lines.reduce((a, l) => a + l.confianza, 0) / alb.lines.length : 0;
  const docFuente = alb.preview && !alb.isPdf ? `<img src="${alb.preview}" alt="Albarán subido" class="w-full rounded-lg">`
    : alb.preview && alb.isPdf ? `<iframe src="${alb.preview}" title="Albarán PDF" class="w-full h-[560px] rounded-lg bg-white"></iframe>`
      : `<div class="papel rounded-lg p-4 text-[12px] leading-snug">
        <div class="marca-ia p-2 flex justify-between gap-2"><div><div class="font-bold text-[14px]">${esc(d.proveedor)}</div><div class="text-secondary">CIF: ${esc(d.cif || '—')}</div></div><div class="text-right"><div class="font-bold">ALBARÁN</div><div class="mono text-primary">#${esc(d.numero)}</div><div class="text-secondary">${esc(d.fecha)}</div></div></div>
        <div class="flex justify-between text-secondary mt-3 mb-2"><span>Destinatario: ${MARCA.nombre}</span><span>${d.bultos || alb.lines.length} bultos</span></div>
        <div class="flex justify-between mono text-[10px] text-secondary border-b pb-1 mb-2"><span>DESCRIPCIÓN</span><span>CANT.</span></div>
        ${alb.lines.map((l, i) => `<div class="marca-ia ${l.sku ? '' : 'nuevo'} p-2 mb-2 flex justify-between gap-2"><span class="absolute -top-2 -left-2 px-1 rounded mono text-[9px] text-white ${l.sku ? 'bg-primary-container' : 'bg-amber-600'}">#${i + 1}${l.sku ? '' : ' NUEVO'}</span><div><div>${esc(l.descripcion)}</div><div class="mono text-[10px] text-secondary">${esc(l.codigo || 'sin código')}${l.series ? ' · S/N ' + esc(parseSN(l.series).slice(0, 2).join(', ')) + (parseSN(l.series).length > 2 ? '…' : '') : ''}</div></div><div class="font-semibold whitespace-nowrap">${num(l.cantidad)}</div></div>`).join('')}
        <div class="flex justify-between text-secondary mt-4 pt-2 border-t"><span>Transportista · matrícula</span><span class="italic">Firma de entrega</span></div>
      </div>`;
  return `<section class="flex flex-col gap-space-md">
    <div class="flex flex-wrap items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-tertiary-container"></span><h2 class="text-headline-md font-semibold">Validación de albarán en curso</h2>${tag(d.numero || 's/n', 'bg-primary-fixed text-primary')}${alb.mode === 'ia' ? tag('Lectura real', 'bg-tertiary-fixed/40 text-tertiary') : tag('Simulado', 'bg-surface-container-high text-secondary')}<span class="text-body-sm text-secondary lg:ml-auto">Archivo: ${esc(alb.file || '—')}</span></div>
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
      <div class="lg:col-span-5 ${CARD} p-space-md"><div class="flex items-center gap-2 mb-3">${ic('image', 'text-secondary')}<span class="font-semibold">Documento fuente</span></div><div class="bg-primary-fixed/40 rounded-xl p-3">${docFuente}</div></div>
      <div class="lg:col-span-7 flex flex-col gap-space-md min-w-0">
        <div class="${CARD} p-space-md">
          <div class="flex justify-between items-center gap-2 mb-3"><span class="font-semibold">Datos generales extraídos</span><span class="mono text-label-sm px-2 py-0.5 rounded-full bg-tertiary-fixed/30 text-tertiary">${(conf * 100).toFixed(1)}% confianza</span></div>
          <div class="grid grid-cols-2 xl:grid-cols-4 gap-2">
            ${[['proveedor', 'Proveedor'], ['numero', 'N.º albarán'], ['fecha', 'Fecha'], ['cif', 'CIF']].map(([k, l]) => `<label class="bg-surface-container-low rounded-lg p-2.5"><span class="${LBL}">${l}</span><input data-in="albDoc" data-k="${k}" value="${esc(d[k] || '')}" class="w-full bg-transparent font-semibold focus:outline-none focus:ring-2 focus:ring-primary rounded"></label>`).join('')}
          </div>
        </div>
        <div class="${CARD} overflow-hidden">
          <div class="p-space-md flex justify-between items-center gap-2"><span class="font-semibold">Artículos detectados para inventario</span><span class="mono text-label-sm text-secondary">${alb.lines.length} líneas · ${ok.length} se ingresarán</span></div>
          ${alb.lines.map((l, i) => albLine(l, i)).join('')}
          <div class="p-space-md flex flex-col sm:flex-row gap-2 bg-surface-container-low">
            <button data-act="albAdd" class="${BTN_S} h-12 px-4">${ic('playlist_add', 'ms-20')}Añadir línea manual</button>
            <button data-act="albCsv" class="${BTN_S} h-12 px-4">${ic('ios_share', 'ms-20')}Exportar CSV</button>
            <button data-act="albCancel" class="${BTN_S} h-12 px-4">Descartar</button>
            <button data-act="albOk" ${ok.length ? '' : 'disabled'} class="${BTN_P} h-14 sm:h-auto px-5 flex-1 text-body-lg">${ic('check_circle', 'ms-fill')}Confirmar e integrar en stock (${ok.length} línea${ok.length === 1 ? '' : 's'}, ${num(unidades)} uds)</button>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}
function albLine(l, i) {
  const p = l.sku ? find(l.sku) : null, conf = l.confianza;
  const est = !p ? { t: 'No catalogado', c: 'bg-amber-100 text-amber-800' } : conf >= .9 ? { t: `Coincide (+${num(l.cantidad)} ${UNIT[p.unit]})`, c: 'bg-tertiary-fixed/30 text-tertiary' } : { t: `Revisar · ${Math.round(conf * 100)}%`, c: 'bg-amber-100 text-amber-800' };
  const sn = p && p.serialized ? parseSN(l.series) : [];
  return `<div class="p-space-md border-t border-surface-container ${!p ? 'bg-amber-50' : ''} ${l.include ? '' : 'opacity-50'}">
    <div class="flex gap-3">
      <input type="checkbox" data-in="albInc" data-i="${i}" ${l.include ? 'checked' : ''} ${p ? '' : 'disabled'} class="w-5 h-5 mt-1 accent-primary shrink-0" aria-label="Incluir línea ${i + 1}">
      <div class="flex-1 min-w-0 flex flex-col gap-2">
        <div class="flex flex-wrap justify-between gap-2"><div class="min-w-0"><div class="font-semibold">${esc(l.descripcion)}</div><div class="mono text-label-sm text-secondary">${esc(l.codigo || 'sin código')}${l.how ? ` · emparejado por ${esc(l.how)}` : ''}${l.nota ? ` · ${esc(l.nota)}` : ''}</div></div>
          <span class="self-start mono text-label-sm px-2 py-1 rounded-full whitespace-nowrap ${est.c}">● ${est.t}</span></div>
        <div class="grid grid-cols-1 sm:grid-cols-[1fr_150px] gap-2">
          <select data-in="albSku" data-i="${i}" class="${INP} h-11 text-body-sm" aria-label="Referencia del catálogo"><option value="">— Sin correspondencia (no se ingresa) —</option>${S.products.map(x => `<option value="${esc(x.sku)}" ${x.sku === l.sku ? 'selected' : ''}>${esc(x.sku)} · ${esc(x.name)}</option>`).join('')}</select>
          <label class="flex items-center gap-2 ${INP} h-11"><input data-in="albQty" data-i="${i}" id="albQ${i}" inputmode="decimal" value="${esc(l.cantidad)}" class="w-full bg-transparent focus:outline-none font-semibold" aria-label="Cantidad"><span class="text-body-sm text-secondary">${p ? UNIT[p.unit] : ''}</span></label>
        </div>
        ${p && p.serialized ? `<label class="flex flex-col gap-1"><span class="${LBL}">N.º de serie (${sn.length} de ${num(l.cantidad)})</span><textarea data-in="albSN" data-i="${i}" id="albSN${i}" rows="2" class="${INP} mono text-body-sm ${sn.length !== Number(l.cantidad) ? 'ring-2 ring-error' : ''}">${esc(l.series)}</textarea></label>` : ''}
        ${p ? `<div class="text-body-sm text-secondary">Destino <span class="mono text-primary">${esc(p.loc)}</span> · stock ${qtyTxt(p, p.stock)} → <b class="text-on-surface">${qtyTxt(p, p.stock + (Number(l.cantidad) || 0))}</b></div>`
      : `<div class="flex flex-wrap items-center gap-2 text-body-sm"><span class="text-amber-800 flex items-center gap-1">${ic('auto_awesome', 'ms-16')}Modelo nuevo: créalo o elige uno del catálogo.</span><button data-act="albSkuNuevo" data-i="${i}" class="px-3 h-9 rounded-lg bg-amber-600 text-white font-semibold">Crear SKU</button></div>`}
      </div>
    </div></div>`;
}
function setLines(doc, mode) {
  alb.doc = { proveedor: doc.proveedor || '', numero: doc.numero || '', fecha: doc.fecha || '', cif: doc.cif || '', bultos: doc.bultos };
  alb.lines = (doc.lineas || []).map(l => {
    let sku = l.sku && find(l.sku) ? l.sku : null, how = sku ? 'IA' : null;
    if (!sku) { const m = matchLine(l.codigo, l.descripcion); sku = m.sku; how = m.how; }
    const embalaje = /bolsa|embalaje|porte/i.test(l.descripcion || '') && !sku;
    return { codigo: l.codigo || '', descripcion: l.descripcion || '', cantidad: Number(l.cantidad) || 0, confianza: Number(l.confianza) || .8, sku, how, include: !!sku && !embalaje, series: (l.series || []).join('\n'), nota: l.nota || '' };
  });
  alb.mode = mode;
}
async function runSteps() { for (let i = 0; i < 3; i++) { alb.steps[i] = 'run'; render(); await wait(600 + Math.random() * 450); alb.steps[i] = 'done'; } }
async function processDemo(key, fileName, keepPreview) {
  const prev = keepPreview ? { preview: alb.preview, isPdf: alb.isPdf } : { preview: null, isPdf: false };
  alb = { stage: 'processing', mode: 'sim', steps: [], doc: null, lines: [], file: fileName || `Ejemplo · ${DEMOS[key].proveedor} ${DEMOS[key].numero}`, ...prev, t0: performance.now(), ms: 0 };
  await runSteps();
  setLines(DEMOS[key], 'sim'); alb.stage = 'review'; alb.ms = performance.now() - alb.t0; render();
}
/* Punto de conexión para IA real en servidor: devuelve {proveedor,numero,fecha,cif,lineas:[{codigo,descripcion,cantidad,sku,series,nota,confianza}]}
   o null para usar el modo simulado. La clave de la IA NUNCA va en el navegador: esta función debe llamar a TU servidor. */
async function leerAlbaranIA(file) {
  if (!(/^image\//.test(file.type) && iaLive())) return null;
  const catalog = S.products.map(p => `${p.sku}${p.supplierRef ? ' / ' + p.supplierRef : ''}${p.ean ? ' / ' + p.ean : ''} | ${p.name} | ${UNIT[p.unit]}`).join('\n');
  const prompt = `La imagen es un albarán de entrega de un proveedor de material eléctrico, fontanería y movilidad eléctrica para un almacén en España.
Extrae cada línea de material recibido. Ignora bolsas, portes y embalajes salvo que estén en el catálogo.
Para cada línea: código tal como aparece, descripción, cantidad en la unidad base del catálogo (metros para cables y tubos, unidades para el resto; si pone cajas o bobinas, multiplica e indícalo en "nota"), números de serie si aparecen, y el SKU del catálogo que corresponde (o null si no hay).
Responde SOLO con JSON con esta forma:
{"proveedor":"","cif":"","numero":"","fecha":"dd/mm/aaaa","lineas":[{"codigo":"","descripcion":"","cantidad":0,"sku":null,"series":[],"nota":"","confianza":0.9}]}

Catálogo (SKU / ref. proveedor / EAN | nombre | unidad):
${catalog}`;
  return ai.sample.json(prompt, { images: [file], modelTier: 'default', cache: false });
}
async function processFile(file) {
  if (!file || alb.stage === 'processing') return;
  const isImg = /^image\//.test(file.type), isPdf = file.type === 'application/pdf';
  if (!isImg && !isPdf) return toast('Formato no admitido. Sube una foto (JPG/PNG) o un PDF.', 'err');
  alb = { stage: 'processing', mode: null, steps: [], doc: null, lines: [], file: file.name, preview: URL.createObjectURL(file), isPdf, t0: performance.now(), ms: 0 };
  if (ui.view !== 'albaranes') location.hash = 'albaranes';
  if (isImg && iaLive()) {
    alb.mode = 'ia'; alb.steps[0] = 'run'; render();
    try {
      const t = setTimeout(() => { alb.steps[0] = 'done'; alb.steps[1] = 'run'; render(); }, 2500);
      const data = await leerAlbaranIA(file);
      clearTimeout(t);
      alb.steps = ['done', 'done', 'run']; render(); await wait(350);
      setLines(data, 'ia'); alb.steps[2] = 'done'; alb.stage = 'review'; alb.ms = performance.now() - alb.t0; render();
      if (!alb.lines.length) toast('La IA no ha encontrado líneas de material. Prueba con una foto más nítida y de frente.', 'warn', 7000);
      return;
    } catch (e) {
      toast(e && e.code === 'not_granted' ? 'No se ha autorizado el uso de Claude. Se muestra un resultado simulado.' : 'La lectura con IA ha fallado. Se muestra un resultado simulado.', 'warn', 7000);
    }
  }
  const key = /polich|carg|ve/i.test(file.name) ? 've' : /salt/i.test(file.name) ? 'saltoki' : 'dist';
  await processDemo(key, file.name, true);
}
function approveAlb() {
  const lines = alb.lines.filter(l => l.include && l.sku);
  for (const l of lines) {
    const p = find(l.sku), q = Number(String(l.cantidad).replace(',', '.'));
    if (!(q > 0)) return toast(`Revisa la cantidad de ${p.name}.`, 'err');
    if (p.serialized) {
      const sn = parseSN(l.series);
      if (sn.length !== q) return toast(`${p.name}: hay ${sn.length} n.º de serie para ${q} unidades. Corrígelo antes de confirmar.`, 'err', 7000);
      const dup = sn.find(s => (p.serials || []).includes(s)); if (dup) return toast(`El n.º de serie ${dup} ya está en stock.`, 'err');
    }
  }
  let uds = 0;
  for (const l of lines) { const q = Number(String(l.cantidad).replace(',', '.')); uds += q; applyMovement({ sku: l.sku, type: 'entrada', qty: q, reason: 'Compra a proveedor', ref: `Alb. ${alb.doc.numero || 's/n'}`, serials: find(l.sku).serialized ? parseSN(l.series) : [] }); }
  const conf = alb.lines.reduce((a, l) => a + l.confianza, 0) / (alb.lines.length || 1);
  S.albaranes.unshift({ numero: alb.doc.numero || 's/n', proveedor: alb.doc.proveedor || 'Proveedor', fecha: alb.doc.fecha || '', lineas: lines.length, unidades: uds, ts: Date.now(), operator: S.operator, confianza: conf, modo: alb.mode });
  save();
  toast(`Albarán ${alb.doc.numero || ''} integrado: ${lines.length} línea${lines.length === 1 ? '' : 's'} sumada${lines.length === 1 ? '' : 's'} al stock.`, 'ok', 6000);
  albReset(); render();
}

/* ---------- 10. Entregas y firma ---------- */
function cestaEquipo() { let e = equipo(S.cesta.equipo); if (!e) { e = S.equipos[0]; S.cesta.equipo = e && e.id; } return e; }
function disponible(p) { const l = S.cesta.lineas.find(x => x.sku === p.sku); return p.stock - (l ? l.qty : 0); }
function addCesta(sku, n = 1) {
  const p = find(sku); if (!p) return;
  let l = S.cesta.lineas.find(x => x.sku === sku);
  if (!l) { l = { sku, qty: 0, serials: [] }; S.cesta.lineas.push(l); }
  if (p.serialized) {
    const libre = (p.serials || []).find(s => !l.serials.includes(s));
    if (!libre) return toast(`No quedan más ${p.name} en stock.`, 'warn');
    l.serials.push(libre); l.qty = l.serials.length;
  } else {
    if (l.qty + n > p.stock) { toast(`Solo hay ${qtyTxt(p, p.stock)} de ${p.name}.`, 'warn'); l.qty = p.stock; }
    else l.qty = Math.round((l.qty + n) * 1000) / 1000;
  }
  if (l.qty <= 0) S.cesta.lineas = S.cesta.lineas.filter(x => x !== l);
  save();
}
function subCesta(sku) {
  const p = find(sku), l = S.cesta.lineas.find(x => x.sku === sku); if (!l) return;
  if (p.serialized) { l.serials.pop(); l.qty = l.serials.length; }
  else l.qty = Math.max(0, l.qty - (p.unit === 'm' ? 10 : 1));
  if (l.qty <= 0) S.cesta.lineas = S.cesta.lineas.filter(x => x !== l);
  save();
}

VIEW_FN.entregas = function () {
  const eq = cestaEquipo();
  const recs = eq ? eq.tecnicos.map(tec).filter(Boolean) : [];
  if (!recs.find(t => t.id === S.cesta.receptor)) S.cesta.receptor = recs[0] ? recs[0].id : null;
  const rec = tec(S.cesta.receptor);
  const prods = searchProducts(ui.entQ, { cat: ui.entQ ? 'all' : ui.entCat }).slice(0, 12);
  const lineas = S.cesta.lineas.filter(l => find(l.sku));
  const firmado = ui.firma.length > 0;
  const nextId = `ENT-${new Date().getFullYear()}-${String(S.seq.ent + 1).padStart(4, '0')}`;
  const puede = lineas.length && rec && firmado && ui.certifica;

  const receptora = `<section class="${CARD} p-4 lg:p-space-md flex flex-col gap-3">
    <div class="flex items-center justify-between gap-2"><div class="flex items-center gap-3"><span class="w-10 h-10 rounded-lg bg-surface-container-low text-primary grid place-items-center">${ic('local_shipping')}</span><h2 class="text-headline-md font-semibold">Unidad receptora</h2></div><a href="#equipos" class="mono text-label-sm text-primary">Gestionar equipos →</a></div>
    ${eq ? `<div class="flex items-center gap-3 bg-surface-container-low rounded-xl p-3">
      <span class="w-12 h-12 rounded-full bg-white grid place-items-center mono font-semibold text-primary shrink-0">${esc(eq.id)}</span>
      <div class="flex-1 min-w-0"><div class="font-semibold truncate">${esc(eq.flota)} · ${esc(eq.nombre)}</div><div class="text-body-sm text-secondary truncate">${eq.tecnicos.map(t => esc(tec(t)?.nombre)).join(' · ')} · ${esc(eq.matricula)}</div></div>
      <span class="mono text-label-sm px-2 py-1 rounded-full ${estadoEq[eq.estado].c} whitespace-nowrap">${estadoEq[eq.estado].t}</span></div>` : '<p class="text-secondary">Crea primero un equipo.</p>'}
    <div class="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">${S.equipos.map(e => `<button data-act="cestaEq" data-v="${e.id}" class="shrink-0 px-4 h-11 rounded-full text-body-sm font-semibold ${e.id === S.cesta.equipo ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface-variant'}">${e.id === S.cesta.equipo ? '✓ ' : ''}${esc(e.id)} ${esc(e.nombre.replace('Equipo ', ''))}${e.tecnicos.length === 1 ? ' (1)' : ''}</button>`).join('')}</div>
  </section>`;

  const catalogo = `<section class="${CARD} p-4 lg:p-space-md flex flex-col gap-3">
    <div class="flex items-center justify-between"><h2 class="text-headline-md font-semibold flex items-center gap-2">${ic('add_box', 'text-primary')}Añadir al despacho</h2><span class="text-body-sm text-secondary">Toca para sumar</span></div>
    <div class="relative">${ic('search', 'absolute left-3 top-1/2 -translate-y-1/2 text-outline ms-20')}<input id="entQ" data-in="entQ" value="${esc(ui.entQ)}" type="search" class="${INP} pl-10 h-12" placeholder="Buscar en todo el catálogo"></div>
    ${ui.entQ ? '' : `<div class="flex bg-surface-container-low rounded-lg p-1 overflow-x-auto no-scrollbar">${Object.entries(CATS).map(([k, c]) => `<button data-act="entCat" data-v="${k}" class="shrink-0 px-3 h-10 rounded-md text-body-sm font-semibold ${ui.entCat === k ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant'}">${c.label}</button>`).join('')}</div>`}
    <div class="grid grid-cols-2 xl:grid-cols-3 gap-2">${prods.map(p => { const d = disponible(p); return `<button data-act="alCestaE" data-sku="${esc(p.sku)}" ${d <= 0 ? 'disabled' : ''} class="text-left bg-surface-container-low hover:bg-surface-container rounded-xl p-3 flex flex-col gap-1 disabled:opacity-40 relative">
      <span class="absolute top-2.5 right-2.5 text-primary">${ic('add_circle')}</span>
      <span class="self-start">${tag(p.packLabel || CATS[p.cat].label, 'bg-white text-secondary')}</span>
      <span class="font-semibold leading-snug line-clamp-2 pr-5">${esc(p.name)}</span>
      <span class="mono text-label-sm text-secondary truncate">${p.serialized ? `SN: ${esc((p.serials || [])[0] || '—')}` : esc(p.loc)}</span>
      <span class="flex justify-between items-end mt-1"><span class="mono text-label-sm">Disp: <b>${num(d)}</b> ${UNIT[p.unit]}</span><span class="mono text-label-sm text-primary">+${p.unit === 'm' ? 10 : 1}</span></span></button>`; }).join('') || '<p class="text-secondary col-span-2">Sin resultados.</p>'}</div>
  </section>`;

  const cesta = `<section class="${CARD} p-4 lg:p-space-md flex flex-col gap-3">
    <div class="flex items-center justify-between"><h2 class="text-headline-md font-semibold flex items-center gap-2"><span class="w-7 h-7 rounded-md bg-primary-container text-white grid place-items-center mono text-label-md">${lineas.length}</span>Material en cesta de entrega</h2>${lineas.length ? `<button data-act="cestaClear" class="text-error text-body-sm flex items-center gap-1">${ic('delete', 'ms-18')}Limpiar</button>` : ''}</div>
    ${lineas.map(l => { const p = find(l.sku); return `<div class="bg-surface-container-low rounded-xl p-3 flex flex-col gap-2">
      <div class="flex items-center gap-3"><div class="flex-1 min-w-0"><div class="font-semibold leading-snug">${esc(p.name)}</div><div class="mono text-label-sm text-secondary">${p.serialized ? `S/N: ${l.serials.map(s => `<span class="bg-primary-fixed text-primary px-1 rounded">${esc(s)}</span>`).join(' ')}` : `${esc(p.loc)} · ${esc(p.packLabel || '')}`}</div></div>
        <div class="flex items-center bg-white rounded-lg shrink-0"><button data-act="cestaSub" data-sku="${esc(p.sku)}" class="w-11 h-11 grid place-items-center" aria-label="Menos">${ic('remove')}</button>
          ${p.serialized ? `<span class="w-10 text-center font-bold">${l.qty}</span>` : `<input id="cq-${esc(p.sku)}" data-in="cestaQty" data-sku="${esc(p.sku)}" value="${l.qty}" inputmode="decimal" class="w-14 text-center font-bold bg-transparent focus:outline-none" aria-label="Cantidad">`}
          <button data-act="cestaAdd" data-sku="${esc(p.sku)}" class="w-11 h-11 grid place-items-center bg-primary text-white rounded-r-lg" aria-label="Más">${ic('add')}</button></div></div>
      ${p.serialized ? `<button data-act="entSN" data-sku="${esc(p.sku)}" class="self-start mono text-label-sm text-primary">${ui.entSN === p.sku ? 'Ocultar' : 'Elegir n.º de serie'}</button>${ui.entSN === p.sku ? `<div class="flex flex-wrap gap-1.5">${(p.serials || []).map(s => `<button data-act="entSNt" data-sku="${esc(p.sku)}" data-v="${esc(s)}" class="px-2.5 h-9 rounded-lg mono text-label-sm ${l.serials.includes(s) ? 'bg-primary text-white' : 'bg-white'}">${esc(s)}</button>`).join('')}</div>` : ''}` : ''}
    </div>`; }).join('') || '<div class="text-center text-secondary py-6 bg-surface-container-low rounded-xl">La cesta está vacía. Añade material desde el catálogo o desde el inventario.</div>'}
  </section>`;

  const firma = `<section class="${CARD} p-4 lg:p-space-md flex flex-col gap-3">
    <div class="flex items-center justify-between gap-2"><h2 class="text-headline-md font-semibold flex items-center gap-2"><span class="w-9 h-9 rounded-lg bg-tertiary-fixed/40 text-tertiary grid place-items-center">${ic('signature')}</span>Firma digital del receptor</h2><button data-act="firmaClear" class="text-body-sm text-secondary flex items-center gap-1">${ic('refresh', 'ms-18')}Borrar</button></div>
    <label class="flex items-center gap-3 bg-surface-container-low rounded-xl p-3">${ic('badge', 'text-secondary')}
      <span class="flex-1 min-w-0"><span class="${LBL} block">Firmante designado</span>
        <select data-in="cestaRec" class="bg-transparent font-semibold focus:outline-none w-full">${recs.map(t => `<option value="${t.id}" ${t.id === S.cesta.receptor ? 'selected' : ''}>${esc(t.nombre)} (DNI ${esc(t.dni)})</option>`).join('')}</select></span>
      ${rec ? tag(rec.rol.split(' ')[0], 'bg-white text-secondary') : ''}</label>
    <div class="relative"><canvas id="firma" class="firma w-full h-40 bg-surface-container-low rounded-xl" aria-label="Zona de firma"></canvas>
      <span class="absolute top-2 right-2 mono text-label-sm px-2 py-0.5 rounded-full ${firmado ? 'bg-tertiary-fixed text-on-tertiary-fixed' : 'bg-white text-secondary'}">● ${firmado ? 'Trazo capturado' : 'Esperando trazo'}</span>
      ${firmado ? '' : `<span class="absolute bottom-3 left-4 mono text-label-sm text-outline pointer-events-none">✕ Firma táctil requerida · ${new Date().toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>`}</div>
    <label class="flex items-start gap-3 bg-surface-container-low rounded-xl p-3 cursor-pointer"><input type="checkbox" data-in="certifica" ${ui.certifica ? 'checked' : ''} class="w-6 h-6 mt-0.5 accent-primary shrink-0"><span class="text-body-sm">Certifico que el material relacionado se entrega revisado, completo, con precintos intactos y sin desperfectos visibles.</span></label>
    <div class="flex justify-between mono text-label-sm text-secondary"><span class="flex items-center gap-1">${ic('lock', 'ms-16')}Huella SHA-256 + fecha y hora</span><span>Doc #${nextId}</span></div>
  </section>`;

  const boton = `<button data-act="entOk" ${puede ? '' : 'disabled'} class="${BTN_P} w-full h-16 text-headline-sm">${ic('check_circle', 'ms-fill')}Confirmar entrega y descontar stock</button>
    ${puede ? '' : `<p class="text-body-sm text-secondary text-center">${!lineas.length ? 'Añade material a la cesta.' : !rec ? 'Elige quién recibe.' : !firmado ? 'Falta la firma del receptor.' : 'Marca la casilla de conformidad.'}</p>`}`;

  return `<div class="px-4 lg:px-gutter py-4 lg:py-space-lg flex flex-col gap-4 lg:gap-space-lg max-w-[1600px]">
    <div class="hidden lg:flex items-end justify-between"><div><span class="${LBL}">Custodia de material · almacén → furgoneta</span><h1 class="text-headline-lg font-bold">Entrega y firma de material</h1></div>
      <a href="#equipos" class="${BTN_S} px-4 h-11">${ic('verified_user', 'ms-20')}Auditoría de entregas</a></div>
    <div class="lg:hidden flex items-center justify-between gap-2 bg-surface-container-low rounded-xl px-3 py-2.5 mono text-label-sm"><span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-tertiary-container pulso"></span>SYNC LOCAL</span><span class="text-primary">${esc(eq ? eq.id : '')} · Doc #${nextId}</span></div>
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-space-lg items-start">
      <div class="lg:col-span-7 flex flex-col gap-4 lg:gap-space-lg">${receptora}${catalogo}</div>
      <div class="lg:col-span-5 flex flex-col gap-4 lg:gap-space-lg lg:sticky lg:top-20">${cesta}${firma}${boton}</div>
    </div>
  </div>`;
};

function setupFirma() {
  const cv = $('#firma'); if (!cv) return;
  const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr); ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0037b0';
  const draw = () => { ctx.clearRect(0, 0, r.width, r.height); for (const st of ui.firma) { ctx.beginPath(); st.forEach(([x, y], i) => { const X = x * r.width, Y = y * r.height; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); if (st.length === 1) ctx.lineTo(st[0][0] * r.width + .5, st[0][1] * r.height); ctx.stroke(); } };
  draw();
  let cur = null;
  const pt = e => { const b = cv.getBoundingClientRect(); return [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height]; };
  cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); cur = [pt(e)]; ui.firma.push(cur); draw(); };
  cv.onpointermove = e => { if (!cur) return; cur.push(pt(e)); draw(); };
  cv.onpointerup = cv.onpointercancel = () => { if (!cur) return; const primera = ui.firma.length === 1; cur = null; if (primera) renderMain(); };
}
function firmaDataURL() {
  const c = document.createElement('canvas'); c.width = 360; c.height = 140;
  const ctx = c.getContext('2d'); ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0037b0';
  for (const st of ui.firma) { ctx.beginPath(); st.forEach(([x, y], i) => i ? ctx.lineTo(x * 360, y * 140) : ctx.moveTo(x * 360, y * 140)); ctx.stroke(); }
  return c.toDataURL('image/png');
}
async function commitEntrega() {
  const eq = cestaEquipo(), rec = tec(S.cesta.receptor), lineas = S.cesta.lineas.filter(l => find(l.sku) && l.qty > 0);
  for (const l of lineas) { const p = find(l.sku); if (l.qty > p.stock) return toast(`Solo hay ${qtyTxt(p, p.stock)} de ${p.name}.`, 'err'); }
  S.seq.ent++;
  const e = { id: `ENT-${new Date().getFullYear()}-${String(S.seq.ent).padStart(4, '0')}`, ts: Date.now(), equipo: eq.id, receptor: rec.id, dni: rec.dni, lineas: clone(lineas), firma: firmaDataURL(), operator: S.operator };
  const avisos = [];
  try { for (const l of lineas) avisos.push(applyMovement({ sku: l.sku, type: 'salida', qty: l.qty, reason: 'Entrega a equipo', ref: e.id, serials: l.serials, equipo: eq.id })); }
  catch (err) { S = load(); return toast(err.message, 'err'); } // deshace: recarga el último estado guardado
  e.hash = await hashEntrega(e);
  S.entregas.unshift(e); S.cesta.lineas = []; ui.firma = []; ui.certifica = false; ui.entSN = null;
  save(); render();
  toast(`Entrega ${e.id} firmada por ${rec.nombre}. Stock descontado.`, 'ok', 6000);
  avisos.forEach(avisoEstado);
  openRecibo(e.id);
}
function openRecibo(id) {
  const e = S.entregas.find(x => x.id === id); if (!e) return;
  const eq = equipo(e.equipo), rec = tec(e.receptor);
  openModal(`${sheetHead(`Albarán de entrega ${esc(e.id)}`, fechaHora(e.ts))}
    <div id="impresion" class="p-5 flex flex-col gap-3 bg-white">
      <div class="flex justify-between"><div><div class="font-bold">${MARCA.nombre}</div><div class="text-body-sm text-secondary">${MARCA.nave}</div></div><div class="text-right mono text-label-md">${esc(e.id)}<br>${fechaHora(e.ts)}</div></div>
      <div class="grid grid-cols-2 gap-2 text-body-sm"><div class="bg-surface-container-low rounded-lg p-2.5"><div class="${LBL}">Equipo / vehículo</div>${esc(eq ? `${eq.nombre} · ${eq.flota} (${eq.matricula})` : e.equipo)}</div><div class="bg-surface-container-low rounded-lg p-2.5"><div class="${LBL}">Recibe</div>${esc(rec ? rec.nombre : '')} · DNI ${esc(e.dni || rec?.dni || '')}</div></div>
      <table class="w-full text-body-sm"><thead><tr class="text-left ${LBL}"><th class="py-1">Material</th><th>S/N</th><th class="text-right">Cant.</th></tr></thead><tbody>${e.lineas.map(l => { const p = find(l.sku); return `<tr class="border-t border-surface-container"><td class="py-1.5">${esc(p ? p.name : l.sku)}<div class="mono text-label-sm text-secondary">${esc(l.sku)}</div></td><td class="mono text-label-sm">${(l.serials || []).map(esc).join('<br>')}</td><td class="text-right font-semibold">${num(l.qty)} ${p ? UNIT[p.unit] : ''}</td></tr>`; }).join('')}</tbody></table>
      <div class="flex items-end justify-between gap-3 border-t border-surface-container pt-3"><div>${firmaSVG(e.firma, 'h-16 w-44')}<div class="text-body-sm text-secondary">Firma del receptor</div></div><div class="mono text-[9px] text-secondary break-all max-w-[55%] text-right">Huella SHA-256<br>${esc(e.hash || '')}</div></div>
      <p class="text-body-sm text-secondary">Aceptación de la entrega por el receptor. Registrado por ${esc(e.operator)}.</p>
    </div>
    <div class="sticky bottom-0 bg-white border-t border-surface-container p-4 flex gap-2"><button data-act="cerrar" class="${BTN_S} h-12 px-5">Cerrar</button><button data-act="imprimir" class="${BTN_P} h-12 flex-1">${ic('print', 'ms-20')}Imprimir o guardar PDF</button></div>`);
}

/* ---------- 11. Equipos y técnicos ---------- */
function auditTable() {
  const es = S.entregas.slice().sort((a, b) => b.ts - a.ts);
  const resumen = e => e.lineas.map(l => `${num(l.qty)}${find(l.sku)?.unit === 'm' ? ' m' : '×'} ${esc((find(l.sku)?.name || l.sku).split(' ').slice(0, 3).join(' '))}`).join(', ');
  return `<section class="${CARD} overflow-hidden">
    <div class="p-space-md flex flex-wrap items-center justify-between gap-3"><div class="flex items-center gap-3"><span class="w-11 h-11 rounded-xl bg-tertiary-fixed text-on-tertiary-fixed grid place-items-center">${ic('verified_user')}</span><div><h2 class="text-headline-md font-semibold">Auditoría de entregas y firmas</h2><p class="mono text-label-sm text-secondary">Custodia de material del almacén a furgoneta · huella SHA-256</p></div></div>
      <div class="flex gap-2"><button data-act="verificar" class="${BTN_S} px-3 h-10 text-body-sm">${ic('fact_check', 'ms-18')}Verificar huellas</button><button data-act="csvEntregas" class="${BTN_S} px-3 h-10 text-body-sm">${ic('download', 'ms-18')}CSV</button></div></div>
    ${isDesk() ? `<div class="overflow-x-auto"><table class="tabla w-full min-w-[900px]"><thead class="bg-surface-container-low"><tr><th>Referencia / fecha</th><th>Equipo / vehículo</th><th>Receptor</th><th>Resumen de material</th><th>Firma capturada</th><th class="text-right">Doc.</th></tr></thead><tbody>
      ${es.map(e => { const eq = equipo(e.equipo), r = tec(e.receptor); return `<tr><td><div class="mono text-label-md text-primary">#${esc(e.id)}</div><div class="mono text-label-sm text-secondary">${hace(e.ts)}</div></td>
        <td><div class="flex items-center gap-2">${ic('airport_shuttle', 'text-secondary ms-20')}<div><div>${esc(eq ? eq.flota : e.equipo)}</div><div class="mono text-label-sm text-secondary">${esc(eq ? eq.matricula : '')}</div></div></div></td>
        <td><div class="flex items-center gap-2">${avatar(r ? r.nombre : '?')}<span>${esc(r ? r.nombre : '—')}</span></div></td>
        <td class="max-w-[320px] text-body-sm">${resumen(e)}</td>
        <td><div class="flex items-center gap-2"><span class="bg-surface-container-low rounded-lg px-1">${firmaSVG(e.firma)}</span><span class="mono text-label-sm text-tertiary">✓ ${esc((e.hash || '').slice(0, 8))}</span></div></td>
        <td class="text-right"><button data-act="recibo" data-v="${esc(e.id)}" class="p-2 rounded-lg text-primary hover:bg-primary-fixed" aria-label="Ver albarán de entrega">${ic('picture_as_pdf')}</button></td></tr>`; }).join('') || '<tr><td colspan="6" class="text-center text-secondary py-8">Sin entregas registradas.</td></tr>'}
    </tbody></table></div>`
      : `<div class="px-4 pb-2">${es.map(e => { const eq = equipo(e.equipo), r = tec(e.receptor); return `<button data-act="recibo" data-v="${esc(e.id)}" class="w-full text-left flex items-center gap-3 py-3 border-t border-surface-container"><span class="bg-surface-container-low rounded-lg">${firmaSVG(e.firma, 'h-10 w-20')}</span><div class="flex-1 min-w-0"><div class="mono text-label-md text-primary">#${esc(e.id)}</div><div class="text-body-sm truncate">${esc(eq ? eq.flota : '')} · ${esc(r ? r.nombre : '')}</div><div class="text-body-sm text-secondary truncate">${resumen(e)}</div></div><span class="mono text-label-sm text-secondary shrink-0">${hace(e.ts)}</span></button>`; }).join('') || '<p class="text-secondary py-6 text-center">Sin entregas.</p>'}</div>`}
  </section>`;
}
VIEW_FN.equipos = function () {
  const enRuta = S.equipos.filter(e => e.estado === 'ruta').length;
  const tab = (k, l, n, i) => `<button data-act="eqTab" data-v="${k}" class="flex items-center gap-2 px-4 h-11 rounded-lg font-semibold ${ui.eqTab === k ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant'}">${ic(i, 'ms-20')}${l}<span class="mono text-label-sm px-1.5 rounded bg-surface-container-high">${n}</span></button>`;
  const cardEq = e => {
    const vs = vanStock(e.id), ult = S.entregas.filter(x => x.equipo === e.id).sort((a, b) => b.ts - a.ts)[0];
    const top = vs.slice().sort((a, b) => b.qty * find(b.sku).price - a.qty * find(a.sku).price).slice(0, 3);
    return `<article class="${CARD} p-4 lg:p-space-md flex flex-col gap-3">
      <div class="flex items-start gap-3"><span class="w-12 h-12 rounded-xl bg-surface-container-low text-primary grid place-items-center shrink-0">${ic(e.tecnicos.length > 1 ? 'airport_shuttle' : 'directions_car')}</span>
        <div class="flex-1 min-w-0"><div class="${LBL}">${esc(e.nombre)} · ${esc(e.flota)}</div><div class="text-headline-md font-semibold mono">${esc(e.matricula)}</div></div>
        <button data-act="eqEstado" data-v="${e.id}" title="Cambiar estado" class="mono text-label-sm px-2.5 py-1 rounded-full whitespace-nowrap ${estadoEq[e.estado].c}">● ${estadoEq[e.estado].t}</button></div>
      <div class="bg-surface-container-low rounded-xl p-3 flex flex-col gap-2"><div class="${LBL}">Personal operativo (${e.tecnicos.length} técnico${e.tecnicos.length === 1 ? '' : 's'})</div>
        ${e.tecnicos.map(tec).filter(Boolean).map(t => `<div class="flex items-center gap-3">${avatar(t.nombre, 'bg-white text-primary')}<div class="flex-1 min-w-0"><div class="font-semibold truncate">${esc(t.nombre)}</div><div class="mono text-label-sm text-secondary truncate">${esc(t.rol)}</div></div>${ic('verified', 'text-tertiary ms-20')}</div>`).join('') || '<span class="text-secondary text-body-sm">Sin técnicos asignados</span>'}</div>
      <div><div class="flex justify-between mb-2"><span class="${LBL}">Stock a bordo</span><button data-act="verVan" data-v="${e.id}" class="mono text-label-sm text-primary">Ver todo (${vs.length}) →</button></div>
        <div class="grid grid-cols-3 gap-2">${top.map(x => { const p = find(x.sku); return `<div class="bg-surface-container-low rounded-lg p-2 text-center">${ic(CATS[p.cat].icon, 'text-primary ms-20')}<div class="font-semibold">${num(x.qty)} ${UNIT[p.unit]}</div><div class="mono text-[9px] text-secondary truncate">${esc(p.name)}</div></div>`; }).join('') || '<div class="col-span-3 text-body-sm text-secondary bg-surface-container-low rounded-lg p-3 text-center">Sin material cargado</div>'}</div></div>
      ${ult ? `<button data-act="recibo" data-v="${esc(ult.id)}" class="text-left bg-surface-container-low rounded-xl p-3 flex items-center gap-3">${ic('draw', 'text-tertiary')}<div class="flex-1 min-w-0"><div class="mono text-label-sm text-secondary">Última entrega firmada</div><div class="font-semibold">${hace(ult.ts)} (#${esc(ult.id)})</div></div>${ic('visibility', 'text-primary')}</button>` : ''}
      <div class="mt-auto flex flex-col gap-2">
        ${e.tecnicos.length > 1 ? `<button data-act="desdoblar" data-v="${e.id}" class="${BTN_T} h-11">${ic('call_split', 'ms-20')}Desdoblar en técnicos (1+1)</button>` : `<button data-act="emparejar" data-v="${e.id}" class="${BTN_T} h-11">${ic('call_merge', 'ms-20')}Formar pareja</button>`}
        <button data-act="cargar" data-v="${e.id}" class="${BTN_P} h-12">${ic('inventory', 'ms-20')}${e.estado === 'depot' ? 'Asignar material para la ruta de hoy' : 'Gestionar carga de furgoneta'}</button>
      </div></article>`;
  };
  const libres = S.tecnicos.filter(t => !S.equipos.some(e => e.tecnicos.includes(t.id)));
  return `<div class="px-4 lg:px-gutter py-4 lg:py-space-lg flex flex-col gap-4 lg:gap-space-lg max-w-[1600px]">
    <div class="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
      <div><span class="${LBL}">Logística &amp; flota / gestión de equipos</span><h1 class="text-headline-lg-mobile lg:text-headline-lg font-bold">Equipos de instalación &amp; despacho móvil</h1></div>
      <div class="flex flex-wrap items-center gap-2"><span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container-high mono text-label-sm"><span class="w-2 h-2 rounded-full bg-tertiary-container"></span>${enRuta} en ruta · ${S.tecnicos.length} operarios</span>
        <button data-act="nuevoEq" class="${BTN_P} px-4 h-11">${ic('group_add', 'ms-20')}Crear equipo</button><button data-act="nuevoTec" class="${BTN_S} px-4 h-11">${ic('person_add', 'ms-20')}Técnico</button></div>
    </div>
    <section class="${CARD} p-4 lg:p-space-md flex gap-4 items-start"><span class="w-11 h-11 rounded-xl bg-primary-fixed text-primary grid place-items-center shrink-0">${ic('alt_route')}</span><div class="flex-1"><h2 class="text-headline-sm font-semibold">Operación flexible</h2><p class="text-body-md text-secondary">Configura cuadrillas en pareja (2 técnicos, 1 furgoneta) o desdóblalas en técnicos individuales cuando incorporas vehículos. El stock a bordo de cada furgoneta se calcula con lo entregado y firmado menos lo devuelto.</p></div></section>
    <div class="inline-flex self-start bg-surface-container-low rounded-xl p-1">${tab('equipos', 'Equipos', S.equipos.length, 'local_shipping')}${tab('tecnicos', 'Técnicos', S.tecnicos.length, 'engineering')}</div>
    ${ui.eqTab === 'equipos' ? `<div class="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 lg:gap-space-lg">${S.equipos.map(cardEq).join('')}</div>`
      : `<div class="${CARD} overflow-hidden">${S.tecnicos.map(t => { const e = S.equipos.find(x => x.tecnicos.includes(t.id)); return `<div class="flex flex-wrap items-center gap-3 p-4 border-b border-surface-container">${avatar(t.nombre)}<div class="flex-1 min-w-[160px]"><div class="font-semibold">${esc(t.nombre)}</div><div class="mono text-label-sm text-secondary">${esc(t.rol)} · DNI ${esc(t.dni)}</div></div>
        <label class="flex items-center gap-2"><span class="${LBL}">Equipo</span><select data-in="tecEq" data-v="${t.id}" class="${INP} !w-auto h-11"><option value="">— Sin equipo —</option>${S.equipos.map(x => `<option value="${x.id}" ${e && e.id === x.id ? 'selected' : ''}>${esc(x.nombre)} (${esc(x.matricula)})</option>`).join('')}</select></label></div>`; }).join('')}
        ${libres.length ? `<p class="p-4 text-body-sm text-amber-800 bg-amber-50">${libres.length} técnico${libres.length === 1 ? '' : 's'} sin equipo: no podrán recibir entregas hasta asignarlos.</p>` : ''}</div>`}
    ${auditTable()}
  </div>`;
};

function openEqForm(preset = {}) {
  ui.eqf = { nombre: '', flota: `Furgoneta ${String(S.equipos.length + 1).padStart(2, '0')}`, matricula: '', estado: 'depot', tecnicos: [], ...preset };
  const libres = S.tecnicos;
  openModal(`${sheetHead(preset._split ? 'Desdoblar equipo' : 'Crear equipo', preset._split ? 'El segundo técnico sale con su propio vehículo.' : 'Cuadrilla con su vehículo')}
    <div class="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
      ${[['nombre', 'Nombre del equipo', 'Equipo Delta'], ['flota', 'Vehículo', 'Furgoneta 04'], ['matricula', 'Matrícula *', '0000-XXX']].map(([k, l, ph]) => `<label class="flex flex-col gap-1"><span class="${LBL}">${l}</span><input data-in="eqf" data-k="${k}" value="${esc(ui.eqf[k])}" placeholder="${ph}" class="${INP} h-12 ${k === 'matricula' ? 'mono uppercase' : ''}"></label>`).join('')}
      <label class="flex flex-col gap-1"><span class="${LBL}">Estado</span><select data-in="eqf" data-k="estado" class="${INP} h-12">${Object.entries(estadoEq).map(([k, v]) => `<option value="${k}" ${ui.eqf.estado === k ? 'selected' : ''}>${v.t}</option>`).join('')}</select></label>
      ${preset._split ? '' : `<div class="sm:col-span-2"><span class="${LBL}">Técnicos (se retiran de su equipo actual)</span><div class="flex flex-wrap gap-2 mt-1">${libres.map(t => `<label class="flex items-center gap-2 px-3 h-11 rounded-lg bg-surface-container-low"><input type="checkbox" data-in="eqfTec" data-v="${t.id}" class="w-5 h-5 accent-primary">${esc(t.nombre)}</label>`).join('')}</div></div>`}
    </div>
    <div class="sticky bottom-0 bg-white border-t border-surface-container p-4 flex gap-2"><button data-act="cerrar" class="${BTN_S} h-12 px-5">Cancelar</button><button data-act="eqfOk" class="${BTN_P} h-12 flex-1">${ic('save', 'ms-20')}Guardar equipo</button></div>`);
}
function commitEq() {
  const f = ui.eqf; f.matricula = String(f.matricula || '').trim().toUpperCase();
  if (!f.matricula) return toast('Indica la matrícula del vehículo.', 'err');
  let n = S.equipos.length + 1, id; do { id = 'F' + String(n++).padStart(2, '0'); } while (equipo(id));
  const tecs = f._split ? [f._split.tec] : f.tecnicos;
  if (!tecs.length) return toast('Asigna al menos un técnico.', 'err');
  S.equipos.forEach(e => { e.tecnicos = e.tecnicos.filter(t => !tecs.includes(t)); });
  S.equipos.push({ id, nombre: f.nombre || `Equipo ${id}`, flota: f.flota || `Vehículo ${id}`, matricula: f.matricula, estado: f.estado, tecnicos: tecs });
  save(); closeModal(); render(); toast(`${f.nombre || id} creado con ${tecs.length} técnico${tecs.length === 1 ? '' : 's'}.`, 'ok');
}
function openTecForm() {
  ui.tf = { nombre: '', rol: 'Técnico electricista', dni: '' };
  openModal(`${sheetHead('Nuevo técnico', 'Solo se guardan los 4 últimos dígitos y la letra del DNI.')}
    <div class="p-5 grid grid-cols-1 gap-3">
      ${[['nombre', 'Nombre y apellidos *'], ['rol', 'Puesto'], ['dni', 'DNI (se enmascara)']].map(([k, l]) => `<label class="flex flex-col gap-1"><span class="${LBL}">${l}</span><input data-in="tf" data-k="${k}" value="${esc(ui.tf[k])}" class="${INP} h-12"></label>`).join('')}
    </div>
    <div class="sticky bottom-0 bg-white border-t border-surface-container p-4"><button data-act="tfOk" class="${BTN_P} h-12 w-full">${ic('person_add', 'ms-20')}Añadir técnico</button></div>`);
}

/* ---------- 12. Movimientos ---------- */
VIEW_FN.movimientos = function () {
  const now = Date.now(), lim = { hoy: new Date().setHours(0, 0, 0, 0), '7': now - 7 * 864e5, '30': now - 30 * 864e5, all: 0 }[ui.movRange];
  const toks = norm(ui.movQ).split(/\s+/).filter(Boolean);
  const list = S.movements.filter(m => (ui.movType === 'all' || m.type === ui.movType) && m.ts >= lim && (!toks.length || toks.every(t => norm([m.sku, find(m.sku)?.name, m.reason, m.ref, m.operator, (m.serials || []).join(' ')].join(' ')).includes(t))));
  const tot = t => list.filter(m => m.type === t).length;
  const chip = (k, l) => `<button data-act="movType" data-v="${k}" class="shrink-0 px-4 h-11 rounded-full font-semibold text-body-sm ${ui.movType === k ? 'bg-primary text-white' : 'bg-surface-container-lowest shadow-sm'}">${l}</button>`;
  return `<div class="px-4 lg:px-gutter py-4 lg:py-space-lg flex flex-col gap-4 max-w-[1400px]">
    <div class="flex flex-col lg:flex-row lg:items-end justify-between gap-3"><div><span class="${LBL}">Trazabilidad completa</span><h1 class="text-headline-lg-mobile lg:text-headline-lg font-bold">Registro de movimientos</h1><p class="text-secondary">${tot('entrada')} entradas · ${tot('salida')} salidas · ${tot('merma')} mermas en la selección</p></div>
      <div class="grid grid-cols-3 lg:flex gap-2">
        <button data-act="pick" data-v="entrada" class="${BTN_T} h-12 px-4 !text-tertiary">${ic('move_to_inbox', 'ms-20')}Entrada</button>
        <button data-act="pick" data-v="salida" class="${BTN_P} h-12 px-4">${ic('outbox', 'ms-20')}Salida</button>
        <button data-act="pick" data-v="merma" class="${BTN_T} h-12 px-4 !text-error">${ic('report', 'ms-20')}Merma</button>
      </div></div>
    <div class="flex flex-col lg:flex-row gap-2">
      <div class="relative flex-1">${ic('search', 'absolute left-3 top-1/2 -translate-y-1/2 text-outline ms-20')}<input id="movQ" data-in="movQ" value="${esc(ui.movQ)}" type="search" class="${INP} pl-10 h-12" placeholder="Material, obra, operario, n.º de serie…"></div>
      <select data-in="movRange" class="${INP} lg:!w-44 h-12">${[['hoy', 'Hoy'], ['7', 'Últimos 7 días'], ['30', 'Últimos 30 días'], ['all', 'Todo']].map(([v, t]) => `<option value="${v}" ${ui.movRange === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <button data-act="csvMov" class="${BTN_S} h-12 px-4">${ic('file_download', 'ms-20')}CSV</button>
    </div>
    <div class="flex gap-2 overflow-x-auto no-scrollbar">${chip('all', 'Todos')}${chip('entrada', 'Entradas')}${chip('salida', 'Salidas')}${chip('merma', 'Mermas')}</div>
    ${isDesk() ? `<section class="${CARD} overflow-x-auto"><table class="tabla w-full min-w-[900px]"><thead class="bg-surface-container-low"><tr><th>Fecha</th><th>Tipo</th><th>Material</th><th class="text-right">Cantidad</th><th>Motivo</th><th>Referencia</th><th>Operario</th></tr></thead><tbody>
      ${list.slice(0, 200).map(m => { const p = find(m.sku), t = TIPO[m.type]; return `<tr><td class="mono text-label-sm whitespace-nowrap">${fechaHora(m.ts)}</td><td><span class="inline-flex items-center gap-1 px-2 py-1 rounded-full mono text-label-sm ${t.c}">${ic(t.icon, 'ms-16')}${t.t}</span></td>
        <td><button data-act="ficha" data-sku="${esc(m.sku)}" class="text-left"><div class="font-medium hover:text-primary">${esc(p ? p.name : m.sku)}</div><div class="mono text-label-sm text-secondary">${esc(m.sku)}${m.serials && m.serials.length ? ' · S/N ' + m.serials.map(esc).join(', ') : ''}</div></button></td>
        <td class="text-right font-semibold whitespace-nowrap ${m.type === 'entrada' ? 'text-tertiary' : m.type === 'merma' ? 'text-error' : ''}">${t.sign}${num(m.qty)} ${p ? UNIT[p.unit] : ''}</td><td>${esc(m.reason)}</td><td class="text-body-sm">${esc(m.ref)}${m.equipo ? ` · ${esc(equipo(m.equipo)?.flota || m.equipo)}` : ''}</td><td>${esc(m.operator)}</td></tr>`; }).join('') || '<tr><td colspan="7" class="text-center text-secondary py-10">Sin movimientos en la selección.</td></tr>'}
    </tbody></table></section>`
      : `<section class="${CARD} px-4">${list.slice(0, 120).map(movRow).join('') || '<p class="text-secondary py-8 text-center">Sin movimientos en la selección.</p>'}</section>`}
  </div>`;
};

/* ---------- 13. Configuración y auditoría ---------- */
VIEW_FN.config = function () {
  const bytes = (() => { try { return (localStorage.getItem(LS) || '').length; } catch (e) { return 0; } })();
  const blk = (icon, t, body) => `<section class="${CARD} p-4 lg:p-space-md flex flex-col gap-3"><h2 class="text-headline-sm font-semibold flex items-center gap-2">${ic(icon, 'text-primary')}${t}</h2>${body}</section>`;
  return `<div class="px-4 lg:px-gutter py-4 lg:py-space-lg flex flex-col gap-4 max-w-5xl">
    <div><span class="${LBL}">Sistema</span><h1 class="text-headline-lg-mobile lg:text-headline-lg font-bold">Configuración &amp; auditoría</h1></div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      ${blk('person', 'Operario activo', `<p class="text-body-sm text-secondary">Cada entrada, salida y merma queda a su nombre.</p><button data-act="perfil" class="flex items-center gap-3 bg-surface-container-low rounded-xl p-3 text-left">${avatar(S.operator)}<span class="flex-1 font-semibold">${esc(S.operator)}</span><span class="text-primary text-body-sm">Cambiar</span></button>`)}
      ${blk('traffic', 'Semáforo de stock', `<ul class="text-body-sm flex flex-col gap-2"><li class="flex gap-2"><span class="w-3 h-3 mt-1 rounded-full bg-error shrink-0"></span><span><b>Rojo</b>: stock por debajo del mínimo (p. ej. tacos &lt; 100 ud, cargadores &lt; 2 ud). Salta aviso al instante.</span></li><li class="flex gap-2"><span class="w-3 h-3 mt-1 rounded-full bg-amber-400 shrink-0"></span><span><b>Amarillo</b>: por debajo de 1,5 × el mínimo.</span></li><li class="flex gap-2"><span class="w-3 h-3 mt-1 rounded-full bg-tertiary-container shrink-0"></span><span><b>Verde</b>: nivel correcto.</span></li></ul><p class="text-body-sm text-secondary">El mínimo se edita en la ficha de cada referencia.</p>`)}
      ${blk('auto_awesome', 'Lectura de albaranes con IA', `<p class="text-body-sm">Estado: <b>${!ai.checked ? 'comprobando…' : iaLive() ? 'Claude Vision activo (dentro de claude.ai)' : 'modo simulado'}</b>.</p><p class="text-body-sm text-secondary">Para lectura real fuera de claude.ai, implementa <code class="mono">leerAlbaranIA(file)</code> en <code class="mono">js/app.js</code> para que llame a tu servidor. La clave de la IA va en el servidor, nunca en el navegador.</p>`)}
      ${blk('fact_check', 'Integridad de entregas', `<p class="text-body-sm text-secondary">Cada entrega firmada guarda una huella SHA-256 de su contenido y la firma. Si alguien la modifica, la huella deja de coincidir.</p><button data-act="verificar" class="${BTN_S} h-12">${ic('verified', 'ms-20')}Verificar ${S.entregas.length} entregas</button>`)}
      ${blk('database', 'Datos y copias de seguridad', `<p class="text-body-sm text-secondary">Los datos viven en este navegador (${(bytes / 1024).toFixed(0)} KB). Haz copias a menudo: si borras los datos del navegador, se pierden.</p>
        <div class="grid grid-cols-2 gap-2"><button data-act="backup" class="${BTN_P} h-12">${ic('download', 'ms-20')}Exportar copia</button><button data-act="restore" class="${BTN_S} h-12">${ic('upload', 'ms-20')}Importar copia</button>
        <button data-act="csvStock" class="${BTN_S} h-12">${ic('table', 'ms-20')}Stock CSV</button><button data-act="csvMov" class="${BTN_S} h-12">${ic('swap_vert', 'ms-20')}Movimientos CSV</button></div>
        <button data-act="reset" class="${BTN} h-12 text-error bg-error-container/50 hover:bg-error-container">${ic('restart_alt', 'ms-20')}Restaurar datos de prueba</button>`)}
      ${blk('info', 'Acerca de', `<p class="text-body-sm text-secondary">${MARCA.nombre} · control de stock para material eléctrico, fontanería y movilidad eléctrica. Funciona sin servidor (GitHub Pages) y en el móvil del operario. ${S.products.length} referencias · ${S.movements.length} movimientos · ${S.entregas.length} entregas.</p>`)}
    </div>
  </div>`;
};

/* ---------- 14. Exportaciones ---------- */
function downloadFile(name, content, type) {
  const blob = new Blob([content], { type }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function csv(name, rows) {
  const cell = v => { const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  downloadFile(name, '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}
const hoyTxt = () => new Date().toISOString().slice(0, 10);
function csvStock() { csv(`stock-${hoyTxt()}.csv`, [['SKU', 'Nombre', 'Categoría', 'Stock', 'Unidad', 'Mínimo', 'Estado', 'Ubicación', 'Proveedor', 'Precio coste', 'Valor', 'EAN', 'Ref. proveedor', 'N.º serie'], ...S.products.map(p => [p.sku, p.name, CATS[p.cat].label, p.stock, UNIT[p.unit], p.min, ST[status(p)].t, p.loc, p.supplier, p.price, Math.round(p.stock * p.price * 100) / 100, p.ean || '', p.supplierRef || '', (p.serials || []).join(' ')])]); }
function csvMov() { csv(`movimientos-${hoyTxt()}.csv`, [['Fecha', 'Tipo', 'SKU', 'Material', 'Cantidad', 'Unidad', 'Motivo', 'Referencia', 'Equipo', 'Operario', 'N.º serie'], ...S.movements.map(m => { const p = find(m.sku); return [fechaHora(m.ts), TIPO[m.type].t, m.sku, p ? p.name : '', m.qty, p ? UNIT[p.unit] : '', m.reason, m.ref, m.equipo || '', m.operator, (m.serials || []).join(' ')]; })]); }

/* ---------- 15. Avisos (toasts) ---------- */
function toast(msg, kind = '', ms = 4000) {
  const c = { ok: 'bg-inverse-surface text-white', err: 'bg-error text-white', warn: 'bg-amber-500 text-black', '': 'bg-inverse-surface text-white' }[kind];
  const i = { ok: 'check_circle', err: 'error', warn: 'warning', '': 'info' }[kind];
  const el = document.createElement('div');
  el.className = `toast pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl shadow-xl ${c}`;
  el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  el.innerHTML = `${ic(i, 'ms-20 shrink-0')}<span class="text-body-md">${esc(msg)}</span>`;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), ms);
}

/* ---------- 16. Eventos ---------- */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const a = b.dataset.act, v = b.dataset.v, sku = b.dataset.sku;
  if (b.tagName === 'FORM') return;
  switch (a) {
    case 'cerrar': closeModal(); break;
    case 'ir': location.hash = v; break;
    case 'menu': openMenu(); break;
    case 'avisos': openAvisos(); break;
    case 'perfil': openPerfil(); break;
    case 'setOp': S.operator = v; save(); closeModal(); render(); toast(`Operario activo: ${v}.`, 'ok'); break;
    case 'nuevoAlb': if (ui.view !== 'albaranes') location.hash = 'albaranes'; $('#fileIn').click(); break;
    case 'ficha': openFicha(sku); break;
    case 'mov': openMove(sku, b.dataset.t); break;
    case 'pick': openPicker(v); break;
    case 'mvType': mv.type = v; mv.reason = REASONS[v][0]; mv.sel = []; renderMove(); break;
    case 'mvStep': { const p = find(mv.sku); mv.qty = Math.max(0, Math.round(((Number(String(mv.qty).replace(',', '.')) || 0) + (Number(v) === -1 ? -1 : Number(v))) * 1000) / 1000); if (mv.type !== 'entrada' && mv.qty > p.stock) mv.qty = p.stock; renderMove(); break; }
    case 'mvSel': mv.sel = mv.sel.includes(v) ? mv.sel.filter(x => x !== v) : [...mv.sel, v]; renderMove(); break;
    case 'mvOk': commitMove(); break;
    case 'nuevoProd': openProdForm(); break;
    case 'editProd': openProdForm(sku); break;
    case 'pfOk': commitProd(); break;
    case 'catTab': ui.catTab = v; renderMain(); break;
    case 'filtroCat': ui.cat = ui.cat === v && !isDesk() ? 'all' : v; ui.page = 1; if (ui.view !== 'stock') location.hash = 'stock'; else renderMain(); break;
    case 'filtroEst': ui.est = v; ui.page = 1; ui.almacen = 'central'; if (ui.view !== 'stock') location.hash = 'stock'; else render(); break;
    case 'limpiarFiltros': ui.q = ''; ui.est = 'all'; ui.pas = 'all'; ui.cat = 'all'; ui.page = 1; render(); break;
    case 'toggleFiltros': ui.filtros = !ui.filtros; renderMain(); break;
    case 'page': ui.page = Number(v); renderMain(); break;
    case 'pedir': { const p = find(sku); const q = Math.max(p.pack || 1, Math.ceil((p.min * 2 - p.stock) / (p.pack || 1)) * (p.pack || 1)); S.pedidos[sku] = { ts: Date.now(), qty: q }; save(); render(); toast(`Añadido a la lista de reposición: ${qtyTxt(p, q)} de ${p.name} (${p.supplier}).`, 'ok'); if (!$('#modal').classList.contains('hidden')) openAvisos(); break; }
    case 'csvPedido': csv(`reposicion-${hoyTxt()}.csv`, [['Proveedor', 'SKU', 'Ref. proveedor', 'Material', 'Cantidad sugerida', 'Unidad', 'Stock actual', 'Mínimo'], ...Object.entries(S.pedidos).map(([k, o]) => { const p = find(k); return p ? [p.supplier, p.sku, p.supplierRef || '', p.name, o.qty, UNIT[p.unit], p.stock, p.min] : null; }).filter(Boolean).sort((x, y) => x[0].localeCompare(y[0]))]); break;
    case 'csvStock': csvStock(); break;
    case 'csvMov': csvMov(); break;
    case 'conteo': openConteo(v); break;
    case 'conteoOk': commitConteo(); break;
    case 'etiqueta': { const p = find(sku); const w = window.open('', '_blank', 'width=420,height=520'); if (!w) return toast('El navegador ha bloqueado la ventana de impresión.', 'warn'); w.document.write(`<!doctype html><meta charset="utf-8"><title>Etiqueta ${esc(p.sku)}</title><body style="font-family:system-ui;text-align:center;padding:24px"><div style="width:220px;margin:auto">${$('#qrFicha').innerHTML}</div><h2 style="margin:8px 0 2px;font-size:18px">${esc(p.sku)}</h2><div>${esc(p.name)}</div><div style="font:600 20px monospace;margin-top:8px">${esc(p.loc)}</div><script>setTimeout(()=>print(),300)<\/script>`); w.document.close(); break; }
    case 'alCesta': addCesta(sku, find(sku).unit === 'm' ? 10 : 1); renderShell(); toast(`Añadido a la entrega de ${cestaEquipo()?.flota || ''}. Ve a “Entrega” para firmar.`, 'ok'); break;
    case 'almacen': ui.almacen = v; render(); break;
    case 'verVan': ui.almacen = v; location.hash = 'stock'; if (ui.view === 'stock') render(); break;
    case 'devolver': { const x = vanStock(v).find(y => y.sku === sku); if (!x) break; const p = find(sku); openMove(sku, 'entrada', { reason: 'Devolución de obra', equipo: v, max: x.qty, qty: p.serialized ? 0 : x.qty, snTxt: x.serials.join('\n'), lock: true, ref: `Devuelto por ${equipo(v).flota}` }); break; }
    // Escáner
    case 'scanMode': ui.scanMode = v; if (ui.scanHit) { ui.scanReason = REASONS[v === 'consulta' ? 'salida' : v][0]; setScanSerial(); } renderScan(); break;
    case 'camOn': startCamera(); break;
    case 'camOff': stopCamera(); camOverlay(); break;
    case 'torch': { const t = cam.stream && cam.stream.getVideoTracks()[0]; if (t) { cam.torch = !cam.torch; t.applyConstraints({ advanced: [{ torch: cam.torch }] }).catch(() => { }); camOverlay(); } break; }
    case 'testCode': handleCode(v, 'simulación'); break;
    case 'scanStep': { const p = find(ui.scanHit.sku); ui.scanQty = Math.max(1, Math.round(((Number(String(ui.scanQty).replace(',', '.')) || 0) + Number(v)) * 1000) / 1000); if (ui.scanMode === 'salida' && ui.scanQty > p.stock) ui.scanQty = Math.max(1, p.stock); renderScan(); break; }
    case 'scanSel': ui.scanSel = ui.scanSel.includes(v) ? ui.scanSel.filter(x => x !== v) : [...ui.scanSel, v]; renderScan(); break;
    case 'scanOk': commitScan(); break;
    case 'scanNext': ui.scanHit = null; renderScan(); if (!cam.stream) startCamera(); break;
    case 'altaCodigo': { const c = ui.scanHit.code; openProdForm(null, /^\d{8,14}$/.test(c) ? { ean: c } : { sku: c.toUpperCase() }); break; }
    // Albaranes
    case 'demoAlb': processDemo(v); break;
    case 'albCancel': albReset(); render(); break;
    case 'albOk': approveAlb(); break;
    case 'albAdd': alb.lines.push({ codigo: '', descripcion: 'Línea añadida a mano', cantidad: 1, confianza: 1, sku: null, how: 'manual', include: false, series: '', nota: '' }); renderMain(); break;
    case 'albSkuNuevo': { const l = alb.lines[Number(b.dataset.i)]; openProdForm(null, { sku: String(l.codigo || '').toUpperCase(), name: l.descripcion, supplierRef: l.codigo, supplier: alb.doc.proveedor, cat: /cargador|wallbox|mennekes|charger|conector/i.test(l.descripcion) ? 'cargadores' : 'aparamenta', serialized: /cargador|wallbox|mennekes|charger/i.test(l.descripcion), _albLine: Number(b.dataset.i) }); pf._albLine = Number(b.dataset.i); break; }
    case 'albCsv': csv(`albaran-${(alb.doc.numero || 'sn').replace(/[^\w-]/g, '')}.csv`, [['Proveedor', 'N.º albarán', 'Fecha', 'Código', 'Descripción', 'SKU', 'Cantidad', 'N.º serie', 'Confianza', 'Se ingresa'], ...alb.lines.map(l => [alb.doc.proveedor, alb.doc.numero, alb.doc.fecha, l.codigo, l.descripcion, l.sku || '', l.cantidad, parseSN(l.series).join(' '), Math.round(l.confianza * 100) + '%', l.include && l.sku ? 'Sí' : 'No'])]); break;
    // Entregas
    case 'cestaEq': S.cesta.equipo = v; save(); renderMain(); break;
    case 'entCat': ui.entCat = v; renderMain(); break;
    case 'alCestaE': addCesta(sku, find(sku).unit === 'm' ? 10 : 1); renderMain(); break;
    case 'cestaAdd': addCesta(sku, find(sku).unit === 'm' ? 10 : 1); renderMain(); break;
    case 'cestaSub': subCesta(sku); renderMain(); break;
    case 'cestaClear': S.cesta.lineas = []; save(); renderMain(); break;
    case 'entSN': ui.entSN = ui.entSN === sku ? null : sku; renderMain(); break;
    case 'entSNt': { const l = S.cesta.lineas.find(x => x.sku === sku); if (!l) break; l.serials = l.serials.includes(v) ? l.serials.filter(x => x !== v) : [...l.serials, v]; l.qty = l.serials.length; if (!l.qty) S.cesta.lineas = S.cesta.lineas.filter(x => x !== l); save(); renderMain(); break; }
    case 'firmaClear': ui.firma = []; renderMain(); break;
    case 'entOk': commitEntrega(); break;
    case 'recibo': openRecibo(v); break;
    case 'imprimir': window.print(); break;
    // Equipos
    case 'eqTab': ui.eqTab = v; renderMain(); break;
    case 'cargar': S.cesta.equipo = v; save(); location.hash = 'entregas'; if (ui.view === 'entregas') render(); break;
    case 'eqEstado': { const eq = equipo(v); const ks = Object.keys(estadoEq); eq.estado = ks[(ks.indexOf(eq.estado) + 1) % ks.length]; save(); renderMain(); break; }
    case 'desdoblar': { const eq = equipo(v); openEqForm({ _split: { from: v, tec: eq.tecnicos[1] }, nombre: `${eq.nombre} B`, flota: `Vehículo ${tec(eq.tecnicos[1])?.nombre.split(' ')[0] || ''}`, estado: eq.estado }); break; }
    case 'emparejar': { const eq = equipo(v); const otros = S.equipos.filter(x => x.id !== v && x.tecnicos.length === 1);
      if (!otros.length) return toast('No hay otro técnico individual con quien emparejar.', 'warn');
      openModal(`${sheetHead('Formar pareja', `${esc(tec(eq.tecnicos[0])?.nombre || '')} se une a otro técnico individual. El vehículo de ${esc(eq.nombre)} queda libre.`)}<div class="p-4 flex flex-col gap-2">${otros.map(o => `<button data-act="emparejarOk" data-v="${v}" data-o="${o.id}" class="flex items-center gap-3 p-3 rounded-xl bg-surface-container-low text-left">${avatar(tec(o.tecnicos[0])?.nombre)}<span class="flex-1"><b>${esc(tec(o.tecnicos[0])?.nombre)}</b><br><span class="text-body-sm text-secondary">${esc(o.nombre)} · ${esc(o.matricula)}</span></span>${ic('chevron_right')}</button>`).join('')}</div>`); break; }
    case 'emparejarOk': { const from = equipo(v), to = equipo(b.dataset.o); if (vanStock(from.id).length) { closeModal(); return toast(`${from.flota} aún lleva material a bordo: devuélvelo o pásalo antes de retirar el vehículo.`, 'warn', 7000); } to.tecnicos.push(...from.tecnicos); S.equipos = S.equipos.filter(x => x !== from); save(); closeModal(); render(); toast(`Pareja formada en ${to.nombre}.`, 'ok'); break; }
    case 'nuevoEq': openEqForm(); break;
    case 'eqfOk': commitEq(); break;
    case 'nuevoTec': openTecForm(); break;
    case 'tfOk': { const f = ui.tf; if (!String(f.nombre).trim()) return toast('Indica el nombre.', 'err'); const d = String(f.dni || '').replace(/\W/g, '').toUpperCase(); const id = uid('T'); S.tecnicos.push({ id, nombre: f.nombre.trim(), rol: f.rol || 'Técnico', dni: d.length >= 5 ? `***${d.slice(-5, -1)}-${d.slice(-1)}` : (d || '—') }); save(); closeModal(); ui.eqTab = 'tecnicos'; render(); toast('Técnico añadido. Asígnale un equipo.', 'ok'); break; }
    case 'verificar': { let ok = 0, bad = []; for (const x of S.entregas) { (await hashEntrega(x)) === x.hash ? ok++ : bad.push(x.id); } bad.length ? toast(`${bad.length} entrega(s) no coinciden con su huella: ${bad.join(', ')}.`, 'err', 8000) : toast(`Las ${ok} entregas coinciden con su huella SHA-256.`, 'ok'); break; }
    case 'csvEntregas': csv(`entregas-${hoyTxt()}.csv`, [['Entrega', 'Fecha', 'Equipo', 'Vehículo', 'Receptor', 'DNI', 'SKU', 'Material', 'Cantidad', 'N.º serie', 'Huella SHA-256'], ...S.entregas.flatMap(x => x.lineas.map(l => { const eq = equipo(x.equipo), r = tec(x.receptor), p = find(l.sku); return [x.id, fechaHora(x.ts), eq ? eq.nombre : x.equipo, eq ? eq.matricula : '', r ? r.nombre : '', x.dni || r?.dni || '', l.sku, p ? p.name : '', l.qty, (l.serials || []).join(' '), x.hash]; }))]); break;
    // Movimientos / config
    case 'movType': ui.movType = v; renderMain(); break;
    case 'backup': downloadFile(`almacen-copia-${hoyTxt()}.json`, JSON.stringify(S, null, 1), 'application/json'); break;
    case 'restore': $('#jsonIn').click(); break;
    case 'reset': if (confirm('¿Restaurar los datos de prueba? Se perderán los cambios hechos en este navegador (exporta una copia antes si los necesitas).')) { S = fresh(); for (const x of S.entregas) x.hash = await hashEntrega(x); save(); albReset(); ui.almacen = 'central'; render(); toast('Datos de prueba restaurados.', 'ok'); } break;
  }
});
document.addEventListener('submit', e => {
  if (e.target.dataset.act === 'manualForm') { e.preventDefault(); if (ui.manual.trim()) { handleCode(ui.manual, 'teclado'); ui.manual = ''; } }
});
document.addEventListener('input', e => {
  const t = e.target, k = t.dataset.in; if (!k) return;
  const val = t.type === 'checkbox' ? t.checked : t.value;
  switch (k) {
    case 'gq': ui.q = val; ui.page = 1; ui.almacen = 'central'; if (ui.view !== 'stock') { if (ui.view === 'scan') stopCamera(); ui.view = 'stock'; history.replaceState(null, '', '#stock'); render(); } else renderMain(); break;
    case 'q': ui.q = val; ui.page = 1; renderMain(); { const g = $('#gq'); if (g) g.value = val; } break;
    case 'mvQty': mv.qty = val; { const p = find(mv.sku), q = Number(String(val).replace(',', '.')) || 0, btn = $('[data-act="mvOk"]'); if (btn) btn.disabled = !(q > 0) || (mv.type !== 'entrada' && q > p.stock); } break;
    case 'mvSN': mv.snTxt = val; break;
    case 'mvRef': mv.ref = val; break;
    case 'pickQ': ui.pickQ = val; refreshPicker(); break;
    case 'pf': pf[t.dataset.k] = val; break;
    case 'pfLoc': { const parts = pf.loc.split('-'), i = { P: 0, E: 1, N: 2 }[t.dataset.k], d = String(val).replace(/\D/g, ''); parts[i] = t.dataset.k + (t.dataset.k === 'N' ? d : d.padStart(2, '0')); pf.loc = parts.join('-'); break; }
    case 'conteo': ui.conteo.vals[t.dataset.sku] = val; break;
    case 'manual': ui.manual = val; break;
    case 'scanQty': ui.scanQty = val; break;
    case 'scanSN': ui.scanSN = val; break;
    case 'scanRef': ui.scanRef = val; break;
    case 'albDoc': alb.doc[t.dataset.k] = val; break;
    case 'albQty': alb.lines[Number(t.dataset.i)].cantidad = val; break;
    case 'albSN': alb.lines[Number(t.dataset.i)].series = val; break;
    case 'entQ': ui.entQ = val; renderMain(); break;
    case 'movQ': ui.movQ = val; renderMain(); break;
    case 'eqf': ui.eqf[t.dataset.k] = val; break;
    case 'tf': ui.tf[t.dataset.k] = val; break;
  }
});
document.addEventListener('change', e => {
  const t = e.target, k = t.dataset.in; if (!k) return;
  const val = t.type === 'checkbox' ? t.checked : t.value;
  switch (k) {
    case 'almacen': ui.almacen = val; if (ui.view !== 'stock') location.hash = 'stock'; else render(); break;
    case 'cat': ui.cat = val; ui.page = 1; renderMain(); break;
    case 'est': ui.est = val; ui.page = 1; renderMain(); break;
    case 'pas': ui.pas = val; ui.page = 1; renderMain(); break;
    case 'mvReason': mv.reason = val; break;
    case 'mvSN': renderMove(); break;
    case 'mvQty': renderMove(); break;
    case 'scanReason': ui.scanReason = val; break;
    case 'scanSN': case 'scanQty': renderScan(); break;
    case 'albInc': alb.lines[Number(t.dataset.i)].include = val; renderMain(); break;
    case 'albSku': { const l = alb.lines[Number(t.dataset.i)]; l.sku = val || null; l.include = !!val; l.how = val ? 'manual' : null; renderMain(); break; }
    case 'albQty': case 'albSN': renderMain(); break;
    case 'cestaRec': S.cesta.receptor = val; save(); break;
    case 'cestaQty': { const p = find(t.dataset.sku), l = S.cesta.lineas.find(x => x.sku === t.dataset.sku), q = Number(String(val).replace(',', '.')); if (l && q >= 0) { l.qty = Math.min(q, p.stock); if (!l.qty) S.cesta.lineas = S.cesta.lineas.filter(x => x !== l); save(); } renderMain(); break; }
    case 'certifica': ui.certifica = val; renderMain(); break;
    case 'movRange': ui.movRange = val; renderMain(); break;
    case 'eqfTec': ui.eqf.tecnicos = val ? [...ui.eqf.tecnicos, t.dataset.v] : ui.eqf.tecnicos.filter(x => x !== t.dataset.v); break;
    case 'tecEq': { const id = t.dataset.v; S.equipos.forEach(x => { x.tecnicos = x.tecnicos.filter(y => y !== id); }); if (val) equipo(val).tecnicos.push(id); save(); renderMain(); toast('Asignación actualizada.', 'ok'); break; }
  }
});
$('#fileIn').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; processFile(f); });
$('#jsonIn').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const s = JSON.parse(await f.text()); if (!s || !Array.isArray(s.products)) throw 0; S = migrate(s); save(); render(); toast('Copia importada.', 'ok'); }
  catch (err) { toast('Ese archivo no es una copia válida de la app.', 'err'); }
});
document.addEventListener('dragover', e => { if (ui.view === 'albaranes') { e.preventDefault(); } });
document.addEventListener('drop', e => { if (ui.view !== 'albaranes') return; e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) processFile(f); });
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); const g = isDesk() ? $('#gq') : $('#mq'); if (g) g.focus(); else location.hash = 'stock'; }
  if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal();
  if (e.key === 'Enter' && e.target.id === 'drop') $('#fileIn').click();
});
let _wasDesk = isDesk();
window.addEventListener('resize', () => { const d = isDesk(); if (d !== _wasDesk) { _wasDesk = d; if (ui.view === 'scan') { $('#main').innerHTML = ''; } render(); } else if (ui.view === 'entregas') setupFirma(); });
window.addEventListener('online', renderShell); window.addEventListener('offline', renderShell);

/* ---------- 17. Arranque ---------- */
ui.view = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'stock';
render();
if (ui.view === 'scan') startCamera();
