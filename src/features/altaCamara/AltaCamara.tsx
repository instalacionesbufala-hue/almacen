/* E-015 · "Nuevo con la cámara": 1) leer el código (si ya existe, se abre esa ficha) · 2) foto del producto o de su etiqueta, que la IA
   convierte en una ficha propuesta · 3) revisar y guardar (la foto queda como foto del artículo). Sin IA o sin cobertura, se rellena a mano. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { UNIDADES, UNIT, categoriasActivas } from '../../data/catalogo';
import type { Producto, Unidad } from '../../data/tipos';
import { buscarExistente, formularioInicial, opDeAlta, parecidos, type FormAlta, type PropuestaIA, type TipoAlta } from '../../domain/altaCamara';
import { uid } from '../../domain/formato';
import { qtyTxt, unidadTxt } from '../../domain/reglas';
import { ejecutar, useAlmacen } from '../../store/almacen';
import { nuevoId } from '../../store/ops';
import { modoNube } from '../../store/nube/cliente';
import { closeModal, openModal, SheetFoot, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, Campo, Icon, INP, LBL, Tile } from '../../ui/base';
import { SelectorSocio } from '../config/Socios';
import { socioInicial } from '../../domain/socios';
import { useCamara } from '../escaner/camara';
import { asociarCodigo } from '../inventario/codigos';
import { guardarComoAlternativo, skuInternoDe } from '../../domain/codigos';
import { comprimir } from '../fotos/imagen';
import { guardarFoto } from '../fotos/servicio';
import { AVISO_GEMINI, iaArticulo, leerArticuloConIA } from '../albaranes/lector';
import { abrirFicha, abrirMovimiento } from '../inventario/hojas';

type Origen = 'inventario' | 'dotacion';
export const abrirAltaCamara = (o: { codigo?: string; origen?: Origen; formato?: string } = {}) => openModal(<AltaCamara codigo0={o.codigo || ''} origen={o.origen || 'inventario'} formato0={o.formato} />, { ancha: true });

const TIPOS: { t: TipoAlta; label: string; icon: string }[] = [
  { t: 'material', label: 'Material', icon: 'inventory_2' }, { t: 'ropa', label: 'Ropa', icon: 'checkroom' },
  { t: 'epi', label: 'EPI', icon: 'health_and_safety' }, { t: 'herramienta', label: 'Herramienta', icon: 'construction' },
];

function AltaCamara({ codigo0, origen, formato0 }: { codigo0: string; origen: Origen; formato0?: string }) {
  const E = useAlmacen(), admin = E.rol === 'admin';
  const tipoInicial: TipoAlta = origen === 'dotacion' ? (admin ? 'herramienta' : 'ropa') : 'material';
  const [paso, setPaso] = useState<'codigo' | 'foto' | 'ficha'>(codigo0 ? 'foto' : 'codigo');
  const [codigo, setCodigo] = useState(codigo0);
  const [escrito, setEscrito] = useState('');
  const [existe, setExiste] = useState<Producto | null>(() => (codigo0 ? buscarExistente(E, codigo0) : null));
  const [foto, setFoto] = useState<Blob | null>(null);
  const [fotoUrl, setFotoUrl] = useState('');
  const [leyendo, setLeyendo] = useState(false);
  const [nota, setNota] = useState('');
  const [f, setF] = useState<FormAlta | null>(null);
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  const archivo = useRef<HTMLInputElement>(null);
  const propietario0 = socioInicial(E);                                   // E-024: el único socio activo, o ninguno (se elige)

  useEffect(() => { const on = () => setEnLinea(true), off = () => setEnLinea(false); addEventListener('online', on); addEventListener('offline', off); return () => { removeEventListener('online', on); removeEventListener('offline', off); }; }, []);
  useEffect(() => () => { if (fotoUrl) URL.revokeObjectURL(fotoUrl); }, [fotoUrl]);

  const [formato, setFormato] = useState(formato0 || '');
  const leido = (c: string, fmt?: string) => {
    const code = c.trim(); if (!code) return;
    setCodigo(code); setFormato(fmt || '');
    const ex = buscarExistente(E, code);
    if (ex) { setExiste(ex); navigator.vibrate?.(60); } else { setExiste(null); setPaso('foto'); }
  };
  const cam = useCamara(paso === 'codigo' && !existe, leido, { pausarConModal: false });

  const puedeIA = iaArticulo() && modoNube;
  const leerIA = async (blob: Blob) => {
    setLeyendo(true); setNota('');
    try {
      const c = await comprimir(blob);
      const prop: PropuestaIA = await leerArticuloConIA(c.grande, codigo);
      setF(formularioInicial({ codigo, skuInterno: skuInternoDe(E), propuesta: prop, tipo: origen === 'dotacion' && prop.tipo === 'material' ? tipoInicial : prop.tipo, propietario: propietario0 }));
      setNota(`Propuesta de la IA${prop.confianza < 0.6 ? ' (poco segura: revísala bien)' : ''}${prop.nota ? ` · ${prop.nota}` : ''}. Corrige lo que haga falta.`);
    } catch (e) {
      setF(cur => cur ?? formularioInicial({ codigo, skuInterno: skuInternoDe(E), tipo: tipoInicial, propietario: propietario0 }));
      setNota(`La IA no ha podido leerla (${(e as Error).message}). Rellena la ficha a mano: la foto ya está puesta.`);
    } finally { setLeyendo(false); setPaso('ficha'); }
  };
  const conFoto = (blob?: File) => {
    if (!blob) return;
    setFoto(blob); setFotoUrl(URL.createObjectURL(blob));
    if (puedeIA && navigator.onLine) void leerIA(blob);
    else {
      setF(formularioInicial({ codigo, skuInterno: skuInternoDe(E), tipo: tipoInicial, propietario: propietario0 }));
      setNota(!puedeIA ? 'La lectura con IA no está disponible aquí: rellena la ficha a mano (la foto ya está puesta).' : 'Sin conexión: rellena la ficha a mano. Cuando vuelva la cobertura puedes pulsar "Leer con IA", y la foto se sube sola.');
      setPaso('ficha');
    }
  };
  const aMano = () => { setF(formularioInicial({ codigo, skuInterno: skuInternoDe(E), tipo: tipoInicial, propietario: propietario0 })); setNota(''); setPaso('ficha'); };
  const reiniciar = () => { setPaso('codigo'); setCodigo(''); setEscrito(''); setExiste(null); setFoto(null); setFotoUrl(''); setF(null); setNota(''); };

  const guardar = async (otro: boolean) => {
    if (!f) return;
    let op;
    try { op = opDeAlta(admin ? 'admin' : 'almacen', f, f.tipo === 'herramienta' ? `H${uid('').slice(-5).toUpperCase()}` : nuevoId(), E.operator); }
    catch (e) { return toast((e as Error).message, 'err'); }
    if (!ejecutar(op)) return;
    const sku = op.op === 'altaDotacion' ? '' : op.args.producto.sku.toUpperCase();
    // E-020: el código leído (EAN, QR del fabricante…) queda como código alternativo: el siguiente escaneo abre el artículo
    if (sku && op.op !== 'altaDotacion' && guardarComoAlternativo(codigo, op.args.producto)) asociarCodigo(codigo, sku, formato, false);
    let fotoOk = true;
    if (foto && sku) { try { fotoOk = await guardarFoto(sku, foto, 'propia'); } catch { fotoOk = false; } }
    const que = op.op === 'altaDotacion' ? `Ficha de ${f.name.trim()} creada` : op.op === 'borradorArticulo' ? `Borrador ${sku} creado: el administrador lo aprobará y entonces entrará el stock` : `${sku} dado de alta`;
    toast(`${que}.${foto && sku && !fotoOk ? ' La foto no se ha podido guardar.' : ''}`, fotoOk ? 'ok' : 'warn', 6000);
    if (otro) reiniciar(); else closeModal();
  };

  return (<>
    <SheetHead title="Nuevo con la cámara" sub={paso === 'codigo' ? '1 · Lee el código de barras o de la etiqueta' : paso === 'foto' ? '2 · Foto del producto o de su etiqueta' : `3 · Revisa y guarda${admin ? '' : ' (queda como borrador para el administrador)'}`} />
    <div className="p-4 flex flex-col gap-3">
      {paso === 'codigo' && !existe && <>
        <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3] max-h-[45vh]">
          <video ref={cam.video} playsInline muted className="w-full h-full object-cover" />
          {!cam.estado.on && <p className="absolute inset-0 grid place-items-center text-white/80 text-body-sm p-4 text-center">{cam.estado.msg || 'Abriendo la cámara…'}</p>}
        </div>
        <div className="flex gap-2"><input value={escrito} onChange={e => setEscrito(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') leido(escrito); }} placeholder="O escribe el código" className={`${INP} h-14 font-mono`} aria-label="Código" />
          <button onClick={() => leido(escrito)} disabled={!escrito.trim()} className={`${BTN_P} h-14 px-4 disabled:opacity-40`}>Seguir</button></div>
        <button onClick={() => setPaso('foto')} className={`${BTN_S} h-14`}><Icon n="barcode_reader" className="ico-20" />No tiene código</button>
      </>}

      {existe && <div className="rounded-xl bg-primary-fixed/40 p-4 flex flex-col gap-3">
        <div className="flex items-center gap-3"><Tile p={existe} /><div className="min-w-0"><div className="font-semibold">Ya existe: {existe.name}</div>
          <div className="font-mono text-label-sm text-secondary">{existe.sku} · almacén {qtyTxt(existe, existe.stock)}{existe.borrador ? ' · borrador' : ''}</div></div></div>
        <p className="text-body-sm">No se crea un duplicado. ¿Quieres registrar una entrada de este artículo?</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button onClick={() => { closeModal(); abrirMovimiento(existe.sku, 'entrada'); }} disabled={existe.borrador} className={`${BTN_P} h-14 disabled:opacity-40`}><Icon n="add_box" className="ico-20" />Registrar entrada</button>
          <button onClick={() => { closeModal(); abrirFicha(existe.sku); }} className={`${BTN_S} h-14`}><Icon n="open_in_new" className="ico-20" />Abrir la ficha</button>
          <button onClick={reiniciar} className={`${BTN_S} h-14`}><Icon n="restart_alt" className="ico-20" />Leer otro</button></div>
      </div>}

      {paso === 'foto' && <>
        {codigo && <p className="text-body-sm">Código <b className="font-mono">{codigo}</b>: no está en el catálogo.</p>}
        <input ref={archivo} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { conFoto(e.target.files?.[0]); e.target.value = ''; }} />
        <button onClick={() => archivo.current?.click()} disabled={leyendo} className={`${BTN_P} h-20 text-body-lg`}><Icon n="photo_camera" className="ico-28" />{leyendo ? 'Leyendo con IA…' : 'Hacer la foto'}</button>
        <p className="text-body-sm text-secondary">{puedeIA ? 'La IA propone el nombre, la categoría y el formato (bote de 1000, bolsa de 100, rollo en metros…). Tú lo revisas antes de guardar.' : 'La lectura con IA no está disponible aquí: la foto se guarda y la ficha se rellena a mano.'}</p>
        {puedeIA && <p className="text-label-sm text-secondary">{AVISO_GEMINI.split('.')[0]}. Son fotos de producto: no fotografíes personas.</p>}
        <button onClick={aMano} className={`${BTN_S} h-14`}><Icon n="edit_note" className="ico-20" />Sin foto: rellenar a mano</button>
      </>}

      {paso === 'ficha' && f && <Ficha f={f} setF={setF} admin={admin} fotoUrl={fotoUrl} nota={nota} leyendo={leyendo}
        releer={foto && puedeIA && enLinea ? () => void leerIA(foto) : undefined} />}
    </div>
    {paso === 'ficha' && f && <SheetFoot className="grid grid-cols-2 gap-2">
      <button onClick={() => void guardar(true)} disabled={leyendo} className={`${BTN_S} h-14`}><Icon n="add" className="ico-20" />Guardar y añadir otro</button>
      <button onClick={() => void guardar(false)} disabled={leyendo} className={`${BTN_P} h-14`}><Icon n="save" className="ico-20" />Guardar</button></SheetFoot>}
  </>);
}

function Ficha({ f, setF, admin, fotoUrl, nota, leyendo, releer }: { f: FormAlta; setF: (f: FormAlta) => void; admin: boolean; fotoUrl: string; nota: string; leyendo: boolean; releer?: () => void }) {
  const E = useAlmacen();
  const set = (k: keyof FormAlta) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const similares = useMemo(() => (f.tipo === 'herramienta' ? [] : parecidos(E, f.name)), [E, f.name, f.tipo]);
  const conContenido = f.unit !== 'm' && f.unit !== 'ud';
  const inp = (k: keyof FormAlta, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}, className = '') =>
    <Campo label={label} className={className}><input value={String(f[k])} onChange={set(k)} className={`${INP} h-12`} {...extra} /></Campo>;
  const cambiaTipo = (t: TipoAlta) => setF({ ...f, tipo: t, cat: t === 'ropa' ? 'ropa' : t === 'epi' ? 'epis' : f.cat === 'ropa' || f.cat === 'epis' ? 'fijaciones' : f.cat });
  return (<>
    <div className="flex gap-3 items-start">
      {fotoUrl ? <img src={fotoUrl} alt="Foto del artículo" className="w-24 h-24 rounded-xl object-cover shrink-0" /> : <div className="w-24 h-24 rounded-xl bg-surface-container-low grid place-items-center shrink-0"><Icon n="no_photography" className="text-secondary" /></div>}
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        {nota && <p className={`text-body-sm rounded-lg p-2 ${/no ha podido|Sin conexión|no está disponible/.test(nota) ? 'bg-amber-100 text-amber-900' : 'bg-primary-fixed/40'}`}>{nota}</p>}
        {releer && <button onClick={releer} disabled={leyendo} className={`${BTN_S} h-11 px-3 self-start`}><Icon n="auto_awesome" className="ico-20" />{leyendo ? 'Leyendo…' : 'Leer con IA'}</button>}
      </div>
    </div>
    <div className="grid grid-cols-4 bg-surface-container-low rounded-xl p-1">{TIPOS.map(x =>
      <button key={x.t} onClick={() => cambiaTipo(x.t)} disabled={x.t === 'herramienta' && !admin} title={x.t === 'herramienta' && !admin ? 'Las herramientas las da de alta el administrador' : undefined}
        className={`h-12 rounded-lg text-body-sm font-semibold flex items-center justify-center gap-1 disabled:opacity-40 ${f.tipo === x.t ? 'bg-white shadow-sm text-primary' : 'text-on-surface-variant'}`}><Icon n={x.icon} className="ico-20 hidden sm:inline" />{x.label}</button>)}</div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {inp('name', 'Nombre *', { autoFocus: !f.name, placeholder: 'Lo que pone en el envase' }, 'sm:col-span-2')}
      {similares.length > 0 && <div className="sm:col-span-2 rounded-xl bg-amber-50 ring-1 ring-amber-200 p-3 flex flex-col gap-2">
        <span className="text-body-sm font-semibold text-amber-900">¿Es alguno de estos?</span>
        {similares.map(p => <button key={p.sku} onClick={() => { closeModal(); abrirFicha(p.sku); }} className="flex items-center gap-3 text-left rounded-lg bg-white p-2 min-h-12">
          <Tile p={p} size="w-10 h-10" /><span className="flex-1 min-w-0"><span className="block font-medium truncate">{p.name}</span><span className="font-mono text-label-sm text-secondary">{p.sku} · {qtyTxt(p, p.stock)}</span></span><Icon n="chevron_right" className="text-secondary" /></button>)}
      </div>}
      {f.tipo === 'herramienta' ? <>
        {inp('marca', 'Marca')}{inp('modelo', 'Modelo')}{inp('serie', 'N.º de serie o lote')}
        <p className="sm:col-span-2 text-body-sm text-secondary">Se crea su ficha de dotación (operativa, sin asignar). La foto no se guarda en la ficha: las herramientas muestran la del catálogo por modelo.</p>
      </> : <>
        <Campo label="Categoría"><select value={f.cat} onChange={set('cat')} className={`${INP} h-12`}>{categoriasActivas().map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select></Campo>
        <Campo label="Se vende y se entrega por"><select value={f.unit} onChange={e => setF({ ...f, unit: e.target.value as Unidad, contenido: e.target.value === 'm' || e.target.value === 'ud' ? '1' : f.contenido })} className={`${INP} h-12`}>
          {UNIDADES.map(u => <option key={u} value={u}>{u === 'm' ? 'Metros' : u === 'ud' ? 'Unidades' : unidadTxt(u, 2).replace(/^./, c => c.toUpperCase())}</option>)}</select></Campo>
        {conContenido && inp('contenido', `Unidades por ${UNIT[f.unit]}`, { inputMode: 'numeric' })}
        {inp('stock', `Stock inicial en el almacén (${unidadTxt(f.unit, 2)})`, { inputMode: 'decimal' })}
        {admin && inp('min', 'Mínimo (vacío = después)', { inputMode: 'decimal' })}
        {(f.tipo === 'ropa' || f.tipo === 'epi') && <>{inp('modelo', 'Modelo (agrupa las tallas)', { placeholder: f.name })}{inp('talla', 'Talla')}</>}
        <Campo label="Propiedad"><select value={f.propiedad} onChange={set('propiedad')} className={`${INP} h-12`}><option value="propia">Material propio</option><option value="custodia">En custodia (no es nuestro)</option></select></Campo>
        {f.propiedad === 'custodia' && <Campo label="Socio de custodia"><SelectorSocio value={f.propietario} onChange={v => setF({ ...f, propietario: v })} /></Campo>}
        <details className="sm:col-span-2 rounded-xl bg-surface-container-low p-3"><summary className={`${LBL} cursor-pointer`}>Códigos y proveedor</summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            {inp('sku', admin ? 'SKU (código propio)' : 'SKU (lo revisa el administrador)', { className: `${INP} h-12 font-mono` })}
            {inp('ean', 'EAN / código de barras', { inputMode: 'numeric' })}
            {inp('supplierRef', 'Código del proveedor')}
            {inp('supplier', 'Proveedor')}
          </div></details>
      </>}
    </div>
  </>);
}

