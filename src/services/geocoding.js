// Google Geocoding API: dirección de texto → coordenadas + dirección formateada.
// Restringe la búsqueda a la ciudad del pedido y verifica que el resultado caiga en esa ciudad.
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

// "Bogotá", "bogota d.c.", "BOGOTÁ, D.C." → "bogota"
const plano = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\bd\.?\s*c\.?\b/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const esBogota = (ciudad) => plano(ciudad).startsWith('bogota');

// Para Google, Bogotá es un distrito aparte y no pertenece a Cundinamarca: mezclarlos lleva a otros municipios
function armarConsulta({ direccion, ciudad, departamento }) {
  const partes = [normalizarDireccion(direccion)];
  if (esBogota(ciudad)) partes.push('Bogotá D.C.');
  else {
    partes.push(ciudad);
    if (departamento && plano(departamento) !== plano(ciudad)) partes.push(departamento);
  }
  partes.push('Colombia');
  return partes.join(', ');
}

// ¿El resultado de Google está en la ciudad pedida?
function resultadoEnCiudad(resultado, ciudad) {
  const buscada = plano(ciudad);
  const comps = resultado.address_components || [];
  const nombres = comps
    .filter((c) => (c.types || []).some((t) => ['locality', 'administrative_area_level_2', 'administrative_area_level_1', 'sublocality', 'postal_town'].includes(t)))
    .flatMap((c) => [plano(c.long_name), plano(c.short_name)]);
  if (!nombres.length) return plano(resultado.formatted_address).includes(buscada);
  return nombres.some((n) => n && (n === buscada || n.startsWith(buscada) || buscada.startsWith(n)));
}

function createGeocoder({ apiKey, fetchImpl = fetch }) {
  const consultar = async (consulta, componentes) => {
    const url =
      'https://maps.googleapis.com/maps/api/geocode/json' +
      `?address=${encodeURIComponent(consulta)}&components=${encodeURIComponent(componentes)}&language=es&region=co&key=${apiKey}`;
    const data = await (await fetchImpl(url)).json();
    if (data.status === 'ZERO_RESULTS') return [];
    if (data.status !== 'OK') throw new Error(`Google Geocoding respondió ${data.status}: ${data.error_message || ''}`);
    return data.results;
  };

  return async function geocodificar(entrega) {
    if (!apiKey) throw new Error('GOOGLE_MAPS_KEY no está configurada');
    const { ciudad } = entrega;
    const consulta = armarConsulta(entrega);
    const localidad = esBogota(ciudad) ? 'Bogotá' : ciudad;

    // 1) Restringido a la ciudad; 2) si no hay nada, solo al país
    let resultados = await consultar(consulta, `country:CO|locality:${localidad}`);
    if (!resultados.length) resultados = await consultar(consulta, 'country:CO');
    if (!resultados.length) throw errores.direccion({ consulta, motivo: 'Google no encontró la dirección' });

    const top = resultados.find((r) => resultadoEnCiudad(r, ciudad)) || resultados[0];
    const enCiudad = resultadoEnCiudad(top, ciudad);
    const tipo = top.geometry.location_type; // ROOFTOP | RANGE_INTERPOLATED | GEOMETRIC_CENTER | APPROXIMATE
    return {
      lat: top.geometry.location.lat,
      lng: top.geometry.location.lng,
      direccion_formateada: top.formatted_address,
      precision: enCiudad ? tipo : 'OTRA_CIUDAD',
      // Revisión si Google no encontró el número exacto o si el punto cae fuera de la ciudad pedida
      requiere_revision: !enCiudad || top.partial_match === true || tipo === 'APPROXIMATE' || tipo === 'GEOMETRIC_CENTER',
    };
  };
}

module.exports = { createGeocoder, normalizarDireccion, armarConsulta, resultadoEnCiudad };
