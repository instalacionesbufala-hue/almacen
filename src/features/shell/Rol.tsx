/* E-027 · Lo que se ve del rol: etiqueta discreta "Solo lectura", franja de "Probando como…" y pantalla sin acceso */
import { probarComo, usePermisos } from '../../store/permisos';
import { ir } from '../../store/ui';
import { Icon } from '../../ui/base';

export function EtiquetaRol({ compacta = false }: { compacta?: boolean }) {
  const perm = usePermisos();
  if (!perm.soloLectura || perm.probando) return null;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container-high text-secondary font-mono text-label-sm whitespace-nowrap" title="Tu rol permite ver, no modificar">
    <Icon n="visibility" className="ico-16" />{compacta ? 'Lectura' : 'Solo lectura'}</span>;
}

/** Mientras el administrador prueba un rol: una franja arriba para salir */
export function AvisoRol() {
  const perm = usePermisos();
  if (!perm.probando) return null;
  return <div className="fixed z-[70] top-16 inset-x-2 lg:top-auto lg:bottom-4 lg:left-80 lg:right-auto rounded-xl bg-amber-400 text-black px-4 py-2 flex flex-wrap items-center justify-center gap-3 text-body-sm font-semibold shadow-lg">
    <span className="flex items-center gap-1"><Icon n="visibility" className="ico-18" />Estás viendo la app como «{perm.rol?.nombre || perm.probando}». No se puede modificar nada.</span>
    <button onClick={() => { probarComo(null); ir('config'); }} className="h-9 px-3 rounded-lg bg-black text-white">Dejar de probar</button></div>;
}

export function SinAcceso() {
  return <div className="px-4 lg:px-gutter py-10 max-w-xl"><div className="bg-surface-container-lowest rounded-xl shadow-sm p-6 flex flex-col gap-2">
    <Icon n="lock" className="text-secondary ico-32" /><h1 className="text-headline-sm font-semibold">Tu rol no da acceso a esta pantalla</h1>
    <p className="text-body-md text-secondary">Si lo necesitas, pide al administrador que cambie los permisos de tu rol.</p>
    <button onClick={() => ir('stock')} className="self-start text-primary font-semibold h-11">Ir al inventario</button></div></div>;
}
