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

### E-003 · Lectura real de albaranes · PENDIENTE
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

### E-004 · Usuarios y permisos · PENDIENTE
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

### E-005 · Guía de puesta en marcha · PENDIENTE
Escribe `docs/PUESTA-EN-MARCHA.md` para el usuario, paso a paso y sin dar nada por sabido:
- crear el proyecto en Supabase y aplicar las migraciones;
- crear el primer administrador;
- poner las variables en GitHub (Settings → Secrets and variables);
- activar GitHub Pages;
- desplegar la función de albaranes;
- dar de alta al usuario de almacén;
- probar la sincronización entre móvil y escritorio.

### E-006 · Mínimos y avisos de reposición · PENDIENTE
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

### E-007 · Plantillas de entrega a técnicos · PENDIENTE
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

### E-008 · Material en custodia de Esmove · PENDIENTE
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

---

## Revisión del chat

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
