// Rastreo público: /rastreo/:guia (página) y /v1/rastreo/:guia (JSON). Solo expone datos no sensibles.
const express = require('express');
const { DESCRIPCIONES } = require('../services/webhooks');

const PASOS = ['guia_generada', 'asignado', 'en_ruta', 'entregado'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function datosPublicos(db, guia) {
  const p = await db.buscarPedidoPorGuia(guia);
  if (!p || p.estado === 'cancelado') return null;
  const historial = await db.historial(p.id);
  return {
    guia_numero: p.guia_numero,
    estado: p.estado,
    estado_detalle: DESCRIPCIONES[p.estado] || p.estado,
    ciudad: p.entrega?.ciudad,
    fecha_estimada: p.fecha_programada || p.eta?.fecha_estimada,
    conductor: p.conductor?.nombre?.split(' ')[0] || null,
    historial: historial.map((h) => ({ estado: h.estado, detalle: DESCRIPCIONES[h.estado] || h.estado, timestamp: h.creado_en })),
  };
}

function pagina(d, empresa) {
  const idx = PASOS.indexOf(d.estado);
  const pasos = PASOS.map((s, i) => `<li class="${i <= idx ? 'ok' : ''}">${esc(DESCRIPCIONES[s])}</li>`).join('');
  const hist = d.historial.slice().reverse().map((h) =>
    `<tr><td>${esc(new Date(h.timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota' }))}</td><td>${esc(h.detalle)}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rastreo ${esc(d.guia_numero)}</title><style>
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f5f7fa;color:#263238}
header{background:#0D2137;color:#fff;padding:18px 16px}header b{font-size:18px}
main{max-width:640px;margin:0 auto;padding:16px}.card{background:#fff;border-radius:10px;padding:18px;margin-bottom:14px;box-shadow:0 1px 3px #0001}
h1{font-size:22px;margin:0 0 4px}.estado{font-size:18px;color:#1565C0;font-weight:600}
ol{list-style:none;padding:0;margin:14px 0 0}ol li{padding:8px 0 8px 28px;position:relative;color:#90a4ae}
ol li:before{content:'';position:absolute;left:4px;top:12px;width:12px;height:12px;border-radius:50%;background:#cfd8dc}
ol li.ok{color:#263238}ol li.ok:before{background:#2E7D32}
table{width:100%;border-collapse:collapse;font-size:14px}td{padding:8px 4px;border-bottom:1px solid #eceff1}
</style></head><body><header><b>${esc(empresa.nombre)}</b></header><main>
<div class="card"><div>Guía</div><h1>${esc(d.guia_numero)}</h1><div class="estado">${esc(d.estado_detalle)}</div>
${d.fecha_estimada ? `<div>Entrega estimada: ${esc(d.fecha_estimada)}</div>` : ''}
${d.conductor && d.estado === 'en_ruta' ? `<div>Conductor: ${esc(d.conductor)}</div>` : ''}<ol>${pasos}</ol></div>
<div class="card"><table>${hist}</table></div></main></body></html>`;
}

function rastreoRouter({ db, config }) {
  const r = express.Router();
  r.get('/v1/rastreo/:guia', async (req, res) => {
    const d = await datosPublicos(db, req.params.guia);
    if (!d) return res.status(404).json({ error: 'no_encontrado', mensaje: 'Guía no encontrada' });
    res.json(d);
  });
  r.get('/rastreo/:guia', async (req, res) => {
    const d = await datosPublicos(db, req.params.guia);
    if (!d) return res.status(404).type('html').send('<p style="font-family:sans-serif;padding:24px">Guía no encontrada.</p>');
    res.type('html').send(pagina(d, config.empresa));
  });
  return r;
}

module.exports = { rastreoRouter };
