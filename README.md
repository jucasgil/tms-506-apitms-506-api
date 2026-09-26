# TMS 506 — API de integración y TMS interno

Backend Node.js/Express que recibe pedidos de los OMS clientes, genera la guía (PDF con código de barras y QR), ubica la dirección con Google, arma las rutas del día con Google Routes y notifica al OMS por webhook en cada cambio de estado.

## Endpoints

| Método | Ruta | Quién lo usa |
|---|---|---|
| `POST` | `/v1/pedidos` | OMS cliente (`X-API-Key`) — crea pedido y devuelve guía |
| `GET` | `/v1/pedidos/:pedido_id` | OMS cliente — estado, conductor, historial, evidencia |
| `DELETE` | `/v1/pedidos/:pedido_id` | OMS cliente — cancela si aún no está asignado |
| `GET` | `/rastreo/:guia` · `/v1/rastreo/:guia` | Público — página y JSON de rastreo |
| `POST` | `/v1/internos/rutas/optimizar` | Dashboard del despachador (`X-Internal-Secret`) |
| `POST` | `/v1/internos/estado` | Trigger de Supabase al cambiar `pedidos.estado` |
| `POST` | `/v1/internos/reintentar-webhooks` | pg_cron de Supabase, cada minuto |
| `GET` | `/health` | Monitoreo |

## Panel del TMS

`/panel` — interfaz para despachadores y administradores: resumen del día, monitoreo en mapa, órdenes (asignar, despachar, entregar, novedades, corregir direcciones), nueva orden manual, rutero (optimizar, iniciar y deshacer rutas), mensajeros, sellers (crear llaves de API), bodegas y usuarios. Su API está en `/v1/admin` y requiere iniciar sesión.

## Puesta en marcha

1. **Supabase** → SQL Editor → pegar `supabase/schema.sql` → Run. Luego, en una consulta nueva, `supabase/migracion-002-panel.sql` → Run. Luego actualizar el bloque *CONFIGURACIÓN* del final con la URL de Vercel y el `INTERNAL_SECRET`, y ejecutarlo.
2. **GitHub** → subir esta carpeta (sin `node_modules`) a un repositorio nuevo.
3. **Vercel** → New Project → importar el repo → cargar las variables de `.env.example` → Deploy.
4. **Primer cliente** → `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run crear-api-key -- "Nombre del cliente" sandbox`.

## Qué ajustar antes de producción

- `src/config/tarifas.js` — tarifario real (los valores actuales son de ejemplo).
- `src/config/zonas.js` — rectángulos de tus zonas de reparto.
- `DEPOSITO_LAT` / `DEPOSITO_LNG` — ubicación de la bodega.

## Pruebas

```
npm install
npm test
```
