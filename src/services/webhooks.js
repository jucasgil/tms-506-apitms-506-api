// Webhooks hacia el OMS del cliente: armado del payload, envío y cálculo de reintentos.

function construirPayload(pedido, ahora = new Date()) {
  const payload = {
    evento: `pedido.${pedido.estado}`,
    version: '1.0',
    timestamp: ahora.toISOString(),
    pedido_id: pedido.pedido_oms_id,
    guia_numero: pedido.guia_numero,
    estado: {
      codigo: pedido.estado,
      descripcion: DESCRIPCIONES[pedido.estado] || pedido.estado,
      timestamp: pedido.actualizado_en || ahora.toISOString(),
    },
    evidencia: pedido.evidencia || null,
    novedad: pedido.novedad || null,
  };
  if (pedido.conductor) payload.conductor = pedido.conductor;
  if (pedido.fecha_programada && pedido.estado === 'reagendado') payload.nueva_fecha_estimada = pedido.fecha_programada;
  return payload;
}

const DESCRIPCIONES = {
  pendiente: 'Pedido recibido, procesando guía',
  guia_generada: 'Guía generada, esperando despacho',
  asignado: 'Asignado a conductor y ruta',
  en_ruta: 'Conductor en camino al destino',
  entregado: 'Entrega confirmada',
  novedad: 'Intento de entrega fallido',
  reagendado: 'Entrega reprogramada',
  devuelto: 'Paquete en devolución al remitente',
  cancelado: 'Pedido cancelado',
};

// Devuelve la fecha del siguiente intento, o null si ya se agotaron los reintentos
function proximoIntento(intentosHechos, reintentosMin, ahora = new Date()) {
  const espera = reintentosMin[intentosHechos - 1];
  return espera === undefined ? null : new Date(ahora.getTime() + espera * 60000);
}

function createWebhookSender({ timeoutMs = 5000, fetchImpl = fetch }) {
  return async function enviar(url, payload, secreto) {
    try {
      const resp = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': secreto || '' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { ok: resp.status >= 200 && resp.status < 300, status: resp.status };
    } catch (err) {
      return { ok: false, status: 0, error: err.message };
    }
  };
}

module.exports = { construirPayload, proximoIntento, createWebhookSender, DESCRIPCIONES };
