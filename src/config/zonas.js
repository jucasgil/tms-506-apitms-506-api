// Zonas de reparto. Cada zona es un rectángulo (lat/lng mínimos y máximos).
// Se evalúan en orden: la primera que contenga el punto gana.
// ⚠️ Rectángulos aproximados de Bogotá — ajústalos a tu zonificación real.
module.exports = [
  { nombre: 'Norte', minLat: 4.680, maxLat: 4.830, minLng: -74.120, maxLng: -74.000 },
  { nombre: 'Occidente', minLat: 4.600, maxLat: 4.760, minLng: -74.220, maxLng: -74.120 },
  { nombre: 'Centro', minLat: 4.590, maxLat: 4.680, minLng: -74.120, maxLng: -74.030 },
  { nombre: 'Sur', minLat: 4.450, maxLat: 4.600, minLng: -74.220, maxLng: -74.050 },
];
// Puntos fuera de todas las zonas quedan con zona = ciudad (ej: "Medellín") o "Fuera de cobertura".
