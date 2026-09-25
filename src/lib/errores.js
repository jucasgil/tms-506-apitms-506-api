class ApiError extends Error {
  constructor(status, codigo, mensaje, detalle) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

const errores = {
  validacion: (detalle) => new ApiError(400, 'validacion', 'El cuerpo de la solicitud no cumple el esquema', detalle),
  noAutorizado: () => new ApiError(401, 'no_autorizado', 'API Key inválida o ausente'),
  noEncontrado: (msg = 'Recurso no encontrado') => new ApiError(404, 'no_encontrado', msg),
  duplicado: (pedidoId) => new ApiError(409, 'duplicado', `El pedido ${pedidoId} ya fue registrado`),
  noCancelable: (estado) =>
    new ApiError(409, 'no_cancelable', `No se puede cancelar un pedido en estado "${estado}". Contáctanos directamente.`),
  direccion: (detalle) => new ApiError(422, 'direccion_no_geocodificable', 'No se pudo ubicar la dirección de entrega', detalle),
};

module.exports = { ApiError, errores };
