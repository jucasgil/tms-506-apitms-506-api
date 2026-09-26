-- ═══════════════════════════════════════════════════════════════════════════
-- TMS 506 — Esquema completo de Supabase
-- Cómo usarlo: Supabase → SQL Editor → pegar todo → Run.
-- Después, ejecutar el bloque "CONFIGURACIÓN" del final con tus valores reales.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ── Configuración que usan los triggers para llamar al backend ─────────────
create table if not exists config (
  clave text primary key,
  valor text not null
);

-- ── Clientes OMS ───────────────────────────────────────────────────────────
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  cliente_nombre text not null,
  api_key_hash text unique not null,          -- se guarda el hash SHA-256, nunca la llave
  webhook_secret text not null,               -- va en el header X-Webhook-Secret de cada webhook
  entorno text not null default 'live' check (entorno in ('live', 'sandbox')),
  activa boolean not null default true,
  creada_en timestamptz not null default now()
);

-- ── Conductores ────────────────────────────────────────────────────────────
create table if not exists conductores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  telefono text,
  email text,                                 -- para el login en la app de Glide
  vehiculo text,
  zona text,                                  -- Norte | Sur | Centro | Occidente | null = cualquier zona
  capacidad_kg numeric not null default 50,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- ── Viajes (ruta del día de cada conductor) ────────────────────────────────
create table if not exists viajes (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  conductor_id uuid references conductores(id),
  secuencia jsonb not null default '[]',      -- [{orden, pedido_id, guia_numero, lat, lng, ...}]
  total_paradas int,
  km_totales numeric,
  duracion_min int,
  kg_totales numeric,
  estado text not null default 'planificado' check (estado in ('planificado', 'en_curso', 'finalizado')),
  creado_en timestamptz not null default now()
);

-- ── Consecutivo de guías ───────────────────────────────────────────────────
create sequence if not exists guia_seq start 1;
create or replace function siguiente_guia() returns bigint
language sql security definer as $$ select nextval('guia_seq') $$;

-- ── Pedidos ────────────────────────────────────────────────────────────────
create table if not exists pedidos (
  id uuid primary key default gen_random_uuid(),
  pedido_oms_id text not null,
  referencia text,
  cliente_id uuid not null references api_keys(id),
  guia_numero text unique not null,
  destinatario jsonb not null,
  entrega jsonb not null,
  paquete jsonb not null,
  servicio jsonb not null,
  eta jsonb,
  tarifa jsonb,
  lat numeric,
  lng numeric,
  zona text,
  requiere_revision boolean not null default false,
  estado text not null default 'pendiente' check (estado in
    ('pendiente','guia_generada','asignado','en_ruta','entregado','novedad','reagendado','devuelto','cancelado')),
  fecha_programada date,
  intentos_entrega int not null default 0,
  pdf_url text,
  tracking_url text,
  webhook_url text not null,
  conductor_id uuid references conductores(id),
  viaje_id uuid references viajes(id),
  -- Columnas que llena la app del conductor (Glide)
  evidencia_foto_url text,
  evidencia_firma_url text,
  receptor_nombre text,
  novedad_tipo text check (novedad_tipo in
    ('cliente_ausente','direccion_incorrecta','rehusado','acceso_restringido','dano_paquete','otro')),
  novedad_descripcion text,
  novedad_foto_url text,
  novedad_accion text,
  -- Columnas planas para que Glide/Softr las muestren sin leer JSON
  destinatario_nombre text generated always as (destinatario->>'nombre') stored,
  destinatario_telefono text generated always as (destinatario->>'telefono') stored,
  direccion text generated always as (entrega->>'direccion') stored,
  ciudad text generated always as (entrega->>'ciudad') stored,
  peso_kg numeric generated always as ((paquete->>'peso_kg')::numeric) stored,
  servicio_tipo text generated always as (servicio->>'tipo') stored,
  creada_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (cliente_id, pedido_oms_id)
);
create index if not exists pedidos_estado_idx on pedidos (estado);
create index if not exists pedidos_conductor_idx on pedidos (conductor_id);

-- ── Historial de estados (lo llena un trigger) ─────────────────────────────
create table if not exists pedido_eventos (
  id bigint generated always as identity primary key,
  pedido_id uuid not null references pedidos(id) on delete cascade,
  estado text not null,
  creado_en timestamptz not null default now()
);
create index if not exists pedido_eventos_pedido_idx on pedido_eventos (pedido_id);

-- ── Cola de reintentos de webhooks ─────────────────────────────────────────
create table if not exists webhook_pendientes (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references pedidos(id) on delete cascade,
  url text not null,
  payload jsonb not null,
  secreto text,
  intentos int not null default 0,
  ultimo_status int,
  proximo_intento timestamptz not null default now(),
  entregado boolean not null default false,
  agotado boolean not null default false,
  creado_en timestamptz not null default now()
);
create index if not exists webhook_pendientes_cola_idx on webhook_pendientes (proximo_intento) where not entregado and not agotado;

-- ═══════════════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════

-- actualizado_en + historial de estados
create or replace function pedidos_antes_de_guardar() returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end $$;

drop trigger if exists pedidos_actualizado on pedidos;
create trigger pedidos_actualizado before update on pedidos
  for each row execute function pedidos_antes_de_guardar();

create or replace function registrar_evento_estado() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.estado is distinct from old.estado then
    insert into pedido_eventos (pedido_id, estado) values (new.id, new.estado);
  end if;
  return new;
end $$;

drop trigger if exists pedidos_evento on pedidos;
create trigger pedidos_evento after insert or update of estado on pedidos
  for each row execute function registrar_evento_estado();

-- Aviso al backend en cada cambio de estado → webhook al OMS + WhatsApp + reglas de novedad
create or replace function avisar_backend_estado() returns trigger
language plpgsql security definer as $$
declare
  v_url text := (select valor from config where clave = 'backend_url');
  v_secreto text := (select valor from config where clave = 'internal_secret');
begin
  if v_url is null or new.estado is not distinct from old.estado then
    return new;
  end if;
  perform net.http_post(
    url := v_url || '/v1/internos/estado',
    body := jsonb_build_object('record', to_jsonb(new), 'old_record', to_jsonb(old)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Internal-Secret', v_secreto),
    timeout_milliseconds := 10000
  );
  return new;
end $$;

drop trigger if exists pedidos_avisar_backend on pedidos;
create trigger pedidos_avisar_backend after update of estado on pedidos
  for each row execute function avisar_backend_estado();

-- ═══════════════════════════════════════════════════════════════════════════
-- ALMACENAMIENTO DE PDFs Y SEGURIDAD
-- ═══════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public) values ('guias', 'guias', true)
on conflict (id) do nothing;

-- RLS activado: solo el backend (service role) accede. Glide/Softr se conectan con su propia credencial.
alter table config enable row level security;
alter table api_keys enable row level security;
alter table conductores enable row level security;
alter table viajes enable row level security;
alter table pedidos enable row level security;
alter table pedido_eventos enable row level security;
alter table webhook_pendientes enable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- CONFIGURACIÓN — reemplaza los valores y ejecuta este bloque
-- ═══════════════════════════════════════════════════════════════════════════
insert into config (clave, valor) values
  ('backend_url', 'https://tms-506-apitms-506-api.vercel.app'),   -- cámbiala si Vercel asigna otra URL
  ('internal_secret', '8fedfc0a8e34ca58d2b19c2a08f4120da125fc7a16ad75e863390973fc2075b2')
on conflict (clave) do update set valor = excluded.valor;

-- Reintentos de webhooks cada minuto
select cron.unschedule('reintentar-webhooks') where exists (select 1 from cron.job where jobname = 'reintentar-webhooks');
select cron.schedule('reintentar-webhooks', '* * * * *', $$
  select net.http_post(
    url := (select valor from config where clave = 'backend_url') || '/v1/internos/reintentar-webhooks',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'X-Internal-Secret', (select valor from config where clave = 'internal_secret'))
  ) where exists (select 1 from webhook_pendientes where not entregado and not agotado and proximo_intento <= now());
$$);
