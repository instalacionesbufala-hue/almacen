# Almacén Búfala · control de stock

Control de stock del almacén de Búfala Tech (material eléctrico, fontanería y movilidad eléctrica), con el diseño de Stitch (`diseno/stitch/`). Funciona en PC y en el móvil del operario.

- **Stock general**: KPIs, semáforo rojo/amarillo/verde, buscador y filtros por categoría, estado y pasillo, recuento cíclico.
- **Escáner**: cámara del móvil (QR `BUF:<SKU>|SN:<serie>`, EAN, n.º de serie) para dar entradas y salidas.
- **Albaranes con IA**: foto o PDF, propone líneas de cualquier proveedor y **no ingresa nada sin confirmar**.
- **Entregas y firmas**: cesta almacén → furgoneta, firma del receptor y huella SHA-256.
- **Equipos y técnicos**: cuadrillas con furgoneta, desdoblar o emparejar, stock a bordo.
- **Dotación**: herramientas, EPIs (con caducidad) y ropa de trabajo asignados a equipos o técnicos, con roturas, pérdidas, deterioro y reposiciones.
- **Movimientos**: historial de entradas, salidas y mermas con operario, exportable a CSV.

## Arrancar en tu ordenador

Necesitas [Node.js](https://nodejs.org) 20 o superior.

```bash
npm install
npm run dev      # abre http://localhost:5173
npm test         # pruebas de las reglas de negocio (src/domain)
npm run build    # genera la versión publicable en dist/
```

## Publicar en GitHub Pages

La acción `.github/workflows/pages.yml` pasa las pruebas, compila y publica la app cada vez que se sube algo a `main`. Solo hay que activarla una vez: **Settings → Pages → Source: GitHub Actions**.

## Estructura

```
src/data       tipos y datos de demostración
src/domain     reglas de negocio puras + pruebas (Vitest)
src/store      estado (localStorage por ahora; aquí se conectará Supabase, E-002)
src/features   pantallas: inventario, escáner, albaranes, entregas, equipos, dotación, movimientos, configuración
src/ui         componentes del diseño Stitch
prototipo/     versiones anteriores (solo como referencia)
diseno/stitch  pantallas de Stitch (referencia visual)
```

## Lectura real de albaranes

Por defecto la lectura es simulada. Cuando exista la función de servidor con Gemini (E-003), se pone su URL en la variable `VITE_ALBARANES_URL` (en local, en `.env.local`; en GitHub, en **Settings → Secrets and variables → Actions → Variables**). La clave de la IA nunca va en la app.

El trabajo entre el chat y Claude Code se coordina en `PUENTE.md`, y el contexto del proyecto está en `CLAUDE.md`.
