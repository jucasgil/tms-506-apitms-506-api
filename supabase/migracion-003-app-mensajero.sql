alter table conductores add column if not exists pin_hash text;
alter table conductores add column if not exists ultima_lat numeric;
alter table conductores add column if not exists ultima_lng numeric;
alter table conductores add column if not exists ultima_ubicacion_en timestamptz;
create index if not exists conductores_telefono_idx on conductores (telefono);

alter table pedidos add column if not exists entregado_en timestamptz;
alter table pedidos add column if not exists entrega_lat numeric;
alter table pedidos add column if not exists entrega_lng numeric;
alter table pedidos add column if not exists recaudo_confirmado boolean;

update conductores set telefono = right(regexp_replace(telefono, '\D', '', 'g'), 10) where telefono is not null;

select 'Migración 003 aplicada' as resultado;
