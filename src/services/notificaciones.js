// Mensajes al destinatario vía Twilio (WhatsApp o SMS). Si Twilio no está configurado, no hace nada.
const MENSAJES = {
  en_ruta: (p) => `🚚 ${p.destinatario.nombre.split(' ')[0]}, tu pedido va en camino. Guía ${p.guia_numero}. Rastréalo: ${p.tracking_url}`,
  entregado: (p) => `✅ Tu pedido fue entregado. Guía ${p.guia_numero}. ¡Gracias!`,
  reagendado: (p) =>
    `📦 Intentamos entregar tu pedido (guía ${p.guia_numero}) pero no fue posible. Lo reprogramamos para el ${p.fecha_programada}.`,
  devuelto: (p) => `↩️ Tu pedido con guía ${p.guia_numero} está siendo devuelto al remitente. Contáctalo para más información.`,
};

function createNotifier({ accountSid, authToken, from, fetchImpl = fetch }) {
  const activo = Boolean(accountSid && authToken && from);

  return async function notificarDestinatario(pedido) {
    const plantilla = MENSAJES[pedido.estado];
    if (!activo || !plantilla) return { enviado: false };

    const telefono = pedido.destinatario.telefono.replace(/[\s-]/g, '');
    const to = from.startsWith('whatsapp:') ? `whatsapp:${telefono}` : telefono;
    const resp = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: plantilla(pedido) }),
    });
    if (!resp.ok) console.error('Twilio error', resp.status, await resp.text());
    return { enviado: resp.ok };
  };
}

module.exports = { createNotifier, MENSAJES };
