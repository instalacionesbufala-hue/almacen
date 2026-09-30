/* E-014 · Portal del técnico: página de solo lectura que se abre con su enlace personal (#/tecnico/<token>), sin usuario ni contraseña.
   En la nube la sirve la función "portal-tecnico" (valida el token por su hash); en la demostración se calcula en este navegador. */
import { useEffect, useState } from 'react';
import { MARCA } from '../../data/catalogo';
import type { Unidad } from '../../data/tipos';
import { num, redondea } from '../../domain/formato';
import { unidadTxt } from '../../domain/reglas';
import { datosPortalLocal, hashToken, type DatosPortal } from '../../domain/portal';
import { S } from '../../store/almacen';
import { claveAnon, modoNube, urlSupabase } from '../../store/nube/cliente';
import { Icon } from '../../ui/base';

const URL_PORTAL = modoNube ? `${urlSupabase}/functions/v1/portal-tecnico` : '';
async function pedir(cuerpo: Record<string, string>) {
  const r = await fetch(URL_PORTAL, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: claveAnon }, body: JSON.stringify(cuerpo) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'No se ha podido abrir el portal');
  return d;
}

const cantidad = (q: number, u: string) => `${num(q)} ${unidadTxt(u as Unidad, q)}`;
const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

export default function PortalTecnico({ token }: { token: string }) {
  const [d, setD] = useState<DatosPortal | null>(null);
  const [error, setError] = useState('');
  const [pdf, setPdf] = useState('');
  useEffect(() => {
    const antes = document.title;
    document.title = `Mis entregas · ${MARCA.nombre}`;
    (async () => {
      try {
        if (modoNube) setD(await pedir({ token }));
        else {
          const h = await hashToken(token), e = S().portalEnlaces.find(x => x.hash === h && !x.revocado);
          const datos = e ? datosPortalLocal(S(), e.tecnico) : null;
          if (!datos) throw new Error('Este enlace ya no es válido. Pide uno nuevo en el almacén.');
          setD(datos);
        }
      } catch (x) { setError((x as Error).message); }
    })();
    return () => { document.title = antes; };
  }, [token]);

  const verPdf = async (id: string) => {
    setPdf(id);
    try {
      if (modoNube) { const { url } = await pedir({ token, pdf: id }); location.href = url; }
      else { const e = S().entregas.find(x => x.id === id); if (e) await (await import('../entregas/justificante')).descargarJustificante(e); }
    } catch (x) { setError((x as Error).message); } finally { setPdf(''); }
  };

  return (
    <div className="min-h-dvh bg-background">
      <header className="bg-primary text-white px-4 py-4"><div className="max-w-2xl mx-auto flex items-center gap-3">
        <span className="w-10 h-10 rounded-lg bg-white/15 grid place-items-center"><Icon n="bolt" /></span>
        <div className="min-w-0"><div className="font-bold">{MARCA.nombre}</div><div className="text-body-sm text-white/80 truncate">{d ? `${d.tecnico.nombre}${d.tecnico.equipo ? ` · ${d.tecnico.equipo}` : ''}` : 'Portal del técnico'}</div></div>
      </div></header>
      <main className="max-w-2xl mx-auto p-4 flex flex-col gap-4">
        {error && <div className="rounded-xl bg-error-container text-error p-4 flex gap-2"><Icon n="link_off" />{error}</div>}
        {!d && !error && <p className="text-secondary text-center py-10">Cargando…</p>}
        {d && <>
          <section className="bg-surface-container-lowest rounded-xl shadow-sm p-4 flex flex-col gap-2">
            <h2 className="text-headline-sm font-semibold flex items-center gap-2"><Icon n="local_shipping" className="text-primary" />{d.vehiculo ? `Lo que lleva tu vehículo · ${d.vehiculo.matricula}` : 'Vehículo'}</h2>
            {!d.vehiculo ? <p className="text-body-sm text-secondary">Tu equipo no tiene vehículo asignado ahora mismo.</p>
              : !d.a_bordo.length ? <p className="text-body-sm text-secondary">No consta material a bordo.</p>
                : d.a_bordo.map(a => { const f = redondea(a.unidades / (a.contenido || 1)); return (
                  <div key={a.sku} className="flex items-center gap-3 py-2 border-b border-surface-container last:border-0">
                    {a.foto ? <img src={a.foto} alt="" className="w-12 h-12 rounded-lg object-cover" /> : <span className="w-12 h-12 rounded-lg bg-surface-container-low grid place-items-center"><Icon n="inventory_2" className="text-secondary" /></span>}
                    <span className="flex-1 min-w-0"><span className="block font-medium leading-snug">{a.nombre}</span><span className="font-mono text-label-sm text-secondary">{a.sku}</span></span>
                    <b className={`whitespace-nowrap ${a.unidades < 0 ? 'text-error' : ''}`}>{cantidad(f, a.unidad)}{a.contenido > 1 ? <span className="block text-label-sm text-secondary font-normal text-right">{num(a.unidades)} ud</span> : null}</b>
                  </div>); })}
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="text-headline-sm font-semibold flex items-center gap-2 px-1"><Icon n="draw" className="text-primary" />Entregas a tu equipo ({d.entregas.length})</h2>
            {!d.entregas.length && <p className="text-body-sm text-secondary px-1">Todavía no hay entregas firmadas.</p>}
            {d.entregas.map(e => (
              <article key={e.id} className="bg-surface-container-lowest rounded-xl shadow-sm p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2"><div><div className="font-semibold">{e.numero}</div>
                  <div className="text-body-sm text-secondary">{fecha(e.fecha)}{e.equipo ? ` · ${e.equipo}` : ''}{e.vehiculo ? ` · ${e.vehiculo}` : ''}{e.obra ? ` · ${e.obra}` : ''}{e.recoge ? ` · recogió ${e.recoge}` : ''}</div></div>
                  <button onClick={() => void verPdf(e.id)} disabled={!!pdf} className="h-12 px-4 rounded-xl bg-primary text-white font-semibold inline-flex items-center gap-2 shrink-0 disabled:opacity-50"><Icon n="picture_as_pdf" className="ico-20" />{pdf === e.id ? 'Abriendo…' : 'PDF'}</button></div>
                <ul>{e.lineas.map((l, i) => <li key={i} className="flex items-center gap-3 py-1.5 border-t border-surface-container">
                  {l.foto ? <img src={l.foto} alt="" className="w-10 h-10 rounded-lg object-cover" /> : <span className="w-10 h-10 rounded-lg bg-surface-container-low grid place-items-center"><Icon n="inventory_2" className="ico-20 text-secondary" /></span>}
                  <span className="flex-1 min-w-0 text-body-md leading-snug">{l.nombre}</span><b className="whitespace-nowrap">{cantidad(Number(l.cantidad), l.unidad)}</b></li>)}</ul>
              </article>))}
          </section>
          <p className="text-label-sm text-secondary text-center pb-6">Solo lectura. Este enlace es personal: no lo compartas. Si lo pierdes, pide uno nuevo en el almacén.</p>
        </>}
      </main>
    </div>
  );
}
