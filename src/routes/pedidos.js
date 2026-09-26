const express = require('express');
const { errores } = require('../lib/errores');
const { crearPedido } = require('../services/pedidos');
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

function pedidosRouter(deps) {
  const { db } = deps;
  const r = express.Router();
  r.use(apiKeyAuth(db));

  // ── Crear pedido y generar guía ─────────────────────────────────────────
  r.post('/', async (req, res) => {
    const { pedido, geo, eta, tarifa, pdf_url, tracking_url, guia_numero } = await crearPedido(deps, req.cliente, req.body);
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
