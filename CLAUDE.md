# Almacén Búfala: control de stock

App web mobile-first de inventario para el almacén de Búfala Tech (material eléctrico, fontanería y movilidad eléctrica). Uso en PC (administración) y en móvil (operarios en pasillo, con guantes).

## Protocolo de trabajo (obligatorio)
Este repositorio es el canal entre Claude (chat, arquitecto) y Claude Code (implementación).
1. Al empezar cada sesión, lee `PUENTE.md` y localiza los encargos con estado `PENDIENTE`.
2. Trabaja los encargos en orden de ID. Pasa cada uno a `EN CURSO` mientras lo haces.
3. Al terminar un encargo, escribe tu respuesta en la sección "Respuestas de Code" de `PUENTE.md`: qué has hecho, ficheros tocados, decisiones tomadas, dudas y bloqueos. Marca el encargo como `HECHO` o `BLOQUEADO`.
4. Haz commit con el mensaje `E-XXX: resumen` y push a `main`.
5. No borres ni reescribas encargos del chat: solo cambia su estado.
6. Si algo del encargo es ambiguo, elige lo razonable, anótalo como decisión y sigue.

## Estado actual
`index.html` es el prototipo funcional: un solo archivo, JavaScript sin frameworks, Tailwind por CDN y localStorage.

## Modelo de datos
- **Producto:** sku, ean?, supplierRef?, name, cat (cables | tubos | fijaciones | aparamenta | cargadores | fontaneria), unit (m | ud), pack/packLabel (formato de compra), stock, min, loc (`Pxx-Exx-Nx`), supplier, price (€ neto por unidad base), serialized, serials[].
- **Movimiento:** id, ts, sku, type (entrada | salida | merma), qty, reason, ref (obra o albarán), operator, serials[].
- **Albarán:** numero, proveedor, fecha, lineas, ts, operator.

## Reglas de negocio
- Semáforo: rojo si stock < min, amarillo si stock < 1,5 × min, verde en otro caso.
- Mínimos de referencia: tacos 100 ud, cargadores VE 2 ud.
- No se permite una salida ni una merma mayor que el stock disponible.
- Los cargadores VE se mueven siempre con número de serie, y un número de serie no puede estar duplicado.
- QR de los cargadores: `BUF:<SKU>|SN:<serie>`.
- La lectura de albaranes propone líneas y las empareja por código (también por prefijo, porque Saltoki añade sufijos) o por descripción. Nunca ingresa stock sin aprobación humana.
- Proveedor principal: Saltoki (Alcobendas y Móstoles). Sus códigos de artículo son los SKU.

## Estilo de interfaz
- Tipografía Barlow / Barlow Condensed.
- Etiqueta de ubicación amarilla tipo rack.
- Franja de color por categoría, con los colores de conductor.
- Botones de al menos 48 px, y 64–72 px en las acciones de operario.
- Modo claro y oscuro.
- Textos en español.
