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

### E-002 · Backend y persistencia · PENDIENTE
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
