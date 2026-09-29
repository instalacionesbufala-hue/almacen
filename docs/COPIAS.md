# Copias de seguridad de la base de datos

## Qué hace

La tarea `.github/workflows/copia-seguridad.yml` se ejecuta **los lunes y los jueves** a las 03:17 (hora UTC):

1. **Mantiene activo Supabase.** Hace una consulta a la API. El plan gratuito pausa el proyecto tras 7 días sin actividad, y dos ejecuciones por semana lo evitan con margen.
2. **Vuelca la base de datos** con `pg_dump` 17:
   - `almacen_FECHA.dump`: todas las tablas de la app (esquema `public`), con su estructura y sus datos.
   - `usuarios_FECHA.dump`: los usuarios de acceso (`auth.users`), necesarios para que los perfiles vuelvan a funcionar.
3. **La cifra** con AES-256 (GPG) usando tu contraseña `COPIA_CLAVE`.
4. **La guarda en un repositorio privado aparte** (`COPIAS_REPO`, por ejemplo `instalacionesbufala-hue/almacen-copias`), **nunca en este repositorio, que es público**. Se conservan las 26 copias más recientes, unos 3 meses.

Si falta alguna de las claves, la tarea sigue manteniendo activo el proyecto y avisa de que la copia está desactivada.

## Dónde queda cada copia

`https://github.com/<COPIAS_REPO>/tree/main/copias/almacen_AAAA-MM-DD_HHMM.tar.gz.gpg`

También puedes lanzar una copia a mano: **Actions → "Copia de seguridad y mantener activo Supabase" → Run workflow**.

## Cómo restaurar

Necesitas la contraseña `COPIA_CLAVE` y la cadena de conexión de la base de datos de destino (Supabase → **Connect** → **Session pooler**).

```bash
gpg --decrypt almacen_AAAA-MM-DD_HHMM.tar.gz.gpg > copia.tar.gz
tar -xzf copia.tar.gz
# 1) usuarios (antes que los perfiles)
pg_restore --data-only --no-owner -d "CADENA_DE_CONEXION" usuarios_AAAA-MM-DD_HHMM.dump
# 2) datos y estructura de la app
pg_restore --clean --if-exists --no-owner -d "CADENA_DE_CONEXION" almacen_AAAA-MM-DD_HHMM.dump
```

- **Proyecto nuevo y vacío:** restaura directamente y después ejecuta de nuevo el último bloque de `supabase/migrations/…_seguridad.sql` (permisos y tiempo real), porque `--no-privileges` no copia los permisos.
- **Recuperar solo unas filas:** restaura en un proyecto de pruebas y copia desde ahí lo que necesites. Así el proyecto real no se toca.
- **El historial no se reescribe:** movimientos, entregas e incidencias son inalterables. Si hubo un error, corrígelo con un ajuste; no restaures encima del proyecto real salvo en caso de pérdida total.

La guía de puesta en marcha (`docs/PUESTA-EN-MARCHA.md`) explica cómo crear el repositorio privado, el token y cada clave.
