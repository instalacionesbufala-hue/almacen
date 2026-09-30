/* E-006 · Bandeja "Reposición": avisos agrupados por proveedor y, para la custodia (E-008), por propietario.
   Genera el borrador del pedido o de la solicitud a Esmove (sin importes): copiar, PDF o correo. */
import { useState } from 'react';
import { fechaHora, hoyISO, num } from '../../domain/formato';
import { episARenovar, gruposReposicion, textoBorrador, type GrupoReposicion } from '../../domain/custodia';
import { caducidad } from '../../domain/herramientas';
import { critical } from '../../domain/reglas';
import { descargarCsv } from '../../domain/csv';
import { ejecutar, useAlmacen } from '../../store/almacen';
import { usePermisos } from '../../store/permisos';
import { modoNube } from '../../store/nube/cliente';
import { procesarAhora } from '../../store/nube/avisos';
import { openModal, SheetHead } from '../../ui/modal';
import { toast } from '../../ui/toast';
import { BTN_P, BTN_S, BTN_T, Icon, INP, Tag, Vacio } from '../../ui/base';
import { abrirMinimos } from './Minimos';
import { FotoLinea } from '../../ui/foto';

/** Contador de la campana: avisos abiertos (en tiempo real con Supabase) + EPIs por renovar */
export function useContadorAvisos() {
  const E = useAlmacen();
  const grupos = gruposReposicion(E);
  return grupos.reduce((a, g) => a + g.lineas.filter(l => l.estado === 'abierto').length, 0) + episARenovar(E).length + (grupos.length ? 0 : critical(E).length);
}

export const abrirReposicion = () => openModal(<Reposicion />, { ancha: true });
function Reposicion() {
  const E = useAlmacen(), perm = usePermisos(), grupos = gruposReposicion(E), epis = episARenovar(E);
  return (<>
    <SheetHead title="Reposición" sub={`${grupos.reduce((a, g) => a + g.lineas.length, 0)} artículos bajo mínimo · ${epis.length} EPIs por renovar. El aviso nace solo al bajar del mínimo y se cierra al reponer.`} />
    <div className="p-5 flex flex-col gap-4">
      {perm.editarCatalogo && <button onClick={() => abrirMinimos()} className={`${BTN_T} self-start px-4 h-11`}><Icon n="tune" className="ico-20" />Mínimos y objetivos</button>}
      {grupos.length ? grupos.map(g => <Grupo key={g.destino + g.grupo} g={g} admin={perm.admin} />) : <Vacio>Nada bajo mínimo. Todo el stock está repuesto.</Vacio>}
      {epis.length > 0 && <section className="rounded-xl bg-amber-50 p-4 flex flex-col gap-2">
        <h3 className="font-semibold flex items-center gap-2"><Icon n="health_and_safety" className="text-amber-800" />EPIs que caducan o hay que revisar (30 días)</h3>
        {epis.map(h => { const c = caducidad(h); return <div key={h.id} className="flex justify-between gap-2 text-body-sm border-b border-amber-100 py-1.5">
          <span className="truncate">{h.nombre}{h.talla ? ` · talla ${h.talla}` : ''} · {E.tecnicos.find(t => t.id === h.tecnico)?.nombre || E.equipos.find(e => e.id === h.equipo)?.nombre || 'almacén'}</span>
          <Tag c={c.estado === 'vencido' ? 'bg-error-container text-error' : 'bg-amber-100 text-amber-800'}>{c.estado === 'vencido' ? `vencido hace ${-c.dias} d` : `vence en ${c.dias} d`}</Tag></div>; })}
      </section>}
    </div>
  </>);
}

function Grupo({ g, admin }: { g: GrupoReposicion; admin: boolean }) {
  const E = useAlmacen(), custodia = g.destino === 'propietario';
  const [cant, setCant] = useState<Record<string, string>>({});
  const clave = (l: GrupoReposicion['lineas'][0]) => l.sku || 'h:' + l.modelo;
  const qty = (l: GrupoReposicion['lineas'][0]) => Number(cant[clave(l)] ?? l.pedida ?? l.sugerida) || 0;
  const conCantidades = { ...g, lineas: g.lineas.map(l => ({ ...l, pedida: qty(l) })) };
  const texto = textoBorrador(conCantidades);
  const propietario = custodia ? E.propietarios.find(o => o.id === g.grupo) : undefined;
  const destinatarios = propietario?.correosReposicion || [];

  const copiar = async () => { try { await navigator.clipboard.writeText(texto); toast('Borrador copiado.', 'ok'); } catch { toast('No se ha podido copiar: selecciónalo a mano.', 'warn'); } };
  const pdf = () => {
    const w = window.open('', '_blank', 'width=720,height=900'); if (!w) return toast('El navegador ha bloqueado la ventana.', 'warn');
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(g.titulo)}</title><body style="font-family:system-ui;padding:32px;color:#0b1c30">
      <h2>${esc(g.titulo)}</h2><p style="color:#565e74">Almacén Búfala · ${esc(fechaHora(Date.now()))}</p>
      <table style="border-collapse:collapse;width:100%"><tr>${['Código', 'Artículo', 'Stock actual', 'Mínimo', 'Cantidad'].map(c => `<th style="text-align:left;border-bottom:1px solid #999;padding:6px">${c}</th>`).join('')}</tr>
      ${conCantidades.lineas.map(l => `<tr><td style="padding:6px;border-bottom:1px solid #ddd">${esc(l.codigo)}</td><td style="padding:6px;border-bottom:1px solid #ddd">${esc(l.nombre)}</td><td style="padding:6px;border-bottom:1px solid #ddd">${esc(num(l.stock))} ${esc(l.unidad)}</td><td style="padding:6px;border-bottom:1px solid #ddd">${esc(num(l.minimo))}</td><td style="padding:6px;border-bottom:1px solid #ddd"><b>${esc(num(l.pedida || 0))} ${esc(l.unidad)}</b></td></tr>`).join('')}
      </table><script>setTimeout(()=>print(),300)<\/script>`);
    w.document.close();
  };
  const csv = () => descargarCsv(`${custodia ? 'solicitud' : 'pedido'}-${g.grupo.replace(/\W+/g, '-')}-${hoyISO()}.csv`, [['Código', 'Artículo', 'Stock actual', 'Mínimo', 'Cantidad', 'Unidad'], ...conCantidades.lineas.map(l => [l.codigo, l.nombre, l.stock, l.minimo, l.pedida || 0, l.unidad])]);
  const correo = async () => {
    if (modoNube && E.configAvisos.correoActivo && (custodia ? destinatarios.length : true)) {
      if (!ejecutar({ op: 'envio', args: { canal: 'correo', tipo: 'solicitud', asunto: g.titulo, cuerpo: texto, destinatarios: custodia ? destinatarios : [] } })) return;
      await procesarAhora(); toast(custodia ? `Solicitud enviada a ${propietario?.nombre}.` : 'Pedido enviado por correo.', 'ok');
    } else {
      location.href = `mailto:${encodeURIComponent(destinatarios.join(','))}?subject=${encodeURIComponent(g.titulo)}&body=${encodeURIComponent(texto)}`;
    }
  };
  const marcar = () => {
    let n = 0;
    for (const l of g.lineas) {
      if (l.estado === 'pedido') continue;
      const ok = l.sku ? ejecutar({ op: 'pedido', args: { sku: l.sku, qty: qty(l), proveedor: custodia ? propietario?.nombre : g.grupo } }) : ejecutar({ op: 'pedidoHerramienta', args: { modelo: l.modelo!, qty: qty(l), proveedor: g.grupo } });
      if (ok) n++;
    }
    if (n) toast(`${n} línea${n === 1 ? '' : 's'} marcada${n === 1 ? '' : 's'} como pedida${n === 1 ? '' : 's'}. Si no llega en ${E.configAvisos.diasRecordatorio} días, se vuelve a avisar.`, 'ok', 6000);
  };
  return (
    <section className={`rounded-xl p-4 flex flex-col gap-3 ${custodia ? 'bg-violet-50' : 'bg-surface-container-low'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold flex items-center gap-2"><Icon n={custodia ? 'handshake' : 'local_shipping'} className={custodia ? 'text-violet-800' : 'text-primary'} />{g.titulo}</h3>
        {custodia ? <Tag c="bg-violet-100 text-violet-800">Sin importes · envío {E.configAvisos.custodiaEnvio === 'automatico' ? 'automático' : 'revisado por el administrador'}</Tag>
          : null}
      </div>
      <div className="flex flex-col">{g.lineas.map(l => (
        <div key={clave(l)} className="flex flex-wrap items-center gap-3 py-2 border-b border-white/70">
          <FotoLinea sku={l.sku} modelo={l.modelo} /><div className="flex-1 min-w-[180px]"><div className="font-medium">{l.nombre}</div><div className="font-mono text-label-sm text-secondary">{l.codigo || l.sku || ''} · stock {num(l.stock)} {l.unidad} · mín. {num(l.minimo)}</div></div>
          {l.estado === 'pedido' ? <Tag c="bg-amber-100 text-amber-800">Pedido: {num(l.pedida || 0)} {l.unidad}</Tag>
            : admin ? <label className="flex items-center gap-2 text-body-sm">Pedir<input value={cant[clave(l)] ?? String(l.sugerida)} onChange={e => setCant({ ...cant, [clave(l)]: e.target.value })} inputMode="decimal" className={`${INP} !w-24 h-10 text-center font-mono`} aria-label={`Cantidad a pedir de ${l.nombre}`} />{l.unidad}</label>
              : <span className="font-mono text-label-sm text-secondary">Sugerido {num(l.sugerida)} {l.unidad}</span>}
        </div>))}</div>
      {admin ? <div className="flex flex-wrap gap-2">
        <button onClick={() => void correo()} className={`${BTN_P} h-11 px-4`}><Icon n="send" className="ico-20" />{custodia ? `Enviar a ${propietario?.nombre || 'propietario'}` : 'Enviar por correo'}</button>
        <button onClick={copiar} className={`${BTN_S} h-11 px-4`}><Icon n="content_copy" className="ico-20" />Copiar</button>
        <button onClick={pdf} className={`${BTN_S} h-11 px-4`}><Icon n="picture_as_pdf" className="ico-20" />PDF</button>
        <button onClick={csv} className={`${BTN_S} h-11 px-4`}><Icon n="table" className="ico-20" />CSV</button>
        {g.lineas.some(l => l.estado !== 'pedido') && <button onClick={marcar} className={`${BTN_T} h-11 px-4`}><Icon n="check" className="ico-20" />Marcar como pedido</button>}
      </div> : <p className="text-body-sm text-secondary">El administrador revisa y hace el pedido.</p>}
      {custodia && admin && !destinatarios.length && <p className="text-body-sm text-violet-800">Falta el correo de reposición de {propietario?.nombre}: añádelo en Custodia → Datos del propietario.</p>}
    </section>
  );
}
