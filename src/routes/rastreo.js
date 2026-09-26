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

function pagina(d) {
  const idx = PASOS.indexOf(d.estado);
  const CORTO = { guia_generada: 'Guía creada', asignado: 'Asignado', en_ruta: 'En camino', entregado: 'Entregado' };
  const pasos = PASOS.map((s, i) => `<div class="st ${i < idx ? 'done' : i === idx ? 'now' : ''}"><i></i>${CORTO[s]}</div>`).join('');
  const relleno = idx <= 0 ? 0 : Math.round((idx / (PASOS.length - 1)) * 80);
  const hist = d.historial.slice().reverse().map((h) =>
    `<li><b>${esc(h.detalle)}</b><span>${esc(new Date(h.timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span></li>`).join('');
  const aviso = ['novedad', 'reagendado', 'devuelto'].includes(d.estado)
    ? `<div class="aviso">${esc(d.estado_detalle)}${d.estado === 'reagendado' && d.fecha_estimada ? ` · nueva fecha: ${esc(d.fecha_estimada)}` : ''}</div>` : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Guía ${esc(d.guia_numero)} · 506 Logistics</title>
<link rel="icon" type="image/svg+xml" href="/brand/favicon.svg"><link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png"><meta name="theme-color" content="#0a0e3a">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>
:root{--canvas:#0a0e3a;--signal:#f2e94e;--blue:#2438d6;--ink:#12142b;--slate:#5b6172;--line:#e2e2dc;--bone:#f3f3ee;--muted-dark:#9aa0cc}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;background:var(--bone);color:var(--ink);letter-spacing:-.01em;-webkit-font-smoothing:antialiased}
header{background:var(--canvas);color:#fff;padding:22px 20px 88px;position:relative;overflow:hidden}
header::before{content:'';position:absolute;width:560px;height:560px;border-radius:50%;left:50%;top:-320px;transform:translateX(-50%);background:radial-gradient(circle at 50% 60%,#2a3be0 0%,#18228f 38%,rgba(10,14,58,0) 70%);opacity:.85}
header .in{position:relative;max-width:640px;margin:0 auto}
header img{height:30px;display:block}
header h1{font-size:clamp(30px,7vw,40px);font-weight:800;letter-spacing:-.04em;line-height:1;margin-top:34px}
header h1 em{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-style:italic;color:var(--signal);letter-spacing:0}
main{max-width:640px;margin:-62px auto 0;padding:0 16px 40px;position:relative}
.card{background:#fff;border-radius:20px;padding:22px;box-shadow:0 16px 40px rgba(10,14,58,.12);margin-bottom:14px}
.lbl{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--slate)}
.guia{font-size:26px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.row{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:4px 12px;border-radius:40px;background:#fbf7cf;color:#5a5310}
.badge::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor}
.badge.ok{background:#e7f6ea;color:#1f6b33}
.stepper{position:relative;display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin:26px 0 22px}
.stepper::before{content:'';position:absolute;left:12.5%;right:12.5%;top:9px;height:2px;background:var(--line)}
.stepper .fill{position:absolute;left:12.5%;top:9px;height:2px;background:var(--blue)}
.st{position:relative;display:grid;justify-items:center;gap:8px;text-align:center;font-size:11.5px;line-height:1.25;color:var(--slate)}
.st i{width:20px;height:20px;border-radius:50%;background:#fff;border:2px solid var(--line);display:block}
.st.done i{background:var(--blue);border-color:var(--blue)}
.st.now i{background:var(--signal);border-color:var(--ink);box-shadow:0 0 0 5px rgba(242,233,78,.35)}
.st.now{color:var(--ink);font-weight:700}
.eta{background:var(--bone);border-radius:14px;padding:14px 16px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.eta b{font-size:16px;letter-spacing:-.02em}
.aviso{background:#fff1e6;color:#8a3a06;border-radius:14px;padding:12px 14px;font-weight:600;font-size:14px;margin-top:12px}
ul{list-style:none}
li{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);font-size:14px}
li:last-child{border-bottom:0}
li span{color:var(--slate);white-space:nowrap}
footer{text-align:center;font-size:12.5px;color:var(--slate);padding:6px 0 30px}
footer a{color:var(--blue);font-weight:600;text-decoration:none}
</style></head><body>
<header><div class="in"><img src="/brand/logo-506-blanco.svg" alt="506 Logistics"><h1>Sigue tu <em>envío.</em></h1></div></header>
<main>
<div class="card">
<div class="row"><div><div class="lbl">Guía</div><div class="guia">${esc(d.guia_numero)}</div></div><span class="badge ${d.estado === 'entregado' ? 'ok' : ''}">${esc(d.estado_detalle)}</span></div>
<div class="stepper" role="img" aria-label="Progreso del envío: ${esc(d.estado_detalle)}"><span class="fill" style="width:${relleno}%"></span>${pasos}</div>
${d.fecha_estimada && d.estado !== 'entregado' ? `<div class="eta"><div><div class="lbl">Entrega estimada</div><b>${esc(d.fecha_estimada)}</b></div>${d.ciudad ? `<div><div class="lbl">Destino</div><b>${esc(d.ciudad)}</b></div>` : ''}</div>` : ''}
${d.conductor && d.estado === 'en_ruta' ? `<div class="eta" style="margin-top:10px"><div><div class="lbl">Tu mensajero</div><b>${esc(d.conductor)}</b></div></div>` : ''}
${aviso}
</div>
<div class="card"><div class="lbl" style="margin-bottom:6px">Historial</div><ul>${hist}</ul></div>
<footer>506 Logistics · <a href="https://www.506logistics.co" target="_blank" rel="noopener">506logistics.co</a></footer>
</main></body></html>`;
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
    if (!d) return res.status(404).type('html').send('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Guía no encontrada · 506 Logistics</title><link rel="icon" href="/brand/favicon.svg"></head><body style="margin:0;font-family:Helvetica,Arial,sans-serif;background:#0a0e3a;color:#fff;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px"><div><img src="/brand/logo-506-blanco.svg" alt="506 Logistics" style="height:34px"><p style="margin-top:24px;color:#9aa0cc">No encontramos esa guía. Revisa el número e inténtalo de nuevo.</p></div></body></html>');
    res.type('html').send(pagina(d));
  });
  return r;
}

module.exports = { rastreoRouter };
