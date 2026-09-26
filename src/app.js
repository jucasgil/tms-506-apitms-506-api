const express = require('express');
const path = require('path');
const { ApiError } = require('./lib/errores');
const { pedidosRouter } = require('./routes/pedidos');
const { internosRouter } = require('./routes/internos');
const { rastreoRouter } = require('./routes/rastreo');
const { adminRouter } = require('./routes/admin');
const { appRouter } = require('./routes/app');

// Las dependencias se inyectan para poder probar la app sin servicios reales
function createApp(deps) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/v1/app', express.json({ limit: '6mb' })); // fotos de entrega
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) =>
    res.json({
      status: 'OK',
      servicio: 'tms-506-api',
      version: '1.0.0',
      configuracion: {
        supabase: Boolean(deps.config.supabase?.url && deps.config.supabase?.serviceKey),
        google_maps: Boolean(deps.config.google?.mapsKey),
        twilio: Boolean(deps.config.twilio?.accountSid),
        internal_secret: Boolean(deps.config.internalSecret),
      },
    }));

  app.use('/v1/pedidos', pedidosRouter(deps));
  app.use('/v1/internos', internosRouter(deps));
  app.use('/v1/admin', adminRouter(deps));
  app.use('/v1/app', appRouter(deps));
  app.use(rastreoRouter(deps));

  // Panel web del TMS
  const panel = path.join(__dirname, '..', 'public', 'panel');
  app.get('/', (_req, res) => res.redirect('/panel'));
  app.use('/panel', express.static(panel, { index: 'index.html', maxAge: '5m' }));

  // App del mensajero (PWA instalable)
  const appMovil = path.join(__dirname, '..', 'public', 'app');
  app.use('/app', express.static(appMovil, { index: 'index.html', maxAge: 0 }));

  app.use((_req, res) => res.status(404).json({ error: 'no_encontrado', mensaje: 'Ruta no existe' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: err.codigo, mensaje: err.message, ...(err.detalle && { detalle: err.detalle }) });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'muy_grande', mensaje: 'El archivo es demasiado pesado' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'json_invalido', mensaje: 'El cuerpo no es JSON válido' });
    console.error(err);
    res.status(500).json({ error: 'error_interno', mensaje: 'Error interno. Si persiste, contáctanos.' });
  });

  return app;
}

module.exports = { createApp };
