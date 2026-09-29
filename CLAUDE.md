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

## Estado actual
- `prototipo/index.html`: el prototipo original (un solo archivo). Se guarda solo como referencia para recuperar lógica; su diseño no se usa.
- La app nueva con el diseño de Stitch está en desarrollo. La tecnología (seguir sin frameworks o pasar a React, encargo E-001) está **pendiente de que el usuario decida**.

## Modelo de datos
- **Producto:** sku, ean?, supplierRef?, name, cat (cables | tubos | fijaciones | aparamenta | cargadores | fontaneria), unit (m | ud), pack/packLabel (formato de compra), stock, min, loc (`Pxx-Exx-Nx`), supplier, price (€ neto por unidad base), serialized, serials[].
- **Movimiento:** id, ts, sku, type (entrada | salida | merma), qty, reason, ref (obra o albarán), operator, serials[], equipo? (furgoneta a la que va o de la que vuelve).
- **Albarán:** numero, proveedor, fecha, lineas, unidades, confianza, modo (ia | simulado), ts, operator.
- **Técnico / operario:** id, nombre, rol, dni (solo enmascarado: `***1234-X`).
- **Equipo (cuadrilla):** id, nombre, flota (vehículo), matricula, estado (ruta | depot | taller), tecnicos[] (1 = técnico individual, 2 = pareja; se puede desdoblar y volver a emparejar).
- **Entrega:** id (`ENT-AAAA-NNNN`), ts, equipo, receptor, dni, lineas[{sku, qty, serials[]}], firma (imagen), hash (SHA-256 del contenido y la firma), operator. Descuenta stock del almacén con movimientos de salida "Entrega a equipo".
- **Stock a bordo de una furgoneta:** se calcula, no se guarda: lo entregado menos lo devuelto (entradas "Devolución de obra" con ese equipo).
- **Pedido de reposición:** sku → {ts, qty sugerida}. Se borra solo cuando una entrada devuelve el stock al mínimo.

(Decisión del usuario: todo lo que aparece en Stitch entra en el modelo y en las tablas del backend.)

## Reglas de negocio
- Semáforo: rojo si stock < min, amarillo si stock < 1,5 × min, verde en otro caso.
- Mínimos de referencia: tacos 100 ud, cargadores VE 2 ud.
- No se permite una salida ni una merma mayor que el stock disponible.
- Los cargadores VE se mueven siempre con número de serie, y un número de serie no puede estar duplicado.
- QR de los cargadores: `BUF:<SKU>|SN:<serie>`.
- La lectura de albaranes propone líneas y las empareja por código (también por prefijo, porque Saltoki añade sufijos) o por descripción. Nunca ingresa stock sin aprobación humana.
- Proveedor principal: Saltoki (Alcobendas y Móstoles). Sus códigos de artículo son los SKU.

- Catálogo de ejemplo: las referencias actuales son **de demostración** (algunas no son de Saltoki). Las reales se darán de alta más adelante, **con la cámara** (código desconocido → "Crear referencia con este código") **y a mano** (formulario "Añadir referencia").

## Estilo de interfaz (diseño Stitch, decisión del usuario)
- Referencia: `diseno/stitch/*.png` y sus `*.html` (de ahí salen los colores y las tipografías).
- Tipografía Plus Jakarta Sans (textos) y JetBrains Mono (etiquetas, SKU, cifras).
- Paleta azul de Stitch (primario `#0037b0`), fondo `#f8f9ff`, tarjetas blancas. Iconos Material Symbols.
- Escritorio: barra lateral (Stock general, Albaranes y recepción IA, Equipos y técnicos, Entregas y firmas, Configuración) y cabecera con buscador, selector de almacén, "Nuevo albarán IA", avisos y operario.
- Móvil: barra inferior con Inventario, **Escanear** (botón central destacado), Entrega y Cuadrillas.
- Botones de al menos 48 px. El tamaño de las acciones de operario (56 px como en Stitch o 64–72 px) lo está decidiendo el usuario.
- Solo modo claro, como en Stitch.
- Textos en español.
