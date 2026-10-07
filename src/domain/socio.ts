/* E-034 · Lo que ve un usuario de socio (Esmove, Instant Box…): solo su material en custodia, sus movimientos, las instalaciones de
   sus artículos (solo esas líneas del cierre), sus actas y solicitudes. Nada de técnicos, firmas, operarios, entregas, dotación,
   configuración ni el resto del cierre. Es lo mismo que devuelve datos_socio() en el servidor (que es quien de verdad lo decide);
   aquí sirve para "Probar como este usuario" y para las pruebas. */
import type { Estado } from '../data/tipos';
import { esCustodia } from './reglas';

export function filtrarParaSocio(S: Estado, propietario: string): Estado {
  const prods = S.products.filter(p => esCustodia(p) && p.propietario === propietario);
  const skus = new Set(prods.map(p => p.sku));
  const lineasCierre = S.lineasCierre.filter(l => l.sku && skus.has(l.sku)).map(l => ({ ...l, nota: '' }));
  const conCierre = new Set(lineasCierre.map(l => l.cierre));
  return {
    ...S,
    socio: propietario,
    products: prods.map(p => ({ ...p, notas: undefined, proveedorHabitual: undefined, stockPropuesto: undefined, propuestoPor: undefined, objetivo: undefined })),
    archivados: (S.archivados || []).filter(p => esCustodia(p) && p.propietario === propietario),
    aBordo: S.aBordo.filter(b => skus.has(b.sku)),
    movements: S.movements.filter(m => skus.has(m.sku)).map(m => ({ ...m, operator: 'Búfala', entrega: undefined })),
    cierres: S.cierres.filter(c => conCierre.has(c.id)).map(c => ({ ...c, datos: undefined, datosWizard: undefined, holded: undefined, materialEspecial: '', versiones: [] })),
    lineasCierre,
    actas: S.actas.filter(a => a.propietario === propietario).map(a => ({ ...a, firma: '', operator: 'Búfala' })),
    // E-038: sus retiradas, con la firma de quien recogió (para el PDF); quien la registró en Búfala no se ve
    retiradas: (S.retiradas || []).filter(r => r.socio === propietario).map(r => ({ ...r, operator: 'Búfala' })),
    avisos: S.avisos.filter(a => a.destino === 'propietario' && a.grupo === propietario && a.sku && skus.has(a.sku)),
    propietarios: S.propietarios.filter(o => o.id === propietario).map(o => ({ ...o, contacto: '', correosReposicion: [], correosInformes: [] })),
    equipos: S.equipos.map(e => ({ ...e, tecnicos: [] })),
    // nada interno
    tecnicos: [], entregas: [], herramientas: [], minimosHerramienta: [], perfiles: [], pendientes: [], albaranes: [], envios: [], asignaciones: [],
    equivalencias: [], kits: {}, integraciones: [], portalEnlaces: [], copias: [], propuestas: [], codigos: [], pedidos: {},
  };
}
