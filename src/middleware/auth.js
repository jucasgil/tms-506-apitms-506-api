const crypto = require('crypto');
const { hashApiKey } = require('../lib/calculos');
const { errores } = require('../lib/errores');

// Clientes OMS: header X-API-Key
const apiKeyAuth = (db) => async (req, _res, next) => {
  const key = req.header('X-API-Key');
  if (!key) throw errores.noAutorizado();
  const cliente = await db.buscarApiKey(hashApiKey(key));
  if (!cliente) throw errores.noAutorizado();
  req.cliente = cliente;
  next();
};

// Supabase (trigger y cron) y el dashboard: header X-Internal-Secret
const internalAuth = (secreto) => (req, _res, next) => {
  const recibido = Buffer.from(req.header('X-Internal-Secret') || '');
  const esperado = Buffer.from(secreto || '');
  if (!secreto || recibido.length !== esperado.length || !crypto.timingSafeEqual(recibido, esperado))
    throw errores.noAutorizado();
  next();
};

module.exports = { apiKeyAuth, internalAuth };
