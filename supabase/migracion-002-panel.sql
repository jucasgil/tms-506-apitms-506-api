-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 002 — Panel del TMS (usuarios, mensajeros, bodegas, órdenes manuales)
-- Supabase → SQL Editor → consulta nueva → pegar todo → Run. Se puede correr más de una vez.
-- ═══════════════════════════════════════════════════════════════════════════

-- Usuarios del panel (despachadores y administradores)
create table if not exists usuarios (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  nombre text not null,
  password_hash text not null,
  rol text not null default 'despachador' check (rol in ('admin', 'despachador')),
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
alter table usuarios enable row level security;

-- Datos del vehículo del mensajero
alter table conductores add column if not exists placa text;
alter table conductores add column if not exists tipo_vehiculo text;

-- Bodegas (la principal es el punto de salida y regreso de las rutas)
create table if not exists bodegas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  direccion text,
  ciudad text,
  lat numeric,
  lng numeric,
  principal boolean not null default false,
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);
alter table bodegas enable row level security;

-- Viajes: bodega de salida y posibilidad de deshacerlos
alter table viajes add column if not exists bodega_id uuid references bodegas(id);
alter table viajes drop constraint if exists viajes_estado_check;
alter table viajes add constraint viajes_estado_check check (estado in ('planificado', 'en_curso', 'finalizado', 'cancelado'));

-- Órdenes creadas a mano desde el panel no tienen OMS al cual avisar
alter table pedidos alter column webhook_url drop not null;
create index if not exists pedidos_actualizado_idx on pedidos (actualizado_en);

-- Cliente interno para órdenes manuales (no tiene llave de API)
insert into api_keys (cliente_nombre, api_key_hash, webhook_secret, entorno)
values ('Venta directa', 'interno-sin-llave', 'n/a', 'live')
on conflict (api_key_hash) do nothing;

-- Primer administrador. Contraseña temporal: cámbiala al entrar (menú de tu usuario → Cambiar contraseña)
insert into usuarios (email, nombre, password_hash, rol)
values ('jucasgil@gmail.com', 'Julio', 'scrypt$ebda37accb2ed8db99669302c69298dd$f9271a74827399ceb08af67d64d555d8cc0204c103c01aea5c7f0a3b167e24dd82723a7f3db8e566b845ec2634eac4c6f3443812a60f47cb2e52e09a3b6d3a75', 'admin')
on conflict (email) do nothing;

-- Dirección real del backend en Vercel (la usan los avisos automáticos de Supabase)
update config set valor = 'https://tms-506-apitms-506-api.vercel.app' where clave = 'backend_url';

-- Cliente de prueba (llave tk_test_e4978b8d…; en la base solo queda su huella)
insert into api_keys (cliente_nombre, api_key_hash, webhook_secret, entorno)
values ('Cliente de prueba', 'cf77d968d67f35df4aba582151b7efa8db16ee31e426de917d17a6e39ab830c2',
        'whsec_22ddacbf346477d4761e254dc631a2d1b858a8836256dd32', 'sandbox')
on conflict (api_key_hash) do nothing;

select 'Migración 002 aplicada' as resultado;
