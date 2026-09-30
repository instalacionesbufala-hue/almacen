# Almacén Búfala: control de stock

App web mobile-first de inventario para el almacén de Búfala Tech (material eléctrico, fontanería y movilidad eléctrica). Uso en PC (administración) y en móvil (operarios en pasillo, con guantes).

## Quién decide (leer primero)
El usuario (dueño del proyecto) tiene la última palabra. Sus decisiones, recogidas en `PUENTE.md` → "Respuestas de Code" → "Decisiones del usuario", **prevalecen sobre este archivo y sobre los encargos** si se contradicen. Si algo no cuadra, se pregunta al usuario antes de seguir.

**Diseño: manda Stitch** (decisión del usuario, 29/09/2026). La referencia visual son las 6 pantallas de `diseno/stitch/` (3 de escritorio: stock, albaranes IA, equipos; 3 de móvil: inventario, escáner, entrega y firma). El diseño anterior (Barlow, rack amarillo) queda descartado.

## Protocolo de trabajo (obligatorio)
Este repositorio es el canal entre Claude (chat, arquitecto) y Claude Code (implementación).
1. Al empezar cada sesión, lee `PUENTE.md` y localiza los encargos con estado `PENDIENTE`.
2. Trabaja los encargos en orden de ID. Pasa cada uno a `EN CURSO` mientras lo haces.
3. Al terminar un encargo, escribe tu respuesta en la sección "Respuestas de Code" de `PUENTE.md`: qué has hecho, ficheros tocados, decisiones tomadas, dudas y bloqueos. Marca el encargo como `HECHO` o `BLOQUEADO`.
4. Haz commit con el mensaje `E-XXX: resumen` y push a `main`.
5. No borres ni reescribas encargos del chat: solo cambia su estado.
6. Si algo del encargo es ambiguo, elige lo razonable, anótalo como decisión y sigue.
7. **Orden:** si la última revisión del chat en `PUENTE.md` indica un orden ("Orden: E-013 → E-015 → …"), sigue ese orden y no el de los ID.
8. **Buzón alternativo del chat (cuando el chat no puede subir a GitHub).** El chat puede entregar sus cambios en un fichero **`PUENTE-chat.md`** que el usuario deja en la raíz del proyecto, o cuya ruta te indica (Descargas, una carpeta de Google Drive sincronizada…). Si lo encuentras al empezar, o el usuario te dice "integra el buzón":
   - **Primera línea:** indica el commit sobre el que se escribió (`base: <sha>`).
   - **Si `PUENTE.md` no ha cambiado desde ese commit:** sustitúyelo por el contenido del buzón, sin la primera línea.
   - **Si ha cambiado:** integra solo las secciones nuevas o modificadas por el chat (encargos, "Revisión del chat" y decisiones del usuario), sin perder tus respuestas ni tus cambios de estado.
   - **Ficheros de datos:** si el buzón trae adjuntos para `datos/` (por ejemplo, CSV), el usuario los dejará junto a `PUENTE-chat.md` con su nombre final; muévelos a `datos/`.
   - **Después:** commit `Chat (buzón): <resumen>`, borra `PUENTE-chat.md` y sigue con los encargos.
   - **Nunca se sube:** `PUENTE-chat.md` va en `.gitignore`; si no está, añádelo.

## Estado actual
- `prototipo/index.html`: el prototipo original (un solo archivo). Se guarda solo como referencia para recuperar lógica; su diseño no se usa.
- `prototipo/stitch-vanilla/`: primera versión con el diseño de Stitch en JS sin frameworks (referencia).
- **App actual: React + Vite + TypeScript + Tailwind** (decisión del usuario, E-001 hecho). Vive en `src/` y se publica en GitHub Pages con `.github/workflows/pages.yml`. Comprobar siempre con `npm test`, `npx tsc -b` y `npm run build`.
- Capas: `src/data` (tipos y demo) → `src/domain` (reglas puras con pruebas) → `src/store` (estado; hoy localStorage, mañana Supabase) → `src/features` (pantallas) → `src/ui` (componentes Stitch). Las reglas nuevas van en `src/domain` con su prueba.
- **IA de albaranes: Gemini con capa gratuita** (decisión del usuario). La clave va solo en el servidor (función de Supabase). El código debe permitir cambiar de proveedor (p. ej. a Claude) sin rehacer la app.
- **Backend (E-002 hecho):** esquema, funciones y RLS en `supabase/migrations`; pruebas de base de datos con PGlite en `supabase/tests` (`npm run test:bd`). Toda escritura de la app pasa por `ejecutar(op)` (`src/store/ops.ts`), nunca mutando el estado a mano. Sin variables de Supabase la app funciona en modo demo local.
- **Backend: Supabase, plan gratuito** (500 MB de base de datos, 50.000 usuarios activos al mes, 500.000 llamadas a funciones al mes; se pausa tras 1 semana sin uso y no incluye copias automáticas).

## Modelo de datos
- **Producto:** sku, ean?, supplierRef?, name, cat (cables | tubos | fijaciones | aparamenta | cargadores | fontaneria), unit (m | ud), pack/packLabel (formato de compra), stock, min, loc (`Pxx-Exx-Nx`), supplier, price (€ neto por unidad base), serialized, serials[].
- **Movimiento:** id, ts, sku, type (entrada | salida | merma), qty, reason, ref (obra o albarán), operator, serials[], equipo? (furgoneta a la que va o de la que vuelve).
- **Albarán:** numero, proveedor, fecha, lineas, unidades, confianza, modo (ia | simulado), ts, operator.
- **Técnico / operario:** id, nombre, rol, dni (solo enmascarado: `***1234-X`).
- **Equipo (cuadrilla):** id, nombre, flota (vehículo), matricula, estado (ruta | depot | taller), tecnicos[] (1 = técnico individual, 2 = pareja; se puede desdoblar y volver a emparejar).
- **Entrega:** id (`ENT-AAAA-NNNN`), ts, equipo, receptor, dni, lineas[{sku, qty, serials[]}], firma (imagen), hash (SHA-256 del contenido y la firma), operator. Descuenta stock del almacén con movimientos de salida "Entrega a equipo".
- **Stock a bordo de una furgoneta:** se calcula, no se guarda: lo entregado menos lo devuelto (entradas "Devolución de obra" con ese equipo).
- **Pedido de reposición:** sku → {ts, qty sugerida}. Se borra solo cuando una entrada devuelve el stock al mínimo.
- **Dotación** (tipo `Herramienta` en `src/data/tipos.ts`): herramientas, EPIs y ropa de trabajo. id, clase (herramienta | epi | ropa), nombre, marca, serie/lote, talla?, cantidad, caduca? (EPIs, AAAA-MM-DD), valor, estado (operativa | deteriorada | rota | perdida | baja), equipo?, tecnico?, historial[] de incidencias (alta, asignación, deterioro, rotura, pérdida, reparación, reposición, baja) con operario, fecha, nota y coste. Reglas en `src/domain/herramientas.ts`: una pérdida solo se resuelve reponiendo; la reposición cambia n.º de serie y caducidad y guarda la serie retirada; la baja libera la asignación; aviso de EPIs vencidos o que vencen en 30 días.

(Decisión del usuario: todo lo que aparece en Stitch entra en el modelo y en las tablas del backend.)

## Reglas de negocio
- Semáforo: rojo si stock < min, amarillo si stock < 1,5 × min, verde en otro caso.
- Mínimos de referencia: tacos 100 ud, cargadores VE 2 ud.
- No se permite una salida ni una merma mayor que el stock disponible.
- Los cargadores VE se mueven siempre con número de serie, y un número de serie no puede estar duplicado.
- QR de los cargadores: `BUF:<SKU>|SN:<serie>`.
- La lectura de albaranes propone líneas y las empareja por código (también por prefijo, porque Saltoki añade sufijos) o por descripción. Nunca ingresa stock sin aprobación humana.
- Proveedores: Saltoki (Alcobendas y Móstoles) es uno de ellos, pero **hay más** (decisión del usuario). El SKU es un código propio de la referencia; el código de cada proveedor va en `supplierRef` y el emparejado de albaranes debe funcionar con cualquier proveedor (código, EAN, prefijo o descripción).

- Catálogo de ejemplo: las referencias actuales son **de demostración** (algunas no son de Saltoki). Las reales se darán de alta más adelante, **con la cámara** (código desconocido → "Crear referencia con este código") **y a mano** (formulario "Añadir referencia").

## Estilo de interfaz (diseño Stitch, decisión del usuario)
- Referencia: `diseno/stitch/*.png` y sus `*.html` (de ahí salen los colores y las tipografías).
- Tipografía Plus Jakarta Sans (textos) y JetBrains Mono (etiquetas, SKU, cifras).
- Paleta azul de Stitch (primario `#0037b0`), fondo `#f8f9ff`, tarjetas blancas. Iconos Material Symbols.
- Escritorio: barra lateral (Stock general, Albaranes y recepción IA, Equipos y técnicos, Entregas y firmas, Configuración) y cabecera con buscador, selector de almacén, "Nuevo albarán IA", avisos y operario.
- Móvil: barra inferior con Inventario, **Escanear** (botón central destacado), Entrega y Cuadrillas.
- Botones de al menos 48 px; **acciones de operario a 56 px, como en Stitch** (decisión del usuario).
- Solo modo claro, como en Stitch.
- Textos en español.
