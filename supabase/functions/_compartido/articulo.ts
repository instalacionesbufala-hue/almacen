/* E-015 · Alta de artículos con la cámara: prompt, esquema de respuesta y normalización de lo que propone la IA.
   Módulo puro compartido por la función de servidor "leer-articulo" y por las pruebas. La IA PROPONE; el usuario revisa y guarda. */

export const CATEGORIAS = ['cargadores', 'cuadros', 'epis', 'ropa', 'cables', 'tubos', 'fijaciones', 'aparamenta', 'fontaneria'] as const;
export const UNIDADES = ['m', 'ud', 'bote', 'sobre', 'bolsa', 'pack', 'caja'] as const;
export type Categoria = typeof CATEGORIAS[number];
export type UnidadArt = typeof UNIDADES[number];
export type TipoArticulo = 'material' | 'herramienta' | 'epi' | 'ropa';

export interface ArticuloLeido {
  tipo: TipoArticulo;
  nombre: string;
  marca: string;
  modelo: string;
  /** referencia del fabricante o código del proveedor que se lee en la etiqueta */
  referencia: string;
  ean: string;
  categoria: Categoria | null;
  unidad: UnidadArt;
  contenido: number;
  talla: string;
  confianza: number;
  nota: string;
}

/** EAN-8, EAN-13 (y UPC-A de 12 dígitos) con su dígito de control */
export function eanValido(v: string): boolean {
  const d = String(v || '').replace(/\s/g, '');
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(d)) return false;
  const n = d.split('').map(Number), control = n.pop()!;
  const suma = n.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (suma % 10)) % 10 === control;
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Formato de venta a partir del texto del envase: "bote 1000 ud" → bote de 1000 · "bolsa 100" → bolsa de 100 · "rollo 100 m" → metros */
export function unidadDeTexto(texto: string): { unidad: UnidadArt; contenido: number } | null {
  const t = norm(texto);
  if (/\b(rollo|bobina|carrete)\b/.test(t) || /\d+\s*m\b(?!m)/.test(t) && /\b(cable|tubo|manguera|corrugado)\b/.test(t)) return { unidad: 'm', contenido: 1 };
  const formatos: [RegExp, UnidadArt][] = [[/\bbotes?\b/, 'bote'], [/\bsobres?\b/, 'sobre'], [/\bbolsas?\b/, 'bolsa'], [/\b(packs?|blister|blisters)\b/, 'pack'], [/\b(cajas?|caja de)\b/, 'caja']];
  for (const [re, unidad] of formatos) {
    if (!re.test(t)) continue;
    const m = t.match(/(\d{1,3}(?:[.\s]\d{3})+|\d+)\s*(?:ud|uds|unidades|u\b|pcs|piezas|tacos|tornillos|bridas|conectores)?/);
    const contenido = m ? Number(m[1].replace(/[.\s]/g, '')) : 0;
    return { unidad, contenido: contenido > 1 ? contenido : 1 };
  }
  return null;
}

export function construirPromptArticulo(codigo?: string): string {
  return `La foto es de un artículo (o de su etiqueta o envase) de un almacén de instalaciones eléctricas, fontanería y movilidad eléctrica en España: material, herramientas, EPIs o ropa de trabajo.
Propón su ficha para darlo de alta. No inventes: deja vacío lo que no se lea.
- "tipo": material (se gasta en obra), herramienta, epi o ropa.
- "nombre": nombre corto y claro en español, como lo escribiría el almacén (p. ej. "Bote 1000 tacos nylon SX 6×30", "Magnetotérmico 2P 40 A curva C").
- "marca", "modelo" y "referencia" (referencia del fabricante o código del proveedor de la etiqueta).
- "ean": el número del código de barras si se lee entero (8 o 13 cifras).
- "categoria": una de ${CATEGORIAS.join(', ')}.
- "unidad" y "contenido": cómo se vende y se entrega. Unidades: m (cables, tubos y mangueras que se cortan por metros), ud (una pieza suelta), bote, sobre, bolsa, pack o caja. "contenido" es cuántas unidades trae cada formato (bote de 1000 tacos → unidad bote, contenido 1000). Para m y ud, contenido 1.
- "talla" solo en ropa y EPIs, si aparece.
- "confianza" de 0 a 1 y una "nota" breve si algo es dudoso.
No extraigas precios ni números de serie.${codigo ? `\nEl código leído con el escáner es: ${codigo}` : ''}`;
}

export const ESQUEMA_ARTICULO = {
  type: 'OBJECT',
  properties: {
    tipo: { type: 'STRING', enum: ['material', 'herramienta', 'epi', 'ropa'] },
    nombre: { type: 'STRING' }, marca: { type: 'STRING' }, modelo: { type: 'STRING' }, referencia: { type: 'STRING' }, ean: { type: 'STRING' },
    categoria: { type: 'STRING', enum: [...CATEGORIAS] }, unidad: { type: 'STRING', enum: [...UNIDADES] }, contenido: { type: 'NUMBER' },
    talla: { type: 'STRING' }, confianza: { type: 'NUMBER' }, nota: { type: 'STRING' },
  },
  required: ['nombre', 'tipo'],
};

const txt = (v: unknown) => String(v ?? '').trim();

/** Limpia la propuesta del modelo: categoría y unidad válidas, contenido coherente, EAN solo si cuadra su control */
export function normalizarArticulo(raw: unknown): ArticuloLeido {
  const r = (typeof raw === 'string' ? JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim()) : raw) as Record<string, unknown>;
  const tipo: TipoArticulo = (['material', 'herramienta', 'epi', 'ropa'] as const).find(t => t === txt(r?.tipo).toLowerCase()) ?? 'material';
  let categoria = (CATEGORIAS as readonly string[]).includes(txt(r?.categoria).toLowerCase()) ? txt(r?.categoria).toLowerCase() as Categoria : null;
  if (!categoria && tipo === 'ropa') categoria = 'ropa';
  if (!categoria && tipo === 'epi') categoria = 'epis';
  const nombre = txt(r?.nombre);
  let unidad = (UNIDADES as readonly string[]).includes(txt(r?.unidad).toLowerCase()) ? txt(r?.unidad).toLowerCase() as UnidadArt : null;
  let contenido = Number(r?.contenido) || 0;
  // si el modelo no da la unidad (o da "ud" con un envase evidente en el nombre), se deduce del texto
  const delTexto = unidadDeTexto(`${nombre} ${txt(r?.nota)}`);
  if ((!unidad || (unidad === 'ud' && delTexto && delTexto.unidad !== 'm')) && delTexto) { unidad = delTexto.unidad; if (!(contenido > 1)) contenido = delTexto.contenido; }
  unidad ??= categoria === 'cables' || categoria === 'tubos' ? 'm' : 'ud';
  if (unidad === 'm' || unidad === 'ud' || !(contenido > 0)) contenido = unidad === 'm' || unidad === 'ud' ? 1 : Math.max(1, Math.round(contenido) || 1);
  const ean = txt(r?.ean).replace(/\s/g, '');
  return {
    tipo, nombre, marca: txt(r?.marca), modelo: txt(r?.modelo), referencia: txt(r?.referencia), ean: eanValido(ean) ? ean : '',
    categoria, unidad, contenido: Math.round(contenido), talla: tipo === 'ropa' || tipo === 'epi' ? txt(r?.talla) : '',
    confianza: Math.max(0, Math.min(1, Number(r?.confianza) || 0.7)), nota: txt(r?.nota),
  };
}
