# Puesta en marcha paso a paso

Esta guía convierte la demo en la app real: con usuarios y contraseñas, con los datos guardados en la nube y con el móvil y el ordenador sincronizados. No hace falta saber programar. Sigue los pasos en orden y marca cada casilla al terminarla.

> **Atajo:** si prefieres no teclear comandos, haz tú solo lo que exige tu cuenta y tus contraseñas (pasos 1, 2.1, 3, 4.1, 5 y las cuentas del paso 8) y pide a Claude Code el resto: "ejecuta los comandos de la guía de puesta en marcha". Claude nunca debe ver tus contraseñas: cuando un comando te pida una, escríbela tú en la terminal.

**Tiempo aproximado:** 45 minutos la parte obligatoria (pasos 1 a 7) y 15 minutos cada extra (pasos 8 a 10).

**Qué vas a necesitar:**
- Tu cuenta de GitHub (`instalacionesbufala-hue`).
- Un correo para la cuenta de Supabase.
- Este ordenador, con la carpeta `almacen` descargada. Node.js ya está instalado.
- Un móvil para la prueba final.

**Cuánto cuesta:** nada. Todo es de plan gratuito.
- **Supabase:** 500 MB de base de datos, 50.000 usuarios al mes y 500.000 llamadas a funciones al mes. Se pausa si pasa una semana sin uso; la copia del paso 10 lo evita.
- **Gemini:** capa gratuita, con límite diario de lecturas.
- **Resend:** 3.000 correos al mes.
- **Telegram y GitHub Pages:** gratis.

---

## 1. Crear el proyecto en Supabase

- [ ] 1.1. Entra en **https://supabase.com** y pulsa **Start your project**. Regístrate con GitHub (lo más cómodo) o con tu correo.
- [ ] 1.2. Pulsa **New project** y rellena:
  - **Organization:** la que te propone (o créala con tu nombre, en plan **Free**).
  - **Project name:** `almacen-bufala`.
  - **Database Password:** pulsa **Generate a password** y **guárdala en un sitio seguro** (gestor de contraseñas o papel). La pedirán los pasos 2 y 10.
  - **Region:** *West EU (Ireland)* o *Central EU (Frankfurt)*, las más cercanas a España.
- [ ] 1.3. Pulsa **Create new project** y espera 1 o 2 minutos a que termine.
- [ ] 1.4. Apunta estos tres datos (los usarás varias veces):
  - **Referencia del proyecto:** son las letras que aparecen en la dirección del navegador tras `/project/`. Ejemplo: en `https://supabase.com/dashboard/project/abcdefghijkl`, la referencia es `abcdefghijkl`.
  - **Project URL:** en **Project Settings** (rueda dentada abajo a la izquierda) → **Data API**. Es `https://abcdefghijkl.supabase.co`.
  - **Clave anon public:** en **Project Settings** → **API Keys**, la que se llama `anon` `public`. Es un texto largo que empieza por `eyJ`. Es pública por diseño: la seguridad está en los permisos de la base de datos.

> **No copies nunca la clave `service_role`** en ningún sitio. Da acceso total y Supabase ya se la pasa sola a las funciones de servidor.

## 2. Crear las tablas (aplicar las migraciones)

Las "migraciones" son los archivos de `supabase/migrations/`: crean las tablas, las reglas y los permisos. Se aplican con la herramienta oficial de Supabase, que se descarga sola con `npx`.

> **Cómo escribir los comandos de esta guía.** Copia solo lo que hay dentro de cada recuadro gris. La palabra `bash` que a veces aparece encima no se escribe: solo indica el tipo de bloque. En Windows los comandos llevan `npx.cmd` (no `npx`), porque PowerShell bloquea `npx` a secas con el error *la ejecución de scripts está deshabilitada*.

- [ ] 2.1. Abre una terminal en la carpeta `almacen`: en el Explorador de Windows entra en la carpeta, clic derecho en un hueco → **Abrir en Terminal**. Escribe y pulsa Enter:
  ```bash
  npx.cmd supabase login
  ```
  Se abre el navegador: pulsa **Authorize**. La terminal dirá *You are now logged in*.
- [ ] 2.2. Enlaza la carpeta con tu proyecto. Cambia `abcdefghijkl` por tu referencia del paso 1.4:
  ```bash
  npx.cmd supabase link --project-ref abcdefghijkl
  ```
  Cuando pida la **database password**, escribe la del paso 1.2. Mientras la escribes no se ve nada en pantalla; es normal.
- [ ] 2.3. Crea las tablas:
  ```bash
  npx.cmd supabase db push
  ```
  Te enseña la lista de migraciones (10 archivos) y pregunta si continúa: escribe `Y` y pulsa Enter. Termina con *Finished supabase db push*.
- [ ] 2.4. **Datos de demostración: ya no se cargan.** Una instalación nueva empieza vacía y el catálogo real se importa en el paso 12. (Si en algún momento quieres probar con datos inventados, pega el contenido de `supabase/seed.sql` en **SQL Editor** → **Run**; después se borran con un botón, también en el paso 12.)
- [ ] 2.5. Comprueba que ha ido bien: en Supabase, **Table Editor** debe listar `productos`, `movimientos`, `entregas`, `perfiles` y otras. En **Storage** deben aparecer dos espacios **privados** (con candado): `justificantes` y `fotos-articulos`. Si `fotos-articulos` saliera como *Public*, ábrelo → **Edit bucket** → desmarca *Public bucket*: las fotos de Saltoki y de fabricantes no deben quedar públicas.

## 3. Crear el primer administrador (tú)

Nadie puede registrarse solo en la app: los usuarios los da de alta el administrador. El primero se crea a mano.

- [ ] 3.1. En Supabase, entra en **Authentication** → **Users** → **Add user** → **Create new user**.
  - **Email:** tu correo.
  - **Password:** tu contraseña para entrar en la app (mínimo 8 caracteres).
  - Marca **Auto Confirm User**.
  - Pulsa **Create user**.
- [ ] 3.2. Dale el rol de administrador. Entra en **SQL Editor** → **New query**, pega esto cambiando el correo y el nombre, y pulsa **Run**:
  ```sql
  insert into public.perfiles (id, nombre, email, rol)
  select id, 'César', email, 'admin' from auth.users where email = 'tu-correo@ejemplo.com';
  ```
  Responderá *Success. No rows returned*. Es normal: Supabase contesta así a cualquier `insert`, **se haya guardado o no**. Por eso hay que comprobarlo en el paso 3.3.
- [ ] 3.3. Comprueba que ha funcionado. Borra el editor, pega esto y pulsa **Run**:
  ```sql
  select nombre, email, rol, activo from public.perfiles;
  ```
  Tiene que salir una fila con tu nombre, tu correo, `admin` y `true`. Si sale vacío, el correo no coincide con el del paso 3.1. Míralo con `select email from auth.users;` y repite el 3.2 con ese correo copiado tal cual. No repitas el 3.2 si la fila ya sale: daría un error de duplicado.

## 4. Poner las variables en GitHub

Así, la app publicada sabe a qué proyecto de Supabase conectarse.

- [ ] 4.1. Entra en **https://github.com/instalacionesbufala-hue/almacen** → **Settings** → **Secrets and variables** → **Actions** → pestaña **Variables** → **New repository variable**. Crea estas dos (nombre exacto, en mayúsculas):

  | Name | Value |
  |---|---|
  | `VITE_SUPABASE_URL` | la Project URL del paso 1.4, **solo hasta `.supabase.co`** (`https://abcdefghijkl.supabase.co`), sin `/rest/v1/` ni nada detrás |
  | `VITE_SUPABASE_ANON_KEY` | la clave `anon public` del paso 1.4 |

  Van en **Variables**, no en *Secrets*: no son secretas y la app las necesita en el navegador.

Las variables `VITE_ALBARANES_URL` (paso 7) y `VITE_VAPID_PUBLICA` (paso 8) se añaden más adelante, en el mismo sitio.

## 5. Publicar la app (GitHub Pages)

- [ ] 5.1. **Settings** → **Pages** → **Source:** debe poner **GitHub Actions**. Ya lo cambiaste; solo compruébalo.
- [ ] 5.2. Vuelve a publicar para que la app use las variables nuevas: pestaña **Actions** → **Publicar en GitHub Pages** (a la izquierda) → **Run workflow** → **Run workflow**. En 2 o 3 minutos se pone en verde.
- [ ] 5.3. Abre **https://instalacionesbufala-hue.github.io/almacen/**. Ahora debe pedirte correo y contraseña; si sigue entrando directamente, es que aún ves la demo (espera a que termine el paso 5.2 y recarga). Entra con los datos del paso 3.1.

> **Cada vez que cambies una variable de GitHub**, repite el paso 5.2 para que la app publicada la recoja.

## 6. Desplegar las funciones de servidor

Son seis pequeños programas que se ejecutan en Supabase, donde las claves no están a la vista:

| Función | Para qué sirve |
|---|---|
| `usuarios` | Dar de alta usuarios y cambiar contraseñas desde la app |
| `notificar` | Enviar los avisos por correo, push y Telegram |
| `leer-albaran` | Leer los albaranes con IA (Gemini) |
| `leer-articulo` | Proponer la ficha de un artículo nuevo a partir de su foto ("Nuevo con la cámara", misma IA) |
| `portal-tecnico` | Página de cada técnico con sus entregas y lo que lleva su vehículo (se abre con su enlace de WhatsApp, sin contraseña) |
| `registrar-cierre` | Recibir los cierres de instalación del wizard y descontar el material del vehículo del equipo (paso 14) |

- [ ] 6.1. En la terminal de la carpeta `almacen` (con la sesión del paso 2.1):
  ```bash
  npx.cmd supabase functions deploy usuarios
  ```
  ```bash
  npx.cmd supabase functions deploy notificar
  ```
  ```bash
  npx.cmd supabase functions deploy leer-albaran
  ```
  ```bash
  npx.cmd supabase functions deploy leer-articulo
  ```
  ```bash
  npx.cmd supabase functions deploy portal-tecnico
  ```
  ```bash
  npx.cmd supabase functions deploy registrar-cierre
  ```
  Cada comando termina con *Deployed Functions*. Compruébalo en Supabase → **Edge Functions**: deben aparecer las seis.
- [ ] 6.2. Di a las funciones desde qué web se les puede llamar (así ninguna otra página puede usarlas con tu sesión). Es la dirección de la app del paso 5, **sin la ruta final**:
  ```bash
  npx.cmd supabase secrets set ORIGEN_APP=https://instalacionesbufala-hue.github.io
  ```
  Si algún día publicas la app en otro dominio, añádelo separado por comas (`ORIGEN_APP=https://instalacionesbufala-hue.github.io,https://almacen.tudominio.es`). `localhost` siempre está permitido para desarrollo.

## 7. Activar la lectura de albaranes con IA (Gemini)

> **Antes de activarla, decide sobre la privacidad.** Según las condiciones de Google, en el **nivel gratuito** de Gemini el contenido que envías puede usarse para mejorar sus productos, y los albaranes llevan precios y direcciones de obra. Si no te parece bien, tienes dos salidas:
> - **Activar la facturación** en Google AI Studio: entonces Google deja de usar tus datos. Se paga por lectura (céntimos al mes con el uso normal de un almacén).
> - **No hacer este paso**: la app sigue con la lectura simulada y los albaranes se meten a mano.
>
> La app muestra este mismo aviso en Albaranes y en Configuración.

- [ ] 7.1. Entra en **https://aistudio.google.com** con una cuenta de Google → **Get API key** → **Create API key**. Copia la clave, que empieza por `AIza`.
- [ ] 7.2. Guárdala en Supabase (no en GitHub). Cambia `AIza...` por tu clave:
  ```bash
  npx.cmd supabase secrets set GEMINI_API_KEY=AIza...
  ```
  (También se puede hacer desde Supabase → **Edge Functions** → **Secrets** → **Add new secret**.)
- [ ] 7.3. En GitHub → **Variables** (como en el paso 4.1), crea:

  | Name | Value |
  |---|---|
  | `VITE_ALBARANES_URL` | `https://abcdefghijkl.supabase.co/functions/v1/leer-albaran` (con tu referencia) |

- [ ] 7.4. Repite el paso 5.2 (Run workflow). "Nuevo con la cámara" usa la misma clave: su dirección sale sola de `VITE_ALBARANES_URL` cambiando `leer-albaran` por `leer-articulo` (no hace falta otra variable).
- [ ] 7.5. **Prueba:** en la app, abre **Albaranes y recepción IA**. La etiqueta debe decir **IA CONECTADA (GEMINI)**. Sube una foto de un albarán, revisa las líneas propuestas y pulsa aprobar. Nada entra en stock hasta que lo apruebas.

Si aparece *Se ha alcanzado el límite gratuito*, has pasado el cupo diario de Gemini: vuelve a intentarlo al día siguiente.

Si aparece *Gemini está saturado* (error 503), es cosa de Google: el nivel gratuito se satura a ratos. La función ya reintenta sola y prueba un modelo más ligero; si aun así falla, espera un minuto y vuelve a subir el albarán.

Si aparece *Gemini ha respondido 404* o *Gemini no reconoce el modelo*, Google ha retirado el modelo. La función usa `gemini-flash-latest`, que siempre apunta al vigente. Vuelve a desplegarla con `npx.cmd supabase functions deploy leer-albaran` y, si creaste el secreto `GEMINI_MODELO`, bórralo en Supabase → **Edge Functions** → **Secrets**.

## 8. Avisos de reposición: correo, push y Telegram (opcional)

Los avisos **en la app** funcionan desde ya. Para recibirlos fuera, activa los canales que quieras. Primero, lo común a todos:

- [ ] 8.0. **Tarea programada de avisos.** Cada minuto, Supabase mira si hay avisos pendientes y se los pasa a la función `notificar`. Para eso necesita una clave compartida:
  1. Inventa una contraseña larga (por ejemplo, 30 letras y números al azar). Es la **clave de la tarea**.
  2. En la terminal (cambia `LA_CLAVE` por ella):
     ```bash
     npx.cmd supabase secrets set CLAVE_CRON=LA_CLAVE
     ```
  3. En Supabase → **SQL Editor**, pega esto (con tu referencia y la misma clave) y pulsa **Run**:
     ```sql
     select vault.create_secret('https://abcdefghijkl.supabase.co/functions/v1/notificar', 'url_notificar');
     select vault.create_secret('LA_CLAVE', 'clave_cron');
     ```

Después, cada canal se configura en la app, en **Configuración → Avisos**, donde también eliges el modo de envío (**Inmediato para críticos** o **Resumen diario a las…**). Tras configurar un canal, pulsa **Enviar prueba** y mira el **Registro de envíos**.

### Correo (Resend)
- [ ] 8.1. Crea una cuenta gratis en **https://resend.com** → **API Keys** → **Create API Key** → copia la clave, que empieza por `re_`.
- [ ] 8.2. Guárdala en Supabase:
  ```bash
  npx.cmd supabase secrets set RESEND_API_KEY=re_...
  ```
- [ ] 8.3. **Remitente.** Tienes dos opciones:
  > El remitente **no puede ser un Gmail** (ni Hotmail u otro correo gratuito): Resend solo envía desde `onboarding@resend.dev` o desde un dominio tuyo verificado.
  - **Sin dominio propio:** usa `Almacén <onboarding@resend.dev>`. Solo llega **a tu propio correo**, el de la cuenta de Resend.
  - **Con dominio propio:** para enviar a otros (por ejemplo, a Esmove), en Resend → **Domains** → **Add domain**. Añade en tu proveedor de dominio los registros DNS que te indica y usa `Almacén <avisos@tudominio.es>`.
- [ ] 8.4. En la app, en **Configuración → Avisos → Correo**: activa el canal y rellena el remitente y los destinatarios. Pulsa **Guardar configuración de avisos** y luego **Enviar prueba** (desde esta versión, Enviar prueba guarda antes los cambios). Si falta la clave del paso 8.2, el Registro de envíos lo dirá.

### Copia de las entregas a los técnicos (E-011)
Al firmar una entrega, la app envía al técnico el **PDF del justificante firmado** al correo de su ficha. El correo se puede escribir en la propia pantalla de firma, y lo puede hacer también el personal de almacén.

> **Importante:** para que la copia llegue a los técnicos hace falta un **dominio propio verificado en Resend** (paso 8.3, opción *Con dominio propio*, por ejemplo `avisos.bufalatech.es`). Con `onboarding@resend.dev`, Resend solo entrega al correo de tu cuenta: la copia al técnico sale como *Copia no enviada*.
>
> Mientras no tengas dominio, en el albarán de cada entrega están **Compartir PDF** (WhatsApp, correo… desde el móvil) y **Descargar PDF**.

- [ ] 8.4b. *(Opcional)* En **Configuración → Avisos → Correo**, marca **Copia de cada entrega firmada** para recibir tú también cada justificante en los destinatarios de correo.
- En **Entrega → Últimas entregas** verás si cada copia ha llegado (*Copia enviada*, *Enviando copia*, *Copia no enviada*). En el albarán puedes corregir el correo y pulsar **Reenviar copia**.

### Notificaciones push en el móvil
- [ ] 8.5. Genera el par de claves de push en la terminal:
  ```bash
  npx.cmd web-push generate-vapid-keys
  ```
  Te da una **Public Key** y una **Private Key**.
- [ ] 8.6. Guárdalas en Supabase (con tus valores y tu correo):
  ```bash
  npx.cmd supabase secrets set VAPID_PUBLICA=LA_PUBLICA VAPID_PRIVADA=LA_PRIVADA VAPID_CONTACTO=mailto:tu-correo@ejemplo.com
  ```
- [ ] 8.7. En GitHub → **Variables**, crea `VITE_VAPID_PUBLICA` con la **Public Key**; nunca la privada. Repite el paso 5.2.
- [ ] 8.8. En cada móvil que deba recibir avisos, abre la app → **Configuración → Avisos → Push** → **Activar en este dispositivo** → acepta el permiso.
  - **Android (Chrome):** funciona directamente.
  - **iPhone (iOS 16.4 o posterior):** primero añade la app a la pantalla de inicio (en Safari: botón **Compartir** → **Añadir a pantalla de inicio**), ábrela desde ese icono y activa ahí las notificaciones. Desde Safari normal, iPhone no las permite.

### Telegram
- [ ] 8.9. En Telegram, busca **@BotFather** → escribe `/newbot` → pon un nombre (por ejemplo, *Almacén Búfala*) y un usuario terminado en `bot`. Te da un **token** del tipo `123456:ABC...`.
- [ ] 8.10. Guárdalo en Supabase:
  ```bash
  npx.cmd supabase secrets set TELEGRAM_BOT_TOKEN=123456:ABC...
  ```
- [ ] 8.11. Busca tu bot en Telegram y escríbele cualquier cosa (por ejemplo, "hola"). Para un grupo, añade el bot al grupo y escribe algo en él.
- [ ] 8.12. Averigua el `chat_id`: abre en el navegador `https://api.telegram.org/botTU_TOKEN/getUpdates`, con tu token. Busca `"chat":{"id":` y copia el número que sigue; en los grupos empieza por `-`.
- [ ] 8.13. En la app, en **Configuración → Avisos → Telegram**: activa el canal, pega el `chat_id`, pulsa **Guardar configuración de avisos** y luego **Enviar prueba**.

## 9. Dar de alta al usuario del almacén

- [ ] 9.1. Entra en la app con tu usuario de administrador → **Configuración** → **Usuarios** → **Dar de alta un usuario**.
- [ ] 9.2. Rellena nombre, correo, una contraseña inicial (mínimo 8 caracteres) y el rol **Almacén**. Pulsa guardar.
- [ ] 9.3. Pásale su correo y su contraseña en persona o por teléfono, no por escrito en un grupo.

Qué puede hacer cada rol:
- **Almacén:** operativa diaria **sin ver precios**. Sus mermas de más de 50 € y sus recuentos quedan pendientes de que tú los valides.
- **Administrador:** todo.

Si alguien deja la empresa, pulsa **Editar** junto a su nombre y desmarca que está activo: ya no puede entrar y su historial se conserva.

## 10. Copia de seguridad y mantener Supabase despierto (muy recomendable)

El plan gratuito de Supabase **no hace copias** y **se pausa tras 7 días sin uso**. La tarea `.github/workflows/copia-seguridad.yml` resuelve las dos cosas los lunes y los jueves. El detalle y cómo restaurar están en [`COPIAS.md`](COPIAS.md).

- [ ] 10.1. **Repositorio privado para las copias.** En GitHub: **+** (arriba a la derecha) → **New repository**.
  - Nombre: `almacen-copias`.
  - Marca **Private** (¡importante!) y **Add a README file**.
  - Pulsa **Create repository**.
- [ ] 10.2. **Token con permiso solo sobre ese repositorio.** GitHub → tu foto → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
  - **Token name:** `copias-almacen`.
  - **Expiration:** 1 año; pon un recordatorio para renovarlo.
  - **Repository access:** **Only select repositories** → `almacen-copias`.
  - **Permissions** → **Repository permissions** → **Contents:** **Read and write**.
  - Pulsa **Generate token** y copia el token, que empieza por `github_pat_`.
- [ ] 10.3. **Cadena de conexión de la base de datos.** En Supabase, pulsa **Connect** (arriba) → pestaña **Direct** (*Connection string*) → en el desplegable del método de conexión elige **Session pooler** (no *Direct connection*: GitHub no la alcanza) → copia la cadena `postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@...` y sustituye `[YOUR-PASSWORD]` por la contraseña del paso 1.2.
- [ ] 10.4. **Contraseña de las copias.** Inventa otra contraseña larga y **guárdala también fuera de GitHub**: sin ella las copias no se pueden abrir.
- [ ] 10.5. En `almacen` → **Settings** → **Secrets and variables** → **Actions**:
  - Pestaña **Secrets** → **New repository secret**, tres veces:

    | Name | Value |
    |---|---|
    | `SUPABASE_DB_URL` | la cadena del paso 10.3 |
    | `COPIA_CLAVE` | la contraseña del paso 10.4 |
    | `COPIAS_TOKEN` | el token del paso 10.2 |

  - Pestaña **Variables** → `COPIAS_REPO` = `instalacionesbufala-hue/almacen-copias`.
- [ ] 10.6. **Prueba:** **Actions** → **Copia de seguridad y mantener activo Supabase** → **Run workflow**. Al terminar en verde, en `almacen-copias` debe aparecer la carpeta `copias/` con un archivo `.gpg`.

## 11. Prueba final: móvil y ordenador sincronizados

- [ ] 11.1. Abre la app en el ordenador y entra como administrador en **Stock general**.
- [ ] 11.2. En el móvil, abre `https://instalacionesbufala-hue.github.io/almacen/` y entra con el usuario de almacén del paso 9. Consejo: añádela a la pantalla de inicio para usarla como una aplicación.
- [ ] 11.3. En el móvil: **Escanear** (o busca una referencia) → registra una **salida** de 1 unidad.
- [ ] 11.4. En el ordenador, **sin recargar**, el stock de esa referencia debe bajar en pocos segundos y el movimiento aparece en el historial.
- [ ] 11.5. **Prueba sin cobertura:** en el móvil, activa el modo avión y registra otra salida. La app la guarda en la cola y lo indica ("en cola"). Quita el modo avión: se envía sola y aparece en el ordenador.
- [ ] 11.6. En el ordenador, cambia el mínimo de una referencia. El cambio debe verse en el móvil.

Si los seis pasos salen bien, la app está en marcha.

## 12. Pasar a datos reales (E-013)

La app deja de usar precios: solo cuenta material. El stock está en el **almacén** o a bordo del **vehículo** de cada equipo, y entregar a un equipo es pasar material del almacén a su vehículo.

- [ ] 12.1. **Aplica la migración nueva y vuelve a desplegar `notificar`** (solo si tu base es anterior a E-013; Code lo hace al terminar el encargo):
  ```bash
  npx.cmd supabase db push
  ```
  ```bash
  npx.cmd supabase functions deploy notificar
  ```
- [ ] 12.2. **Exporta una copia** por si acaso: **Configuración** → *Datos y copias de seguridad* → **Exportar copia**.
- [ ] 12.3. **Borra los datos de ejemplo** (una sola vez): **Configuración** → *Pasar a datos reales* → **Borrar datos de ejemplo**. Escribe `BORRAR DEMO` y pulsa **Borrar definitivamente**. Se borran los artículos, movimientos, entregas, equipos, técnicos, vehículos y fichas de dotación de ejemplo, con sus fotos. **Se conservan** los usuarios, la configuración de avisos y Esmove. Después el botón desaparece y queda la fecha en que se hizo.
- [ ] 12.4. **Importa el catálogo real**: en el mismo bloque, **Importar catálogo (CSV)** → elige `datos/catalogo-stock-real.csv`. Antes de importar ves tres listas: **Nuevos**, **Ya existen** (no se tocan) y **Con errores** (unidad o categoría desconocida, propietario que no existe…; esas filas no entran). Pulsa **Importar**. Cada artículo entra con su stock inicial como *Inventario de apertura* y la referencia de sus albaranes. Repetir la importación no duplica nada.
- [ ] 12.5. **Completa los mínimos**: el botón **Completar mínimo (N)** abre la lista de los artículos importados sin mínimo. Escribe el mínimo de cada uno (en su formato: cajas, botes, metros…) y **Guarda**. Mientras un artículo no tenga mínimo, no genera avisos de reposición.
- [ ] 12.6. **Da de alta los equipos, vehículos y técnicos reales** en **Equipos y técnicos**: primero los vehículos (matrícula), luego los equipos (con el nombre tal como lo envía el wizard, p. ej. *Búfala 1*) y asígnales su vehículo; por último los técnicos, con su código y teléfono. Cada cambio de equipo queda en el **historial**.
- [ ] 12.7. **Carga los vehículos**: si un vehículo ya lleva material, regístralo como **Traspaso** al vehículo desde la ficha del artículo (o con una entrega firmada). Así el total (almacén + vehículos) cuadra desde el primer día.

## 13. Copia por WhatsApp y portal del técnico (E-014)

> **E-017 · Las entregas son al equipo.** En **Entregas y firmas** eliges el **equipo** (con su vehículo y sus técnicos); el material entra en su vehículo. Al firmar, tocas el nombre del **técnico que recoge** (si el equipo tiene uno solo, ya viene elegido) y firma él; queda como "recogido por". La ropa y los EPIs de la cesta pasan a esa persona. Puedes marcar que la copia por correo llegue también al resto del equipo, y en el albarán enviarla por WhatsApp a cada técnico. En su portal, cada técnico ve las entregas de su equipo mientras pertenece a él.

- [ ] 13.1. En **Equipos y técnicos → Técnicos**, pon el **teléfono** de cada técnico (o escríbelo en la pantalla de firma: se guarda solo).
- [ ] 13.2. Tras firmar una entrega, en el albarán pulsa **Enviar por WhatsApp**. Se abre WhatsApp con un mensaje breve y un **enlace personal** al portal del técnico: sus entregas firmadas (con el PDF) y el material que lleva su vehículo. Sin usuario ni contraseña.
- [ ] 13.3. Cada envío (WhatsApp, PDF compartido o correo) queda en **Copias enviadas** del albarán, con fecha y quién lo mandó.
- [ ] 13.4. Si un técnico pierde el móvil o deja la empresa: su fila → **Portal** → **Revocar todos**. Sus enlaces dejan de funcionar al momento. **Revocar y generar nuevo** crea otro y lo puedes enviar por WhatsApp desde ahí.

## 14. Cierres del wizard: descontar el material de los vehículos (E-012)

Cada cierre que un equipo hace con el wizard (`cierre-esbrain.html`) descuenta del **vehículo de su equipo** el material declarado. Es un control aproximado: se corrige con el recuento del vehículo.

- [ ] 14.1. **Equipos:** en **Equipos y técnicos**, los equipos se llaman exactamente como en el wizard (`Búfala 1`, `Búfala 2`, `Búfala 3`) y cada uno tiene su vehículo. En **Configuración → Integraciones y cierres** lo verás en verde o con el aviso de lo que falta.
- [ ] 14.2. **Equivalencias:** en el mismo bloque, **Cargar la propuesta** (las reglas del chat con tus respuestas: conductores por sección, UTP según el cargador, manguitos, fijaciones, canaleta = moldura Hager…). Revísalas y pulsa **Confirmar**. Las partidas sin artículo (bornas trifásicas, cajas, magnetotérmicos, picas…) no descuentan hasta que les pongas uno. Elige el **kit de fijación** por defecto (A: clip + clavo) y la fecha de **apertura** (los cierres anteriores se ignoran).
- [ ] 14.3. **Token:** **Crear token para el wizard**. Copia `ALMACEN_URL` y `ALMACEN_TOKEN`: el token se enseña una sola vez.
- [ ] 14.4. **Apps Script:** abre el proyecto de Google Apps Script del wizard (el de `WEB_APP_URL`):
  1. **Configuración del proyecto** (rueda dentada) → **Propiedades del script** → añade `ALMACEN_URL` y `ALMACEN_TOKEN` con los valores del paso anterior.
  2. **Editor** → **+** → **Secuencia de comandos** → llámalo `Almacen` y pega el contenido de [`docs/apps-script-almacen.gs`](apps-script-almacen.gs).
  3. En tu `doPost`, justo después de escribir la fila en "Registro", añade la línea `enviarAlAlmacen(datos);` (`datos` = el objeto del cierre que ya recibes).
  4. **Implementar → Gestionar implementaciones → editar (lápiz) → Versión: nueva → Implementar**, para que el wizard use el código nuevo (la URL no cambia).
- [ ] 14.5. **Prueba:** haz un cierre de prueba con el wizard. En la app, **Equipos y técnicos → Cierres** debe aparecer con su estado, y el material debe bajar en el vehículo de ese equipo. Si algo falla, el Apps Script lo apunta en la hoja **Almacén-log** (y `reintentarAlmacen()` lo reenvía).
- [ ] 14.6. **Histórico:** en el editor de Apps Script, elige la función `cargarHistoricoAlAlmacen` y pulsa **Ejecutar** (la primera vez pedirá permisos). Envía los cierres de "Registro" en lotes; los anteriores a la apertura se ignoran y reenviar no descuenta dos veces. Si las cabeceras de "Registro" no se llaman como los campos del wizard, exporta la hoja a CSV con esos nombres y cárgala en **Configuración → Integraciones y cierres → Cargar histórico (CSV)**.
- [ ] 14.7. **Día a día:**
  - **Cierres** muestra cada cierre (aplicado, parcial, discrepancia, fallido…), sus líneas traducidas, el consumo del periodo (con CSV) y las discrepancias.
  - Las líneas **por elegir** (cable de datos con un cargador que no es V2C ni Policharger, o un cargador no reconocido) las resuelves ahí mismo eligiendo el artículo.
  - **Vehículos → Recontar**: el almacén cuenta lo que hay a bordo y tú validas las diferencias en tu bandeja.
- [ ] 14.8. Si el token se filtra, **Revocar** en Integraciones y crea otro (paso 14.3 y 14.4.1).

## 15. Corregir la primera carga (E-016)

La primera carga se hizo leyendo los albaranes con la IA y dejó algunas fichas mal (unidades en `ud`, categorías, proveedor "Búfala" y dos líneas asignadas a otro artículo). Hazlo **en este orden**, para no duplicar stock:

- [ ] 15.1. **Crea a mano, con stock inicial 0**, los dos artículos que faltaban (Inventario → **Añadir referencia**):
  - `6222106082` · HAG ML MOLDURA 30X12/2,1M 2C ATEHA PVC BLN · Tubos y canalización · **metros**;
  - `6222110054` · HAG ANGULO INTERIOR ATEHA 30X12MM BLN · Tubos y canalización · unidades.
- [ ] 15.2. **Reasigna las dos líneas mal leídas** del albarán **3.322.577** (Albaranes → pulsa el albarán en el historial → **Reasignar línea**):
  - la línea de **6222110056 (tapa final), +20** → pasa a **6222106082 (moldura)**;
  - la línea de **6222110053 (ángulo exterior), +10** → pasa a **6222110054 (ángulo interior)**.
  Cada una deja dos ajustes enlazados (−A y +B) con referencia al albarán; el historial no se borra.
  - **Si ya creaste la moldura y el ángulo interior con stock inicial (20 m y 10 ud)** en lugar de 0, **no reasignes**: ese material estaría contado dos veces. Haz dos **ajustes de inventario** (E-018): abre la ficha del artículo → **Ajuste de inventario…** (debajo de los botones) → Dónde: **Almacén** → **−** y la cantidad:
    - **6222110056 (tapa final): −20** (de 30 a 10);
    - **6222110053 (ángulo exterior): −10** (de 20 a 10);
    - motivo en los dos: **"Duplicado de la corrección del albarán 3.322.577"**.
    Antes de confirmar verás "de X a Y". El ajuste no cuenta como merma, ni como salida a obra, ni como consumo, y queda en el historial y en la auditoría.
- [ ] 15.3. **Actualiza las fichas con el catálogo corregido**: Configuración → **Importar catálogo (CSV)** → `datos/catalogo-stock-real.csv` → marca **Actualizar fichas existentes**. En la pestaña "Ya existen" verás, campo a campo, lo que cambia (unidad `ud` → `m`, `bote`, `bolsa`…, categoría, proveedor **Saltoki**). **El stock no se toca**: el número ya es el del albarán. Además crea la **cinta aislante negra (9900101045) con 20 ud**. La moldura y el ángulo interior ya tienen movimientos, así que su stock no se duplica.
- [ ] 15.4. **Revisa** Configuración → **Categorías** (ya sin Fontanería; bolsas, cinta y bridas están en Consumibles) y, en Integraciones y cierres, que ninguna equivalencia salga en rojo ("NO EXISTE en el catálogo"). Después, **confirma las equivalencias**.
- [ ] 15.5. **Fotos:** las bridas incoloras se ven casi en blanco (la foto de Saltoki es transparente). Sustitúyelas con la cámara desde la ficha, igual que las que faltan (bolsas de basura y el Trydan de Esmove).

**Para el día a día:**
- **Editar una ficha** (administrador): Ficha → **Editar**. Puedes cambiar también el **código (SKU)**: se crea la ficha con el código nuevo y la antigua queda archivada dentro; el historial y las entregas firmadas conservan el código antiguo, y buscarlo lleva al nuevo. Cada cambio queda en la auditoría (antes y después).
- **Dos fichas que eran el mismo artículo:** Ficha → **Fusionar en otro artículo**. El stock (también el de los vehículos) pasa con ajustes enlazados, convertido por el formato.
- **Ajuste de inventario** (solo tú): ficha → **Ajuste de inventario…**, o en el diálogo de Entrada/Salida. Cantidad que se suma o se resta, en el almacén o en un vehículo, con motivo obligatorio. El personal de almacén ve **Proponer ajuste**, que te llega a la bandeja.
- **Aviso al dar de alta con stock inicial:** si el código ya entró por un albarán, la app lo avisa antes de guardar (para no contarlo dos veces).
- **El EAN de la caja no es el código del artículo** (E-020): si el escáner dice "no está en el catálogo", pulsa **"Es un artículo que ya tengo"** y elige el artículo. El código queda guardado (ficha → **Códigos alternativos**) y el siguiente escaneo lo abre. Si solo se lee el QR del fabricante (una web), la app lo avisa y sigue buscando el código de barras.
- **Códigos de artículo** (E-021): solo letras, números, guion, guion bajo y punto. Si creas un artículo desde un código que no sirve (la web de un QR), la app propone uno interno (`BF-000001`) y guarda el leído como código alternativo. Un artículo antiguo con código no válido sale en la bandeja ("Código no válido: cámbialo").
- **Borrar o archivar** (E-022): ficha → **Borrar o archivar…**. Solo se borra definitivamente si no tiene nada (movimientos, entregas, pendientes, códigos, foto…); si no, se **archiva** (con stock 0): deja de salir en listas, buscador, escáner y entregas, y el historial se conserva. Configuración → **Archivados**: restaurar, deshacer una fusión o borrar los que no tienen nada.
- **El código de un archivado se puede reutilizar**: al dar de alta, importar o cambiar el código a uno archivado, ese artículo se reactiva con la ficha nueva. Ejemplo: el Trydan `TRY32-1-L10-P` → **Editar** → código `8900500020` → **Guardar** deja un solo artículo `8900500020` con su stock.
- **Operaciones rechazadas**: si el servidor no acepta algo, el cambio se deshace en pantalla, sale un aviso con el motivo y queda en la bandeja ("Operaciones rechazadas") para reintentar o descartar.
- **El personal de almacén** no edita fichas: **Proponer un cambio**; te llega a la bandeja para aplicarlo o descartarlo.
- **Equivalencias:** se editan en la app (condiciones, artículos con buscador y foto, fórmula, kits). **Probar** enseña qué descontaría un cierre sin aplicar nada, y **Recalcular cierres desde…** vuelve a aplicar las reglas actuales a los cierres ya recibidos (solo la diferencia).

---

## Si algo falla

| Síntoma | Qué mirar |
|---|---|
| La app publicada no pide contraseña | Faltan las variables del paso 4, o no has repetido el paso 5.2 tras crearlas. |
| *Invalid path specified in request URL* al entrar | La variable `VITE_SUPABASE_URL` lleva algo detrás de `.supabase.co` (por ejemplo `/rest/v1/`). Déjala solo hasta `.supabase.co` y repite el paso 5.2. |
| "Correo o contraseña incorrectos" siendo correctos | En Supabase → Authentication → Users, el usuario debe estar confirmado (paso 3.1, *Auto Confirm User*). |
| "Tu usuario no tiene acceso" | Falta el paso 3.2 (la fila en `perfiles`). Compruébalo con el paso 3.3. |
| "Dar de alta un usuario" da error | La función `usuarios` no está desplegada (paso 6). |
| En la consola del navegador sale *blocked by CORS policy* | Falta el secreto `ORIGEN_APP` o no coincide con la dirección de la app (paso 6.2). |
| Los albaranes siguen en modo simulado | Falta `VITE_ALBARANES_URL` o no has repetido el paso 5.2. |
| "La lectura con IA no está configurada" | Falta el secreto `GEMINI_API_KEY` (paso 7.2). |
| Los avisos se quedan en "pendiente" en el Registro de envíos | Faltan los pasos 8.0 (clave de la tarea y Vault) o la clave del canal. El error concreto sale en el registro. |
| *No se puede cargar el archivo …npx.ps1 porque la ejecución de scripts está deshabilitada* | Escribe `npx.cmd` en lugar de `npx`. No hace falta cambiar ninguna opción de seguridad de Windows. |
| *bash no se reconoce como nombre de un cmdlet* | La palabra `bash` no se escribe: copia solo el comando que hay dentro del recuadro. |
| Supabase dice *Project paused* | Pulsa **Restore project**. Para que no vuelva a pasar, haz el paso 10. |
| Las fotos no se ven en otro móvil | La foto se sube en cuanto el móvil que la hizo tiene cobertura y la app abierta; mientras tanto, en su ficha pone *Pendiente de subir*. |
| No llegan las push en iPhone | Hay que abrir la app desde el icono de la pantalla de inicio (paso 8.8). |

Si te atascas, copia el mensaje de error exacto y pásaselo a Claude Code.
