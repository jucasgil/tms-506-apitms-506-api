// Acción automática según el tipo de novedad que el conductor elige en la app.
const { siguienteDiaHabil, ahoraColombia, isoFecha } = require('../lib/calculos');

const REGLAS = {
  cliente_ausente: { accion: 'reagendar', maxIntentos: 2 },
  acceso_restringido: { accion: 'reagendar', maxIntentos: 2 },
  direccion_incorrecta: { accion: 'revision' },
  rehusado: { accion: 'devolver' },
  dano_paquete: { accion: 'escalar' },
  otro: { accion: 'revision' },
};

// Devuelve los cambios a aplicar sobre el pedido (o null si solo queda para revisión manual)
function resolverNovedad(pedido, now = new Date()) {
  const tipo = pedido.novedad?.tipo || 'otro';
  const regla = REGLAS[tipo] || REGLAS.otro;
  const intentos = (pedido.intentos_entrega || 0) + 1;

  if (regla.accion === 'reagendar') {
    if (intentos > regla.maxIntentos) return { estado: 'devuelto', intentos_entrega: intentos, accion: 'devolver_por_intentos' };
    return {
      estado: 'reagendado',
      intentos_entrega: intentos,
      fecha_programada: isoFecha(siguienteDiaHabil(ahoraColombia(now))),
      conductor_id: null,
      accion: 'reagendar_siguiente_dia',
    };
  }
  if (regla.accion === 'devolver') return { estado: 'devuelto', intentos_entrega: intentos, accion: 'devolver_origen' };
  if (regla.accion === 'escalar') return { requiere_revision: true, intentos_entrega: intentos, accion: 'escalar_supervisor' };
  return { requiere_revision: true, intentos_entrega: intentos, accion: 'revision_despachador' };
}

module.exports = { resolverNovedad, REGLAS };
