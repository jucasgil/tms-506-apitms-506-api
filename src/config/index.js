// Configuración central. Todo sale de variables de entorno (Vercel → Settings → Environment Variables).
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

module.exports = {
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),

  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    bucketGuias: process.env.SUPABASE_BUCKET_GUIAS || 'guias',
  },

  google: { mapsKey: process.env.GOOGLE_MAPS_KEY },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_FROM, // ej: whatsapp:+14155238886 o +1XXXXXXXXXX
  },

  // Secreto que usan Supabase (trigger y cron) y el dashboard para llamar endpoints internos
  internalSecret: process.env.INTERNAL_SECRET,

  deposito: {
    lat: num(process.env.DEPOSITO_LAT, 4.6486),
    lng: num(process.env.DEPOSITO_LNG, -74.1047),
  },

  empresa: {
    nombre: process.env.EMPRESA_NOMBRE || 'Transportadora 506',
    prefijoGuia: process.env.PREFIJO_GUIA || 'T506',
  },

  rutas: {
    maxParadas: num(process.env.MAX_PARADAS_POR_RUTA, 25), // límite de Google Routes con optimizeWaypointOrder
  },

  webhooks: {
    // minutos de espera antes de cada reintento (después del primer intento fallido)
    reintentosMin: [1, 5, 15],
    timeoutMs: 5000,
  },
};
