const crypto = require('crypto');
const ZONAS = require('../config/zonas');
const TARIFAS = require('../config/tarifas');

// ── API Keys ────────────────────────────────────────────────────────────────
const hashApiKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');
const nuevaApiKey = (entorno = 'live') => `tk_${entorno}_${crypto.randomBytes(24).toString('hex')}`;
const nuevoSecreto = () => `whsec_${crypto.randomBytes(24).toString('hex')}`;

// ── Zonas ───────────────────────────────────────────────────────────────────
function asignarZona(lat, lng, ciudad, zonas = ZONAS) {
  const z = zonas.find((z) => lat >= z.minLat && lat <= z.maxLat && lng >= z.minLng && lng <= z.maxLng);
  if (z) return z.nombre;
  return ciudad ? ciudad.trim() : 'Fuera de cobertura';
}

// ── Tarifa ──────────────────────────────────────────────────────────────────
function calcularTarifa(paquete, servicioTipo, t = TARIFAS) {
  const volumetrico = (paquete.largo_cm * paquete.ancho_cm * paquete.alto_cm) / t.divisorVolumetrico;
  const pesoCobrable = Math.ceil(Math.max(paquete.peso_kg, volumetrico));
  const s = t.servicios[servicioTipo];
  const adicional = Math.max(0, pesoCobrable - t.kgIncluidos) * s.porKgAdicional;
  const seguro = Math.round((paquete.valor_declarado || 0) * t.seguroPct);
  return { valor: s.base + adicional + seguro, moneda: t.moneda, peso_cobrable_kg: pesoCobrable };
}

// ── Fechas (hora de Colombia, UTC-5 sin horario de verano) ─────────────────
function ahoraColombia(now = new Date()) {
  return new Date(now.getTime() - 5 * 3600 * 1000); // usar getUTC* sobre este valor
}
const isoFecha = (d) => d.toISOString().slice(0, 10);
function siguienteDiaHabil(d) {
  const r = new Date(d);
  do r.setUTCDate(r.getUTCDate() + 1);
  while (r.getUTCDay() === 0); // domingo no se reparte (festivos: pendiente)
  return r;
}
function fechaHoyColombia(now = new Date()) {
  return isoFecha(ahoraColombia(now));
}

function calcularEta(servicioTipo, now = new Date()) {
  const co = ahoraColombia(now);
  const hora = co.getUTCHours();
  if (servicioTipo === 'same_day' && hora < 12) return { fecha_estimada: isoFecha(co), rango_horario: '2pm - 8pm' };
  if (servicioTipo === 'express' && hora < 10) return { fecha_estimada: isoFecha(co), rango_horario: '12pm - 8pm' };
  return { fecha_estimada: isoFecha(siguienteDiaHabil(co)), rango_horario: '8am - 6pm' };
}

module.exports = {
  hashApiKey, nuevaApiKey, nuevoSecreto,
  asignarZona, calcularTarifa, calcularEta, siguienteDiaHabil, fechaHoyColombia, ahoraColombia, isoFecha,
};
