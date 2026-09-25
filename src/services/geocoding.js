// Google Geocoding API: dirección de texto → coordenadas + dirección formateada.
const { errores } = require('../lib/errores');

// Expande abreviaturas comunes en Colombia para mejorar la precisión de Google
function normalizarDireccion(dir) {
  return dir
    .replace(/\s+/g, ' ')
    .replace(/\b(cra|kra|kr|cr|carr)\.?\s/gi, 'Carrera ')
    .replace(/\b(cll|cl|calle)\.?\s/gi, 'Calle ')
    .replace(/\b(av|avda)\.?\s/gi, 'Avenida ')
    .replace(/\b(dg|diag)\.?\s/gi, 'Diagonal ')
    .replace(/\b(tv|trans|transv)\.?\s/gi, 'Transversal ')
    .replace(/\bno\.?\s*(?=\d)/gi, '# ')
    .trim();
}

function createGeocoder({ apiKey, fetchImpl = fetch }) {
  return async function geocodificar({ direccion, ciudad, departamento }) {
    if (!apiKey) throw new Error('GOOGLE_MAPS_KEY no está configurada');
    const consulta = `${normalizarDireccion(direccion)}, ${ciudad}, ${departamento}, Colombia`;
    const url =
      'https://maps.googleapis.com/maps/api/geocode/json' +
      `?address=${encodeURIComponent(consulta)}&components=country:CO&language=es&region=co&key=${apiKey}`;

    const resp = await fetchImpl(url);
    const data = await resp.json();

    if (data.status === 'ZERO_RESULTS') throw errores.direccion({ consulta, motivo: 'Google no encontró la dirección' });
    if (data.status !== 'OK') throw new Error(`Google Geocoding respondió ${data.status}: ${data.error_message || ''}`);

    const top = data.results[0];
    const tipo = top.geometry.location_type; // ROOFTOP | RANGE_INTERPOLATED | GEOMETRIC_CENTER | APPROXIMATE
    return {
      lat: top.geometry.location.lat,
      lng: top.geometry.location.lng,
      direccion_formateada: top.formatted_address,
      precision: tipo,
      // Se marca para revisión si Google no encontró el número exacto
      requiere_revision: top.partial_match === true || tipo === 'APPROXIMATE' || tipo === 'GEOMETRIC_CENTER',
    };
  };
}

module.exports = { createGeocoder, normalizarDireccion };
