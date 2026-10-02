/* E-020 · Códigos alternativos: "Es un artículo que ya tengo" (buscador con fotos) y la sección "Códigos" de la ficha */
import { useState } from 'react';
import { codigosDe, tipoCodigo } from '../../domain/codigos';
import { qtyTxt } from '../../domain/reglas';
import { ejecutar, useAlmacen } from '../../store/almacen';
import { closeModal, openModal, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_S, Icon, INP, LBL, Pill, Tile, Vacio } from '../../ui/base';
import { OrdenArticulos, useListaArticulos } from '../../ui/selectorArticulo';
import { useCamara } from '../escaner/camara';

/** Asocia un código ya leído a un artículo existente (o lo intenta y avisa) */
export function asociarCodigo(codigo: string, sku: string, formato = '', aviso = true): boolean {
  const ok = ejecutar({ op: 'asociarCodigo', args: { codigo: codigo.trim(), sku, tipo: tipoCodigo(codigo.trim(), formato) } });
  if (ok && aviso) toast(`Código ${codigo.trim()} guardado: el siguiente escaneo abrirá este artículo.`, 'ok', 6000);
  return ok;
}

/** "Es un artículo que ya tengo": buscador con fotos; al elegir, el código leído queda como código alternativo */
export const abrirAsociarCodigo = (codigo: string, formato = '', onHecho?: (sku: string) => void) => openModal(<AsociarCodigo codigo={codigo} formato={formato} onHecho={onHecho} />);
function AsociarCodigo({ codigo, formato, onHecho }: { codigo: string; formato: string; onHecho?: (sku: string) => void }) {
  const [q, setQ] = useState('');
  const { lista } = useListaArticulos(q, { borradores: true, max: 60 });          // E-024: A-Z o por referencia
  const elegir = (sku: string) => { if (asociarCodigo(codigo, sku, formato)) { closeModal(); onHecho?.(sku); } };
  return (<>
    <SheetHead title="¿Qué artículo es?" sub={`El código ${codigo} quedará guardado en el artículo que elijas.`} />
    <div className="p-5 flex flex-col gap-3">
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} type="search" className={`${INP} h-12`} placeholder="Busca por nombre o código" />
      <OrdenArticulos agrupar={false} />
      <div className="flex flex-col">{lista.length ? lista.map(p =>
        <button key={p.sku} onClick={() => elegir(p.sku)} className="flex items-center gap-3 py-2.5 border-b border-surface-container text-left min-h-14"><Tile p={p} size="w-14 h-14" />
          <div className="flex-1 min-w-0"><div className="font-medium">{p.name}</div><div className="font-mono text-label-sm text-secondary">{p.sku} · almacén {qtyTxt(p, p.stock)}</div></div><Pill p={p} short /></button>) : <Vacio>Sin resultados.</Vacio>}</div>
    </div>
  </>);
}

/** Sección "Códigos" de la ficha: lista, añadir (escaneando o escribiéndolo) y quitar (administrador) */
export function CodigosFicha({ sku }: { sku: string }) {
  const E = useAlmacen(), lista = codigosDe(E, sku);
  return (
    <div><div className="flex items-center justify-between"><div className={LBL}>Códigos alternativos (EAN del fabricante…)</div>
      <button onClick={() => abrirAnadirCodigo(sku)} className="text-primary text-body-sm font-semibold h-10 inline-flex items-center gap-1"><Icon n="barcode_scanner" className="ico-20" />Añadir</button></div>
      {lista.length ? <ul className="flex flex-col">{lista.map(c => <li key={c.codigo} className="flex items-center justify-between gap-2 py-1.5 border-b border-surface-container">
        <span className="min-w-0"><span className="font-mono text-body-md break-all">{c.codigo}</span> <span className="text-label-sm text-secondary">{c.tipo} · {c.operator}</span></span>
        {E.rol === 'admin' && <button onClick={() => { if (confirm(`¿Quitar el código ${c.codigo} de este artículo?`)) ejecutar({ op: 'quitarCodigo', args: { codigo: c.codigo } }); }} className="text-error text-body-sm h-10 px-2" aria-label={`Quitar ${c.codigo}`}>Quitar</button>}</li>)}</ul>
        : <p className="text-body-sm text-secondary">Ninguno. Si la caja trae otro código (el EAN del fabricante), añádelo y el escáner la reconocerá.</p>}
    </div>
  );
}

export const abrirAnadirCodigo = (sku: string) => openModal(<AnadirCodigo sku={sku} />);
function AnadirCodigo({ sku }: { sku: string }) {
  const E = useAlmacen(), p = E.products.find(x => x.sku === sku);
  const [manual, setManual] = useState('');
  const guardar = (c: string, formato = '') => { if (c.trim() && asociarCodigo(c, sku, formato)) closeModal(); };
  const cam = useCamara(true, (c, f) => guardar(c, f), { pausarConModal: false });
  return (<>
    <SheetHead title="Añadir código" sub={p?.name} />
    <div className="p-5 flex flex-col gap-3">
      <div className="cam h-56 rounded-xl"><div className="cam-fondo" /><video ref={cam.video} playsInline muted autoPlay />{cam.estado.on && <div className="laser" />}
        {cam.estado.aviso && <p className="absolute bottom-3 inset-x-3 rounded-lg bg-black/60 text-white text-body-sm p-2">{cam.estado.aviso}</p>}</div>
      {cam.estado.msg && <p className="text-body-sm text-secondary">{cam.estado.msg}</p>}
      <div className="flex gap-2"><input value={manual} onChange={e => setManual(e.target.value)} className={`${INP} h-12 flex-1`} placeholder="O escríbelo" aria-label="Código" />
        <button onClick={() => guardar(manual)} className={`${BTN_S} h-12 px-4`}>Guardar</button></div>
    </div>
  </>);
}
