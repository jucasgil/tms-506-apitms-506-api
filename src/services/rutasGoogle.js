// Google Routes API: ordena las paradas de UN conductor (máx. 25) saliendo y volviendo al depósito.
const punto = (lat, lng) => ({ location: { latLng: { latitude: Number(lat), longitude: Number(lng) } } });

function createRouteOptimizer({ apiKey, fetchImpl = fetch }) {
  return async function ordenarParadas(deposito, pedidos) {
    if (!apiKey) throw new Error('GOOGLE_MAPS_KEY no está configurada');
    if (pedidos.length === 0) return { secuencia: [], km: 0, duracion_min: 0 };
    if (pedidos.length > 25) throw new Error('Google Routes admite máximo 25 paradas por ruta');

    const resp = await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify({
        origin: punto(deposito.lat, deposito.lng),
        destination: punto(deposito.lat, deposito.lng),
        intermediates: pedidos.map((p) => punto(p.lat, p.lng)),
        travelMode: 'DRIVE',
        optimizeWaypointOrder: true,
        languageCode: 'es-419',
        regionCode: 'CO',
      }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.routes?.length)
      throw new Error(`Google Routes respondió ${resp.status}: ${data.error?.message || 'sin rutas'}`);

    const ruta = data.routes[0];
    // Con una sola parada Google puede omitir el índice optimizado
    const indices = ruta.optimizedIntermediateWaypointIndex ?? pedidos.map((_, i) => i);
    return {
      secuencia: indices.map((i) => pedidos[i]),
      km: Math.round((ruta.distanceMeters || 0) / 100) / 10,
      duracion_min: Math.round(parseInt(ruta.duration || '0', 10) / 60),
    };
  };
}

module.exports = { createRouteOptimizer };
