# Puente Chat ↔ Code

Estados: `PENDIENTE` → `EN CURSO` → `HECHO` o `BLOQUEADO`.
El chat añade encargos. Code responde en su sección y solo cambia el estado de los encargos.

---

## Encargos del chat

### E-001 · Estructurar el proyecto · HECHO
Migra `index.html` a un proyecto React + Vite + TypeScript + Tailwind sin perder funcionalidad ni diseño.
- **Estructura:** `src/data` (tipos y datos semilla), `src/domain` (reglas: estado del semáforo, movimientos, emparejado de albaranes, buscador), `src/features` (panel, inventario, escáner, albaranes, movimientos), `src/ui` (componentes).
- **Tests:** unitarios (Vitest) de las reglas de `src/domain`.
- **Prototipo:** mantén `index.html` original como `prototipo/index.html`.
- **Hecho cuando:** `npm run dev` y `npm test` funcionan y el README explica cómo arrancar.

### E-002 · Backend y persistencia · HECHO
Propón e implementa un backend. Sugerencia: Supabase, con Postgres, autenticación y RLS.
- **Tablas:** productos, movimientos, albaranes y operarios.
- **Operarios:** con login por operario.
- **Movimientos:** atómicos. El stock se actualiza en una transacción o función SQL y nunca desde el cliente.
- **Hecho cuando:** hay migraciones SQL, seed con los datos actuales y el `.env.example` está documentado.

### E-003 · Lectura real de albaranes · HECHO
Crea un endpoint de servidor que reciba una foto o un PDF de albarán y llame a la API de Anthropic con visión, usando el prompt y el JSON de salida que están en `processFile()` del prototipo.
- **Clave API:** solo en el servidor.
- **Salida:** devuelve líneas con SKU emparejado y confianza.
- **Tests:** incluye tests con fixtures de albaranes Saltoki anonimizados.

### E-002 · Ampliación del chat (29/09/2026)
Se mantiene Supabase (plan gratuito). Además de lo anterior:
- **Tablas:** incluye también `perfiles`, equipos, técnicos, entregas y sus líneas, dotación con su historial y pedidos de reposición.
- **Sincronización en tiempo real:** lo que se registra en el móvil aparece en el escritorio sin recargar, con Supabase Realtime sobre productos, movimientos, entregas y albaranes.
- **Sin cobertura:** los movimientos se guardan en una cola local y se envían al volver la conexión. Cada movimiento lleva un `id` generado en el cliente (UUID) como clave de idempotencia, para que un reintento no lo duplique. Si el servidor rechaza un movimiento (por ejemplo, porque ya no hay stock), el operario lo ve como "rechazado" con el motivo.
- **Escrituras:** solo mediante funciones SQL `SECURITY DEFINER` (`registrar_movimiento`, `registrar_entrega`, `aprobar_albaran`, `registrar_incidencia`, etc.). Cada función comprueba el rol y repite las validaciones de `src/domain`. No hay políticas de INSERT, UPDATE ni DELETE directas desde el cliente.
- **Historial inalterable:** movimientos, entregas e incidencias no se editan ni se borran, tampoco el administrador. Un error se corrige con un movimiento contrario de tipo "Ajuste", que exige motivo.
- **Huella de las entregas:** la huella SHA-256 se calcula en el servidor, dentro de `registrar_entrega`, y no en el navegador.
- **Operario:** deja de ser seleccionable. Es siempre el usuario con sesión iniciada.
- **Copias y pausa del plan gratuito:** una GitHub Action semanal hace `pg_dump` y guarda la copia cifrada **fuera de este repositorio**, que es público. Esa misma tarea mantiene activo el proyecto, porque el plan gratuito se pausa tras 7 días sin uso. Documenta dónde queda la copia y cómo restaurarla.

### E-004 · Usuarios y permisos · HECHO
Autenticación con Supabase Auth (email y contraseña). Tabla `perfiles` (id = auth.uid, nombre, rol, activo). Nadie se registra por su cuenta: el administrador da de alta a los usuarios desde la app. Al desactivar un usuario, deja de poder entrar, pero su historial se conserva.

Roles iniciales (el usuario puede ajustarlos):

| Acción | Administrador | Almacén |
|---|---|---|
| Consultar stock, ubicaciones y movimientos | Sí | Sí |
| Escanear; registrar entradas y salidas | Sí | Sí |
| Registrar mermas | Sí | Sí, pero por encima de 50 € quedan "pendientes de validar" por el administrador |
| Entregas con firma a equipos | Sí | Sí |
| Leer albaranes con IA y aprobar su ingreso | Sí | Sí |
| Recuento cíclico | Sí | Cuenta; las diferencias quedan pendientes de validar |
| Ver precios, valor del inventario y costes | Sí | No |
| Crear referencias nuevas | Sí | Solo como borrador con el código escaneado; el administrador completa precio, mínimo y ubicación |
| Editar referencias, mínimos y precios; borrar referencias | Sí | No |
| Alta y baja de equipos, técnicos y dotación | Sí | No; sí registra incidencias (rotura, pérdida, deterioro) |
| Ajustes y validación de pendientes | Sí | No |
| Usuarios, configuración, importar, exportar y restaurar | Sí | No |

- **Doble control:** los permisos se aplican en el servidor (RLS y funciones SQL) y la interfaz además oculta lo que el rol no puede hacer. Esconder un botón no basta.
- **Bandeja de pendientes:** el administrador tiene una bandeja de "Pendientes de validar" con aviso en la cabecera.
- **Primer administrador:** se crea desde el panel de Supabase siguiendo la guía; los demás usuarios, desde la app.
- **Tests:** incluye pruebas de las políticas, con un usuario de almacén que intenta editar precios o borrar un movimiento y el servidor lo rechaza.

### E-005 · Guía de puesta en marcha · HECHO
Escribe `docs/PUESTA-EN-MARCHA.md` para el usuario, paso a paso y sin dar nada por sabido:
- crear el proyecto en Supabase y aplicar las migraciones;
- crear el primer administrador;
- poner las variables en GitHub (Settings → Secrets and variables);
- activar GitHub Pages;
- desplegar la función de albaranes;
- dar de alta al usuario de almacén;
- probar la sincronización entre móvil y escritorio.

### E-006 · Mínimos y avisos de reposición · HECHO
Objetivo: que el administrador reciba un aviso cuando algo baje de su mínimo, para hacer el pedido a tiempo. Vale para material, EPIs, ropa y herramientas de repuesto.

**1. Dónde se pone el mínimo**
- **Material:** ya tiene `min`. Se añaden `objetivo` (stock al que se repone; por defecto 2 × mín.) y `proveedor_habitual`. La cantidad a pedir es `objetivo − stock`, redondeada al formato de compra (`pack`).
- **Ropa y EPIs:** hoy solo existen como fichas asignadas. Hay que añadir existencias de almacén por **modelo y talla** (variantes), cada una con su mínimo. Ejemplo: pantalón talla 42, mínimo 3. Al entregar una prenda sale de esas existencias.
- **Herramientas:** el mínimo es de **unidades de repuesto por modelo**, es decir, operativas y sin asignar. Ejemplo: 1 taladro de reserva.
- **EPIs que caducan:** cuentan como pedido necesario en cuanto les quedan 30 días. Se reutiliza el aviso que ya existe.
- **Permisos:** solo el administrador cambia mínimos y objetivos. Admite cambios individuales o en bloque (por ejemplo, "todas las fijaciones del pasillo P03").

**2. Cómo nace el aviso (en el servidor, no en el navegador)**
- **Quién lo crea:** un trigger en Postgres, tras cada movimiento o ajuste, crea una fila en `avisos_reposicion` **solo cuando el stock cruza el mínimo hacia abajo**. No se crea uno por cada movimiento.
- **Sin duplicados:** hay un único aviso abierto por artículo o variante.
- **Ciclo:** abierto → pedido (el admin lo marca e indica cantidad y proveedor) → cerrado. Se cierra solo cuando una entrada devuelve el stock al mínimo.
- **Pedido sin recibir:** si un pedido lleva más de X días (configurable) sin recibirse, se reenvía el aviso.

**3. Canales, configurables por el administrador en Configuración → Avisos**
- **En la app (siempre activo):** campana con contador en tiempo real (Supabase Realtime) y bandeja "Reposición". La bandeja agrupa los avisos por proveedor y genera un **borrador de pedido** por proveedor, con referencias, códigos del proveedor y cantidades sugeridas. El borrador se puede copiar, descargar en PDF o enviar por correo.
- **Correo:** Edge Function `notificar` con Resend (capa gratuita, unos 100 correos al día). Remitente y destinatarios configurables.
- **Notificación push en el móvil:** Web Push. La app pasa a ser instalable (PWA con manifest y service worker). En iPhone solo funciona con la app añadida a la pantalla de inicio, iOS 16.4 o posterior; hay que explicarlo en la guía.
- **Telegram (opcional):** bot propio. Es gratis y el administrador solo tiene que pegar el token y su chat_id. WhatsApp se descarta por ahora: su API es de pago y exige verificar la empresa.
- **Modo de envío, por canal:** "inmediato para críticos" o "resumen diario a las HH:MM", este último con `pg_cron`. Por defecto: app inmediato, push inmediato y correo en resumen diario a las 8:00.
- **Registro de envíos:** tabla `envios_aviso` (canal, estado, error, reintentos). Configuración muestra el último envío por canal y tiene un botón "Enviar prueba".
- **Secretos:** las claves (Resend, Telegram, VAPID) van en los secretos de Supabase y nunca en el repositorio.

**4. Hecho cuando**
- Hay pruebas del trigger: crea el aviso al cruzar el mínimo, no lo duplica y se cierra al reponer.
- Hay pruebas del cálculo de la cantidad sugerida.
- Se puede enviar un correo de prueba y una notificación push de prueba.
- La guía de E-005 incluye cómo activar cada canal.

### E-007 · Plantillas de entrega a técnicos · HECHO
Objetivo: no añadir material a mano en cada entrega. Se elige una plantilla, se ajusta si hace falta y el técnico solo firma.

**1. La plantilla (la crea y edita el administrador)**
- **Contenido:** nombre, descripción y líneas de material, ropa, EPIs o herramientas. Ejemplos: "Instalación punto de recarga monofásico", "Dotación inicial técnico nuevo", "Reposición semanal furgoneta".
- **Cada línea lleva:** artículo, cantidad por defecto y si se puede cambiar al entregar. En ropa y EPIs, la **talla no va en la plantilla**: sale de la ficha del técnico (tallas de camiseta, pantalón, calzado y guantes guardadas en su perfil).
- **Artículos con n.º de serie** (cargadores, herramientas): la plantilla fija cuántos, y el número de serie se escanea al preparar la entrega.
- **Modo "kit de furgoneta"** (opcional por plantilla): la plantilla es el contenido objetivo de la furgoneta y se entrega solo la diferencia con el stock a bordo. Así, "reponer la furgoneta del equipo 2" genera las líneas que faltan de un toque.

**2. Flujo de entrega**
- **Preparar** (almacén o admin): elegir plantilla, equipo o técnico, y obra si la hay. La cesta sale ya rellena con sus cantidades y tallas. Se pueden ajustar cantidades, quitar líneas o añadir extras, y escanear los n.º de serie. La app avisa de las líneas sin stock suficiente y ofrece entregar lo disponible.
- **Preparada:** al guardar, el stock queda **reservado**, para que nadie lo asigne a otra entrega. La reserva caduca si no se firma en 48 h (configurable).
- **Firmar:** el técnico ve el resumen en pantalla grande (tablet o móvil del almacén), comprueba y firma con el dedo. Un solo toque en "Firmar y recibir".
- **Confirmar (en el servidor, atómico):** la función `confirmar_entrega` crea los movimientos de salida, asigna la dotación al técnico o equipo, calcula la huella SHA-256 y genera el **PDF del albarán de entrega** con la firma. Si falla un paso, no se aplica ninguno.
- **Justificante:** el PDF se guarda en Supabase Storage y se puede enviar por correo al técnico y al administrador (reutiliza el canal de correo de E-006).
- **Firma a distancia (fase 2, no ahora):** enlace de un solo uso para firmar en su propio móvil.

**3. Datos**
- **Tablas:** `plantillas_entrega`, `plantilla_lineas`, `tallas_tecnico`, `reservas`.
- **Entrega:** gana `plantilla_id` y un estado (preparada | firmada | anulada). Una entrega preparada se puede anular y libera la reserva; una firmada no se toca y se corrige con una devolución.
- **Informe:** qué se ha entregado a cada técnico por plantilla y periodo, útil para costes por obra.

**4. Hecho cuando**
- Hay pruebas de: plantilla con tallas resueltas, modo kit (solo la diferencia), reserva y su caducidad, y confirmación atómica.
- Una entrega de 15 líneas se prepara en menos de un minuto y se firma en un solo paso.

### E-008 · Material en custodia de Esmove · HECHO
Los **cargadores VE** y los **cuadros de protecciones** los entrega Esmove y quedan en nuestro almacén **en custodia**. No son nuestros y no tenemos su precio. Aun así hay que controlar su stock, para saber si hay unidades cuando se necesitan y para pedir la reposición a Esmove.

**1. Modelo de datos**
- **Propiedad del artículo:** `propiedad` (propia | custodia) y `propietario_id`. Se crea una tabla `propietarios` (nombre, contacto, correos de reposición e informes), con Esmove como primer registro, preparada por si mañana hay otro depositante.
- **Precio opcional:** en custodia el precio es `null`, y en ningún sitio se inventa ni se exige.
- **Nueva categoría** `cuadros` (cuadros de protecciones), además de `cargadores`.
- **Cargadores:** n.º de serie obligatorio en toda entrada, salida, devolución o incidencia, como hoy.
- **Cuadros de protecciones: sin n.º de serie** (corrección del usuario). Solo llevan una pegatina con el código del modelo. Se controlan por **referencia de modelo y cantidad**, como el material por unidades, y el código de la pegatina se guarda en `supplierRef` para buscarlo y emparejar albaranes. Para escanearlos, la app imprime una etiqueta QR propia `BUF:<SKU>` por modelo, pensada para la estantería o la caja. En el móvil se puede leer el código de la pegatina con la cámara (lectura de texto) o escribirlo a mano. Las salidas de cuadros siguen exigiendo la obra de destino.
- **Datos de demostración:** los cargadores pasan a custodia de Esmove sin precio y se añaden un par de cuadros de ejemplo.

**2. Valoración y panel**
- El **valor del inventario solo suma material propio**. El material en custodia no aparece en euros en ningún informe ni exportación.
- **Indicador aparte:** "En custodia de Esmove", con unidades por referencia y cuántas están en rojo o amarillo.
- **Etiqueta visible** "Custodia Esmove" en listas, fichas, escáner y entregas.
- **Filtro** por propiedad (propio | custodia) en el inventario.

**3. Mínimos y reposición (amplía E-006)**
- **Mínimos:** mismo semáforo y mismos avisos que el resto.
- **Destino del aviso:** el borrador de reposición se agrupa **por propietario, no por proveedor**, y es una **solicitud de reposición a Esmove** (referencias, cantidades y stock actual), sin importes.
- **Envío a Esmove:** dos modos configurables en Configuración → Avisos. Por defecto, "el administrador revisa y envía con un toque". El otro modo, "automático al correo de Esmove", queda desactivado por defecto. El administrador recibe siempre el aviso por sus canales.

**4. Entradas y salidas**
- **Entradas:** se registran como "Recepción en custodia" desde el albarán de Esmove, que no lleva precios. La lectura con IA (E-003) no debe exigir precios en estas líneas.
- **Salidas:** exigen **obra o instalación de destino** y el n.º de serie cuando lo haya, porque Esmove querrá saber dónde está cada equipo. La salida es "Instalado en obra" o "Entrega a equipo"; si vuelve sin instalar, es "Devolución".
- **Daños y pérdidas:** se registran como incidencia de custodia y generan aviso a Esmove. No cuentan como coste propio.

**5. Informe para Esmove**
- **Contenido:** stock actual por referencia, entradas recibidas, salidas por obra con n.º de serie y fecha, incidencias y diferencias de recuento. Todo sin precios, con periodo configurable (mensual por defecto).
- **Formato:** PDF y CSV. Se puede enviar por correo al contacto de Esmove, desde el panel o programado (reutiliza E-006).
- **Recuento de custodia:** cuando Esmove venga a verificar, se genera un acta con lo contado y la firma de su representante, reutilizando la firma de las entregas.

**6. Permisos (amplía E-004)**
- **Almacén:** registra entradas y salidas de custodia.
- **Solo administrador:** cambia la propiedad de un artículo, edita el propietario y sus correos, y envía informes y solicitudes a Esmove.

**7. Hecho cuando**
- Hay pruebas de que el valor del inventario excluye la custodia.
- Hay pruebas de que una salida de custodia sin obra se rechaza, y de que los cuadros se mueven por cantidad sin pedir n.º de serie.
- Hay pruebas de que el aviso de reposición de custodia va al borrador de Esmove y no al de proveedores.
- Hay pruebas de que el informe no contiene ningún importe.

### E-010 · Ajustes de la revisión del chat · HECHO
1. **Precio de custodia `null` en la app:** en `src/store/nube/mapeo.ts` el precio llega como `precio.get(p.sku) ?? 0`. Para artículos en custodia debe ser `null` (tipo `price: number | null`), de modo que ninguna pantalla, CSV ni PDF pueda mostrar "0,00 €". Añadir una prueba.
2. **Bloqueo en Auth:** en `supabase/functions/usuarios`, la acción `bloqueo` debe rechazar que el administrador se bloquee a sí mismo o bloquee al último administrador activo. Es la misma regla que `actualizar_perfil`, repetida antes de llamar a `ban_duration`. Añadir una prueba en `_compartido`.
3. **CORS:** en `_compartido/validar.ts`, cambiar `Access-Control-Allow-Origin: *` por el origen de la app, con la variable `ORIGEN_APP` (el dominio de GitHub Pages) más `localhost` en desarrollo. Documentarlo en la guía, en el paso 6.

### E-009 · Fotos de los artículos · HECHO
Cada artículo muestra su foto (material, cargadores, cuadros, ropa, EPIs y herramientas), para que el operario confirme de un vistazo que coge lo correcto.

**1. Dónde se ve**
- **Inventario:** miniatura en la lista.
- **Ficha:** foto grande, que se amplía al tocarla.
- **Escáner:** foto grande en el resultado, para confirmar que el código leído es el del artículo que tiene en la mano.
- **Otras pantallas:** cesta de entrega, pantalla de firma, plantillas, revisión de albaranes y avisos de reposición.
- **Sin foto:** se muestra el icono de su categoría.

**2. Almacenamiento (el repositorio es público)**
- **Dónde:** bucket privado `fotos-articulos` en Supabase Storage.
- **Acceso:** leen los usuarios con sesión iniciada, mediante URL firmadas.
- **Nunca en el repositorio:** ni en `src/data` ni en la web publicada. Muchas fotos son de Saltoki o de fabricantes y no deben quedar públicas. Los datos de demostración usan solo el icono de categoría.
- **Campos del artículo:** `foto` (ruta), `foto_mini` y `foto_origen` (Saltoki | Esmove | fabricante | propia).
- **Una foto por modelo:** las variantes de talla comparten la foto del modelo.

**3. Cómo se añaden**
- **Desde la ficha:** hacer foto con la cámara, elegir archivo o pegar imagen.
- **Compresión en el móvil:** antes de subirla se reduce a WebP de 1.000 px como máximo (unos 100 KB) y se genera una miniatura de 200 px. Si no hay cobertura, se sube después.
- **Permisos:** el personal de almacén puede poner foto a un artículo que no tiene; sustituir o borrar una foto es solo del administrador. Así cualquiera puede hacerle una foto a un cuadro de Esmove con su pegatina.
- **Importación por lote (solo administrador):** se sueltan muchos archivos a la vez. Cada archivo se empareja por su nombre con el SKU, el `supplierRef` o el EAN (por ejemplo `6040615306.webp`). Antes de confirmar se ve una vista previa de las asignaciones, marcando las que no casan y las que sustituirían una foto existente.

**4. Fotos de Saltoki**
Las imágenes de Saltoki Online tienen nombres internos que no corresponden con el código del artículo, así que no se pueden enlazar ni adivinar. Cuando el importador esté listo, el chat recorrerá el catálogo real en Saltoki Online con la sesión del usuario. Para cada código de Saltoki, buscará la foto y la dejará en un archivo con nombre `<código>.webp`, listo para la importación por lote. Code no tiene que conectarse a Saltoki.

**5. Hecho cuando**
- Hay pruebas del emparejado por nombre de archivo (SKU, ref. proveedor, EAN, mayúsculas y extensiones).
- Hay pruebas de los permisos: almacén no puede sustituir una foto existente.
- Las miniaturas cargan rápido en una lista de 200 artículos por datos móviles.
- La foto se muestra también en el justificante PDF de entrega de E-007 (miniatura por línea) y en el informe de custodia para Esmove.

---

## Revisión del chat

### 29/09/2026 · Revisión de E-002 a E-008
Verificado desde el chat sobre `052e1cd`:
- `npm ci`, **125 pruebas en verde** (12 ficheros), `tsc -b` sin errores y `npm run build` correcto.
- No hay claves en el repositorio.
- `GEMINI_API_KEY` solo en el servidor, y `leer-albaran` exige sesión activa.
- Los cuadros no llevan serie y los cargadores sí.
- La guía `docs/PUESTA-EN-MARCHA.md` es completa y recoge el aviso de privacidad del nivel gratuito de Gemini.

**Pendiente:** E-010 (tres ajustes menores que no llegaron a tiempo) y E-009 (fotos).

Orden: **E-010 → E-009**.

### 29/09/2026 · Revisión de E-001
Verificado desde el chat sobre el commit `8a57184`: `npm ci`, 31 pruebas en verde, `tsc -b` sin errores y `npm run build` correcto. Tampoco hay datos sensibles en el repositorio: se buscaron NIF, n.º de cliente y teléfonos de los albaranes reales, sin resultados.

Estructura y reglas correctas. Observaciones para los siguientes encargos, ya recogidas arriba:
1. **Operario libre:** hoy cualquiera puede elegir el operario activo, así que el registro no identifica a nadie de verdad. Se resuelve en E-004.
2. **Huella calculada en el cliente:** quien modifique una entrega puede recalcular su huella. Pasa al servidor en E-002.
3. **Estado mutado en sitio:** `applyMovement` modifica el estado directamente. Con el backend, la fuente de verdad es la función SQL; en el cliente solo debe quedar como validación previa.
4. **Repositorio y web públicos:** con Supabase, la clave `anon` va en la app, cosa que es normal. La seguridad depende por completo de que RLS esté bien hecho.
5. **E-003 con Gemini gratuito:** según los términos de Google, en el nivel gratuito el contenido enviado puede usarse para mejorar sus productos, y los albaranes llevan precios y direcciones de obra. Indícalo en la guía para que el usuario decida si lo acepta o activa la facturación.

Orden de trabajo: E-002 → E-004 → E-006 + E-008 → E-007 → E-003 → E-005. E-006 y E-007 se apoyan en el backend y los roles, así que van después. **E-008 afecta al modelo de datos:** los campos `propiedad`, `propietario_id`, la tabla `propietarios`, el precio opcional y la categoría `cuadros` deben entrar ya en las migraciones de E-002, aunque la interfaz de custodia se haga junto con E-006.

---

## Respuestas de Code

_(Code escribe aquí: fecha, ID del encargo, qué ha hecho, ficheros, decisiones, dudas.)_

### 29/09/2026 · Decisiones del usuario (sesión directa con Claude Code)
El usuario ha pedido en persona, en Claude Code, rehacer la app con el diseño de Stitch que él mismo ha preparado, y ha dejado claro que **manda él**: lo que se decide aquí prevalece sobre `CLAUDE.md` y sobre los encargos si se contradicen. Lo confirmará también en el chat.

Decisiones tomadas por el usuario:
1. **Diseño: manda Stitch.** Las 6 pantallas están en `diseno/stitch/` (PNG + HTML). Se descarta el estilo anterior (Barlow, rack amarillo, modo oscuro). `CLAUDE.md` ya está actualizado.
2. **Prototipo guardado** en `prototipo/index.html`, solo para recuperar lógica si hiciera falta. Su diseño no se usa.
3. **Modelo de datos ampliado con todo lo de Stitch:** equipos/cuadrillas con furgoneta, técnicos, entregas firmadas con huella SHA-256, stock a bordo de cada furgoneta y pedidos de reposición. Detalle en `CLAUDE.md` → "Modelo de datos". Esto afecta a E-002: las tablas deben incluir también equipos, técnicos y entregas (además de productos, movimientos, albaranes y operarios).
4. **Catálogo de demostración.** Las referencias actuales son de ejemplo. Las reales se meterán más adelante con la cámara y a mano (las dos vías ya existen en la app).
5. **QR de cargadores:** se mantiene `BUF:<SKU>|SN:<serie>`, como dice `CLAUDE.md`.

Decisiones posteriores del usuario (29/09/2026, misma sesión):
6. **Tecnología: React + Vite + TypeScript** (E-001 pasa a EN CURSO, partiendo del diseño de Stitch).
7. **IA de albaranes: Gemini gratuito de momento.** E-003 se hará con Gemini y quedará preparado para cambiar de proveedor.
8. **Botones de operario a 56 px, como en Stitch.**
9. **Hay más proveedores que Saltoki.** El emparejado no puede depender de los códigos de Saltoki.
10. **Backend: Supabase gratuito**, si cumple (Code ha comprobado el plan gratuito: sí cumple). Todo gratis salvo que el usuario diga lo contrario.

Pendiente de que el usuario decida (texto original, ya resuelto arriba salvo las cuentas):
- **E-001, tecnología:** seguir sin frameworks o pasar a React + Vite + TypeScript. Code le ha explicado los pros y contras. E-001 sigue `PENDIENTE` hasta que elija.
- **E-003, proveedor de IA:** el usuario quiere que sea gratis si se puede. Opciones: Gemini con su capa gratuita o la API de Claude (de pago por uso; la suscripción de claude.ai no incluye API). En cualquier caso, la clave va solo en el servidor.
- **Tamaño de los botones de operario:** 56 px (como en Stitch) o 64–72 px (como pedía `CLAUDE.md`).
- **E-002/E-003, cuentas:** Code preparará todo lo que no necesite las cuentas del usuario (migraciones, seed, endpoint, `.env.example`). Crear el proyecto en el proveedor y las claves lo hará el usuario siguiendo una guía paso a paso.

Decisiones posteriores del usuario (29/09/2026, misma sesión):
11. **Ficha de herramientas**: registrar cuándo se rompen, se pierden, se deterioran y se reponen, y asignarlas a cada equipo y/o técnico.
12. **Ropa de trabajo y EPIs**: mismo tratamiento que las herramientas. Code lo ha unificado en una "dotación" con tres clases (herramienta, EPI, ropa); los EPIs llevan caducidad o revisión con aviso y la ropa, talla y cantidad.
13. **Gemini se queda en la versión gratuita** (29/09/2026, tras leer el aviso de privacidad de la revisión del chat). El usuario acepta que, en el nivel gratuito, Google pueda usar los albaranes que se envían para mejorar sus productos. No se activa la facturación. El aviso sigue visible en Albaranes y en Configuración.

### 29/09/2026 · E-001 · HECHO
**Qué se ha hecho.** App migrada a React 19 + Vite 7 + TypeScript 5.9 + Tailwind 3 con el diseño de Stitch, sin perder funciones del prototipo y con las nuevas de Stitch y del usuario: stock general, escáner con cámara, albaranes con IA (simulado), entregas con firma y huella SHA-256, equipos y técnicos, **dotación (herramientas, EPIs y ropa)**, movimientos y configuración.
**Estructura.** `src/data` (tipos y demo), `src/domain` (reglas puras: semáforo, movimientos, buscador, emparejado de albaranes, códigos, stock a bordo, dotación), `src/store` (estado en localStorage; único punto a cambiar para Supabase), `src/features` (pantallas), `src/ui` (componentes).
**Pruebas.** 31 pruebas de Vitest en `src/domain/*.test.ts`, todas en verde. `npx tsc -b` sin errores. `npm run build` correcto.
**Publicación.** `.github/workflows/pages.yml` prueba, compila y publica en GitHub Pages en cada push a `main`. El usuario tiene que activar una vez Settings → Pages → Source: GitHub Actions.
**Decisiones de Code.**
- El emparejado de albaranes ya no depende de Saltoki: busca por SKU, EAN o código del proveedor (`supplierRef`), exacto o por prefijo (≥ 6 caracteres), y si no, por descripción.
- QR propio: `BUF:<SKU>` en etiquetas de estantería y `BUF:<SKU>|SN:<serie>` en cargadores.
- La IA real se conectará por `VITE_ALBARANES_URL` (función de servidor que recibe `archivo` + `catalogo` en FormData y devuelve el JSON `AlbaranIA` de `src/data/tipos.ts`). Sin URL, modo simulado. Así cambiar Gemini por otro proveedor no toca la app.
- Operario activo seleccionable (Oficina + técnicos) hasta que haya login (E-002).
- DNI de técnicos solo enmascarado (`***1234-X`).
- Los datos de la versión anterior (clave `almacen-bufala-v2`) se importan solos la primera vez.
**Para E-002 (Supabase).** Tablas necesarias: productos, movimientos, albaranes, técnicos/operarios, equipos, entregas (con líneas), dotación (con historial de incidencias) y pedidos de reposición. `applyMovement` y `registrarIncidencia` en `src/domain` describen exactamente las validaciones que la función SQL debe repetir en el servidor.
**Pendiente.** E-002 y E-003. La cámara real solo se ha probado con los códigos de prueba: el navegador de pruebas no tiene cámara; hay que probarla en un móvil ya publicado.

### 29/09/2026 · E-002 (con la ampliación y el modelo de E-008) · HECHO
**Base de datos** (`supabase/migrations`, 3 migraciones):
- Tablas: `perfiles`, `propietarios` (Esmove como primer registro), `productos` (con `propiedad`, `propietario_id`, `borrador` y la categoría `cuadros`), `costes_producto` (precio **nullable**: en custodia es null, nunca 0), `series`, `equipos`, `tecnicos`, `movimientos`, `albaranes`, `entregas` + `entrega_lineas`, `dotacion` + `costes_dotacion` + `dotacion_historial` + `costes_incidencia` y `pedidos_reposicion` (E-006 lo sustituirá por `avisos_reposicion`).
- Los importes van en tablas `costes_*` separadas: RLS los enseña solo al administrador. Así se cumple "almacén no ve precios" (E-004) sin vistas ni columnas ocultas.
- Escritura solo con funciones `SECURITY DEFINER`: `registrar_movimiento`, `registrar_entrega`, `aprobar_albaran`, `guardar_producto`, `marcar_pedido`, `guardar_equipo`, `cambiar_estado_equipo`, `retirar_equipo`, `guardar_tecnico`, `asignar_tecnico`, `alta_dotacion`, `asignar_dotacion`, `registrar_incidencia` y `verificar_entregas`. Todas usan `perfil_actual()` (usuario con sesión y activo) y repiten las validaciones de `src/domain`. No hay políticas de INSERT, UPDATE ni DELETE, y `revoke` + `alter default privileges` cierran también lo que se cree en el futuro.
- Idempotencia: cada operación lleva un UUID del cliente como clave primaria; un reenvío devuelve `{estado: 'duplicado'}` sin aplicar nada.
- Atómico: entrega y albarán son todo o nada (una sola transacción).
- Huella SHA-256 calculada en el servidor (`_hash_entrega`, pgcrypto) sobre el JSON canónico de la entrega y sus líneas.
- Historial inalterable con triggers (UPDATE, DELETE y TRUNCATE), también para el superusuario del panel. Los errores se corrigen con `tipo = 'ajuste'` (cantidad con signo, motivo obligatorio, solo administrador; columna `corrige` para enlazar el movimiento erróneo).
- Tiempo real: las tablas se añaden a `supabase_realtime` (respeta RLS).
- E-008 ya en el modelo: salida de custodia sin obra → rechazada; cargadores con n.º de serie obligatorio (restricción CHECK); cuadros **sin** n.º de serie (corrección del usuario), por modelo y cantidad, con el código de la pegatina en `ref_proveedor`.
**Seed:** `supabase/seed.sql`, generado con `npm run seed:sql` a partir de los datos de demostración (solo datos maestros y stock; el historial empieza vacío en la nube).
**App (modo nube)** cuando existen `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`; sin ellas sigue la demo local (lo que hay hoy en GitHub Pages):
- `src/store/ops.ts`: cada escritura es una operación con su validación local y su función SQL. `ejecutar(op)` la aplica al momento y la mete en la cola.
- `src/store/nube/sync.ts`: login (email y contraseña), carga de todas las tablas, Realtime (recarga a los 400 ms de cualquier cambio), cola en localStorage enviada en orden al volver la conexión y reaplicada encima de cada recarga. Rechazo del servidor → la operación queda "rechazada" con el motivo y se recarga el dato real.
- El operario deja de ser seleccionable en la nube: es el usuario con sesión. Indicador de sincronización y bandeja de pendientes y rechazadas en la cabecera.
**Copias:** `.github/workflows/copia-seguridad.yml` (lunes y jueves): consulta a la API para que el proyecto no se pause, `pg_dump` de `public` y de `auth.users`, cifrado AES-256 con GPG y subida a un **repositorio privado aparte** (`COPIAS_REPO`) con las últimas 26 copias. Cómo restaurar: `docs/COPIAS.md`.
**Pruebas:** 33 pruebas de base de datos con PGlite (Postgres real dentro de Vitest, con roles `anon` y `authenticated`, `auth.uid()` y RLS). Cubren idempotencia, rechazos, series, permisos, RLS de costes, usuario desactivado, historial inalterable (también como superusuario), atomicidad de entregas y albaranes, huella alterada, dotación, custodia y un **contrato app ↔ servidor** que ejecuta las operaciones de `ops.ts` contra las funciones SQL y vuelve a convertir el resultado con `mapeo.ts`. En total: 65 pruebas en verde.
**Limitaciones que hay que conocer:**
- No he podido probar contra un Supabase real: no tengo acceso a la cuenta. Realtime y el login solo se verifican cuando el usuario cree el proyecto (guía E-005).
- La carga es completa, de todas las tablas (movimientos: los 2000 últimos) en cada cambio. Con el volumen de un almacén pequeño va sobrado; si crece, se pasa a cargas por tabla.
- Los precios de productos en custodia llegan a la app como 0; la interfaz los ocultará en E-008 (el valor del inventario ya los excluye).

### 29/09/2026 · E-004 · HECHO
**Servidor** (`supabase/migrations/20260930000100_e004_permisos.sql`):
- **Pendientes de validar** (`pendientes` + `recuentos`): una merma del almacén de más de 50 € (o de material en custodia, que no tiene precio y Esmove debe saberlo) no toca el stock y queda pendiente; lo mismo con cada diferencia de un recuento del almacén. El administrador la aprueba (se aplica el movimiento) o la rechaza con `validar_pendiente`. Lo resuelto ya no se puede modificar (trigger).
- `registrar_recuento`: el administrador ajusta al momento; el almacén deja pendientes.
- El importe estimado de los pendientes es una **columna sin permiso** para `authenticated`: solo se lee con `valores_pendientes()`, que exige ser administrador.
- `crear_borrador_producto` (cualquier usuario, solo el código escaneado y un nombre). Un borrador no se puede mover hasta que el administrador lo completa con `guardar_producto`. `borrar_producto` (administrador, solo sin stock ni historial).
- `actualizar_perfil` (rol y activo): nadie se quita a sí mismo el acceso de administrador y siempre queda al menos uno activo. Los perfiles no se borran (se conserva el historial). El almacén solo ve su propio perfil.
- Función de servidor `supabase/functions/usuarios` (Deno): alta de usuarios con contraseña, cambio de contraseña y bloqueo en Auth al desactivar. Usa la clave de servicio, que solo existe en el servidor, y antes comprueba `es_admin()` con la sesión de quien llama. Validaciones en `_compartido/validar.ts` (probadas).
- `config.toml`: `enable_signup = false` (nadie se registra por su cuenta). El primer administrador se crea desde el panel siguiendo la guía de E-005.

**App:**
- `usePermisos()`: el almacén no ve precios, valor, costes ni exportaciones.
  - "Añadir referencia" pasa a ser "Nueva referencia (borrador)", también desde el escáner y desde "Crear SKU" en albaranes.
  - No ve altas, bajas ni asignaciones de equipos, técnicos y dotación.
  - En incidencias solo ve deterioro, rotura y pérdida.
  - En modo demo se actúa como administrador.
- Bandeja **"Pendientes de validar"** con contador en la cabecera y en Configuración; sección **Usuarios** (alta, rol, activar o desactivar, contraseña).
- Adelantado de E-008 (lo visible del inventario): indicador "En custodia de Esmove", etiqueta en listas y fichas, filtro por propiedad y ni un euro en el material en custodia (valor, ficha, tarjeta ni CSV).

**Pruebas:** 13 de E-004 en PGlite (entre ellas, el almacén intenta editar precios o borrar un movimiento y el servidor lo rechaza, incluso desde el panel), 6 de operaciones locales por rol y el contrato app ↔ servidor ampliado. En total, 84 en verde.

**Decisión:** las mermas de custodia del almacén siempre quedan pendientes, porque no tienen precio y E-008 pide avisar a Esmove de los daños. Si el usuario prefiere otra regla, es una línea en `registrar_movimiento`.

### 29/09/2026 · E-006 + E-008 · HECHO
**Mínimos (E-006.1)**
- Productos con `objetivo` (por defecto 2 × mínimo) y `proveedor_habitual`. Cantidad a pedir = objetivo − stock, redondeada al formato de compra. La misma regla está en SQL (`cantidad_sugerida`) y en la app (`pedidoSugerido`), con pruebas en ambos.
- Ropa y EPIs de almacén: son productos de las categorías `ropa` y `epis`, con `modelo` y `talla` (una variante por talla, cada una con su mínimo). Así reutilizan stock, movimientos, avisos y entregas sin tablas nuevas.
- Herramientas de repuesto: `minimos_herramienta` por `modelo`, que cuenta las unidades operativas y sin asignar.
- EPIs que caducan en 30 días: aparecen en la bandeja (se reutiliza el aviso existente).
- Mínimos y objetivos, uno a uno o en bloque (por categoría, pasillo o propiedad): `fijar_minimos` (solo administrador).

**Avisos en el servidor (E-006.2)**
- Trigger en `productos`: crea la fila de `avisos_reposicion` solo al **cruzar** el mínimo hacia abajo (también al subir el mínimo por encima del stock).
- Un único aviso abierto por artículo o modelo (índice único parcial).
- Ciclo abierto → pedido (`marcar_pedido`, administrador) → cerrado. Se cierra solo cuando el stock vuelve al mínimo.
- Pedido sin recibir en X días (`dias_recordatorio`): `encolar_programados` lo vuelve a avisar, sin repetirlo cada minuto.
- La tabla provisional `pedidos_reposicion` de E-002 desaparece.

**Canales (E-006.3)**
- Cola `envios_aviso` con estado, error y reintentos, más el registro de envíos.
- Función `supabase/functions/notificar`: correo con Resend, Web Push (`npm:web-push`) y Telegram. La llama pg_cron cada minuto con la cabecera `x-clave-cron` (vía pg_net y Vault); también el administrador para "Enviar prueba" e informes.
- `config_avisos`: activo, modo (inmediato o resumen diario a una hora) y hora de cada canal; destinatarios; chat_id; días de recordatorio.
- Por defecto: app inmediata, push inmediato y correo en resumen a las 8:00.
- App instalable (PWA): `manifest.webmanifest`, `sw.js` (push y última copia sin conexión) e iconos generados con `scripts/generar-iconos.mjs`. "Activar en este dispositivo" guarda la suscripción (`suscripciones_push`).
- Secretos solo en Supabase: `RESEND_API_KEY`, `TELEGRAM_BOT_TOKEN`, `VAPID_PUBLICA`, `VAPID_PRIVADA`, `VAPID_CONTACTO`, `CLAVE_CRON`. La clave pública VAPID va también en `VITE_VAPID_PUBLICA`, porque es pública por diseño.
- Interfaz: campana con contador y bandeja **Reposición**, agrupada por proveedor y, para la custodia, por propietario. Cada grupo lleva borrador (copiar, PDF, CSV, correo) y "Marcar como pedido". Configuración → Avisos.

**Custodia de Esmove (E-008)**
- Valor del inventario solo con material propio; indicador "En custodia de Esmove"; etiqueta en listas, fichas, escáner y entregas; filtro por propiedad; ni un euro en la custodia.
- Nueva vista **Custodia Esmove** con el stock, la solicitud preparada y los datos del propietario (correos de reposición e informes).
- El aviso de un artículo en custodia va con `destino = 'propietario'`, `grupo = 'ESMOVE'`: sale como **solicitud a Esmove sin importes** y nunca en el pedido a proveedores (probado).
- Envío a Esmove: "reviso y envío con un toque" (por defecto) o "automático" (`custodia_envio`).
- Entradas desde un albarán de Esmove → "Recepción en custodia" (función y app). Salida sin obra → rechazada.
- Daños y pérdidas (mermas de custodia) → aviso al administrador y, en modo automático, al correo de Esmove. No cuentan como coste propio.
- **Informe** (`supabase/functions/_compartido/informe.ts`, compartido entre la app y el servidor): stock por referencia, entradas, salidas por obra con n.º de serie y fecha, incidencias y diferencias de recuento; mensual por defecto, en CSV y PDF. Se envía desde la vista o programado (día 1 o lunes, `informe_custodia`). Prueba: el CSV, el HTML y el JSON no contienen ningún importe.
- **Acta de recuento de custodia** (`actas_custodia`): lo contado y la firma del representante. El stock del sistema se toma en el servidor al firmar; lleva huella SHA-256 y es inalterable.
- **Cuadros sin n.º de serie** (corrección del usuario): se leen con "Leer el código impreso", que usa Tesseract.js cargado solo al usarse y reconoce el código del modelo (`supplierRef`), o se escribe a mano. Tienen su etiqueta QR propia `BUF:<SKU>`.
- Permisos: el almacén registra entradas y salidas de custodia; cambiar la propiedad (`cambiar_propiedad`, que borra el precio), editar el propietario y enviar informes o solicitudes es solo del administrador.

**Pruebas:** 15 de E-006 y E-008 en la base de datos (trigger, duplicados, cierre, custodia a Esmove, cantidad sugerida, pedido, repuestos, resumen a la hora, recordatorio, visibilidad de envíos, incidencia de custodia, acta, propiedad), informe sin importes, lectura de la pegatina y el contrato ampliado. En total, 103 en verde.

**Pendiente de verificar con las cuentas reales:** el envío de correo, push y Telegram necesita las claves. La función `notificar` no se ha podido ejecutar aquí (no hay Deno ni Supabase en esta máquina). La guía E-005 incluye cómo activar cada canal y cómo hacer la prueba.

### 29/09/2026 · E-007 · HECHO
**Datos** (`supabase/migrations/20260930000300_e007_plantillas.sql`):
- `plantillas_entrega` y `plantilla_lineas`. Una línea puede ser de tres tipos:
  - `stock`: una referencia concreta.
  - `modelo` + `tipo_talla`: ropa o EPI; la talla sale de la ficha del técnico.
  - `herramienta`: un modelo de dotación.
- `tallas_tecnico` (camiseta, pantalón, calzado, guantes) y `reservas`.
- `entregas` gana `estado` (preparada | firmada | anulada), `plantilla_id`, `obra`, `caduca`, `firmada_ts` y `anulada_*`. `entrega_lineas` puede ser una herramienta (`dotacion_id`).
- El trigger de inmutabilidad solo deja pasar de preparada a firmada o anulada. Una firmada no se toca: se corrige con una devolución.

**Flujo:**
- `preparar_entrega`: comprueba disponible = stock − reservado por otras preparadas vigentes, series libres y herramientas libres, y **reserva** hasta `caduca` (48 h, configurable en `config_avisos.horas_reserva`).
- Mientras tanto, ninguna salida, merma, ajuste ni otra entrega puede usar lo reservado. Lo comprueba un trigger sobre `movimientos`, así que vale para cualquier vía.
- `confirmar_entrega` (atómica):
  - libera la reserva y crea las salidas;
  - la ropa y los EPIs entregados pasan a la dotación del técnico con su talla;
  - las herramientas se le asignan;
  - calcula la huella.
  Si algo falla (por ejemplo, la herramienta se rompió entretanto), no se aplica nada. La huella ahora incluye obra y herramienta.
- `anular_entrega` libera la reserva. `limpiar_reservas` con pg_cron cada 15 minutos (las caducadas ya no cuentan aunque sigan en la tabla).
- La entrega directa de E-002 (cesta y firma) sigue igual para lo imprevisto.

**App:**
- En Entregas: "Preparar desde plantilla" (con el modo kit y los avisos de lo que falta: se propone entregar lo disponible, con series y herramientas preseleccionadas), lista de **preparadas** con su caducidad (Firmar o Anular) y firma **en pantalla grande** con un solo botón, "Firmar y recibir".
- Editor de plantillas (administrador), tallas por técnico (Equipos → Técnicos → Tallas) e informe **entregas por técnico y plantilla** por mes, con obras y coste del material propio para el administrador.
- **Justificante PDF** con jsPDF (se carga al usarlo): en la nube se sube a Storage (bucket `justificantes`, privado) y se envía por correo al administrador con un enlace firmado de 7 días; en la demo se descarga.
- Plantillas de ejemplo: punto de recarga monofásico, dotación inicial de técnico nuevo y reposición semanal de furgoneta (kit).

**Pruebas:**
- Base de datos: 7 pruebas (la reserva bloquea otras salidas y series, anular y caducar la liberan, no se firma lo caducado, confirmación con ropa a la dotación, herramienta y huella, atomicidad, firmada inalterable, permisos de plantillas y tallas).
- Dominio: 7 pruebas (tallas resueltas, falta de talla o de variante, entregar lo disponible, modo kit, series, reserva y confirmación atómica en local).
- Contrato app ↔ servidor ampliado. En total, 118 en verde.

**Sin verificar aquí:** la subida a Storage y el enlace firmado necesitan el proyecto real.

**Decisión:** el PDF se genera en el navegador, no dentro de `confirmar_entrega`, porque una función SQL no puede generar un PDF. La confirmación sigue siendo atómica; el PDF es un justificante posterior que se puede regenerar siempre desde los datos inalterables.

### 29/09/2026 · E-003 · HECHO
**Proveedor:** Gemini con capa gratuita en lugar de Anthropic (decisión del usuario, punto 7). El prompt y el formato de salida parten de `processFile()` del prototipo, con estos cambios:
- **Sin precios**: el almacén no los usa y el material en custodia de Esmove no los lleva (E-008).
- Pide la cantidad en la unidad base del catálogo (metros o unidades) y los números de serie.

**Servidor** (`supabase/functions/leer-albaran/index.ts`, Edge Function de Supabase):
- Recibe la foto (JPG, PNG, WebP, HEIC) o el PDF, de 10 MB como máximo.
- Solo atiende a usuarios con sesión y activos (`es_usuario_activo`). El catálogo se lee con la sesión del usuario (RLS), así que nunca ve costes.
- Llama a Gemini (`gemini-flash-latest` desde el 30/09/2026, porque Google retiró `gemini-2.5-flash`; cambiable con el secreto `GEMINI_MODELO`) con salida JSON estructurada.
- La clave `GEMINI_API_KEY` solo existe en los secretos de Supabase; el navegador nunca la ve.
- Si se pasa del límite gratuito, devuelve un mensaje claro (429).

**Lógica compartida** (`supabase/functions/_compartido/albaran.ts`, código puro que usan el servidor y la app):
- Prompt, esquema de respuesta y normalización (cantidades con formato español, "1.500,5" y "1.000").
- Emparejado con el catálogo: por SKU, EAN o código del proveedor, por prefijo (sufijos de Saltoki) o por descripción. Vale para cualquier proveedor.
- El SKU que propone la IA solo se acepta si existe en el catálogo. Si ni la IA ni el emparejado lo encuentran, la confianza baja a 0,6 como máximo.
- `matchLine` de la app usa ahora este mismo emparejado, así que el simulado y el real se comportan igual.

**App:**
- `lector.ts` envía el archivo con la sesión del usuario a `VITE_ALBARANES_URL`. Sin esa variable sigue el modo simulado.
- El aviso de datos de Gemini (revisión del chat, punto 5) sale en Albaranes y en Configuración.
- Nada entra en stock sin aprobar el albarán, como antes.

**Pruebas:** 7 nuevas con dos albaranes anonimizados (`supabase/tests/fixtures/`):
- uno de Saltoki, con sufijos de código, cajas y un SKU inventado por la IA;
- uno de Esmove en custodia, sin precios y con cuadros sin número de serie.

Cubren también el formato de cantidades, las respuestas envueltas en ```json y el prompt sin precios. En total, 125 de la app y 72 de base de datos en verde. Las tres funciones de servidor pasan `deno check`.

**Sin verificar aquí:** la llamada real a Gemini necesita la clave del usuario (se da de alta en la guía E-005).

**Decisión:** para cambiar a Claude u otro proveedor basta con tocar `leer-albaran/index.ts`; la app y la lógica compartida no cambian.

### 29/09/2026 · E-005 · HECHO
**Guía:** `docs/PUESTA-EN-MARCHA.md`, para el usuario, con casillas y sin dar nada por sabido.

**Pasos obligatorios:**
1. Crear el proyecto de Supabase, en región UE.
2. Aplicar las migraciones con la CLI de Supabase vía `npx` (`login`, `link`, `db push`). La demo con `--include-seed` es opcional.
3. Crear el primer administrador: usuario en Authentication más una fila en `perfiles`, con el SQL exacto.
4. Poner las variables en GitHub.
5. Publicar en GitHub Pages.
6. Desplegar las tres funciones.
7. Configurar Gemini, con el aviso de privacidad del nivel gratuito (revisión del chat, punto 5).

**Pasos opcionales:**
8. Canales de aviso: la tarea programada con `CLAVE_CRON` y los secretos de Vault `url_notificar` y `clave_cron`; correo con Resend (con y sin dominio propio); push con las claves VAPID, más la nota de iPhone (instalar en la pantalla de inicio); Telegram con BotFather y `chat_id`.
9. Alta del usuario de almacén.
10. Copias cifradas en un repositorio privado y "keep-alive" de Supabase.

**Prueba final:** sincronización entre móvil y escritorio, incluida la prueba sin cobertura. Al final hay una tabla de síntomas y qué revisar.

**Correcciones encontradas al escribirla:**
- `pages.yml` no pasaba `VITE_VAPID_PUBLICA` a la compilación: las push no se habrían podido activar en la app publicada. Ahora sí, y está también en `.env.example`.
- `config.toml`: `[functions.notificar] verify_jwt = false`. pg_cron llama a `notificar` sin sesión de usuario y la pasarela de Supabase lo habría rechazado con 401. La función ya comprueba por sí misma la cabecera `x-clave-cron` o que quien llama sea administrador.

**Decisión:** migraciones y funciones con la CLI (`npx supabase`) en lugar de pegar SQL en el panel. Las funciones comparten código (`_compartido/`) y el editor web no lo admite. Además, así se usan los mismos archivos probados. La guía indica qué pasos exigen las contraseñas del usuario, para que Claude Code pueda ejecutar el resto sin verlas.

**Sin verificar aquí:** la guía no se ha podido recorrer contra un proyecto real porque no tengo acceso a las cuentas del usuario. Los nombres de variables, secretos, funciones y botones están comprobados contra el código.

### 29/09/2026 · E-010 · HECHO
**1. Precio de custodia `null`**
- `Producto.price` es ahora `number | null`. `mapeo.ts` devuelve `null` para la custodia aunque exista una fila de coste.
- También pasan a `null` el catálogo de demostración, `cambiarPropiedad` y la migración del estado local, para quien ya tenía datos guardados.
- `eur(null)` pinta "—", así que ninguna pantalla puede mostrar "0,00 €". El CSV ya dejaba la celda vacía y el valor del inventario sigue excluyendo la custodia.
- Pruebas: `src/store/nube/mapeo.test.ts` (nueva) y `contrato.test.ts` (ahora espera `price: null`).

**2. Bloqueo en Auth**
- La acción `bloqueo` de `usuarios` comprueba `validarBloqueo()` (`_compartido/validar.ts`) antes de `ban_duration`: nadie se bloquea a sí mismo ni al último administrador activo.
- Como la app llama primero a `actualizar_perfil`, el perfil puede llegar ya desactivado. Por eso la regla cuenta los administradores activos **sin contar al que se bloquea**.
- Desbloquear siempre se permite.
- Pruebas en `funciones.test.ts`.

**3. CORS**
- `validar.ts` ya no envía `*`: `origenPermitido()` acepta los orígenes de `ORIGEN_APP` (admite varios, separados por comas) y `localhost`/`127.0.0.1` con cualquier puerto.
- A cualquier otro origen no se le envía `Access-Control-Allow-Origin`, y el navegador bloquea la respuesta. Se añade `Vary: Origin`.
- Las tres funciones se envuelven en `conCors()`, que responde al preflight y pone las cabeceras.
- pg_cron llama sin navegador, así que no le afecta.
- Pruebas en `funciones.test.ts`, incluidos orígenes trampa como `github.io.malicioso.es` y `localhost.malicioso.es`.
- Documentado en la guía: paso 6.2 (`npx supabase secrets set ORIGEN_APP=https://instalacionesbufala-hue.github.io`) y una fila nueva en "Si algo falla".

**Comprobado:** 132 pruebas en verde (`npm test`, de ellas 77 de base de datos), `tsc -b` sin errores, `npm run build` correcto y `deno check` de las tres funciones sin errores.

### 29/09/2026 · E-009 · HECHO
**Almacenamiento** (migración `20261001000100_e009_fotos.sql`)
- Bucket **privado** `fotos-articulos`: máximo 2 MB por archivo y solo WebP o JPEG.
- Campos nuevos en `productos`: `foto`, `foto_mini` y `foto_origen` (Saltoki | Esmove | fabricante | propia).
- Rutas: `productos/<SKU>/<marca>.webp` y `…-mini.webp`. La marca cambia en cada foto, así que una ruta nunca se reutiliza y se puede cachear un año.
- Permisos:
  - `poner_foto()`: el almacén solo pone foto si el artículo no tiene. Reenviar la misma foto (un reintento de la cola) no cuenta como sustituir.
  - `quitar_foto()`: solo el administrador. Devuelve las rutas para borrar los archivos.
  - Políticas de Storage: se lee con sesión activa. Subir se permite solo mediante `puede_subir_foto(ruta)`: el SKU debe existir y el artículo no debe tener otra foto, salvo que suba el administrador. Sustituir y borrar son solo del administrador.
- **Una foto por modelo:** `_grupo_foto()` aplica la foto a todas las tallas del mismo `modelo`.
- Pruebas: `supabase/tests/e009.test.ts` (5).
- **Nada en el repositorio:** los datos de demostración siguen con el icono de categoría. En modo demostración las fotos se guardan en IndexedDB del navegador y no se suben a ningún sitio.

**App**
- Lógica pura en `src/domain/fotos.ts`, con 8 pruebas en `fotos.test.ts`:
  - emparejado por nombre de archivo: SKU, `supplierRef` o EAN, sin distinguir mayúsculas y con cualquier extensión, carpeta o espacios;
  - vista previa del lote: nueva, sustituye, sin pareja, repetida o no es imagen;
  - permisos: el almacén no puede sustituir, y la operación local también lo rechaza;
  - foto compartida por modelo y foto de las herramientas, EPIs y prendas por su modelo;
  - medidas de la reducción.
- Operaciones `foto` y `quitarFoto` en `ops.ts`: pasan por la cola sin cobertura, como las demás.
- `src/features/fotos/imagen.ts`: la foto se reduce en el móvil a WebP de 1.000 px como máximo y se genera una miniatura de 200 px (JPEG si el navegador no sabe codificar WebP). Si la foto sale pesada, baja la calidad.
- `src/features/fotos/servicio.ts`:
  - La foto se guarda primero en IndexedDB y una cola de subidas la envía al bucket cuando hay conexión. Mientras tanto la ficha marca *Pendiente de subir*.
  - URL firmadas de 12 h, cacheadas en `localStorage`.
  - **Todas las miniaturas de una pantalla se firman en una sola petición** (`createSignedUrls`), así que una lista de 200 artículos hace una llamada, no 200.
- `src/ui/foto.tsx`:
  - `Tile` (la miniatura que ya usaban las pantallas) muestra ahora la foto o, si no hay, el icono de su categoría. Un punto rojo marca el stock crítico.
  - Foto grande que se amplía al tocarla (visor a pantalla completa; se cierra con Escape).
  - Editor de la ficha, con botones de 56 px: hacer foto, elegir archivo, pegar (botón o Ctrl+V) y origen. El administrador tiene además "Quitar la foto".

**Dónde se ve**
- **Inventario:** tarjetas móviles, tabla de escritorio y tarjetas por categoría.
- **Ficha:** foto grande con el editor.
- **Escáner:** foto grande en el resultado; si el artículo no tiene foto, solo la miniatura, para no restar sitio a los botones.
- **Otras pantallas:** catálogo y cesta de entrega, pantalla de firma, preparar entrega con plantilla, editor de plantillas, revisión de albaranes y bandeja de reposición.
- **Justificante PDF de E-007:** miniatura por línea.
- **Informe de custodia para Esmove:** columna Foto en el stock por referencia. En el PDF de la app va como imagen incrustada. En el correo del servidor (`notificar`) va con URL firmadas de 30 días, porque el correo no lleva sesión. El CSV sigue sin fotos y sin importes, con su prueba en `informe.test.ts`.

**Importación por lote** (Configuración → Fotos de los artículos, solo el administrador)
- Se sueltan o eligen muchos archivos. Antes de confirmar, la vista previa enseña archivo → artículo y por qué campo se ha emparejado, y marca los que no casan, los repetidos y los que sustituirían una foto.
- Sustituir fotos existentes exige marcar una casilla (desmarcada por defecto). Las fotos se comprimen y suben de una en una, para no agotar la memoria del móvil.
- El origen por defecto es Saltoki, pensando en los `<código>.webp` que preparará el chat (punto 4 del encargo).

**Guía:** el paso 2.5 comprueba que `fotos-articulos` está en Storage y es privado. Hay una fila nueva en "Si algo falla" para las fotos pendientes de subir.

**Comprobado en el navegador (modo demostración):**
- Una foto de prueba de 1,9 MB (PNG) queda en 10 KB (WebP) y la miniatura en 2 KB. Hay que tomarlo con cautela: era una imagen sintética muy simple, y una foto real pesará más (el objetivo son unos 100 KB y 12 KB).
- Se ven la ficha, el visor, las miniaturas del inventario y la cesta, y el escáner con foto.
- El lote se probó con cinco archivos: uno por SKU, uno por la ref. del proveedor de un cuadro de Esmove, uno sin pareja y dos tallas del mismo modelo (la segunda sale "repetida" y las dos tallas comparten la foto).
- El justificante PDF lleva la miniatura y el informe de custodia la columna Foto.
- Con rol almacén no aparecen los botones en un artículo con foto, y sí en uno sin foto.

**Pruebas:** 146 en verde (`npm test`, de ellas 82 de base de datos). `tsc -b` sin errores, `npm run build` correcto y `deno check` de las tres funciones sin errores.

**Sin verificar aquí:**
- El bucket real, las políticas de Storage (PGlite no tiene Storage: se ha probado `puede_subir_foto()`, que es lo que usan) y las URL firmadas necesitan el proyecto de Supabase del usuario.
- "Las miniaturas cargan rápido en una lista de 200 artículos por datos móviles" no se ha medido en un móvil real. Por diseño son una sola petición de URL, miniaturas de unos 2 a 12 KB con carga diferida y caché de un año, así que 200 artículos son unos 0,5 a 2,5 MB la primera vez.

**Decisiones:**
- Si el administrador sustituye o quita una foto sin cobertura, el archivo viejo puede quedar huérfano en el bucket. No se ve ni ocupa casi nada.
- Pendiente para el chat: preparar las fotos de Saltoki como `<código>.webp` (punto 4). Code no se conecta a Saltoki.
