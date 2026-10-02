/* Lo mismo que hace la función "registrar-cierre" (E-026), para las pruebas de base de datos: prepara la versión con lo que ya
   hay del cierre (previo_cierre), traduce los datos efectivos y llama a aplicar_cierre como service_role. */
import { claveCierre, prepararVersion, traducirCierre, type Kits, type OrigenVersion, type PrevioCierre, type Regla } from '../functions/_compartido/cierres';
import { valor, type BD } from './pg';

export interface ResultadoCierre { estado: string; cierre: string; version?: number; pendientes?: number; diferencia?: { sku: string; unidades: number }[] }

export async function enviarCierre(db: BD, hash: string, raw: Record<string, unknown>, o: { origen?: OrigenVersion; reglas: Regla[]; kits: Kits }): Promise<ResultadoCierre> {
  await db.exec('reset role; set role service_role;');
  const origen = o.origen || (raw.origen === 'holded' ? 'holded' : 'wizard');
  const clave = claveCierre({ numInst: String(raw.numInst ?? ''), esbrainUuid: String(raw.esbrainUuid ?? '') });
  const previo = await valor<PrevioCierre | null>(db, 'select previo_cierre($1) as r', [clave]);
  const v = prepararVersion(previo, origen, raw);
  const lineas = v.accion === 'nueva' ? traducirCierre(v.efectivo, o.reglas, o.kits, 'A') : [];
  const meta = { clave, accion: v.accion, origen, documento: v.documento, base: previo?.version || 0, wizard: v.wizard, holded: v.holded, entrada: raw };
  return valor<ResultadoCierre>(db, 'select aplicar_cierre($1, $2::jsonb, $3::jsonb, $4::jsonb) as r', [hash, JSON.stringify(v.efectivo), JSON.stringify(lineas), JSON.stringify(meta)]);
}
