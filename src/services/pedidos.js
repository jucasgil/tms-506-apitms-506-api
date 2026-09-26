// Creación de pedidos: la usan la API de los OMS (POST /v1/pedidos) y el panel (Nueva orden).
const { validarPedido } = require('../lib/validacion');
const { errores } = require('../lib/errores');
const { asignarZona, calcularTarifa, calcularEta, fechaHoyColombia } = require('../lib/calculos');

async function crearPedido({ db, geocodificar, generarPdf, config, now = () => new Date() }, cliente, b, { requiereWebhook = true } = {}) {
  const problemas = validarPedido(b, { requiereWebhook });
  if (problemas.length) throw errores.validacion(problemas);
  if (await db.buscarPedido(cliente.id, b.pedido_id)) throw errores.duplicado(b.pedido_id);

  const geo = await geocodificar(b.entrega);
  const zona = asignarZona(geo.lat, geo.lng, b.entrega.ciudad);
  const ahora = now();
  const anio = ahora.getUTCFullYear();
  const consecutivo = await db.siguienteGuia();
  const guia_numero = `${config.empresa.prefijoGuia}-${anio}-${String(consecutivo).padStart(6, '0')}`;
  const tracking_url = `${config.baseUrl}/rastreo/${guia_numero}`;
  const servicio = { contra_entrega: false, valor_recaudo: 0, ...b.servicio };
  const eta = calcularEta(servicio.tipo, ahora);
  const tarifa = calcularTarifa(b.paquete, servicio.tipo);

  const pdf = await generarPdf(
    {
      guia_numero, tracking_url, zona, eta, servicio,
      servicio_tipo: servicio.tipo,
      pedido_oms_id: b.pedido_id,
      destinatario: b.destinatario,
      entrega: b.entrega,
      paquete: b.paquete,
      direccion_mostrar: `${b.entrega.direccion}, ${b.entrega.ciudad}`,
      fecha_creacion: fechaHoyColombia(ahora),
    },
    { empresa: config.empresa }
  );
  const pdf_url = await db.subirPdf(`${anio}/${guia_numero}.pdf`, pdf);

  const pedido = await db.crearPedido({
    pedido_oms_id: b.pedido_id,
    referencia: b.referencia || null,
    cliente_id: cliente.id,
    guia_numero,
    destinatario: b.destinatario,
    entrega: { ...b.entrega, direccion_formateada: geo.direccion_formateada, precision: geo.precision },
    paquete: b.paquete,
    servicio,
    lat: geo.lat,
    lng: geo.lng,
    zona,
    requiere_revision: geo.requiere_revision,
    estado: 'guia_generada',
    pdf_url,
    tracking_url,
    webhook_url: b.webhook_url || null,
    eta,
    tarifa,
    fecha_programada: servicio.fecha_entrega_prometida || null,
  });

  return { pedido, geo, eta, tarifa, pdf_url, tracking_url, guia_numero };
}

module.exports = { crearPedido };
