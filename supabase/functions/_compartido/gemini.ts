/* Llamada a Gemini (capa gratuita) compartida por "leer-albaran" y "leer-articulo".
   Gemini gratuito se satura a ratos (503) o agota el cupo de un modelo (429): se reintenta y, si sigue, se usa un modelo de reserva.
   Módulo puro: recibe fetch y la espera por parámetro para poder probarlo sin red. */

export type ParteGemini = { inline_data: { mime_type: string; data: string } } | { text: string };
export interface OpcionesGemini {
  clave: string; modelo: string; reserva: string; partes: ParteGemini[]; esquema: unknown;
  /** nombre de la función, para el mensaje de "modelo retirado" */
  funcion: string;
  fetch?: typeof fetch; esperar?: (ms: number) => Promise<void>;
}
export type RespuestaGemini = { ok: true; texto: string; modelo: string } | { ok: false; status: number; error: string };

export function base64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function llamarGemini(o: OpcionesGemini): Promise<RespuestaGemini> {
  const f = o.fetch ?? fetch, esperar = o.esperar ?? ((ms: number) => new Promise<void>(ok => setTimeout(ok, ms)));
  const cuerpo = JSON.stringify({
    contents: [{ role: 'user', parts: o.partes }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: o.esquema },
  });
  const intentos: [string, number][] = [[o.modelo, 0], [o.modelo, 2500], [o.reserva, 1000], [o.reserva, 4000]];
  let r: Response | null = null, usado = o.modelo;
  for (const [modelo, espera] of intentos) {
    if (espera) await esperar(espera);
    r = await f(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': o.clave }, body: cuerpo,
    });
    usado = modelo;
    if (r.ok) break;
    if (r.status === 404 && modelo === o.reserva) continue;            // la reserva también retirada: se prueba el siguiente intento
    if (![429, 500, 503, 504].includes(r.status) && !(r.status === 404 && modelo !== o.modelo)) break;
  }
  r = r!;
  if (r.status === 503 || r.status === 500 || r.status === 504) return { ok: false, status: 503, error: 'Gemini está saturado ahora mismo (le pasa a ratos al nivel gratuito). Espera un minuto y vuelve a intentarlo.' };
  if (r.status === 429) return { ok: false, status: 429, error: 'Se ha alcanzado el límite gratuito de lecturas de Gemini. Prueba más tarde.' };
  if (r.status === 404) return { ok: false, status: 502, error: `Gemini no reconoce el modelo "${usado}" (Google lo habrá retirado). Quita el secreto GEMINI_MODELO o pon uno vigente, y vuelve a desplegar ${o.funcion}.` };
  if (r.status === 400 || r.status === 403) return { ok: false, status: 502, error: `Gemini rechaza la petición (${r.status}): revisa que GEMINI_API_KEY sea correcta y esté activa en Google AI Studio.` };
  if (!r.ok) return { ok: false, status: 502, error: `Gemini ha respondido ${r.status}` };
  const g = await r.json();
  const texto = g?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
  if (!texto) return { ok: false, status: 422, error: 'La IA no ha devuelto nada: prueba con una foto más nítida y de frente' };
  return { ok: true, texto, modelo: usado };
}
