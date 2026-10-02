/* Configuración y auditoría: operario, semáforo, IA, integridad y copias de seguridad */
import { useRef, type ReactNode } from 'react';
import { MARCA } from '../../data/catalogo';
import { hashEntrega } from '../../domain/hash';
import { hoyISO } from '../../domain/formato';
import { descargar } from '../../domain/csv';
import { exportarCopia, reemplazar, restaurarDemo, tamañoGuardado, useAlmacen } from '../../store/almacen';
import { setUI } from '../../store/ui';
import { toast } from '../../ui/toast';
import { Avatar, BTN_BASE, BTN_P, BTN_S, CARD, Icon } from '../../ui/base';
import { usePermisos } from '../../store/permisos';
import { Usuarios } from './Usuarios';
import { abrirPendientes } from '../shell/Pendientes';
import { ConfigAvisosPanel } from './Avisos';
import { abrirMinimos } from '../reposicion/Minimos';
import { abrirReposicion } from '../reposicion/Reposicion';
import { abrirPerfil } from '../inventario/hojas';
import { exportarMovimientosCsv, exportarStockCsv } from '../inventario/StockView';
import { AVISO_GEMINI, iaReal, URL_IA } from '../albaranes/lector';
import { modoNube, urlSupabase } from '../../store/nube/cliente';
import { verificarEntregasServidor } from '../../store/nube/sync';
import { numEntrega } from '../../domain/reglas';
import { abrirImportarFotos } from '../fotos/ImportarFotos';
import { DatosReales } from './Datos';
import { Categorias } from './Categorias';
import { Socios } from './Socios';
import { Archivados } from '../inventario/archivo';
import { Integraciones } from '../cierres/Integraciones';

const Bloque = ({ icon, t, children }: { icon: string; t: string; children: ReactNode }) =>
  <section className={`${CARD} p-4 lg:p-space-md flex flex-col gap-3`}><h2 className="text-headline-sm font-semibold flex items-center gap-2"><Icon n={icon} className="text-primary" />{t}</h2>{children}</section>;

export default function ConfigView() {
  const E = useAlmacen(), archivo = useRef<HTMLInputElement>(null), perm = usePermisos();
  const nPend = E.pendientes.filter(p => p.estado === 'pendiente' || p.estado === 'aplicada').length;
  const verificar = async () => { let ok = 0; const bad: string[] = [];
    if (modoNube) { const r = await verificarEntregasServidor(); if (!r) return; r.forEach(x => x.ok ? ok++ : bad.push(x.numero)); }
    else for (const x of E.entregas) (await hashEntrega(x)) === x.hash ? ok++ : bad.push(numEntrega(x)); bad.length ? toast(`${bad.length} entrega(s) no coinciden con su huella: ${bad.join(', ')}.`, 'err', 8000) : toast(`Las ${ok} entregas coinciden con su huella SHA-256.`, 'ok'); };
  const importar = async (f?: File) => {
    if (!f) return;
    try { const s = JSON.parse(await f.text()); if (!s || !Array.isArray(s.products)) throw new Error(); reemplazar(s); toast('Copia importada.', 'ok'); }
    catch { toast('Ese archivo no es una copia válida de la app.', 'err'); }
  };
  const reset = async () => {
    if (!confirm('¿Restaurar los datos de prueba? Se perderán los cambios hechos en este navegador (exporta una copia antes si los necesitas).')) return;
    await restaurarDemo(); setUI({ almacen: 'central' }); toast('Datos de prueba restaurados.', 'ok');
  };
  return (
    <div className="px-4 lg:px-gutter py-4 lg:py-space-lg flex flex-col gap-4 max-w-5xl">
      <div><span className="font-mono text-label-sm uppercase tracking-wider text-secondary">Sistema</span><h1 className="text-headline-lg-mobile lg:text-headline-lg font-bold">Configuración &amp; auditoría</h1></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {perm.configurar && <div className="lg:col-span-2"><Bloque icon="swap_horiz" t="Pasar a datos reales"><DatosReales /></Bloque></div>}
        {perm.configurar && <Bloque icon="inventory_2" t="Archivados"><p className="text-body-sm text-secondary">Referencias fusionadas en otra o retiradas. No salen en listas, buscador, escáner ni entregas; el historial las conserva. Su código se puede reutilizar (al usarlo, se reactiva).</p><Archivados /></Bloque>}
        {perm.admin && <Bloque icon="handshake" t="Socios de custodia"><p className="text-body-sm text-secondary">Empresas que dejan material en el almacén (Esmove, Instant Box…). Cada artículo en custodia es de un socio; sus informes, solicitudes y actas van por separado. Un socio con artículos no se desactiva.</p><Socios /></Bloque>}
        {perm.configurar && <Bloque icon="category" t="Categorías"><p className="text-body-sm text-secondary">Las del inventario, los filtros y la lectura con IA. Una con artículos no se borra: se desactiva moviéndolos a otra.</p><Categorias /></Bloque>}
        {perm.configurar && <div className="lg:col-span-2"><Bloque icon="hub" t="Integraciones y cierres del wizard"><Integraciones /></Bloque></div>}
        {modoNube && perm.configurar && <div className="lg:col-span-2"><Bloque icon="group" t="Usuarios"><p className="text-body-sm text-secondary">Almacén: operativa diaria; sus mermas se aplican al momento y te llega el aviso, y sus recuentos quedan pendientes de validar. Administrador: todo. Al desactivar a alguien deja de poder entrar y su historial se conserva.</p><Usuarios /></Bloque></div>}
        {perm.validar && <Bloque icon="pending_actions" t="Pendientes de validar"><p className="text-body-sm text-secondary">{nPend ? `Hay ${nPend} pendiente${nPend === 1 ? '' : 's'} de validar.` : 'No hay nada pendiente.'}</p><button onClick={abrirPendientes} className={`${BTN_S} h-12`}><Icon n="pending_actions" className="ico-20" />Abrir la bandeja</button></Bloque>}
        <Bloque icon="person" t={modoNube ? 'Mi usuario' : 'Operario activo'}><p className="text-body-sm text-secondary">Cada entrada, salida, merma e incidencia queda a su nombre.</p>
          <button onClick={abrirPerfil} className="flex items-center gap-3 bg-surface-container-low rounded-xl p-3 text-left"><Avatar n={E.operator} /><span className="flex-1 font-semibold">{E.operator}</span><span className="text-primary text-body-sm">Cambiar</span></button></Bloque>
        {perm.configurar && <div className="lg:col-span-2"><Bloque icon="notifications" t="Avisos de reposición"><div className="flex flex-wrap gap-2"><button onClick={abrirReposicion} className={`${BTN_S} h-11 px-4`}><Icon n="inventory" className="ico-20" />Bandeja de reposición</button><button onClick={() => abrirMinimos()} className={`${BTN_S} h-11 px-4`}><Icon n="tune" className="ico-20" />Mínimos y objetivos</button></div><ConfigAvisosPanel /></Bloque></div>}
        <Bloque icon="traffic" t="Semáforo de stock">
          <ul className="text-body-sm flex flex-col gap-2">
            <li className="flex gap-2"><span className="w-3 h-3 mt-1 rounded-full bg-error shrink-0" /><span><b>Rojo</b>: stock del almacén por debajo del mínimo (p. ej. menos de 2 cajas de tacos o de 2 cargadores). Salta un aviso al instante.</span></li>
            <li className="flex gap-2"><span className="w-3 h-3 mt-1 rounded-full bg-amber-400 shrink-0" /><span><b>Amarillo</b>: por debajo de 1,5 × el mínimo.</span></li>
            <li className="flex gap-2"><span className="w-3 h-3 mt-1 rounded-full bg-tertiary-container shrink-0" /><span><b>Verde</b>: nivel correcto.</span></li></ul>
          <p className="text-body-sm text-secondary">El mínimo se edita en la ficha de cada referencia.</p></Bloque>
        <Bloque icon="auto_awesome" t="Lectura de albaranes con IA">
          <p className="text-body-sm">Estado: <b>{iaReal() ? 'IA conectada' : 'modo simulado'}</b>{iaReal() && <span className="font-mono text-label-sm text-secondary break-all"> · {URL_IA}</span>}</p>
          <p className="text-body-sm text-secondary">La lectura real usa Gemini (capa gratuita) desde una función del servidor, para que la clave nunca esté en el navegador. Mientras no esté configurada, se usan albaranes de ejemplo.</p>
          <p className="text-body-sm text-amber-800">{AVISO_GEMINI}</p></Bloque>
        {perm.configurar && <Bloque icon="photo_library" t="Fotos de los artículos">
          <p className="text-body-sm text-secondary">{modoNube ? 'Se guardan en un espacio privado de Supabase: solo se ven con sesión iniciada, nunca en la web pública.' : 'Demostración: las fotos se quedan en este navegador y no se suben a ningún sitio.'} El almacén puede poner foto a un artículo que no tiene; sustituirla o quitarla es solo tuyo.</p>
          <p className="text-body-sm text-secondary">{E.products.filter(p => p.foto).length} de {E.products.length} artículos con foto.</p>
          <button onClick={abrirImportarFotos} className={`${BTN_S} h-12`}><Icon n="add_photo_alternate" className="ico-20" />Importar fotos por lote</button></Bloque>}
        <Bloque icon="fact_check" t="Integridad de entregas">
          <p className="text-body-sm text-secondary">Cada entrega firmada guarda una huella SHA-256 de su contenido y de la firma. Si alguien la modifica, la huella deja de coincidir.</p>
          <button onClick={verificar} className={`${BTN_S} h-12`}><Icon n="verified" className="ico-20" />Verificar {E.entregas.length} entregas</button></Bloque>
        {perm.configurar && <Bloque icon="database" t="Datos y copias de seguridad">
          <p className="text-body-sm text-secondary">{modoNube ? <>Los datos están en la nube (Supabase{urlSupabase ? ': ' + new URL(urlSupabase).host : ''}) y se copian cada semana fuera del repositorio. Aquí puedes descargar una copia o los listados.</> : <>Modo demostración: los datos viven en este navegador ({(tamañoGuardado() / 1024).toFixed(0)} KB). Haz copias a menudo: si se borran los datos del navegador, se pierden.</>}</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => descargar(`almacen-copia-${hoyISO()}.json`, exportarCopia(), 'application/json')} className={`${BTN_P} h-12`}><Icon n="download" className="ico-20" />Exportar copia</button>
            {!modoNube && <button onClick={() => archivo.current?.click()} className={`${BTN_S} h-12`}><Icon n="upload" className="ico-20" />Importar copia</button>}
            <button onClick={() => exportarStockCsv(E)} className={`${BTN_S} h-12`}><Icon n="table" className="ico-20" />Stock CSV</button>
            <button onClick={() => exportarMovimientosCsv(E)} className={`${BTN_S} h-12`}><Icon n="swap_vert" className="ico-20" />Movimientos CSV</button></div>
          <input ref={archivo} type="file" accept="application/json,.json" className="hidden" onChange={e => { importar(e.target.files?.[0]); e.target.value = ''; }} />
          {!modoNube && <button onClick={reset} className={`${BTN_BASE} h-12 text-error bg-error-container/50 hover:bg-error-container`}><Icon n="restart_alt" className="ico-20" />Restaurar datos de prueba</button>}</Bloque>}
        <Bloque icon="info" t="Acerca de"><p className="text-body-sm text-secondary">{MARCA.nombre} · control de stock, entregas y dotación para instalaciones eléctricas especializadas en puntos de recarga. {E.products.length} referencias · {E.movements.length} movimientos · {E.entregas.length} entregas · {E.herramientas.length} fichas de dotación.</p></Bloque>
      </div>
    </div>
  );
}
