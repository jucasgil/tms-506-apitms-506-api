// Contraseñas (scrypt) y tokens de sesión firmados (HMAC) para el panel.
const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verificarPassword(password, guardado) {
  const [alg, salt, hash] = String(guardado || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const calc = crypto.scryptSync(String(password), salt, 64);
  const esperado = Buffer.from(hash, 'hex');
  return esperado.length === calc.length && crypto.timingSafeEqual(calc, esperado);
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const claveFirma = (secreto) => crypto.createHash('sha256').update(`panel:${secreto}`).digest();

function firmarToken(payload, secreto, horas = 12) {
  const cuerpo = b64(JSON.stringify({ ...payload, exp: Date.now() + horas * 3600e3 }));
  const firma = crypto.createHmac('sha256', claveFirma(secreto)).update(cuerpo).digest('base64url');
  return `${cuerpo}.${firma}`;
}

function leerToken(token, secreto) {
  const [cuerpo, firma] = String(token || '').split('.');
  if (!cuerpo || !firma || !secreto) return null;
  const esperada = crypto.createHmac('sha256', claveFirma(secreto)).update(cuerpo).digest('base64url');
  if (esperada.length !== firma.length || !crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(firma))) return null;
  const payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
  return payload.exp > Date.now() ? payload : null;
}

module.exports = { hashPassword, verificarPassword, firmarToken, leerToken };
