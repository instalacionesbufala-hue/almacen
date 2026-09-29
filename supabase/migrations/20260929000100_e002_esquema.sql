-- E-002 · Esquema del almacén (Supabase / Postgres 15+)
-- Nombres en español. Los importes van en tablas aparte (costes_*) para poder ocultarlos
-- al rol "almacen" con RLS (E-004).

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- Usuarios ----------
create table public.perfiles (
  id        uuid primary key references auth.users(id) on delete restrict,
  nombre    text not null check (length(trim(nombre)) > 0),
  email     text,
  rol       text not null default 'almacen' check (rol in ('admin', 'almacen')),
  activo    boolean not null default true,
  creado    timestamptz not null default now()
);

-- ---------- Propietarios del material en custodia (E-008) ----------
create table public.propietarios (
  id                 text primary key,
  nombre             text not null,
  contacto           text not null default '',
  correos_reposicion text[] not null default '{}',
  correos_informes   text[] not null default '{}',
  activo             boolean not null default true
);
insert into public.propietarios (id, nombre) values ('ESMOVE', 'Esmove');

-- ---------- Catálogo ----------
create table public.productos (
  sku           text primary key check (sku = upper(sku) and length(sku) between 1 and 40),
  ean           text unique,
  ref_proveedor text,
  nombre        text not null check (length(trim(nombre)) > 0),
  categoria     text not null check (categoria in ('cargadores', 'cuadros', 'cables', 'tubos', 'fijaciones', 'aparamenta', 'fontaneria')),
  unidad        text not null check (unidad in ('m', 'ud')),
  formato       numeric(12,3) not null default 1 check (formato > 0),
  formato_texto text not null default '',
  stock         numeric(14,3) not null default 0 check (stock >= 0),
  minimo        numeric(14,3) not null default 0 check (minimo >= 0),
  ubicacion     text not null default 'P00-E00-N0' check (ubicacion ~ '^P\d{1,3}-E\d{1,3}-N\d{1,2}$'),
  proveedor     text not null default '',
  con_serie     boolean not null default false,
  borrador      boolean not null default false,
  -- E-008: material propio o en custodia de un depositante (p. ej. Esmove), sin precio
  propiedad     text not null default 'propia' check (propiedad in ('propia', 'custodia')),
  propietario_id text references public.propietarios(id),
  actualizado   timestamptz not null default now(),
  check ((propiedad = 'propia' and propietario_id is null) or (propiedad = 'custodia' and propietario_id is not null)),
  -- los cargadores siempre con n.º de serie; los cuadros de protecciones no llevan (se controlan por modelo y cantidad)
  check (categoria <> 'cargadores' or con_serie)
);
create index productos_ref_proveedor on public.productos (upper(ref_proveedor));

create table public.costes_producto (
  sku    text primary key references public.productos(sku) on delete cascade,
  precio numeric(12,4) check (precio >= 0)   -- null = sin precio (material en custodia: nunca se inventa)
);

-- Números de serie (cargadores VE y otros artículos con serie)
create table public.series (
  sku       text not null references public.productos(sku) on delete cascade,
  serie     text not null check (length(trim(serie)) > 0),
  en_stock  boolean not null default true,
  equipo_id text,
  primary key (sku, serie)
);

-- ---------- Flota y personal ----------
create table public.equipos (
  id        text primary key,
  nombre    text not null,
  flota     text not null default '',
  matricula text not null unique,
  estado    text not null default 'depot' check (estado in ('ruta', 'depot', 'taller')),
  activo    boolean not null default true
);
alter table public.series add constraint series_equipo_fk foreign key (equipo_id) references public.equipos(id);

create table public.tecnicos (
  id          text primary key,
  nombre      text not null check (length(trim(nombre)) > 0),
  rol         text not null default 'Técnico',
  dni_mascara text not null default '—',
  equipo_id   text references public.equipos(id),
  activo      boolean not null default true
);

-- ---------- Movimientos (historial inalterable) ----------
create table public.movimientos (
  id         uuid primary key,                       -- generado en el cliente: clave de idempotencia
  ts         timestamptz not null default now(),
  sku        text not null references public.productos(sku),
  tipo       text not null check (tipo in ('entrada', 'salida', 'merma', 'ajuste')),
  cantidad   numeric(14,3) not null check (cantidad <> 0),
  motivo     text not null check (length(trim(motivo)) > 0),
  referencia text not null default '',
  series     text[] not null default '{}',
  equipo_id  text references public.equipos(id),
  usuario    uuid references public.perfiles(id),
  operario   text not null,
  corrige    uuid references public.movimientos(id),
  entrega_id uuid,
  albaran_id uuid,
  check (tipo = 'ajuste' or cantidad > 0)
);
create index movimientos_ts on public.movimientos (ts desc);
create index movimientos_sku on public.movimientos (sku, ts desc);

-- ---------- Albaranes ----------
create table public.albaranes (
  id        uuid primary key,
  ts        timestamptz not null default now(),
  numero    text not null default 's/n',
  proveedor text not null default '',
  cif       text not null default '',
  fecha     text not null default '',
  lineas    int not null default 0,
  unidades  numeric(14,3) not null default 0,
  confianza numeric(5,4),
  modo      text not null default 'sim' check (modo in ('ia', 'sim')),
  usuario   uuid references public.perfiles(id),
  operario  text not null
);

-- ---------- Entregas firmadas ----------
create sequence public.entregas_numero start 414;
create table public.entregas (
  id          uuid primary key,                      -- generado en el cliente (idempotencia)
  numero      text not null unique,                  -- ENT-AAAA-NNNN, lo asigna el servidor
  ts          timestamptz not null default now(),
  equipo_id   text not null references public.equipos(id),
  receptor_id text not null references public.tecnicos(id),
  dni         text not null default '',
  firma       text not null,
  hash        text not null,                         -- SHA-256 calculado en el servidor
  usuario     uuid references public.perfiles(id),
  operario    text not null
);
create table public.entrega_lineas (
  entrega_id uuid not null references public.entregas(id),
  n          int not null,
  sku        text not null references public.productos(sku),
  cantidad   numeric(14,3) not null check (cantidad > 0),
  series     text[] not null default '{}',
  primary key (entrega_id, n)
);

-- ---------- Dotación: herramientas, EPIs y ropa ----------
create table public.dotacion (
  id        text primary key,
  clase     text not null check (clase in ('herramienta', 'epi', 'ropa')),
  nombre    text not null check (length(trim(nombre)) > 0),
  marca     text not null default '',
  serie     text not null default '',
  talla     text,
  cantidad  int not null default 1 check (cantidad > 0),
  caduca    date,
  estado    text not null default 'operativa' check (estado in ('operativa', 'deteriorada', 'rota', 'perdida', 'baja')),
  equipo_id text references public.equipos(id),
  tecnico_id text references public.tecnicos(id)
);
create table public.costes_dotacion (
  id    text primary key references public.dotacion(id) on delete cascade,
  valor numeric(12,2) not null default 0 check (valor >= 0)
);
create table public.dotacion_historial (
  id             uuid primary key,
  dotacion_id    text not null references public.dotacion(id),
  ts             timestamptz not null default now(),
  tipo           text not null check (tipo in ('alta', 'asignacion', 'deterioro', 'rotura', 'perdida', 'reparacion', 'reposicion', 'baja')),
  nota           text not null default '',
  serie_anterior text,
  usuario        uuid references public.perfiles(id),
  operario       text not null
);
create table public.costes_incidencia (
  incidencia_id uuid primary key references public.dotacion_historial(id),
  coste         numeric(12,2) not null check (coste >= 0)
);

-- ---------- Reposición (E-006 lo amplía con avisos) ----------
create table public.pedidos_reposicion (
  sku      text primary key references public.productos(sku) on delete cascade,
  ts       timestamptz not null default now(),
  cantidad numeric(14,3) not null check (cantidad > 0),
  usuario  uuid references public.perfiles(id)
);
