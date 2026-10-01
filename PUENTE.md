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

### E-007 · Plantillas de entrega a técnicos · HECHO (sustituido por E-011 por decisión del usuario)
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

### E-011 · Entregas libres con firma y copia por correo · HECHO
**Decisión del usuario:** las plantillas de E-007 **no son como las quiere**. No quiere nada predeterminado. Quiere un lugar donde **seleccionar los artículos** de cada entrega y que después **el técnico firme**. Este encargo sustituye el flujo de plantillas.

**1. Quitar lo predeterminado**
- **Qué sale de la interfaz:** la sección "Plantillas", el selector de plantilla y el "modo kit de furgoneta".
- **Base de datos:** no se borran tablas con datos. Una migración nueva deja `plantillas_entrega` y `plantilla_lineas` sin uso y lo documenta. Se conservan del trabajo de E-007: la reserva de stock, la firma en pantalla grande, `confirmar_entrega` atómica, la huella y el PDF.

**2. Nueva entrega en tres pasos (móvil primero, botones de 56 px)**
1. **Para quién:** técnico o equipo (buscador) y, opcionalmente, la obra.
2. **Qué se entrega (la cesta):**
   - **Buscador** con foto, nombre, SKU y stock disponible, más filtros por categoría.
   - **Escáner en modo continuo:** se escanean varios artículos seguidos y cada lectura suma a la cesta. Si se lee dos veces el mismo, suma cantidad.
   - **Cada línea:** cantidad con − y +. Los cargadores piden su n.º de serie, que se puede escanear. En ropa y EPIs, la talla se elige en la propia línea; si la ficha del técnico tiene talla, aparece preseleccionada pero se puede cambiar.
   - **Stock:** aviso en línea si no hay stock suficiente, sin dejar entregar más de lo disponible.
   - **Cesta guardada:** si se cierra la app, la cesta en curso se conserva en el dispositivo.
3. **Firma:** resumen en pantalla grande con fotos y cantidades. El técnico comprueba y firma con el dedo, y se confirma con "Firmar y recibir".

Una cesta se puede guardar como **preparada**, con el stock reservado, para que el técnico firme más tarde.

**3. Correo del técnico y copia de la entrega**
- **Dato:** nuevo campo `email` en la ficha del técnico, opcional y validado.
- **En la pantalla de firma** se muestra el correo al que irá la copia. Si falta o está mal, se puede escribir en ese momento y se guarda en la ficha. Esto lo puede hacer también el personal de almacén: es la única edición de la ficha que se le permite.
- **Envío automático:** al confirmar la firma, la función `notificar` envía por Resend el **PDF del justificante firmado** como adjunto. El asunto es del tipo "Entrega de material n.º X · fecha" y el texto es breve. Hay opción de copia al administrador (configurable).
- **Registro y reenvío:** cada envío queda en `envios_aviso` (enviado, error o reintentos). El historial de entregas muestra si llegó y tiene un botón "Reenviar copia".
- **Resend:** para enviar a los técnicos hace falta un **dominio propio verificado**, porque con `onboarding@resend.dev` solo llega al correo del administrador. La guía (paso 8) debe decirlo claramente en este apartado. Sin dominio, la app avisa de que la copia no se ha podido enviar y ofrece descargar o compartir el PDF (compartir nativo del móvil, por WhatsApp o correo).

**4. Hecho cuando**
- Hay pruebas de: cesta con escaneo repetido que suma, talla editable, serie obligatoria en cargadores, reserva y su caducidad, confirmación atómica, y envío con reintento y registro.
- En la interfaz no queda ninguna referencia a plantillas.

### E-012 · Consumos de los cierres de instalación y stock en furgonetas · HECHO
**Petición del usuario:** cruzar la app con los **cierres de instalación** que los equipos hacen con el wizard del repositorio `instalacionesbufala-hue/bufala`. El material que declaran se va descontando del stock de su furgoneta, para llevar un control aproximado.

**Qué ha visto el chat en el wizard** (`cierre-esbrain.html`, v1.1.x):
- **Envío:** cada cierre se manda por POST a un **Google Apps Script** (`WEB_APP_URL`), que lo guarda en la hoja "Registro". Ese mismo backend alimenta el dashboard (`?action=dashboard`).
- **Identificación:** `numInst`, `esbrainUuid`, `cliente`, `direccion`, `fechaCierreIso`, `hardware` (modelo del cargador) y `equipo`, que es uno de `Búfala 1`, `Búfala 2` o `Búfala 3`. `despFallido` indica un desplazamiento fallido, sin consumo.
- **El material no viene por SKU, sino por partidas:**
  - línea: `tipoLinea` (tubo | manguera), `fase`, `seccion` (6 | 10 | 16 | 25), `metrosLinea`, `metrosUtp`, `rj45`;
  - bornas: `bornasMono`, `bornasTrif`;
  - canalizaciones: `pvc32`, `corr32`, `acero32`, `acero40`, `canaleta`, `sot50`, `sot90`;
  - protecciones: `cajaReg`, `caja6`, `caja12`, `caja18`, `cerradura`, `mag1025`, `mag32`, `mag40`;
  - kits: `pica`, `preinst`.
- **Sin n.º de serie del cargador:** el wizard no lo pide. **Decisión del usuario:** las series las recoge Esbrain o Instant Box al hacer el cierre, y el almacén **no las gestiona**.

**1. Cómo llegan los cierres (vía recomendada: el Apps Script empuja a Supabase)**
- **Función de servidor** `registrar-cierre`, llamada **desde el Apps Script** (servidor a servidor, con `UrlFetchApp`). Lleva la cabecera `X-Integracion: <token>`; el token se guarda en las **Propiedades del script** y nunca en el HTML público. En Supabase solo se guarda su hash, y se revoca desde Configuración → Integraciones.
- **Momento:** el Apps Script la llama justo después de escribir la fila en "Registro". Code debe entregar el **fragmento de Apps Script** listo para pegar (función `enviarAlAlmacen(datos)`), con reintento y registro de errores en una hoja "Almacén-log".
- **Histórico:** acción de carga inicial de los cierres existentes. Puede ser un `?action=exportCierres` paginado en el Apps Script o un CSV exportado de "Registro"; los cierres anteriores a la fecha de apertura del inventario se ignoran.
- **Idempotencia:** por `esbrainUuid` o, si falta, por `numInst` + `fechaCierreIso`. Reenviar un cierre no descuenta dos veces. Si un cierre se corrige, se envía de nuevo con `version` y la app aplica la diferencia.
- **Permisos del token:** solo `registrar-cierre`. No lee nada.

**2. Traducir partidas a artículos: tabla de equivalencias (administrador)**
- **Tabla** `equivalencias_cierre` (campo del wizard + condiciones → artículo(s) + factor). Ejemplo: `metrosLinea` con tubo, mono y 6 mm² son 1 m de cada uno de 6000650603 (marrón), 6000650604 (azul) y 6000650605 (amarillo/verde).
- **Equivalencias derivadas (estimadas), con reglas del usuario:** editables y desactivables, marcadas como "estimado" en los informes.
  - **Manguitos:** `floor(metros / 3) + 1` por cada tramo de tubo rígido (PVC y acero). Por ejemplo, 4 m son 2 manguitos, uno en cada extremo, y 6 m son 3.
  - **Fijaciones:** 1 cada 0,50 m, es decir `ceil(metros / 0,5)`, **solo en tubo PVC y acero**. **El corrugado no cuenta**, porque no siempre lleva (decisión del usuario). Cada fijación consume un **kit de fijación configurable**:
    - **Kit A (por defecto, decisión del usuario):** abrazadera clip BTM 32-35 + **clavo**. El clavo aún no está dado de alta, así que hasta entonces su línea queda "sin equivalencia".
    - **Kit B:** clip + tornillo 5x40 + taco 6x30.
    - **Kit C:** abrazadera M6 + tirafondo M6x30 + taco.
    - El técnico puede usar uno u otro, así que es un control aproximado que se corrige con el recuento de furgoneta.
  - **Metros de tubo** (PVC, corrugado, acero…): **no se estiman**, los indica el técnico en el cierre.
  - **Cable UTP según el cargador (decisión del usuario):** `metrosUtp` descuenta **Cat6 U/UTP (7270020010) si `hardware` es V2C** y **Cat6 F/UTP (7270021010) si es Policharger**. Con otro modelo, la línea va a "Pendientes". Las condiciones de las equivalencias deben poder mirar cualquier campo del cierre (`hardware`, `tipoLinea`, `fase`, `seccion`).
  - **Canaleta:** la "canaleta" del wizard es la **moldura Hager ATEHA 30x12 (6222106082)**, confirmado por el usuario.
- **Punto de partida:** la propuesta del chat está en `datos/equivalencias-cierres.csv` (28 reglas, ya con las respuestas del usuario). La app la importa como borrador y el administrador la confirma. Las partidas sin artículo quedan "sin equivalencia" y no descuentan hasta que se definan.
- **Equipos:** `Búfala 1`, `Búfala 2` y `Búfala 3` se vinculan a los equipos y furgonetas de la app (Configuración → Integraciones).

**3. Qué hace la app con cada cierre**
- **Consumos:** crea movimientos de tipo **"Consumo en obra"** desde el stock **del vehículo** del equipo, nunca desde el almacén, con referencia `numInst`, cliente y dirección.
- **Consumo de artículos por formato** (bote, sobre, bolsa, pack): el vehículo guarda internamente el **contenido en unidades**. Por ejemplo, 1 sobre de RJ45 son 25 ud, y un cierre con 2 RJ45 resta 2 ud y deja 23 ud, es decir 0,92 sobres. En el almacén se sigue contando por formatos enteros.
- **Stock a bordo:** entregas firmadas (E-011) − consumos de cierres ± devoluciones y recuentos de furgoneta.
- **Negativos:** si un consumo deja la furgoneta en negativo, se registra igual y se marca como **discrepancia**.
- **Desplazamiento fallido:** no hay consumo, pero queda registrado.
- **Cargador de Esmove:** el modelo (`hardware`) se empareja con el artículo en custodia y se descuenta **1 ud del stock del vehículo** del equipo, sin n.º de serie. Queda como **"Instalado en obra"** con `numInst`, cliente y dirección en el informe de custodia para Esmove. Si el modelo no se reconoce, va a "Pendientes".
- **Informes:** stock teórico por furgoneta, consumo por obra, equipo y periodo, discrepancias, y **recuento de furgoneta** (el equipo cuenta, se compara y el administrador valida los ajustes).
- **Cierres recibidos:** una vista muestra cada cierre (recibido, aplicado, parcial o con discrepancia) y sus líneas traducidas.

**4. Sugerencias para el wizard** (proyecto `bufala`, fuera de este repositorio; las decide el usuario)
- Si algún día se quiere cruzar el cargador exacto, bastaría con que el backend del wizard enviase el n.º de serie que ya recoge Esbrain. Hoy **no se necesita**.
- Añadir un campo para el **medidor V2C**, si se instala en algunos cierres, para descontarlo de la custodia.
- Si se añaden materiales al wizard, usar identificadores estables; la tabla de equivalencias se amplía sin tocar código.

**5. Hecho cuando**
- Hay pruebas de: idempotencia y versión, equivalencias con condiciones, manguitos `floor(m/3)+1`, fijaciones `ceil(m/0,5)` sin contar el corrugado, kits A, B y C, UTP según `hardware`, consumo fraccionado de formatos (sobre, bote), negativo como discrepancia, cargador sin serie, fallido sin consumo y token revocado rechazado.
- La guía explica cómo pegar el fragmento en el Apps Script y cómo lanzar la carga del histórico.

### E-013 · Simplificar y pasar a datos reales · HECHO
**Decisiones del usuario (30/09).** Prevalecen sobre lo anterior de E-002, E-006, E-008 y E-009.
1. **Fuera los precios de la app.** Las facturas se controlan por otro lado.
   - Se ocultan y dejan de pedirse precios, costes, "valor del inventario" e importes en cualquier pantalla, CSV o PDF.
   - Las tablas `costes_*` se quedan sin uso; no se borran.
   - **Mermas (decisión del usuario):** la regla de los 50 € desaparece. Las mermas se **aplican al momento**, las registre quien las registre, y **se informa al administrador**: aviso en la app y en sus canales de E-006 (push, correo o Telegram, según su configuración), con quién la registró, qué artículo, qué cantidad y el motivo. Ya no hay bloqueo ni validación previa.
2. **Formatos de venta: el stock respeta la unidad de la línea del producto.**
   - Nuevas unidades: `bote`, `sobre`, `bolsa`, `pack` y `caja`, además de `m` y `ud`, cada una con su **contenido** (bote de 1000 tacos, sobre de 25 RJ45, bolsa de 100 bridas, pack de 20 cintas).
   - En el almacén y en las entregas se mueven **formatos enteros**: se entrega el bote completo.
   - El contenido en unidades solo sirve para los consumos de los cierres (E-012).
3. **Sin números de serie en los cargadores.** Los cargadores y los medidores de Esmove se controlan **por modelo y cantidad**. Las series las recoge Esbrain o Instant Box.
   - Se quita la obligatoriedad de serie en todos los flujos: entrada, entrega, escáner, cierres y custodia.
   - El QR de estantería es `BUF:<SKU>`.
   - Las series existentes en la demostración desaparecen con el borrado.
4. **Sin pasillo, estantería ni nivel.** Hay una sola nave. La ubicación que importa es **dónde está el material**:
   - **Almacén (nave)**, o
   - **vehículo de un equipo de campo** (Búfala 1, 2, 3…).
   - **Entregar a un equipo es un traspaso almacén → vehículo, no una salida.** El stock total es almacén + vehículos.
   - En el inventario, cada artículo muestra "Almacén X · Búfala 1 Y · Búfala 2 Z", y hay filtro por ubicación.
   - Los avisos de mínimo miran **solo el stock del almacén**.
   - Se quita el campo `loc` de las pantallas.

**Equipos, técnicos y vehículos: composición variable** (decisión del usuario del 30/09)
Hoy hay 3 equipos (Búfala 1, 2 y 3), cada uno con 2 técnicos y 1 furgoneta. **La composición va a cambiar pronto**, y en el futuro puede haber más equipos y más vehículos.
- **Tres entidades independientes:**
  - **técnico:** nombre, código de empleado (E01…), categoría, teléfono y correo;
  - **equipo:** nombre, exactamente como lo envía el wizard ("Búfala 1"…);
  - **vehículo:** matrícula y modelo.
- **Asignaciones con historial:** técnico → equipo y vehículo → equipo, con fecha de inicio y de fin. El administrador las cambia desde la app con un selector en cada tarjeta de equipo, como en la pantalla actual.
  - Se permiten equipos sin vehículo, vehículos sin equipo (por ejemplo, en taller) y técnicos sin equipo.
  - Dar de baja no borra el historial.
- **El stock "a bordo" es del vehículo**, no del equipo ni del técnico:
  - si un técnico cambia de equipo, no se mueve material;
  - si un vehículo pasa a otro equipo, su material va con él;
  - el inventario muestra el stock por vehículo, con la matrícula y el equipo actual.
- **Entregas:**
  - **Material de instalación:** se entrega a un **equipo** y entra en el **vehículo que tiene asignado en ese momento**. Si el equipo no tiene vehículo, la app lo impide y lo explica.
  - **Dotación personal** (ropa, EPIs, herramientas personales): se asigna al **técnico**, como hasta ahora.
  - **Firma:** firma el técnico que recoge.
- **Cierres (E-012):** el `equipo` del cierre se traduce al **vehículo asignado a ese equipo en la fecha del cierre** (`fechaCierreIso`), no al de hoy.
- **Datos personales:** los nombres, códigos, teléfonos y matrículas reales **no van al repositorio**, que es público. El usuario los da de alta desde la app. La demostración y los fixtures usan datos inventados.

**Borrado de la demostración (una sola vez). Es lo primero que se hace en E-013; el usuario lo ha pedido expresamente.**
- **Botón visible:** en **Configuración**, en una zona "Datos" solo para el administrador, un botón rojo **"Borrar datos de ejemplo"**. Al pulsarlo:
  - explica qué se borra y qué se conserva;
  - pide escribir "BORRAR DEMO";
  - al terminar, muestra "Datos de ejemplo borrados; ya puedes importar tu catálogo" y un acceso directo a **Importar catálogo (CSV)**.
  - Una vez usado, el botón desaparece y en su lugar queda la fecha del borrado.
- **Cómo:** llama a la función SQL `limpiar_demostracion()`, solo para el administrador.
- **Qué borra:** productos, movimientos, entregas, albaranes, dotación, equipos, técnicos, avisos, pendientes, actas y fotos de la demostración.
- **Qué conserva:** los usuarios, la configuración de avisos y el propietario Esmove.
- **Protección del historial:** la función desactiva los triggers de bloqueo **solo dentro de su propia transacción**. Solo funciona mientras `config.modo_demo = true`, marca que la propia función pone a `false` al terminar.
- **Registro:** deja una fila de auditoría.
- **`seed.sql`:** deja de cargarse por defecto.

**Importador de catálogo (administrador): Configuración → Importar catálogo (CSV)**
- **Formato:** separador `;`, UTF-8 con BOM, cabecera `sku;ref_proveedor;nombre;categoria;propiedad;propietario;proveedor;unidad;contenido_unidad;stock_inicial;minimo;albaranes`.
- **Vista previa:** antes de confirmar se ven las filas nuevas y las ya existentes (por SKU), con aviso de las unidades desconocidas.
- **Stock inicial:** entra en el **almacén** como movimiento "Inventario de apertura", con la referencia de los albaranes.
- **Sin mínimo:** el artículo aparece como tarea "Completar mínimo" para el administrador.
- **Importación repetida:** idempotente por SKU y albaranes.
- **Fichero real:** `datos/catalogo-stock-real.csv` (40 artículos de los albaranes Saltoki 3.322.577, 3.322.832, 3.322.865 y 3.324.674 y del de Esmove 3.327.786), **sin precios**. Lo sube el chat al repositorio a petición del usuario, y el usuario lo importa desde la app. Las pruebas usan un fixture inventado, no este fichero.
- **Equivalencias de los cierres:** `datos/equivalencias-cierres.csv` es la propuesta para E-012.
- **Productos a mano:** el usuario dará de alta otros productos con "Añadir referencia", que debe tener los mismos campos que el CSV: unidad con contenido, propiedad y mínimo.

**Hecho cuando**
- Hay pruebas de: no aparece ningún importe; traspaso almacén → vehículo que no cambia el stock total; historial de asignaciones (técnico que cambia de equipo, vehículo que cambia de equipo con su stock, cierre con fecha anterior a un cambio); formatos enteros en el almacén; cargador sin serie; borrado de la demostración una sola vez; importación idempotente.
- La guía tiene el paso "Pasar a datos reales".

### E-014 · Portal del técnico y copia por WhatsApp · HECHO
**Decisión del usuario:** los técnicos usan Gmail, pero se prefiere **WhatsApp**. Lo importante es que el técnico **tenga un sitio donde ver sus entregas**. E-011 ya permite compartir el PDF desde el móvil; falta lo siguiente.
- **Portal del técnico (solo lectura):** página `#/tecnico/<token>` de la propia app, sin usuario ni contraseña. Se abre con un **enlace personal y privado**: token aleatorio largo, del que solo se guarda el hash. El administrador lo revoca y regenera desde la ficha del técnico.
  - **Qué muestra:** sus entregas firmadas, con fecha, líneas, fotos y PDF, y el **material que tiene su vehículo** (E-013/E-012).
  - **Qué no muestra:** datos de otros técnicos. La app ya no maneja importes.
  - **Cómo se sirve:** función de servidor `portal-tecnico`, que valida el token y devuelve URL firmadas de corta duración para los PDF.
- **WhatsApp:** nuevo campo **teléfono** del técnico (+34) en la ficha. Si falta, se puede escribir en la pantalla de firma y se guarda.
  - Al confirmar la firma, el botón principal **"Enviar por WhatsApp"** abre `https://wa.me/<teléfono>?text=…` con un texto breve y el enlace al portal.
  - Se mantiene "Compartir PDF" (ya hecho en E-011) y el correo como opción secundaria.
- **Registro:** cada copia enviada (canal y fecha) queda en el historial de la entrega, con opción de reenviar.
- **Hecho cuando:** hay pruebas del token (hash, revocación, un técnico no ve lo de otro) y de la construcción del enlace `wa.me` con teléfonos en varios formatos.

### E-015 · Dar de alta artículos con la cámara del móvil · HECHO
**Petición del usuario:** poder dar de alta materiales, herramientas, EPIs, ropa… **con la cámara del móvil**, sin teclear la ficha entera.

**1. Dónde**
- Botón grande **"Nuevo con la cámara"** (56 px) en **Inventario** y en **Dotación** (herramientas, EPIs y ropa), y en el menú rápido del móvil.

**2. Flujo en tres toques**
1. **Leer el código** (si lo tiene): se escanea el código de barras, el EAN o el código de la etiqueta de Saltoki.
   - **Si ya existe** (por SKU, EAN o `supplierRef`), se abre esa ficha en lugar de crear un duplicado, y se ofrece "Registrar entrada".
   - **Si no existe**, el código queda precargado.
2. **Foto del producto o de su etiqueta:** la función de servidor `leer-articulo`, con el mismo proveedor de IA que `leer-albaran` (Gemini) y la clave solo en el servidor, extrae y **propone**:
   - nombre, marca, modelo o referencia del fabricante y EAN;
   - **categoría** sugerida;
   - **unidad y contenido**, detectados del envase ("bote 1000 ud", "bolsa 100", "rollo 100 m");
   - en herramientas, tipo, marca y modelo.
   - **Si la IA no está disponible** o falla, la ficha se rellena a mano con la foto ya puesta.
3. **Revisar y guardar:** formulario precargado y corregible.
   - **Campos:** categoría, propiedad (propia o custodia de Esmove), unidad y contenido, **stock inicial en el almacén**, y mínimo (solo el administrador).
   - **Foto:** la foto tomada queda como **foto del artículo** (E-009: WebP comprimido y miniatura, en el bucket privado).
   - **Guardar varios seguidos:** botón "Guardar y añadir otro".

**3. Reglas**
- **Permisos (E-004):** el administrador crea el artículo directamente. El personal de almacén lo crea como **borrador**, que el administrador completa o aprueba desde su bandeja.
- **Stock inicial:** entra como movimiento "Alta de artículo" en el almacén, nunca como edición directa.
- **Duplicados:** antes de guardar, la app busca parecidos por nombre y avisa: "¿Es alguno de estos?".
- **Sin cobertura:** la foto y la ficha se guardan en la cola y se suben después. La lectura con IA se hace al volver la conexión, y mientras tanto se deja rellenar a mano.
- **Privacidad:** son fotos de producto, no de personas. Se mantiene el aviso del nivel gratuito de Gemini.

**4. Hecho cuando**
- Hay pruebas de: detección de duplicado por código, borrador para el rol almacén, propuesta de la IA con unidad y contenido, alta sin IA, y foto guardada como foto del artículo.
- En el móvil, un alta completa lleva menos de un minuto.

### E-016 · Correcciones tras la primera carga real · HECHO
**Qué ha visto el chat en la app real (30/09).** El usuario no importó el CSV: dio de alta el stock **leyendo los 5 albaranes con la IA**, y eso ha dejado estos fallos.

**1. Emparejado de albaranes: un código distinto nunca es el mismo artículo (bug)**
- **Qué pasó en el albarán 3.322.577:**
  - la línea **6222106082 (moldura Hager 30x12, 20 m)** se registró como **6222110056 (tapa final)**, con +20;
  - la línea **6222110054 (ángulo interior, 10 ud)** se registró como **6222110053 (ángulo exterior)**, con +10.
  - El emparejado por descripción ganó a un código que no existía.
- **Regla nueva:** si la línea trae un código y ese código **no existe** en el catálogo, se propone **"Artículo nuevo"** con ese código. **Nunca** se empareja por descripción con otro artículo que tenga un código distinto. El emparejado por descripción queda solo para líneas **sin código**.
- **En la revisión:** las líneas "Artículo nuevo" se marcan en amarillo y el usuario puede confirmarlas o reasignarlas a mano.
- **Hecho cuando:** hay una prueba con estos dos casos reales, en la que moldura y ángulo interior salen como artículos nuevos.

**2. Artículos creados desde un albarán: unidad, formato, categoría y proveedor**
- **Todo ha entrado en `ud`.** Los cables y tubos (líneas `ML …`) deben ser `m`, y los formatos `BOTE n`, `BOLSA n`, `PACK n`, `SOBRE n` y `KOMMDATA BOLSA 25` deben ser `bote`, `bolsa`, `pack` o `sobre` con su contenido (E-013). Hay que aplicar la misma detección que el CSV del chat al crear artículos desde la lectura con IA.
- **Proveedor:** es el **emisor** del albarán, nunca el cliente. En el albarán 3.322.832 salió "BUFALA TECH" como proveedor de 7270020010, 6200020032 y 6201000032. Además, hay que normalizar las variantes "Saltoki Centro, S.A." y "SALTOKI ALCOBENDAS" a un único proveedor **Saltoki**, con la delegación aparte.
- **Categoría:** ahora hay errores como 2804000757 (bolsas de basura) en "Cables", 7280040060 (RJ45) en "Cables" o 6222110055 (ángulo plano) en "Aparamenta". Se usa la misma heurística del CSV (cable → cables; tubo, moldura, ángulo, junta o tapa ATEHA → tubos; Wago o borna → aparamenta; resto → fijaciones), y el usuario puede corregirla en la revisión.

**3. Importar catálogo: opción "Actualizar fichas existentes"**
- **Qué hace:** una casilla en Configuración → Importar catálogo que, para los SKU que ya existen, **actualiza nombre, categoría, proveedor, unidad y contenido sin tocar el stock**, con una vista previa de los cambios campo a campo. Así el usuario corrige de una vez las 19 fichas con unidad mal importando `datos/catalogo-stock-real.csv`.
- **Cambio de unidad** (`ud` → `m`, `ud` → `bote`): la cantidad **no se convierte**, porque el número ya es el del albarán (3 botes, 400 m).
- **Artículos que faltan:** la importación normal ya los crea con su stock de apertura. Hoy faltan 6222106082 (moldura, 20 m), 6222110054 (ángulo interior, 10 ud) y 9900101045 (cinta aislante negra, **20 ud**). **Corrección del usuario:** de la cinta solo llegó la **negra**; el "1" del albarán es un pack de Saltoki que contiene 20 rollos, así que en el almacén son **20 ud**. La cinta blanca (9900101044) **no se ha recibido** y sale del catálogo.

**4. Corregir una línea de un albarán ya ingresado**
- **Qué hace:** en Albaranes → detalle, la acción **"Reasignar línea"** (solo administrador) mueve la cantidad de una línea del artículo A al B. Genera un par de movimientos de **ajuste enlazados** (−A y +B) con motivo y referencia al albarán, sin borrar nada del historial.
- **Uso ahora:** con ella el usuario deja bien las dos líneas del punto 1 cuando existan los dos artículos nuevos.
- **Hecho cuando:** hay una prueba de reasignación (el stock de A baja, el de B sube y el historial conserva el movimiento original y los dos ajustes).

**6. Categorías configurables (decisión del usuario)**
- **Tabla `categorias`:** id, nombre, icono, color, orden y activa. Sustituye a la lista fija del código.
- **Gestión desde Configuración → Categorías (solo administrador):** crear, renombrar, cambiar icono y color, reordenar y desactivar. Una categoría con artículos no se borra: se desactiva y la app pide mover sus artículos a otra.
- **Fuera "Fontanería":** la empresa es de **instalaciones eléctricas, especializada en puntos de recarga**. La categoría se quita de los datos iniciales, de los filtros, del panel y de cualquier texto. Si tiene artículos, pasan a la que elija el usuario.
- **Categorías iniciales:**
  - Cargadores VE
  - Cuadros de protecciones
  - Cables
  - Tubos y canalización
  - Fijaciones
  - Aparamenta
  - Consumibles
  - EPIs
  - Ropa de trabajo
  - Herramientas
- **Mapa de las antiguas:** `tubos` pasa a "Tubos y canalización"; bolsas, cinta y bridas van a "Consumibles".
- **Reglas que dependen de la categoría** (heurística de importación y de la lectura con IA, y los filtros): usan la tabla, no nombres fijos en el código.

**7. Editar artículos (administrador)**
- **Botón "Editar"** en la ficha de cada artículo. Se pueden cambiar: nombre, código (SKU) y ref. del proveedor, EAN, categoría, proveedor, propiedad (propia o custodia) y propietario, unidad y contenido, mínimo, notas y foto.
- **Cambio de SKU:** el historial referencia al artículo por su id interno, así que no se pierde nada. Antes de guardar se avisa si el nuevo código ya existe.
- **Fusionar dos artículos:** para el caso "esto era el mismo artículo" (como lo del punto 1), el administrador puede **fusionar A en B**. El stock y el historial de A pasan a B mediante un movimiento de ajuste enlazado y A queda archivado, sin borrar nada.
- **El stock no se edita en la ficha:** se corrige con un ajuste (con motivo) o con "Reasignar línea" (punto 4).
- **Auditoría:** cada edición queda en la auditoría: quién, cuándo, y el valor anterior y el nuevo de cada campo.
- **Permisos (E-004):** el personal de almacén no edita fichas; solo puede proponer cambios en borrador, como en el alta.

**8. Equivalencias editables en la app**
- **Qué debe poder hacer el administrador** desde Configuración → Integraciones, sin tocar ficheros:
  - crear, editar, duplicar, activar o desactivar y borrar reglas en borrador;
  - editar la **partida** del wizard, las **condiciones** (campo del cierre, operador y valor), los **artículos** (buscador con foto), la **fórmula** (directa, factor, `floor(m/3)+1`, `ceil(m/0,5)` o kit) y la marca de "estimada".
- **Probar una regla:** botón "Probar" que aplica las reglas a un cierre de ejemplo, o a uno real ya recibido, y muestra qué descontaría **sin aplicar nada**.
- **Historial:** una regla confirmada que se edita guarda su versión anterior. Los cierres ya aplicados no se recalculan, salvo que el administrador lo pida para un periodo ("Recalcular cierres desde…"), que genera ajustes enlazados.
- **Kits de fijación A, B y C:** también se editan aquí (qué artículos y cuántos por fijación).

**5. Otros detalles**
- **Canaleta:** la equivalencia apunta a 6222106082 (moldura), que hoy no existe. En la lista de equivalencias, avisa en rojo de las reglas cuyo artículo no existe.
- **Fotos:** las de las bridas incoloras (5102050137 y 5102050149) se ven prácticamente en blanco, porque la foto de Saltoki es transparente sobre blanco. El usuario las sustituirá con la cámara. En las miniaturas, usar un fondo gris muy claro en lugar de blanco para que se distingan las piezas blancas.
- **Sin foto:** 2804000757 (bolsas de basura) y 8900590300 (Trydan Esmove); se harán con la cámara.

### E-017 · Salidas de material por equipo, no por técnico · HECHO
**Decisión del usuario:** las salidas de material se hacen **al equipo**, no a un técnico. Hoy el paso 1 de la entrega ("¿Quién recibe el material?") lista **técnicos** y deduce el equipo (`EntregasView.tsx`, `PasoQuien`). Hay que darle la vuelta.

**1. Nuevo flujo de entrega**
1. **Para qué equipo:** tarjetas de **equipo** (Búfala 1, 2, 3…) con su vehículo (matrícula) y sus técnicos actuales, más la obra opcional.
   - Un equipo **sin vehículo** aparece deshabilitado y explica el motivo.
   - El buscador sigue encontrando por equipo, técnico o matrícula, pero selecciona el **equipo**.
2. **Material:** igual que ahora. Entra en el **vehículo** del equipo (traspaso almacén → vehículo, E-013).
3. **Firma:** firma **el técnico del equipo que recoge**. Se elige en la pantalla de firma entre los técnicos **actuales** de ese equipo, con un toque sobre su nombre, y queda como "recogido por". Si el equipo tiene un solo técnico, se preselecciona.

**2. Datos**
- **La entrega pertenece al equipo:** `entregas.equipo` es obligatorio y es el destinatario. `receptor` pasa a llamarse "recogido por": técnico, obligatorio para firmar y que debe pertenecer al equipo en ese momento, según el historial de asignaciones.
- **Reservas, stock a bordo, cierres y consumos:** todo va por **equipo y vehículo**, sin cambios respecto a E-012 y E-013.
- **Entregas antiguas:** migración sin pérdida. Las ya existentes conservan su equipo y su técnico, que pasa a ser "recogido por".

**3. Pantallas e informes**
- **Historial de entregas e informe:** se agrupan y filtran **por equipo**, con la columna "recogido por".
- **Justificante PDF y WhatsApp:**
  - el PDF dice "Entrega al equipo Búfala 2 (4299NGK) · recoge y firma: …";
  - la copia se envía **al técnico que firma**; opcionalmente, también a los demás técnicos del equipo (casilla en la pantalla de firma).
- **Portal del técnico (E-014):** cada técnico ve las entregas **de su equipo** mientras pertenece a él (según las fechas del historial) y el material del vehículo de su equipo. No ve las de equipos anteriores ni las posteriores.

**4. Dotación personal: no cambia**
La ropa, los EPIs y las herramientas personales se siguen asignando **a la persona**, porque van con su talla y su responsabilidad. Si se entregan en la misma cesta, esas líneas quedan asignadas al técnico que firma, y la app lo indica en la línea ("dotación personal de …").

**5. Hecho cuando**
- Hay pruebas de: entrega a equipo con firma de uno de sus técnicos, rechazo si quien firma no pertenece al equipo, equipo sin vehículo bloqueado, migración de entregas antiguas, portal filtrado por pertenencia con fechas, y dotación personal asignada a quien firma.

### E-018 · Ajuste de inventario para el administrador · HECHO
**Qué ha visto el chat en la app real (30/09).** Al corregir la primera carga, el usuario creó la moldura (6222106082) y el ángulo interior (6222110054) **con stock inicial 20 m y 10 ud**, en lugar de 0, y no reasignó las líneas. Ahora ese material está **contado dos veces**:
- la tapa final (6222110056) tiene **30** y deberían ser **10**;
- el ángulo exterior (6222110053) tiene **20** y deberían ser **10**.

El diálogo de movimientos solo ofrece Entrada, Salida, A vehículo, Devolución y Merma. **No hay "Ajuste"**, y registrarlo como merma sería falso.

**Qué hacer**
- **Nuevo tipo "Ajuste de inventario"** en el diálogo de movimientos, **solo para el administrador**:
  - cantidad **positiva o negativa**, con **motivo obligatorio** (texto) y ubicación (almacén o vehículo);
  - muestra "de X a Y" antes de confirmar;
  - no cuenta como merma, ni como salida a obra, ni en consumos;
  - queda en el historial y en la auditoría como "Ajuste".
- **El personal de almacén** no ve la opción. Puede "Proponer ajuste", que llega a la bandeja del administrador, como los recuentos.
- **Aviso al crear un artículo con stock inicial:** si su código aparece ya en un albarán ingresado, avisar de que "Ese código ya ha entrado por el albarán X; ¿seguro que quieres añadir stock inicial?".
- **Guía, paso 15:** añadir qué hacer si ya se crearon con stock (ajuste −20 en la tapa final y −10 en el ángulo exterior, motivo "Duplicado de la corrección del albarán 3.322.577") en lugar de reasignar.

**Hecho cuando**
- Hay pruebas de: ajuste negativo y positivo del administrador, rechazo para el rol almacén, motivo obligatorio, sin efecto en mermas ni consumos, y el aviso de código ya ingresado por albarán.

### E-019 · Inventario completo en una sola lista, sin páginas · PENDIENTE
**Petición del usuario:** ver la **lista de materiales completa**, no por páginas. Hoy el inventario (Stock General) muestra unas 8 referencias por página ("Página 1 de 5").

**Qué hacer**
- **Una sola lista:** quitar la paginación del inventario y mostrar **todas las referencias** que cumplen los filtros, con desplazamiento vertical normal.
- **Cabecera fija:** la cabecera de la tabla queda **fija** al desplazarse.
- **Contador:** arriba se ve "Mostrando N de M referencias".
- **Filtros, buscador y orden:** siguen igual (categoría, estado, propiedad, ubicación). Se añade **ordenar por columna** con un toque en la cabecera: código, descripción, stock y estado.
- **Agrupar por categoría (opcional):** un interruptor que muestra la lista agrupada por categoría, con el nombre de cada una como separador y su número de referencias.
- **Rendimiento:** con 40 referencias no hace falta nada especial. Si algún día pasa de 300, usar virtualización (solo se pintan las filas visibles) sin cambiar el aspecto. Las miniaturas se siguen cargando al hacerse visibles (`loading="lazy"`).
- **Móvil:**
  - misma lista continua, en tarjetas, sin páginas;
  - botón flotante **"Subir"** cuando se ha bajado mucho;
  - los botones de cada fila mantienen su tamaño de 56 px.
- **Imprimir o exportar:** **"Exportar CSV"** exporta la lista completa con los filtros aplicados, y hay un botón **"Imprimir lista"** con una vista limpia: código, descripción, categoría, stock en almacén, stock por vehículo y mínimo, **sin fotos**.
- **Mismo criterio en las demás listas largas** que hoy tienen páginas (movimientos, entregas, cierres): lista continua con "Cargar más" al final cuando haya muchas (por ejemplo, de 100 en 100), para no traer el historial entero de golpe.

**Hecho cuando**
- Hay pruebas de: todas las referencias visibles sin paginación, filtros y orden aplicados sobre la lista completa, y CSV con la lista filtrada completa.
- En el móvil se recorren las 40 referencias desplazando, sin tocar ningún botón de página.

### E-020 · Firma sin bloqueos y escáner de códigos de barras en iPhone · HECHO
**Qué ha visto el chat con capturas del usuario en su iPhone (01/10).**

**1. Pantalla de firma: solo la firma es obligatoria.** **Ya aplicado por el chat** directamente en `Hojas.tsx` y `App.tsx` (commits del 01/10; 301 pruebas en verde, `tsc` y build correctos). Code solo tiene que revisarlo. Lo que se cambió:
- **El botón ya no se desactiva por `!recoge`.** Hoy, en un equipo con 2 técnicos, si nadie toca un nombre arriba, el botón "Firmar y recibir" queda gris **sin decir por qué**: le pasó al usuario. Ahora el botón solo exige la firma. Si falta quién recoge, desplaza la vista al selector (`id="quien-recoge"`, resaltado en ámbar con "toca un nombre") y muestra un aviso.
- **Teléfono, correo y "copia a los demás técnicos"** pasan a un `<details>` cerrado: **"Enviar copia por WhatsApp o correo (opcional)"**. Decisión del usuario: no hace falta poner ni teléfono ni correo. Tras firmar se abre el albarán con **"Compartir PDF"** como botón principal, y él lo envía.
- **Sin firma,** el botón dice "Firma arriba para continuar".
- **`App.tsx`:** `pb-28` pasa a `pb-[calc(10rem+env(safe-area-inset-bottom))]`. En el iPhone, la barra inferior y el botón flotante de escanear **tapaban** el botón de firmar.

**2. El escáner no lee códigos de barras en iPhone (bug grave)**
- **Causa:** `camara.ts` usa `BarcodeDetector` si existe y, si no, **jsQR, que solo lee QR**. Safari en iOS no tiene `BarcodeDetector`, así que en el iPhone **ningún código de barras (EAN-13, Code 128…) se lee**. En la captura leyó en su lugar el QR del fabricante (`http://tag.yt/zeSA7`) y salió "código desconocido".
- **Solución:** sustituir jsQR por un lector multiformato que funcione en iOS. Por ejemplo, el ponyfill `barcode-detector` (basado en ZXing, WebAssembly) o `@zxing/browser`.
  - **Formatos:** EAN-13, EAN-8, UPC-A/E, Code 128, Code 39, ITF, Codabar, QR y DataMatrix.
  - **El `.wasm` empaquetado con la app**, sin CDN, para que funcione sin cobertura y sin depender de terceros.
- **Cámara:**
  - pedir 1920×1080 si se puede, con enfoque continuo y la linterna disponible;
  - analizar el fotograma completo y probar también girado 90° (las cajas se escanean de lado);
  - leer unas 6–8 veces por segundo.
- **Prioridad del código del almacén:** si en el mismo fotograma hay un QR que es una URL ajena (como `tag.yt`) y un código de barras, gana el código de barras. Un QR `BUF:<SKU>` siempre gana. Si solo se lee una URL ajena, se muestra "QR del fabricante, no es un código del almacén" y se sigue escaneando unos segundos antes de darlo por desconocido.
- **Pruebas:** imágenes de prueba con EAN-13, Code 128 y QR (fixtures) leídas por el mismo módulo que usa la cámara.

**3. Asociar un código leído a un artículo que ya existe**
Los artículos tienen el **código de Saltoki** como SKU, pero las cajas traen el **EAN** del fabricante. Aunque el escáner lo lea, sale "desconocido". Hace falta enseñárselo a la app una vez:
- **En "Código desconocido",** además de "Crear con la cámara" y "Crear a mano", un botón principal **"Es un artículo que ya tengo"**. Abre un buscador con fotos y guarda el código leído como **código alternativo** de ese artículo.
- **Tabla `codigos_articulo`:** `codigo` único, `sku`, `tipo` (EAN, UPC, Code 128, QR, otro), quién y cuándo. Un artículo puede tener varios. El escáner, el buscador, la cesta de entregas y el emparejado de albaranes buscan también ahí.
- **Permisos:** el administrador asocia directamente. El personal de almacén también puede asociar, por rapidez en el pasillo, y queda en la auditoría; el administrador puede deshacerlo desde la ficha.
- **En la ficha del artículo,** sección "Códigos": lista, añadir escaneando y quitar.
- **Al crear un artículo nuevo** desde un código desconocido, ese código queda ya como su código alternativo.

**4. Hecho cuando**
- En el iPhone del usuario se leen los EAN de las cajas de cable y tubo de la nave.
- Asociar un EAN a un artículo hace que el siguiente escaneo lo abra directamente.
- Hay pruebas de: lector multiformato con fixtures, prioridad BUF y código de barras frente a URL ajena, asociación (alta, duplicado rechazado, borrado), y firma sin teléfono ni correo.

### E-021 · No se puede guardar la foto de un artículo creado desde un código raro · PENDIENTE (urgente, junto a E-020)
**Qué le ha pasado al usuario (01/10, desde el iPhone):** creó un artículo con la cámara desde un código "desconocido" y al guardar la foto salió **"Ruta de la foto no válida"**.

**Causa:**
- El escáner había leído el QR del fabricante `http://tag.yt/zeSA7` y la app lo usó **como SKU**.
- `rutasFoto()` construye `productos/${SKU}/…`, de modo que con ese SKU la ruta queda `productos/HTTP://TAG.YT/ZESA7/xxxx.webp`.
- En SQL, `_sku_de_ruta()` toma el segundo trozo separado por `/` (`HTTP:`), que no es igual al SKU, y `poner_foto` lanza "Ruta de la foto no válida".
- Además, Storage no admite `:` en las rutas.
- **Pasaría igual desde el ordenador:** es un fallo de datos, no del móvil.

**Qué hacer**
1. **Formato válido de SKU:** solo `A-Z`, `0-9`, `-`, `_` y `.`, sin espacios ni `/` ni `:`, de 2 a 40 caracteres. Se valida en la app y **en el servidor** (check en `productos.sku` y en las funciones de alta, edición e importación), con un mensaje claro en español.
2. **Crear desde un código leído que no sirve como SKU** (una URL, o con caracteres no válidos o demasiado largo):
   - la app **propone un SKU interno** (`BF-000123`, correlativo) que el usuario puede cambiar;
   - el código leído se guarda como **código alternativo** del artículo (`codigos_articulo`, E-020 §3), y el siguiente escaneo lo abre.
   - Un EAN normal (solo dígitos) sí puede ser el SKU si el usuario quiere, aunque se recomienda el código del proveedor.
3. **Rutas de foto robustas:** la carpeta de la foto no debe depender de que el SKU sea "bonito".
   - Usar una **clave segura** derivada del SKU (por ejemplo, el SKU con todo lo que no sea `A-Z0-9_.-` codificado de forma reversible, o el id interno del producto).
   - Actualizar a la vez `rutasFoto()`, `_sku_de_ruta()`, `puede_subir_foto()` y `poner_foto()` (migración nueva), sin romper las fotos ya subidas.
4. **Reparar lo que ya existe:**
   - una migración o comprobación lista los productos con SKU no válido (al menos el creado hoy con `HTTP://TAG.YT/…`);
   - el administrador los ve en su bandeja como "Código no válido: cámbialo" y los corrige con **Editar** (E-016), que mueve su historial;
   - el código antiguo queda como código alternativo.
5. **Mensajes de error comprensibles:** si una subida de foto falla, decir el motivo en lenguaje normal ("El código del artículo tiene caracteres no válidos (/ :). Cámbialo en Editar y vuelve a hacer la foto") y no el texto técnico del servidor. La foto queda en la cola del móvil y se reintenta sola cuando se corrige el código.
6. **Hecho cuando**
   - Hay pruebas de: SKU con URL rechazado en el servidor, alta desde un QR ajeno con SKU interno y código alternativo, foto subida para un SKU con `.` y `-`, reparación del artículo existente y reintento de la foto en cola.
   - En el iPhone del usuario se crea un artículo con la cámara y su foto se guarda.

### E-022 · Borrar, fusionar y cambiar el código de una referencia sin quedarse bloqueado · PENDIENTE (urgente)
**Qué le ha pasado al usuario, que es administrador (01/10).** Con la referencia **TRY32-1-L10-P**, un Trydan 7,4 kW con cable de 10 m en custodia de Esmove:
1. **La borró**, la app dijo "borrada" y **volvió a aparecer**.
2. **La fusionó** con otra.
3. **Al cambiarle el SKU a 8900500020** salió **"Ya existe una referencia con el SKU 8900500020"**, sin decir cuál ni qué hacer.

El administrador tiene que poder hacer estas tres cosas, y que queden reflejadas.

**Causas encontradas por el chat en el código**
- **Borrar:** `borrarProducto` en `ops.ts` solo comprueba en local los movimientos y el stock, y quita la referencia al momento. En el servidor, `borrar_producto` **también** rechaza si hay `pendientes` con ese SKU (y no mira entregas, cierres, líneas de albarán, códigos ni avisos). Si el servidor rechaza, la siguiente sincronización **devuelve la referencia** y el usuario no ve el motivo.
- **SKU ocupado por un archivado:** `cambiar_codigo_producto` y el alta comprueban `exists (select 1 from productos where sku = v_nuevo)` **incluyendo los archivados**. Un artículo fusionado sigue ocupando su código para siempre, aunque no se vea en ninguna lista. Además, el mensaje no dice si el código lo tiene un artículo activo o uno archivado.

**Qué hacer**
1. **Las mismas reglas en local y en el servidor** para borrar:
   - **Borrar definitivamente** solo si no hay ningún rastro: movimientos, pendientes, entregas (también preparadas o anuladas), líneas de albarán, consumos de cierres, avisos, códigos alternativos y fotos.
   - **Si hay rastro,** el botón ofrece **"Archivar"**: deja de salir en listas, buscador, escáner y entregas, pero el historial la conserva. No dice "borrada".
   - El mensaje explica qué la retiene ("Tiene 2 movimientos y 1 pendiente en tu bandeja").
2. **Ninguna operación rechazada por el servidor puede quedar como hecha en pantalla:**
   - si la cola recibe un rechazo, deshace el cambio local al momento;
   - muestra un aviso con el motivo en lenguaje normal;
   - lo deja en la **bandeja del administrador**, en "Operaciones rechazadas", con un botón para reintentar o descartar.
   - Revisar todas las operaciones de `ops.ts` con este criterio, no solo borrar.
3. **Los archivados no bloquean códigos:**
   - al archivar o fusionar, el SKU del archivado pasa a un código interno (`<SKU>~A1`, `~A2`…) y el original se guarda en `sku_original`, para que el historial y el buscador de movimientos lo sigan encontrando por el código antiguo;
   - con eso, `cambiar_codigo_producto`, el alta y la importación solo chocan con **activos**;
   - migración para liberar los códigos de los archivados que ya existen.
4. **Si el código choca con un artículo activo,** el mensaje dice **cuál es** (nombre y foto) y ofrece "Abrir esa ficha" o "Fusionar en ella".
5. **Vista "Archivados" (solo administrador)** en Configuración o en el inventario con un filtro. Para cada uno: de qué se fusionó y en cuál, fecha y quién, y estas acciones:
   - **Restaurar:** vuelve a estar activo con su código, si está libre; si no, pide otro.
   - **Deshacer fusión:** si desde entonces no ha habido movimientos del destino que lo impidan, revierte los ajustes enlazados; si no, lo explica.
   - **Borrar definitivamente:** solo sin ningún rastro.
6. **Reparar el caso del usuario:**
   - revisar en la base real el estado de **TRY32-1-L10-P** y **8900500020**: cuál está activo, cuál archivado, stock y movimientos;
   - dejarlo como el usuario quiere, que es **un solo artículo activo con el SKU 8900500020** y todo su historial;
   - si hace falta tocar datos reales, contarlo en la respuesta.
7. **Hecho cuando**
   - Hay pruebas de: borrar con y sin rastro (local y servidor iguales), rechazo del servidor que deshace el cambio local y deja la operación en la bandeja, fusión que libera el código, cambio de SKU al código de un archivado, restaurar y deshacer fusión, y mensaje de choque con un activo.
   - El usuario puede dejar el Trydan como 8900500020.

**Relación con E-021:** la referencia de los clavos (`HTTP://TAG.YT/ZESA7`, EAN 3439510575536) no admite foto por el SKU con `:` y `/`; lo resuelve E-021. Mientras tanto, el usuario puede cambiarle el SKU, por ejemplo a su EAN, y repetir la foto. Comprobar que ese cambio de código funciona con este artículo y que la foto que se quedó en la cola del móvil con la ruta antigua se descarta o se rehace sola.

---

## Revisión del chat

### 01/10/2026 · Chat: borrar, fusionar y cambiar código
- **Lo que le ha pasado al usuario:** una referencia que reaparece tras borrarla, y un código ocupado por un artículo fusionado (archivado).
- **E-022 (urgente).**
- **Orden: E-020 + E-021 + E-022 → E-019.**

### 01/10/2026 · Chat: firma bloqueada y escáner en iPhone
- **Problemas reales en el iPhone del usuario:**
  - "Firmar y recibir" no se activaba porque no se había tocado quién recoge, y la pantalla no lo decía;
  - el escáner no lee códigos de barras (solo QR).
- **E-020 (urgente)** recoge los dos problemas, con la firma ya arreglada y subida por el chat.
- **Error al guardar la foto** de un artículo creado desde el QR del fabricante: va en **E-021**.
- **Orden: E-020 + E-021 → E-019** (o terminar E-019 si ya está casi hecho y seguir con E-020 y E-021).

### 30/09/2026 · Revisión de E-016 y E-017, y estado de la app real
Verificado desde el chat sobre `75da231`:
- **289 pruebas en verde**, `tsc -b` sin errores y build correcto.
- La publicación de E-016 y E-017 está bien.
- Las migraciones están aplicadas en Supabase: la sección Categorías funciona y la app aparece "Sincronizado".
- El chat ha quitado "fontanería" de "Acerca de" y de la descripción de la web (`097d1f9` y `df1bb2e`).

En la app real:
- Unidades corregidas (m, botes, bolsas, sobres y pack).
- La cinta negra tiene 20 ud.
- Policharger NW T2 (24 ud, custodia de Esmove) dado de alta por el usuario.
- 1 Trydan con Schuko traspasado a Búfala 1.
- 18 equivalencias en borrador y ninguna en rojo; **faltan por confirmar**.
- **Stock duplicado** en la tapa final y el ángulo exterior (se explica en E-018).
- **E-019 (nuevo, a petición del usuario):** inventario completo en una sola lista, sin páginas.

**Orden: E-018 → E-019.**

### 30/09/2026 · Chat: publicación fallida arreglada y salidas por equipo
- **Publicación:** el fallo de `f43f1dc` lo causó el chat. La prueba del catálogo real esperaba 40 artículos, y al quitar la cinta blanca quedan 39. Se ha corregido en `16e0271` (257 pruebas en verde y publicación correcta). A partir de ahora el chat ejecuta las pruebas antes de subir cambios en `datos/`.
- **E-017 (nuevo):** las salidas de material se hacen al equipo; el técnico solo firma la recogida.
- **Orden: E-016 → E-017.**

### 30/09/2026 · Revisión de E-012 a E-015 y de la primera carga real
Verificado desde el chat sobre `dc8bdc1`:
- `npm ci`, **257 pruebas en verde**, `tsc -b` sin errores y `npm run build` correcto.
- `registrar-cierre` valida el hash del token y rechaza los revocados.
- `portal-tecnico` usa URL firmadas de corta duración.
- `apps-script-almacen.gs` guarda el token en las Propiedades del script.

En la app real:
- Los ejemplos están borrados (30/09, 20:03).
- Los equipos, vehículos y técnicos están dados de alta.
- 34 de 36 artículos tienen foto.
- El chat ha cargado las equivalencias como borrador (18 reglas; **falta que el usuario las confirme**).
- Todavía no hay token ni Apps Script conectado.
- Los fallos detectados van en **E-016**, junto con lo que el usuario ha pedido después: categorías configurables sin Fontanería, edición de artículos y equivalencias editables en la app.

**Orden: E-016.**

### 30/09/2026 · Chat: botón de borrar ejemplos, fotos de Saltoki y alta con cámara
- **E-013:** el botón **"Borrar datos de ejemplo"** en Configuración queda explícito y es lo primero que se hace.
- **E-015 (nuevo):** alta de artículos y dotación con la cámara.
- **Fotos de Saltoki:** las descarga el chat desde la sesión del usuario en Saltoki Online, con nombre `<código>.webp`, para el importador por lote de E-009. Code no tiene que hacer nada.
- **Orden: E-013 → E-015 → E-014 → E-012.**

### 30/09/2026 · Revisión de E-011 y nuevos encargos
Verificado desde el chat sobre `aeb4e8a`:
- `npm ci`, **160 pruebas en verde**, `tsc -b` sin errores y `npm run build` correcto.
- No queda ninguna referencia a plantillas en la interfaz.
- Ya existe compartir el PDF desde el móvil.

Nuevo, tras hablar con el usuario:
- **E-013:** sin precios, formatos de venta, sin series de cargadores, ubicación almacén o vehículo, borrado de la demostración e importación del stock real.
- **E-014:** portal del técnico y WhatsApp.
- **E-012:** concretado tras estudiar el wizard `bufala` y con las reglas de manguitos y fijaciones del usuario.

**Orden: E-013 → E-014 → E-012.**

### 30/09/2026 · Revisión de E-009, E-010 y de la puesta en marcha
Verificado desde el chat sobre `420c51d`:
- `npm ci`, **148 pruebas en verde** (17 ficheros), `tsc -b` sin errores y `npm run build` correcto.
- No hay contraseñas, claves ni cadenas de conexión en el repositorio.
- E-010 aplicado:
  - custodia con `price: null`;
  - bloqueo del último administrador también en Auth;
  - CORS por `ORIGEN_APP`.
- E-009: bucket privado, lectura solo con sesión y sustitución solo para el administrador.

Puesta en marcha del usuario, comprobada:
- **GitHub Pages:** publica correctamente. La app carga, con sesión de administrador y el estado "Sincronizado".
- **Custodia en la app:** Esmove aparece en unidades, fuera del valor del inventario.
- **Copia de seguridad:** la ejecución manual n.º 2 terminó correctamente y la copia se hizo completa, sin el aviso "Copia desactivada". Bien resueltos el `ping()` y la contraseña con símbolos.

Nuevo:
- **E-011:** sustituye las plantillas por una cesta libre con firma y copia por correo al técnico.
- **E-012:** en espera de información del otro proyecto.

Orden: **E-011 → E-012** (cuando haya datos).

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

### 30/09/2026 · E-011 · HECHO
**1. Sin nada predeterminado**
- Fuera de la interfaz: la sección Plantillas, el selector de plantilla, "Preparar desde plantilla" (también el botón de Equipos) y el modo kit. `grep -ri plantilla src` solo da comentarios de código.
- Borrados `Plantillas.tsx`, `domain/plantillas.ts` (con su prueba), `SEED_PLANTILLAS` y la operación `plantilla`.
- Migración `20261003000100_e011_entregas_libres.sql`:
  - `plantillas_entrega` y `plantilla_lineas` se conservan con sus datos, con un comentario "SIN USO desde E-011";
  - se retira el permiso de ejecutar `guardar_plantilla`;
  - la app ya no carga esas tablas.
- Se conservan de E-007 la reserva, la caducidad, `confirmar_entrega` atómica, la huella, la firma en pantalla grande y las tallas del técnico (ahora sirven para preseleccionar la talla).

**2. Nueva entrega en tres pasos** (`EntregasView.tsx`, botones de 56 px)
1. **Para quién:**
   - buscador de técnicos por nombre, equipo o furgoneta, con un icono si tiene correo;
   - un técnico sin equipo sale desactivado, porque el servidor lo exige;
   - obra opcional.
2. **Material:**
   - buscador con foto, nombre, SKU y disponible (stock menos lo reservado) y filtros por categoría;
   - **escáner en modo seguido**: cámara en la misma pantalla, cada lectura suma, con un registro de las últimas lecturas y vibración; también se puede escribir el código;
   - cada línea tiene − y +, talla en la línea (ropa y EPIs; sale la de la ficha y se cambia con un desplegable), n.º de serie en los cargadores (leído o elegido) y avisos de stock o de serie en la propia línea;
   - "Guardar preparada" reserva el stock durante `horasReserva`.
3. **Firma:** resumen grande con fotos y cantidades, correo de la copia, firma con el dedo y "Firmar y recibir". Por dentro hace preparar y confirmar seguidos en la cola.
- La **cesta** está en `Estado.cesta` (con `obra` y `paso`) y se guarda en el dispositivo.
- Reglas puras en `src/domain/entregas.ts`; la tienda (`features/entregas/cesta.ts`) solo guarda y avisa.
- El hook de cámara pasa a `features/escaner/camara.ts`, compartido con el escáner, con `pausarConModal` y `repetirMs`.

**3. Correo y copia**
- **Correo del técnico:**
  - `tecnicos.email`, validado en la base de datos y en la app;
  - `guardar_email_tecnico` lo puede usar cualquier usuario activo, y es lo único que el almacén puede editar de la ficha;
  - `guardar_tecnico` (administrador) también lo acepta;
  - en Equipos → Técnicos se ve y se edita, y el alta de técnico lo pide.
- **Envío al firmar:**
  - `confirmar_entrega` encola la copia **en la misma transacción** (`_encolar_copia_entrega`), con destino el técnico y, si se marca en Configuración → Avisos, también la administración (`copia_entregas_admin`);
  - asunto del tipo "Entrega de material n.º ENT-2026-0413 · 30/09/2026";
  - si el técnico no tiene correo, no se encola nada.
- **PDF:**
  - `notificar` genera el justificante firmado con `_compartido/justificante.ts` y `npm:jspdf` y lo adjunta en Resend; comprobado en Deno, firma PNG incluida;
  - la app usa el mismo generador, ahora con `jspdf` empaquetado en un trozo aparte en lugar del CDN, así que el PDF se genera sin conexión y con las fotos.
- **Registro y reenvío:**
  - `envios_aviso.entrega_id`; el almacén puede leer esas filas (política `envios_entregas`), pero no el resto del registro;
  - "Últimas entregas" y el albarán muestran si llegó la copia (enviada, enviando, no enviada o sin copia);
  - `reenviar_copia_entrega(id, correo?)` descarta los intentos anteriores y encola uno nuevo, guardando el correo si se escribe;
  - reintentos: hasta 5, con la regla pura en `_compartido/envios.ts`.
- **Sin dominio en Resend:** la pantalla de firma y el albarán avisan. El albarán tiene "Compartir PDF" (compartir nativo del móvil; si no se puede, descarga) y "Descargar PDF". La guía, paso 8, tiene un apartado nuevo que explica que hace falta un dominio verificado.

**Pruebas:** 160 en verde (`npm test`, de ellas 92 de base de datos).
- `src/domain/entregas.test.ts` (10): escaneo repetido que suma, QR de cargador con serie sin duplicar, códigos desconocidos, talla preseleccionada y editable, límites de stock, serie obligatoria, reserva y su caducidad, firma atómica, y correo y reenvío.
- `supabase/tests/e011.test.ts` (7): correo, copia encolada al firmar sin duplicar, copia al administrador, sin correo, reenvío con registro, visibilidad para el almacén, serie obligatoria y plantillas sin uso.
- `funciones.test.ts`: reintentos y estado de la copia.
- `contrato.test.ts` actualizado.
- `tsc -b` sin errores, `npm run build` correcto y `deno check` de las tres funciones sin errores.

**Probado en el navegador (modo demostración, móvil):**
- flujo completo: técnico → pantalón (sale en talla 44 por la ficha de Luis) → un código leído dos veces suma 2 → QR de cargador con serie (repetido, avisa) → código desconocido (avisa) → firma → stock descontado, huella, cesta vacía y albarán con Compartir, Descargar e Imprimir;
- el PDF se genera;
- "Guardar preparada" reserva el material 48 h, que se firma después desde la lista, guardando el correo nuevo en la ficha;
- un correo mal escrito bloquea la firma.

**Desplegado:** la migración y `notificar` en el Supabase del usuario, comprobado con una consulta de solo lectura.

**Sin verificar aquí:** el envío real del correo con el adjunto. Con `onboarding@resend.dev` solo llegaría al correo del administrador; hace falta que el usuario verifique su dominio en Resend.

**Decisiones:**
- En la cesta libre solo hay artículos del catálogo. Las **herramientas** de la dotación se siguen asignando desde Herramientas, EPIs y ropa. Las entregas preparadas antiguas con herramientas se siguen pudiendo firmar.
- El PDF del correo va **sin fotos**: el servidor no convierte WebP. El PDF de la app sí las lleva.
- En la nube, si el que firma es administrador, la copia sale al momento. Si es del almacén, la envía la tarea programada en menos de un minuto.
- Corregido de paso un fallo mío de ayer en Configuración → Avisos: "Enviar prueba" con cambios sin guardar partía los destinatarios por la letra "s" (a la expresión le faltaba una barra).

### 30/09/2026 · E-013 · HECHO
**1. Sin precios**
- Fuera de todas las pantallas, CSV y PDF: precio, valor del inventario, costes de dotación e importes de incidencias. `verCostes` desaparece de los permisos.
- Las tablas `costes_*` se conservan sin uso: `guardar_producto`, `alta_dotacion` e incidencias ignoran cualquier precio que llegue.
- **Mermas:** se aplican al momento, las registre quien las registre. Cada una deja un aviso `aplicada` en la bandeja del administrador (quién, qué, cuánto, motivo y dónde: almacén o vehículo), con el botón **Visto** (`marcar_merma_vista`). Si la registra el almacén, además sale por los canales inmediatos de E-006 (tipo de envío `merma`). La regla de los 50 € y `valores_pendientes` quedan sin uso.
- Las mermas de custodia siguen generando la incidencia para Esmove.

**2. Formatos de venta**
- Unidades `m`, `ud`, `bote`, `sobre`, `bolsa`, `pack` y `caja`, con `contenido` (bote de 1000 → 1000).
- El stock del almacén va en formatos y solo se mueven formatos enteros (salida, traspaso, devolución y entrega). Los metros admiten decimales.
- El stock de los vehículos (`stock_vehiculo.unidades`) va en unidades de contenido, para los consumos de E-012; puede quedar negativo (discrepancia).
- "Añadir referencia" pide unidad, contenido, propiedad y mínimo (vacío = por completar), como el CSV.

**3. Sin n.º de serie**
- Restricción `productos_sin_serie`; las series que lleguen (QR antiguos `BUF:SKU|SN:…`) se ignoran. El QR de estantería es `BUF:<SKU>`.
- Cargadores y medidores van por modelo y cantidad en entradas, entregas, escáner, custodia y el informe para Esmove (sin columna de serie).

**4. Almacén + vehículos, y equipos, técnicos y vehículos con historial**
- Tablas nuevas: `vehiculos` (matrícula y modelo), `asignaciones_tecnico`, `asignaciones_vehiculo` y `stock_vehiculo`. Las matrículas que había pasan a ser vehículos asignados a su equipo.
- Funciones del administrador: `guardar_vehiculo`, `asignar_vehiculo` (cierra la asignación anterior; si el equipo ya tenía otro vehículo, ese queda sin equipo), `asignar_tecnico`, `baja_tecnico` y `baja_vehiculo` (no se puede con material a bordo). El historial nunca se borra.
- `vehiculo_de_equipo(equipo, fecha)` da el vehículo de un equipo en una fecha, para los cierres de E-012.
- Movimientos `traspaso` (almacén → vehículo) y `devolucion` (vehículo → almacén), y merma en un vehículo.
- **Entregas:** el material de instalación entra en el vehículo que el equipo tiene en ese momento (sin vehículo, la app y el servidor lo impiden y lo explican). Ropa y EPIs siguen yendo al técnico. `registrar_entrega` (la directa antigua) queda sin permiso.
- **Pantallas:**
  - Inventario: "Almacén X · Búfala 1 Y" por artículo y filtro por ubicación.
  - Equipos y técnicos: pestañas equipos, vehículos, técnicos e historial, con selectores en cada tarjeta. El técnico tiene código y teléfono.
  - Hoja de movimiento: nuevo tipo **A vehículo** (carga) y **Devolución**, con selector de vehículo.
- Los avisos de mínimo miran solo el almacén. Fuera pasillo, estantería y nivel: el recuento va por categoría.

**5. Pasar a datos reales** (Configuración → *Pasar a datos reales*, solo administrador)
- **Borrar datos de ejemplo:**
  - botón rojo que explica qué se borra y qué se conserva, y pide escribir `BORRAR DEMO`;
  - llama a `limpiar_demostracion()`, que quita los bloqueos del historial solo dentro de su transacción (marca `almacen.limpieza_demo`), borra, deja `config_app.modo_demo = false`, escribe en `auditoria` y devuelve las rutas de las fotos, que la app borra del almacenamiento;
  - después queda la fecha y quién lo hizo. Una segunda llamada falla.
- **Importar catálogo (CSV):**
  - vista previa con tres listas (nuevos, ya existen, con errores: unidad, categoría o propietario desconocidos, SKU repetido, formato no entero…);
  - "1000 ud" y "10 bolsas" se leen como 1000 y 10;
  - el stock inicial entra como "Inventario de apertura" con la referencia "Albaranes …";
  - idempotente por SKU y albaranes, en la app y en `importar_catalogo`.
- **Completar mínimo (N):** abre Mínimos y objetivos filtrado a los artículos sin mínimo.
- `seed.sql` ya no se carga por defecto (`[db.seed] enabled = false`); las pruebas lo cargan explícitamente. Una instalación nueva empieza con `modo_demo = false`; la base del usuario, que tiene la demo, empieza en `true`.
- Guía: paso 2.4 reescrito y **paso 12 "Pasar a datos reales"** nuevo.

**Pruebas:** 185 en verde (`npm test`), de ellas 115 de base de datos.
- `supabase/tests/e013.test.ts` (17): sin importes; traspaso y devolución que no cambian el total; formatos enteros; cargador sin serie; técnico que cambia de equipo sin mover material; vehículo que cambia de equipo con su stock; `vehiculo_de_equipo` en una fecha anterior al cambio; entrega a un equipo sin vehículo; bajas; borrado de la demostración una sola vez (con fotos); historial protegido fuera del borrado; importación idempotente y sus errores.
- `supabase/tests/actualizacion.test.ts` (5): la migración sobre una base **ya en uso** (fixture con los datos de antes y actividad hecha con las funciones antiguas: salida con serie y entrega firmada). Las huellas de las entregas siguen cuadrando y el borrado de la demostración funciona encima.
- `src/domain/catalogoCsv.test.ts` (5): el CSV real se lee sin errores (40 artículos, mínimos por completar), errores marcados y doble importación sin duplicar.
- Adaptadas al modelo nuevo: e002, e004, e006, e007, e011, contrato, reglas, entregas, mapeo, informe y ops.
- `tsc -b` sin errores, `npm run build` correcto y `deno check` de las tres funciones sin errores.

**Probado en el navegador (modo demostración):** borrar datos de ejemplo (escribiendo la frase) → importar `catalogo-stock-real.csv` (40 nuevos) → Completar mínimo (40 → 39 al guardar uno) → cargar 1 m de cable en un vehículo desde la hoja de movimiento.

**Desplegado:** migración `20261004000100_e013_datos_reales.sql` y `notificar` (el informe de custodia lleva "En vehículos" y la matrícula; el justificante, el vehículo).

**Para el usuario:** Configuración → *Pasar a datos reales*: borrar los datos de ejemplo, importar `datos/catalogo-stock-real.csv`, completar los mínimos y dar de alta vehículos, equipos y técnicos reales (guía, paso 12). Mientras no se borre, la demo sigue funcionando con el modelo nuevo.

**Decisiones:**
- El borrado en la nube se hace en directo, no por la cola: necesita conexión y así puede borrar las fotos con la respuesta del servidor. La importación va por la cola, porque es idempotente.
- Los avisos de merma no llevan importes.
- La tabla `series` y las columnas de serie se conservan sin uso, como las de costes.
- Cambiar de equipo a un técnico no cambia las entregas ya firmadas; el material sigue en el vehículo al que entró.
- Corregidos de paso dos fallos:
  - `limpiar_demostracion` nombraba una tabla que ya no existía (`pedidos_reposicion`); lo detectó la prueba nueva;
  - la hoja de movimiento no pasaba el vehículo al registrar (`mover()`), así que devoluciones, mermas en vehículo y cargas fallaban con "Indica el vehículo".

### 30/09/2026 · E-015 · HECHO
**Dónde:** botón **"Nuevo con la cámara"** (56 px) en Inventario (escritorio y móvil), en Herramientas, EPIs y ropa, y en el menú del móvil. El escáner, ante un código desconocido, ofrece "Crear con la cámara" (y "Crear a mano").

**Flujo** (`src/features/altaCamara/AltaCamara.tsx`)
1. **Código:** cámara en la misma hoja, o escribirlo, o "No tiene código".
   - **Si ya existe** (SKU, EAN, código del proveedor, QR `BUF:` o código de Saltoki con sufijo), no se crea nada: se ofrece **Registrar entrada** o **Abrir la ficha**.
2. **Foto** con la cámara trasera. La función `leer-articulo` propone nombre, marca, modelo, referencia, EAN (solo si cuadra su dígito de control), categoría, **unidad y contenido** ("bote 1000 ud", "bolsa 100", "rollo 100 m" → metros) y talla en ropa y EPIs.
3. **Revisar y guardar:**
   - formulario precargado: tipo (material, ropa, EPI o herramienta), nombre, categoría, unidad y contenido, stock inicial, mínimo (solo el administrador), propiedad y, plegados, SKU, EAN, código y proveedor;
   - **"¿Es alguno de estos?"** con los parecidos por nombre;
   - **Guardar** o **Guardar y añadir otro**;
   - la foto queda como **foto del artículo** (E-009: WebP, miniatura, bucket privado y cola de subidas sin cobertura).
- **Sin IA** (demostración, fallo o sin conexión), la ficha se rellena a mano con la foto ya puesta. Sin conexión, el botón **Leer con IA** vuelve a estar activo al recuperarla.

**Reglas**
- **Administrador:** crea el artículo directamente (`guardar_producto`); el stock inicial entra como movimiento "Alta de artículo".
- **Almacén:** crea un **borrador** con la ficha completa y el stock que ha contado (`crear_borrador_articulo`, columnas `stock_propuesto` y `propuesto_por`). El stock no entra hasta que el administrador lo aprueba:
  - la bandeja del administrador tiene la sección **"Artículos en borrador"** con **Revisar y aprobar**;
  - el formulario sale precargado con lo contado;
  - al aprobar, entra como "Alta de artículo · Borrador aprobado", una sola vez;
  - si el administrador corrige la cifra, manda la suya.
- **Duplicados:** por código en la app y en el servidor (SKU, EAN y código del proveedor); por nombre, con el aviso antes de guardar.
- **Reintentos de la cola:** el mismo borrador enviado dos veces devuelve "duplicado", sin error.
- **Herramientas:** se crean como ficha de dotación (una unidad, operativa, con n.º de serie y el alta en su historial), solo el administrador.

**Servidor**
- `supabase/functions/leer-articulo` (nueva).
- `_compartido/articulo.ts`: prompt, esquema, normalización y detección de unidad y EAN.
- `_compartido/gemini.ts`: la llamada con reintentos y modelo de reserva sale de `leer-albaran`, que ahora la comparte.
- Migración `20261005000100_e015_alta_camara.sql`.
- La URL de la app sale sola de `VITE_ALBARANES_URL` (`leer-albaran` → `leer-articulo`), o de `VITE_ARTICULOS_URL` si se define. No hace falta tocar GitHub.

**Pruebas:** 207 en verde (`npm test`).
- `src/domain/altaCamara.test.ts` (9): duplicado por código (incluido el sufijo de Saltoki) y por nombre; la propuesta de la IA llega al formulario con unidad y contenido; alta sin IA; borrador del almacén sin stock hasta aprobarlo; foto como foto del artículo; herramientas solo del administrador; ropa con modelo y talla.
- `supabase/tests/e015.test.ts` (5): borrador con stock propuesto, reintento, duplicados por EAN y por código del proveedor, aprobación que mete el stock una sola vez, corrección del administrador y contrato app ↔ servidor de las tres altas.
- `supabase/tests/articulo.test.ts` (8): unidad y contenido del envase, limpieza de la propuesta, EAN-8, EAN-13 y UPC-A, prompt sin precios ni series, y reintentos y errores de Gemini con `fetch` simulado.
- `tsc -b` sin errores, `npm run build` correcto y `deno check` de las cuatro funciones sin errores.

**Probado en el navegador (móvil, demostración):**
- código existente → "Ya existe" con Registrar entrada;
- código nuevo → foto (simulada) → ficha a mano con la foto;
- nombre parecido → "¿Es alguno de estos?";
- bolsa de 100 con stock 2 → guardado con foto, formato y "Alta de artículo".

**Desplegado:** migración, `leer-articulo` (responde 401 sin sesión y CORS correcto) y `leer-albaran`.

**Sin verificar aquí:** la lectura real con Gemini (hace falta una foto de verdad y sesión en la app publicada) y la cámara física (el navegador de pruebas no la tiene). El tiempo de menos de un minuto por alta hay que medirlo en el móvil.

**Decisiones:**
- Las herramientas no guardan la foto en su ficha: la dotación no tiene campo de foto y E-009 las muestra con la del catálogo por modelo. Si se quiere, es una columna más.
- El almacén no fija el mínimo; lo completa el administrador al aprobar (tarea "Completar mínimo").
- **Corrección pendiente de E-013:** el prompt de `leer-albaran` seguía pidiendo multiplicar cajas por unidades y extraer series. Ahora pide la cantidad en el formato del catálogo (1000 tacos de una "caja de 100" son 10 cajas), con el contenido en la lista, y sin series.

### 30/09/2026 · E-014 · HECHO
**Enlace personal (solo el hash)**
- El token (32 bytes aleatorios, 43 caracteres) lo genera **el dispositivo que envía** la copia; al servidor solo le llega su SHA-256 (tabla `portal_enlaces`, sin columna de token).
- **Decisión:** cada envío por WhatsApp lleva **un enlace nuevo** del mismo técnico. Como solo se guarda el hash, un enlace no se puede recuperar para reenviarlo. Así además funciona sin cobertura (`crear_enlace_portal` va por la cola).
- **Revocar:** el administrador, desde la fila del técnico → **Portal**, revoca **todos** sus enlaces de una vez (`revocar_enlaces_portal`, con auditoría), o revoca y genera uno nuevo (se muestra una sola vez, con Copiar y Enviar por WhatsApp).
- Un técnico dado de baja no ve nada.

**Portal** (`#/tecnico/<token>`, `src/features/portal/PortalTecnico.tsx`)
- Página aparte, sin sesión y de solo lectura, que se carga solo si se abre el enlace.
- **Muestra:** lo que lleva el vehículo de su equipo (en formatos y unidades) y sus entregas firmadas con líneas, fotos y el botón **PDF**.
- **Función `portal-tecnico`** (`verify_jwt = false`, porque valida el token ella misma):
  - calcula el hash y llama a `portal_datos(hash)`, que solo puede ejecutar el servidor (`service_role`);
  - firma las fotos durante 1 hora;
  - para el PDF comprueba `portal_entrega_permitida`, lo genera la primera vez en el bucket privado `justificantes` y devuelve una URL firmada de 10 minutos.
- La generación del PDF pasa a `_compartido/pdf-entrega.ts`, compartida con `notificar`.
- **En la demostración** el portal se calcula en el navegador (`datosPortalLocal`), con la misma forma de datos.

**WhatsApp**
- Teléfono del técnico en formato internacional:
  - en la ficha (administrador);
  - en la **pantalla de firma**, que ahora pide "WhatsApp de…" y lo guarda;
  - o en el propio albarán (`guardar_telefono_tecnico`, abierto a cualquier usuario activo, como el correo).
- En el albarán, tras firmar, el botón principal es **Enviar por WhatsApp**: abre `wa.me` con un texto breve (número, fecha, líneas) y el enlace al portal.
- El token se prepara al abrir el albarán, para que WhatsApp se abra en el mismo toque (los móviles bloquean las ventanas que se abren tarde).
- Se mantienen **Compartir PDF** y el correo como opciones secundarias.

**Registro:** `copias_entrega` (WhatsApp y PDF compartido) más `envios_aviso` (correo). El albarán muestra **Copias enviadas** con canal, destino, fecha y quién, y el botón pasa a **Reenviar por WhatsApp**.

**Migración** `20261006000100_e014_portal_whatsapp.sql`. Redefine `limpiar_demostracion` para vaciar también las tablas nuevas; las pruebas de E-013 lo detectaron.

**Pruebas:** 225 en verde (`npm test`), de ellas 136 de base de datos.
- `supabase/tests/e014.test.ts` (8):
  - solo se guarda el hash (ni el token ni una columna para él) y un token en claro se rechaza;
  - reintento idempotente, y un hash de otro técnico no se acepta;
  - **cada técnico ve solo lo suyo**: el PDF de la entrega de otro se deniega;
  - ni el almacén ni el público leen el portal directamente;
  - revocar anula todos sus enlaces y no los de los demás; uno nuevo vuelve a funcionar; baja;
  - teléfono validado y registro de copias (solo de entregas firmadas, sin duplicar).
- `src/domain/whatsapp.test.ts` (5): teléfonos en muchos formatos (`600 123 456`, `+34…`, `0034…`, `34…`, con paréntesis, guiones o puntos, fijos y extranjeros) y los que se rechazan; enlace `wa.me` con el texto codificado; texto del mensaje.
- `src/domain/portal.test.ts` (6): token y hash (vector SHA-256 conocido), ruta, datos solo del técnico, operaciones locales y firma de fotos.
- `tsc -b` sin errores, `npm run build` correcto y `deno check` sin errores.

**Probado en el navegador (demostración):**
- albarán → teléfono "600 12 34 56" → Enviar por WhatsApp;
- se abre `wa.me/34600123456` con el texto y el enlace; el teléfono queda en la ficha y la copia en el historial ("Reenviar por WhatsApp");
- al abrir el enlace en móvil sale el portal de Luis: su vehículo 0000-DEM con su material y su entrega firmada con PDF.

**Desplegado:** migración, `portal-tecnico` (en producción: un enlace inventado da "ya no es válido" y uno mal formado, 400) y `notificar` (usa el módulo del PDF).

**Sin verificar aquí:** el envío real por WhatsApp desde un móvil y el PDF del portal en producción (hace falta una entrega firmada real).

### 30/09/2026 · E-012 · HECHO
**Qué llega del wizard:** revisado `cierre-esbrain.html` en `instalacionesbufala-hue/bufala` (solo lectura).
- `recolectarDatos()` envía `numInst`, `esbrainUuid`, `fechaCierreIso`, `equipo` (`Búfala 1..3`), `hardware` (texto libre), `despFallido`, `tipoLinea` (`tubo` | `manguera`), `fase` (`mono` | `trif`), `seccion` (`'6'`…`'25'`) y las partidas numéricas (`metrosLinea`, `metrosUtp`, `rj45`, `bornasMono/Trif`, canalizaciones, protecciones…).
- Todo va en un POST al Apps Script. Las reglas usan esos nombres tal cual.

**1. Cómo llegan**
- **Función `registrar-cierre`** (`verify_jwt = false`): cabecera `X-Integracion`; admite un cierre o `{ cierres: [...] }` (histórico, hasta 200 por llamada).
- **Token:** lo genera el servidor (`crear_integracion`) y se enseña una sola vez; se guarda solo su hash (tabla `integraciones`), se revoca en Configuración → Integraciones y cierres, y solo puede registrar cierres.
- **La función:**
  - carga las equivalencias confirmadas, los kits y el catálogo;
  - traduce con `_compartido/cierres.ts`;
  - llama a `aplicar_cierre(hash, cierre, líneas)`, que solo puede ejecutar `service_role` y vuelve a validar el token.
- **Fragmento de Apps Script** listo para pegar: `docs/apps-script-almacen.gs`.
  - `enviarAlAlmacen(datos)` recorta el cierre a lo necesario (sin fotos), reintenta 3 veces y no rompe el guardado del cierre;
  - los errores van a la hoja **Almacén-log** y `reintentarAlmacen()` los reenvía;
  - `cargarHistoricoAlAlmacen()` lee "Registro" por el nombre de las cabeceras y envía lotes de 100.
- **Alternativa para el histórico:** CSV cargado desde la app (`aplicar_cierre_admin`).
- **Idempotencia:** por `esbrainUuid` o por `numInst` + `fechaCierreIso`. Una **versión** mayor aplica solo la diferencia: consume más, o devuelve al vehículo con "Corrección de cierre"; si pasa a fallido, lo devuelve todo. Una versión igual o menor no hace nada.
- **Apertura:** los cierres anteriores a la fecha de apertura se guardan como "ignorado" sin consumo. Sin fecha configurada, cuenta la del borrado de la demostración.

**2. Equivalencias** (`equivalencias_cierre` y `kits_fijacion`, editables por el administrador)
- **Regla:** partida (o suma, `pvc32+acero32`), fórmula, condiciones sobre **cualquier campo** del cierre, artículos con su factor en unidades de contenido, kit, estimada, activa y orden.
- **Fórmulas:** directa, manguitos `floor(m/3)+1`, fijaciones `ceil(m/0,5)` × kit, o 1 ud (cargador).
- **Condiciones:** igual (sin mayúsculas), lista, `campo~texto` (contiene) y `a&b` (contiene los dos). Así un "Policharger 22 kW" no se confunde con un "Trydan 22 kW".
- **Prioridad:** dentro de cada partida y fórmula manda la primera regla por orden que cumpla.
- **Propuesta:** 18 reglas con artículo, sacadas de las 28 filas de `datos/equivalencias-cierres.csv`, y los kits A, B y C.
  - Se cargan como **borrador** y solo aplican cuando el administrador las **confirma**.
  - Las 10 filas "PENDIENTE: dar de alta" no se convierten en reglas: esas partidas salen solas como "sin equivalencia" y no descuentan hasta que se definan.
  - Si un artículo de una regla aún no está en el catálogo (la propuesta usa los códigos reales), la línea queda "sin equivalencia" con la nota correspondiente.
- **Reglas del usuario incluidas:**
  - manguitos solo en PVC (el de acero, sin artículo);
  - fijaciones en PVC + acero, **sin corrugado**;
  - kit A (clip + clavo; el clavo queda "sin equivalencia" hasta que exista), B y C;
  - UTP: V2C/Trydan → 7270020010 y Policharger → 7270021010; con otro modelo, **por elegir**;
  - RJ45 como unidades del sobre de 25;
  - canaleta = moldura Hager 6222106082;
  - cargadores Trydan (7,4, 22 y Schuko) → sus referencias de custodia.

**3. Qué hace con cada cierre** (`_registrar_cierre` y `_sincronizar_cierre`)
- **Consumo:** movimientos **"Consumo en obra"** desde el **vehículo** asignado al equipo **en la fecha del cierre** (`vehiculo_de_equipo`), nunca del almacén.
  - Referencia: `numInst · cliente · dirección`.
  - En unidades de contenido: 2 RJ45 = −2 ud = 0,08 sobres.
- **Discrepancia:** lo que deja el vehículo en negativo se registra igual y la línea y el cierre quedan en "discrepancia".
- **Desplazamiento fallido:** queda registrado, sin consumo.
- **Cargador de Esmove:** 1 ud del vehículo, **sin n.º de serie**. Aparece como "Instalado en obra" en el informe de custodia, con la referencia de la obra. Si el modelo no se reconoce, queda **por elegir**.
- **Sin vehículo:** si el equipo no casa o no tiene vehículo, el cierre se guarda como "sin vehículo" y se aplica con **Reprocesar**.
- **Estados:** aplicado, parcial, discrepancia, fallido, ignorado y sin vehículo.

**4. Pantallas**
- **Configuración → Integraciones y cierres:**
  - token (crear, copiar URL y token, revocar, último uso);
  - comprobación de `Búfala 1..3` → equipo → vehículo;
  - apertura y kit por defecto;
  - equivalencias (cargar propuesta, confirmar, editar regla en texto, activar o desactivar) y kits A/B/C;
  - carga del histórico en CSV.
- **Equipos y técnicos → Cierres:**
  - filtros por equipo, periodo y estado;
  - cada cierre con sus líneas traducidas (estimadas marcadas);
  - **resolver** las líneas por elegir o sin equivalencia eligiendo el artículo;
  - **consumo del periodo** por artículo, con CSV;
  - **discrepancias** (vehículos en negativo).
- **Vehículos → Recontar** (`registrar_recuento_vehiculo`): el almacén cuenta en formatos (un sobre empezado cuenta como 0,5) y la diferencia va a la bandeja del administrador (`pendientes.vehiculo_id`; `validar_pendiente` ajusta el vehículo). El administrador ajusta directamente.
- En la demostración todo funciona en local con la misma lógica (`src/domain/cierres.ts`).

**Migración** `20261007000100_e012_cierres.sql`:
- `movimientos.cierre_id`;
- `config_app.kit_fijacion` y `config_app.apertura_cierres`;
- `pendientes.vehiculo_id`;
- `limpiar_demostracion` vacía también los cierres; las equivalencias, los kits y las integraciones se conservan.

**Pruebas:** 257 en verde (`npm test`).
- `supabase/tests/cierres.test.ts` (12): manguitos y fijaciones, condiciones, sección y fase, UTP según `hardware`, corrugado que no cuenta, kits A, B y C (y kit por regla), RJ45 fraccionado, cargador sin serie, fallido, reglas desactivadas o artículo ausente y clave de idempotencia.
- `supabase/tests/e012.test.ts` (12):
  - hash del token y permisos;
  - consumo del vehículo (no del almacén) con formatos fraccionados y el cargador;
  - discrepancias;
  - idempotencia (uuid y numInst + fecha);
  - **versión** con diferencia;
  - fallido;
  - por elegir y resolución;
  - sin vehículo → reprocesar;
  - apertura;
  - **token revocado rechazado**;
  - propuesta → confirmar y kits;
  - recuento de vehículo.
- `src/domain/cierres.test.ts` (8): la misma lógica en local, consumo del periodo, recuento, edición de reglas en texto y CSV del histórico.
- La prueba de actualización sobre una base en uso aplica también esta migración.
- `tsc -b` sin errores, `npm run build` correcto y `deno check` de las seis funciones sin errores.

**Probado en el navegador (demostración):** cargar la propuesta → confirmar 18 reglas → histórico CSV de 2 cierres → aplicados al vehículo de Búfala 1 y 2 → pestaña Cierres con estados, líneas y consumo del periodo.

**Desplegado:** migración y `registrar-cierre` (en producción: sin cabecera, 401; con un token inventado, 401 "no válida o revocada").

**Guía:** paso 6 (función nueva) y **paso 14** (equipos, equivalencias, token, cómo pegar el fragmento en el Apps Script y publicar una versión nueva, prueba, histórico y día a día).

**Para el usuario:** crear el token, pegar el fragmento y ejecutar el histórico (guía, paso 14). **Antes** hay que importar el catálogo real (E-013), porque las equivalencias usan sus códigos.

**Sin verificar aquí:** el envío real desde el Apps Script (hace falta el token y el proyecto del usuario) y los nombres de las cabeceras de la hoja "Registro" (el histórico por Apps Script los empareja por nombre; si no coinciden, la alternativa es el CSV).

**Sugerencias para el wizard** (proyecto `bufala`; decide el usuario):
- Añadir `version` al reenviar un cierre corregido, para que el almacén aplique la diferencia.
- Añadir un campo para el medidor V2C, si se instala.
- Usar identificadores estables si se añaden partidas: la tabla de equivalencias se amplía sin tocar código.

### 30/09/2026 · E-016 · HECHO
**1. Emparejado de albaranes** (`_compartido/albaran.ts`)
- Si la línea trae un código que no está en el catálogo, sale como **"Artículo nuevo"** (`how = 'nuevo'`). Nunca se empareja por descripción con otro artículo de código distinto. La descripción solo se usa en líneas **sin código**.
- El SKU que propone la IA solo se acepta si coincide con el código de la línea (exacto o con sufijo).
- El prompt dice que el proveedor es el **emisor**, nunca Búfala, y que no asigne un código desconocido a otro artículo.
- **En la revisión:** las líneas nuevas salen en amarillo con **Crear artículo nuevo** (con ese código) o se reasignan a mano en el desplegable.
- **Prueba** con los dos casos reales del 3.322.577: la moldura y el ángulo interior salen como artículos nuevos aunque la IA proponga la tapa final y el ángulo exterior.

**2. Artículos creados desde un albarán** (`_compartido/clasificar.ts`)
- `detectarUnidad`: ML, cables, tubos y molduras → m; `BOTE n`, `BOLSA n`, `PACK n`, `SOBRE n` y `CAJA n` con su contenido; `KOMMDATA BOLSA 25` → sobre de 25; un cargador con cable sigue siendo ud.
- `categoriaSugerida` (lee la tabla de categorías) y `normalizarProveedor`: Saltoki único con la delegación aparte; Búfala nunca es proveedor.
- Se aplican al pulsar **Crear artículo nuevo**, y todo se puede corregir en el formulario.
- El albarán guarda `proveedor` + `delegacion` (columna nueva).
- **Prueba:** las 39 líneas del catálogo real dan exactamente su unidad, contenido y categoría.
- **Migración:** las fichas "Saltoki …" pasan a proveedor **Saltoki** (la delegación anterior queda como proveedor habitual para los pedidos). Las 3 con "BUFALA TECH" quedan sin proveedor hasta el paso 15.3.

**3. Importar catálogo → "Actualizar fichas existentes"**
- Casilla con vista previa campo a campo (nombre, categoría, proveedor, unidad y contenido). Avisa si el artículo tiene stock en vehículos y cambia el contenido.
- `importar_catalogo(filas, actualizar)`. **El stock no se toca ni se convierte.**
- Ajuste: el inventario de apertura solo entra en artículos **sin stock ni movimientos**, así una importación nunca duplica lo que ya entró por albarán.
- **CSV:** apliqué la categoría Consumibles a bolsas, bridas y cinta, y el proveedor "Saltoki", para que "Actualizar" no deshaga las decisiones.

**4. Reasignar línea** (Albaranes → pulsa un albarán del historial → detalle)
- `reasignar_linea_albaran` (solo administrador): ajuste **−A** que corrige la entrada original y ajuste **+B** enlazado al anterior, con referencia al albarán.
- Admite parte de la cantidad; no pasa de lo que queda por reasignar ni de lo que queda en el almacén. El reintento de la cola no repite nada. La entrada original no se toca.

**5. Otros**
- Las equivalencias cuyo artículo no existe salen en **rojo** ("NO EXISTE en el catálogo"), y también los kits con artículos inexistentes.
- Las miniaturas y la foto grande van sobre **gris muy claro** para que se vean las piezas blancas o transparentes.

**6. Categorías configurables**
- **Tabla `categorias`** con id, nombre, icono, color (paleta fija de 10), orden y activa, y FK desde `productos`.
- **Categorías iniciales:** Cargadores VE, Cuadros de protecciones, Cables, Tubos y canalización (id `tubos`), Fijaciones, Aparamenta, Consumibles, EPIs, Ropa de trabajo y Herramientas.
- **Fontanería desaparece** de los datos, los filtros, la demostración (fuera sus 3 artículos de ejemplo), los textos y los prompts de la IA.
- La migración pasa a Consumibles las bolsas de basura, bridas y cinta.
- **Configuración → Categorías:** crear, renombrar, icono y color, subir y bajar, desactivar (con artículos, pide a qué categoría moverlos) y volver a activar.
- La app usa un registro que sigue a la tabla (`catDe`, `categoriasActivas`); una categoría desconocida nunca rompe una pantalla.
- La heurística de importación y `leer-articulo` usan las categorías activas de la tabla.

**7. Editar artículos**
- **Editar:** añade **notas** y el **código (SKU)** editable.
- **Decisión:** cambiar el SKU se hace como **ficha nueva + fusión de la antigua** (`cambiar_codigo_producto`), no reescribiendo el código.
  - Las entregas firmadas llevan su huella SHA-256 sobre el código de cada línea. Reescribirlo rompería la verificación, y el historial es inalterable.
  - Así las huellas siguen cuadrando (hay prueba), el historial muestra el código con el que se hizo y buscar el código antiguo lleva al nuevo.
- **Fusionar A en B** (`fusionar_productos`):
  - el stock del almacén pasa convertido por el contenido (rechaza si no cuadra el formato) y el de los vehículos, tal cual;
  - ajustes enlazados; A queda **archivado** (`archivado` y `fusionado_en`);
  - un trigger impide mover un archivado; la app lo oculta de las listas pero lo sigue mostrando en el historial.
- **Auditoría:** `guardar_producto` guarda en `auditoria` el antes y el después de cada campo cambiado.
- **Almacén:** **Proponer un cambio** (`propuestas_ficha`). En la bandeja del administrador sale "Cambios de ficha propuestos" con las diferencias, para revisar y aplicar o descartar.

**8. Equivalencias en la app** (`features/cierres/Reglas.tsx`)
- **Editor:** condiciones por filas (campo con sugerencias, "es igual a" o "contiene", valores con `|` y `&`); artículos con **buscador con foto** y cantidad; "sin dar de alta" (p. ej. el clavo); fórmula; kit; orden; estimada; nota.
- **Acciones:** **Duplicar** (como borrador) y **Borrar** (solo borradores; una confirmada se desactiva).
- **Historial:** editar una regla confirmada guarda la versión anterior (`equivalencias_historial`, visible en la regla).
- **Probar:** aplica las reglas a un cierre de ejemplo (editable) o a uno recibido (sus datos se piden al servidor) y enseña qué descontaría, **sin aplicar nada**; opcionalmente incluye las reglas en borrador.
- **Recalcular cierres desde…:** traduce con las reglas confirmadas y aplica solo la diferencia (`recalcular_cierre_admin` → "Corrección de cierre"). Conserva las líneas resueltas a mano.
- **Kits A, B y C:** con el mismo editor de artículos.

**Migración** `20261008000100_e016_correcciones.sql` (aplicada en producción). Comprobado con una consulta de solo lectura: 10 categorías, 3 artículos en Consumibles, 33 con proveedor Saltoki y 3 sin proveedor (los de "BUFALA TECH").

**Desplegado:** `leer-albaran` (emparejado y prompt nuevos) y `leer-articulo` (categorías de la tabla).

**Pruebas:** 281 en verde (`npm test`).
- `supabase/tests/e016.test.ts` (10): categorías; albarán con delegación; **reasignación** (A baja, B sube, la entrada original y dos ajustes enlazados, reintento, límites); auditoría campo a campo; fusión con vehículos, archivado y formato que no cuadra; cambio de código con la huella de la entrega intacta; importar con y sin "Actualizar"; propuestas; historial y borrado de reglas.
- `supabase/tests/clasificar.test.ts` (4): las 39 líneas reales y los casos que fallaron en la primera carga.
- `supabase/tests/albaran.test.ts` (+3): los dos casos reales del 3.322.577.
- `src/domain/fichas.test.ts` (7): la misma lógica en local.
- `tsc -b` sin errores, `npm run build` correcto y `deno check` de las seis funciones sin errores.

**Probado en el navegador (demostración):**
- albarán de ejemplo con una línea "Artículo nuevo" y proveedor "Saltoki" · delegación "Alcobendas";
- historial → detalle → **Reasignar línea** (−40 / +40 enlazados);
- Configuración → Categorías (las 10 nuevas);
- cargar la propuesta de equivalencias (artículos que no existen en rojo);
- editor de regla con condiciones por filas y artículos con foto.

**Para el usuario (guía, paso 15), en este orden para no duplicar stock:**
1. Crear a mano, con stock 0, la moldura `6222106082` (metros) y el ángulo interior `6222110054`.
2. En el albarán **3.322.577**, **Reasignar línea**: tapa final +20 → moldura; ángulo exterior +10 → ángulo interior.
3. **Importar catálogo** con **Actualizar fichas existentes**: corrige las 19 unidades y el resto de campos, y crea la cinta negra con 20 ud.
4. Revisar las categorías y las equivalencias en rojo, y **confirmar las equivalencias**.

Comprobado en producción: la cinta blanca (9900101044) no existe, así que no hay nada que retirar. La tapa final (30) y el ángulo exterior (20) tienen otras entradas legítimas; por eso se reasigna solo la línea de ese albarán.

**Sin verificar aquí:** esos pasos sobre los datos reales (los hace el usuario) y una lectura real de albarán con el emparejado nuevo.

### 30/09/2026 · E-017 · HECHO
**1. Flujo de entrega** (`EntregasView.tsx`)
1. **Para qué equipo:** tarjetas de equipo con matrícula y técnicos actuales, y la obra opcional.
   - Un equipo sin vehículo, o sin técnicos, sale deshabilitado con el motivo.
   - El buscador encuentra por equipo, técnico o matrícula, pero selecciona el equipo.
2. **Material:** igual que antes; entra en el vehículo del equipo.
3. **Firma** (`PanelFirma`): se elige con un toque, entre los técnicos **actuales** del equipo, quién recoge y firma (si hay uno solo, ya viene elegido).
   - El WhatsApp y el correo de la copia se rellenan con los de esa persona.
   - Casilla **"Enviar la copia por correo también a los demás técnicos del equipo"**.
   - La ropa y los EPIs de la cesta indican "Dotación personal de …".
- **Preparar para más tarde:** se prepara para el equipo sin técnico, y quién recoge se elige al firmar.

**2. Datos** (migración `20261009000100_e017_entregas_por_equipo.sql`)
- `entregas.equipo_id` es el destinatario. `receptor_id` es **"recogido por"**: admite nulo mientras está preparada y se fija al firmar, junto con el DNI.
- `_entregas_inalterables` solo deja fijar quién recoge en el paso de preparada a firmada; una firmada sigue siendo inalterable.
- `preparar_entrega` acepta el técnico vacío; si viene, tiene que pertenecer al equipo.
- `confirmar_entrega(id, firma, recoge, copia_equipo)`:
  - quien firma tiene que pertenecer al equipo **en ese momento, según el historial de asignaciones** (`_tecnico_del_equipo`);
  - la dotación personal pasa a quien firma;
  - el material de instalación, al vehículo;
  - la huella se calcula con quién recogió.
- `_encolar_copia_entrega(id, equipo)`: al que firma y, si se marca, a los demás técnicos actuales del equipo con correo.
- **Entregas antiguas:** no se tocan. Conservan su equipo y su técnico, que pasa a leerse como "recogido por", y las huellas siguen cuadrando (hay prueba).

**3. Pantallas e informes**
- **Últimas entregas:** por equipo, con "recogido por".
- **Informe:** **"Entregas por equipo"** con la columna "Recogido por" (y el CSV).
- **Preparadas y albarán:** "Entrega al equipo" y "Recoge y firma".
- **PDF** (app y servidor): "Entrega al equipo Búfala 2 (4299NGK)" · "Recoge y firma: …", y el texto de aceptación de la recogida.
- **WhatsApp:** el botón principal envía al técnico que firmó; debajo, **"También al resto del equipo"** con un botón por técnico, cada uno con su enlace personal. El texto habla de "las entregas de tu equipo".
- **Portal:** `portal_datos` y `portal_entrega_permitida` muestran las entregas del **equipo** firmadas mientras el técnico pertenecía a él, con quién recogió. No salen las de equipos anteriores ni las posteriores a irse. En la demostración, lo mismo con el historial local (`eraDelEquipo`).

**4. Dotación personal:** sigue siendo de la persona; pasa al técnico que firma.

**Pruebas:** 289 en verde (`npm test`).
- `supabase/tests/e017.test.ts` (6):
  - entrega al equipo con firma de uno de sus técnicos, con su DNI, la dotación a quien firma, el material al vehículo y la huella válida;
  - rechazo si quien firma no pertenece al equipo;
  - la pertenencia según el historial en el momento de firmar (un técnico que cambió de equipo ya no puede);
  - equipo sin vehículo bloqueado;
  - copia al que firma y al resto del equipo;
  - **portal filtrado por pertenencia con fechas**;
  - migración de entregas antiguas.
- `src/domain/entregas.test.ts` (+2) y `src/domain/portal.test.ts` (+1): la misma lógica en local.
- `tsc -b` sin errores, `npm run build` correcto y `deno check` sin errores.

**Probado en el navegador (móvil, demostración):** Búfala 1 → 10 m de cable → en la firma, "Recoge y firma" con Luis y Jorge → Jorge firma → albarán "Entrega al equipo Búfala 1 · Recoge y firma: Jorge Ruiz". El PDF y el portal se han comprobado solo con pruebas.

**Desplegado:** migración, `notificar` (PDF del correo) y `portal-tecnico`. La app se publica con este commit. En producción, las entregas ya firmadas no cambian.

### 01/10/2026 · E-018 · HECHO
**1. Ajuste de inventario** (`HojaAjuste` en `src/features/inventario/hojas.tsx`)
- Se abre desde la ficha (**"Ajuste de inventario…"**, debajo de los botones) o desde el diálogo de movimientos (botón bajo Entrada · Salida · A vehículo · Devolución · Merma).
- **Dónde:** almacén o un vehículo (con lo que lleva cada uno).
- **Cantidad:** botones **− / +** y la cantidad.
- **Motivo:** texto obligatorio.
- Antes de confirmar muestra **"Almacén: de X a Y"** (o el vehículo), y otra vez en la confirmación.
- No deja el stock en negativo; en el almacén, los formatos van enteros.
- Queda como movimiento de tipo **"Ajuste"** con el motivo y la referencia "Ajuste de inventario". No es merma (no crea aviso de merma), ni salida a obra, ni consumo; en el informe de custodia sale en "Diferencias de recuento".
- **El personal de almacén** ve **"Proponer ajuste"**: llega a la bandeja del administrador como "Ajuste de inventario propuesto", con el motivo, la ubicación y quién lo propone. Al aprobarlo se aplica con ese motivo.

**2. Servidor** (migración `20261010000100_e018_ajuste_inventario.sql`, **aplicada**)
- `ajustar_inventario(id, sku, cantidad, motivo, vehiculo)`:
  - solo el administrador;
  - idempotente por id;
  - comprueba motivo, cantidad distinta de cero y que no quede en negativo;
  - escribe en la **auditoría** (`ajuste_inventario`: de, a, ubicación y motivo);
  - devuelve `de` y `a`.
- `proponer_ajuste(...)`: cualquier usuario; crea un pendiente de tipo `ajuste` (nuevo valor en el `check`).
- `validar_pendiente` aplica los ajustes propuestos con su motivo, en el almacén o en el vehículo, y los anota en la auditoría. Los demás casos no cambian.
- `registrar_movimiento` ya rechazaba el tipo `ajuste` para el rol almacén; sigue igual.

**3. Aviso de código ya ingresado por albarán**
- El aviso se da al **crear** una referencia con stock inicial mayor que 0. Si ese código aparece en un albarán ingresado, la app pregunta: "Ese código ya ha entrado por el albarán X; ¿seguro que quieres añadir stock inicial?".
- **Decisión:** para detectarlo, el albarán tiene que guardar **el código impreso en cada línea**, porque en el caso real la línea se emparejó con otro artículo. Hoy no se guardaba.
  - Nueva columna `albaranes.codigos`, que se rellena al ingresar el albarán. La app envía el código de cada línea.
  - También avisa si el código es el de un artículo que ya tuvo entradas por albarán.
  - **Límite:** los albaranes ingresados antes de hoy no tienen códigos guardados, así que el aviso funciona a partir de los próximos (por ejemplo, el 3.322.577 no avisará).

**4. Guía, paso 15:** se añade qué hacer si ya se crearon con stock:
- **no reasignar**;
- ajuste **−20** en la tapa final (de 30 a 10) y **−10** en el ángulo exterior (de 20 a 10);
- motivo en los dos: "Duplicado de la corrección del albarán 3.322.577".
En "Para el día a día" se explican el ajuste y el aviso.

**Comprobado en producción (solo lectura):** tapa final 30, ángulo exterior 20, moldura 20 y ángulo interior 10. Coincide con lo que vio el chat; el usuario tiene que hacer los dos ajustes.

**Pruebas:** 301 en verde (`npm test`).
- `supabase/tests/e018.test.ts` (6):
  - ajuste negativo y positivo del administrador, con "de X a Y", movimiento "Ajuste" y auditoría;
  - motivo obligatorio, cero y negativo;
  - ajuste en un vehículo;
  - rechazo para el rol almacén (también por `registrar_movimiento`), y la propuesta aprobada desde la bandeja;
  - sin mermas, salidas ni consumos;
  - códigos impresos guardados en el albarán.
- `src/domain/ajuste.test.ts` (6): lo mismo en local, más el informe (0 salidas, 0 incidencias) y el aviso por albarán.
- `tsc -b` sin errores y `npm run build` correcto.

**Probado en el navegador (demostración):**
- Administrador: cable 3G16, **−20** → "Almacén: de 305 m a 285 m" → confirmado, y queda como Ajuste.
- Rol almacén: bridas, "Proponer ajuste" **−2** → el stock no cambia → como administrador, en la bandeja → Aprobar → de 14 a 12 bolsas.

### 01/10/2026 · E-020 · HECHO
**1. Firma:** he revisado los cambios del chat en `Hojas.tsx` y `App.tsx` y están bien; no los he tocado.
- La operación de firmar no lleva ni teléfono ni correo.
- Hay una prueba de firma sin ellos en `codigos.test.ts`.

**2. Escáner multiformato también en iPhone**
- **Lector:** `src/features/escaner/lector.ts` usa `zxing-wasm` (ZXing en WebAssembly) en **todos** los navegadores.
  - No uso el `BarcodeDetector` nativo, para que iPhone y Android se comporten igual y las pruebas usen el mismo código.
  - Se quita `jsqr`.
- **Formatos:** EAN-13/8, UPC-A/E, Code 128, Code 39, ITF, Codabar, QR y DataMatrix.
- **Sin CDN:** el `.wasm` (953 kB, 414 kB comprimido) va empaquetado con la app (`?url` de Vite, en `dist/assets`). El service worker lo guarda tras el primer uso, así que funciona sin cobertura.
- **Cámara** (`camara.ts`):
  - pide 1920×1080, enfoque continuo si el móvil lo admite, y linterna;
  - analiza el fotograma completo, reducido como mucho a 1280 px;
  - prueba también girado (`tryRotate`) e invertido;
  - lee unas 7 veces por segundo.
- **Prioridad** (`elegirCodigo` en `src/domain/codigos.ts`):
  1. un QR `BUF:` siempre gana;
  2. después, un código de barras;
  3. después, un QR que no sea una URL.
  - Si solo se lee una URL ajena, aparece sobre la cámara "QR del fabricante, no es un código del almacén…" y sigue escaneando. A los 4 s la entrega como código desconocido.

**3. Códigos alternativos** (migración `20261011000100_e020_codigos_articulo.sql`, **aplicada**)
- **Tabla `codigos_articulo`:** código único, sku, tipo (EAN, UPC, Code 128, QR u otro), quién y cuándo.
- **`asociar_codigo`** la pueden usar el administrador y el almacén, y queda en la auditoría. Rechaza:
  - un código que ya tiene otro artículo, diciendo cuál;
  - un código que es el SKU, el EAN o la referencia de otro artículo;
  - asociar a un archivado.
- **`quitar_codigo`:** solo el administrador.
- **Fusión:** un disparador pasa los códigos al artículo de destino. Como cambiar el código fusiona en la ficha nueva, también se conservan.
- **Dónde se buscan:** escáner y cesta de entregas (`resolveCode`), buscador, emparejado de albaranes en la app y en `leer-albaran` (**desplegada**).
- **"Código desconocido":**
  - nuevo botón principal **"Es un artículo que ya tengo"**, que abre un buscador con fotos;
  - "Crear con la cámara" y "Crear a mano" guardan el código leído como alternativo del artículo nuevo, si no es ya su SKU ni su EAN.
- **Ficha:** sección **"Códigos alternativos"** con la lista, **Añadir** (escaneando o escribiéndolo) y **Quitar** (administrador).
- "Borrar datos de ejemplo" también vacía la tabla.

**Pruebas:** 321 en verde.
- `src/features/escaner/lector.test.ts` (4): fixtures PNG generadas con ZXing y leídas con el mismo módulo que la cámara:
  - EAN-13, Code 128 y QR;
  - EAN girado 90°;
  - QR del fabricante y EAN en el mismo fotograma (gana el EAN);
  - solo la URL ajena.
- `src/domain/codigos.test.ts`: prioridad, tipos, asociación (alta, duplicado rechazado, quitar, paso al fusionar, escáner, buscador y albaranes) y firma sin teléfono ni correo.
- `supabase/tests/e020.test.ts` (4): lo mismo en el servidor.

**En el navegador (demostración):**
- el lector lee las fixtures cargando el `.wasm` desde la propia app;
- escribo el código 3439510575536 → "Es un artículo que ya tengo" → manguera 5G6 → al volver a leerlo sale **IDENTIFICADO**.
- **Pendiente:** probar en el iPhone del usuario con las cajas reales. El navegador de pruebas no tiene cámara.
