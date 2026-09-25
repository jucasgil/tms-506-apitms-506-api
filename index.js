// Punto de entrada (en la raíz, como lo exige Vercel).
const config = require('./src/config');
const { createApp } = require('./src/app');
const { createDb } = require('./src/db/supabase');
const { createGeocoder } = require('./src/services/geocoding');
const { createRouteOptimizer } = require('./src/services/rutasGoogle');
const { generarGuiaPdf } = require('./src/services/guiaPdf');
const { createNotifier } = require('./src/services/notificaciones');
const { createWebhookSender } = require('./src/services/webhooks');

const { ApiError } = require('./src/lib/errores');

// Si aún no hay credenciales de Supabase, la API arranca y responde 503 en vez de caerse
function dbPendiente() {
  return new Proxy({}, {
    get: () => async () => {
      throw new ApiError(503, 'configuracion_pendiente', 'El servicio aún no tiene configurada la base de datos');
    },
  });
}

const app = createApp({
  config,
  db: config.supabase.url && config.supabase.serviceKey ? createDb(config.supabase) : dbPendiente(),
  geocodificar: createGeocoder({ apiKey: config.google.mapsKey }),
  ordenarParadas: createRouteOptimizer({ apiKey: config.google.mapsKey }),
  generarPdf: generarGuiaPdf,
  notificar: createNotifier(config.twilio),
  enviarWebhook: createWebhookSender({ timeoutMs: config.webhooks.timeoutMs }),
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`TMS API escuchando en http://localhost:${port}`));
}

module.exports = app;
