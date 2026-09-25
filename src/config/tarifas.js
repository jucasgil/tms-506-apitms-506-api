// ⚠️ VALORES DE EJEMPLO — reemplázalos por tu tarifario real antes de salir a producción.
// Tarifa = base del servicio + valor por kg adicional (sobre el peso cobrable) + % del valor declarado (seguro).
module.exports = {
  moneda: 'COP',
  divisorVolumetrico: 5000, // peso volumétrico = largo × ancho × alto (cm) / 5000
  kgIncluidos: 1,
  seguroPct: 0.01,
  servicios: {
    estandar: { base: 9000, porKgAdicional: 1500 },
    express: { base: 14000, porKgAdicional: 2000 },
    same_day: { base: 18000, porKgAdicional: 2500 },
  },
};
