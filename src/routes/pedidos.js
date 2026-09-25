const express = require('express');
const { validarPedido } = require('../lib/validacion');
const { errores } = require('../lib/errores');
const { asignarZona, calcularTarifa, calcularEta, fechaHoyColombia } = require('../lib/calculos');
const { apiKeyAuth } = require('../middleware/auth');
const { DESCRIPCIONES } = require('../services/webhooks');

const CANCELABLES = ['pendiente', 'guia_generada'];

function formatearPedido(p, historial = []) {
  return {
    pedido_id: p.pedido_oms_id,
    guia_numero: p.guia_numero,
    guia_pdf_url: p.pdf_url,
    tracking_url: p.tracking_url,
    estado: p.estado,
    estado_detalle: DESCRIPCIONES[p.estado] || p.estado,
    conductor: p.conductor ? { nombre: p.conductor.nombre, telefono: p.conductor.telefono, vehiculo: p.conductor.vehiculo } : null,
    eta: p.eta,
    tarifa: p.tarifa,
    historial: historial.map((h) => ({ estado: h.estado, timestamp: h.creado_en })),
    evidencia: p.evidencia_foto_url
      ? { foto_url: p.evidencia_foto_url, firma_url: p.evidencia_firma_url, nombre_receptor: p.receptor_nombre }
      : null,
    novedad: p.novedad_tipo ? { tipo: p.novedad_tipo, descripcion: p.novedad_descripcion, accion: p.novedad_accion } : null,
  };
}

function pedidosRouter({ db, geocodificar, generarPdf, config, now = () => new Date() }) {
  const r = express.Router();
  r.use(apiKeyAuth(db));

  // ── Crear pedido y generar guía ─────────────────────────────────────────
  r.post('/', async (req, res) => {
    const problemas = validarPedido(req.body);
    if (problemas.length) throw errores.validacion(problemas);

    const b = req.body;
    const cliente = req.cliente;
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
      webhook_url: b.webhook_url,
      eta,
      tarifa,
      fecha_programada: servicio.fecha_entrega_prometida || null,
    });

    res.status(201).json({
      success: true,
      pedido_id: pedido.pedido_oms_id,
      guia_numero,
      guia_pdf_url: pdf_url,
      tracking_url,
      estado: pedido.estado,
      eta,
      tarifa: { valor: tarifa.valor, moneda: tarifa.moneda },
      direccion_validada: { direccion: geo.direccion_formateada, requiere_revision: geo.requiere_revision },
      creado_en: pedido.creada_en,
    });
  });

  // ── Consultar pedido ────────────────────────────────────────────────────
  r.get('/:pedidoId', async (req, res) => {
    const p = await db.buscarPedido(req.cliente.id, req.params.pedidoId);
    if (!p) throw errores.noEncontrado(`No existe el pedido ${req.params.pedidoId}`);
    res.json(formatearPedido(p, await db.historial(p.id)));
  });

  // ── Cancelar pedido ─────────────────────────────────────────────────────
  r.delete('/:pedidoId', async (req, res) => {
    const p = await db.buscarPedido(req.cliente.id, req.params.pedidoId);
    if (!p) throw errores.noEncontrado(`No existe el pedido ${req.params.pedidoId}`);
    if (!CANCELABLES.includes(p.estado)) throw errores.noCancelable(p.estado);
    await db.actualizarPedido(p.id, { estado: 'cancelado' });
    res.json({ success: true, pedido_id: p.pedido_oms_id, mensaje: 'Pedido cancelado exitosamente.', guia_anulada: p.guia_numero });
  });

  return r;
}

module.exports = { pedidosRouter, formatearPedido };
