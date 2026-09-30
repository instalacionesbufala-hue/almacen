/* E-016 · Clasificar un artículo a partir de la descripción del proveedor (albarán leído con IA, CSV o alta a mano):
   unidad y contenido del formato, categoría sugerida y proveedor normalizado. Son las mismas reglas con las que el chat
   preparó datos/catalogo-stock-real.csv. Propone; el usuario lo puede corregir en la revisión. Módulo puro. */

export type UnidadClasif = 'm' | 'ud' | 'bote' | 'sobre' | 'bolsa' | 'pack' | 'caja';

const norm = (s: unknown) => String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const esCargador = (t: string) => /\b(PUNTO (DE )?CARGA|WALLBOX|CARGADOR|POLICHARGER|PULSAR)\b/.test(t);

/** Unidad y contenido: "ML …", cables, tubos y molduras → metros; "BOTE 1000" → bote de 1000; "BOLSA 100" → bolsa de 100;
    "KOMMDATA BOLSA 25" (conectores RJ45) → sobre de 25; "PACK 10" → pack de 10; "CAJA 200" → caja de 200; el resto → ud */
export function detectarUnidad(descripcion: string): { unidad: UnidadClasif; contenido: number } {
  const t = norm(descripcion);
  if (esCargador(t)) return { unidad: 'ud', contenido: 1 };
  if (/\bML\b/.test(t) || /^(CABLE|MANGUERA|TUBO)\b/.test(t) || /\bMOLDURA\b/.test(t) || /\bCABLE\b/.test(t) && !/\bCONECTOR/.test(t)) return { unidad: 'm', contenido: 1 };
  const f = /\b(BOTE|BOLSA|PACK|SOBRE|CAJA|BLISTER)\s+(?:DE\s+)?(\d{1,3}(?:\.\d{3})*|\d+)\b/.exec(t);
  if (f) {
    const n = Number(f[2].replace(/\./g, ''));
    const u: UnidadClasif = f[1] === 'BOTE' ? 'bote' : f[1] === 'PACK' || f[1] === 'BLISTER' ? 'pack' : f[1] === 'CAJA' ? 'caja' : f[1] === 'SOBRE' ? 'sobre'
      : /\b(RJ45|KOMMDATA|CONECTOR)/.test(t) ? 'sobre' : 'bolsa';
    if (n > 1) return { unidad: u, contenido: n };
  }
  return { unidad: 'ud', contenido: 1 };
}

/** Categoría sugerida (ids de la tabla de categorías). Si la sugerida no está entre las activas, la primera activa de la lista de respaldo. */
export function categoriaSugerida(descripcion: string, activas?: string[]): string {
  const t = norm(descripcion);
  const id = esCargador(t) ? 'cargadores'
    : /\b(WAGO|BORNA|MAGNETOTERM|DIFERENCIAL|MEDIDOR|CONTADOR|CONTACTOR|SOBRETENSION|MANIOBRA)/.test(t) ? 'aparamenta'
      : /\bCUADRO\b/.test(t) ? 'cuadros'
        : /\bBRIDAS?\b|\bBOLSAS? DE BASURA\b|\bCINTA\b|\bSILICONA\b|\bSPRAY\b|\bGUANTES? DE NITRILO/.test(t) ? 'consumibles'
          : /^CABLE\b|\bML CABLE\b|\bMANGUERA\b|\bCABLE (CAT|UTP|FTP|RZ1|H07)/.test(t) ? 'cables'
            : /\b(TUBO|MOLDURA|CANALETA|CANAL|BANDEJA)\b|\b(ANGULO|JUNTA|TAPA)\b.*\bATEHA\b/.test(t) ? 'tubos'
              : /\b(GUANTE|CASCO|GAFAS|ARNES|MASCARILLA)\b/.test(t) ? 'epis'
                : /\b(PANTALON|CAMISETA|POLO|CHAQUETA|SUDADERA|BOTA|ZAPATO)\b/.test(t) ? 'ropa'
                  : 'fijaciones';
  if (!activas || activas.includes(id)) return id;
  return activas.find(x => x === 'fijaciones') ?? activas[0] ?? id;
}

/** Proveedor = emisor del albarán. Las variantes de Saltoki ("Saltoki Centro, S.A.", "SALTOKI ALCOBENDAS") son un único proveedor
    con la delegación aparte. El nombre de la propia empresa (el cliente del albarán) nunca es proveedor. */
export function normalizarProveedor(nombre: string, propia = /\bB[UÚ]FALA\b/i): { proveedor: string; delegacion: string } {
  const t = String(nombre ?? '').trim();
  if (!t || propia.test(t)) return { proveedor: '', delegacion: '' };
  if (/saltoki/i.test(t)) {
    const d = /(alcobendas|m[oó]stoles|centro|getafe|madrid|pamplona|zaragoza|bilbao|valencia|sevilla|barcelona)/i.exec(t);
    return { proveedor: 'Saltoki', delegacion: d ? d[1].charAt(0).toUpperCase() + d[1].slice(1).toLowerCase() : '' };
  }
  const limpio = t.replace(/,?\s*(S\.?\s?A\.?|S\.?\s?L\.?(U\.?)?|S\.?\s?COOP\.?)\s*$/i, '').trim();
  return { proveedor: limpio, delegacion: '' };
}
