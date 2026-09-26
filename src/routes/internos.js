// Endpoints que NO usan los clientes OMS: los llaman Supabase (trigger y pg_cron) y el dashboard del despachador.
const express = require('express');
const { internalAuth } = require('../middleware/auth');
const { planificarRutas } = require('../services/planificacion');
const { construirPayload, proximoIntento } = require('../services/webhooks');
const { resolverNovedad } = require('../services/novedades');
const { fechaHoyColombia } = require('../lib/calculos');

// Convierte las columnas planas que escribe la app del conductor en los objetos del webhook
function normalizar(p) {
  return {
    ...p,
    evidencia: p.evidencia_foto_url
      ? { foto_url: p.evidencia_foto_url, firma_url: p.evidencia_firma_url || null, nombre_receptor: p.receptor_nombre || null }
      : null,
    novedad: p.novedad_tipo ? { tipo: p.novedad_tipo, descripcion: p.novedad_descripcion || null, accion: p.novedad_accion || null } : null,
    conductor: p.conductor ? { nombre: p.conductor.nombre, telefono: p.conductor.telefono, vehiculo: p.conductor.vehiculo } : undefined,
  };
}

function internosRouter({ db, ordenarParadas, enviarWebhook, notificar, config, now = () => new Date() }) {
  const r = express.Router();
  r.use(internalAuth(config.internalSecret));

  // ── Cambio de estado (lo dispara el trigger de Supabase en la tabla pedidos) ──
  r.post('/estado', async (req, res) => {
    const nuevo = req.body.record;
    const anterior = req.body.old_record;
    if (!nuevo || nuevo.estado === anterior?.estado || nuevo.estado === 'pendiente') return res.json({ omitido: true });

    const pedido = normalizar(await db.buscarPedidoPorId(nuevo.id));
    const resultado = { estado: pedido.estado };

    // 1) Webhook al OMS: primer intento inmediato, si falla queda en cola de reintentos
    const payload = construirPayload(pedido, now());
    const envio = pedido.webhook_url
      ? await enviarWebhook(pedido.webhook_url, payload, pedido.cliente?.webhook_secret)
      : { ok: true, sinWebhook: true };
    resultado.webhook = envio.sinWebhook ? 'sin_webhook' : envio.ok ? 'entregado' : 'en_cola';
    if (!envio.ok) {
      await db.encolarWebhook({
        pedido_id: pedido.id,
        url: pedido.webhook_url,
        payload,
        secreto: pedido.cliente?.webhook_secret || null,
        intentos: 1,
        ultimo_status: envio.status,
        proximo_intento: proximoIntento(1, config.webhooks.reintentosMin, now()).toISOString(),
      });
    }

    // 2) Mensaje al destinatario
    resultado.notificacion = await notificar(pedido).catch((e) => ({ enviado: false, error: e.message }));

    // 3) Novedad: aplicar la regla automática (el UPDATE vuelve a disparar este endpoint con el nuevo estado)
    if (pedido.estado === 'novedad') {
      const { accion, ...cambios } = resolverNovedad(pedido, now());
      await db.actualizarPedido(pedido.id, { ...cambios, novedad_accion: accion });
      resultado.accion_novedad = accion;
    }

    res.json(resultado);
  });

  // ── Reintentos de webhooks (pg_cron de Supabase lo llama cada minuto) ──
  r.post('/reintentar-webhooks', async (_req, res) => {
    const vencidos = await db.webhooksVencidos();
    let entregados = 0, agotados = 0;
    for (const w of vencidos) {
      const envio = await enviarWebhook(w.url, w.payload, w.secreto);
      const intentos = w.intentos + 1;
      if (envio.ok) {
        entregados++;
        await db.actualizarWebhook(w.id, { entregado: true, intentos, ultimo_status: envio.status });
      } else {
        const siguiente = proximoIntento(intentos, config.webhooks.reintentosMin, now());
        if (!siguiente) agotados++;
        await db.actualizarWebhook(w.id, {
          intentos,
          ultimo_status: envio.status,
          agotado: !siguiente,
          ...(siguiente && { proximo_intento: siguiente.toISOString() }),
        });
      }
    }
    res.json({ procesados: vencidos.length, entregados, agotados });
  });

  // ── Planificación del día: reparte pedidos y ordena paradas con Google Routes ──
  r.post('/rutas/optimizar', async (req, res) => {
    res.json(await planificarRutas({ db, ordenarParadas, config }, req.body?.fecha || fechaHoyColombia(now())));
  });

  return r;
}

module.exports = { internosRouter, normalizar };
