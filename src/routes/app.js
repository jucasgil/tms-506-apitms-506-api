// API de la app del mensajero (/v1/app). El mensajero entra con su celular y un PIN.
const crypto = require('crypto');
const express = require('express');
const { ApiError, errores } = require('../lib/errores');
const { verificarPassword, firmarToken, leerToken } = require('../lib/sesion');
const { fechaHoyColombia } = require('../lib/calculos');

const TIPOS_NOVEDAD = ['cliente_ausente', 'direccion_incorrecta', 'rehusado', 'acceso_restringido', 'dano_paquete', 'otro'];
const req400 = (msg) => new ApiError(400, 'validacion', msg);
const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const ultimos10 = (tel) => String(tel || '').replace(/\D/g, '').slice(-10);

// "data:image/jpeg;base64,...." → { buffer, tipo, ext }
function leerImagen(dataUrl, campo, maxBytes = 3_500_000) {
  const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw req400(`${campo} debe ser una imagen`);
  const buffer = Buffer.from(m[3], 'base64');
  if (buffer.length > maxBytes) throw req400(`${campo} es demasiado pesada`);
  return { buffer, tipo: m[1], ext: m[2] === 'jpeg' ? 'jpg' : m[2] };
}

function appRouter(deps) {
  const { db, config, now = () => new Date() } = deps;
  const r = express.Router();
  const secreto = config.internalSecret;
  const inicioHoy = () => `${fechaHoyColombia(now())}T05:00:00.000Z`;

  // ── Ingreso con celular + PIN ─────────────────────────────────────────
  r.post('/login', async (req, res) => {
    const tel = ultimos10(req.body?.telefono);
    const pin = String(req.body?.pin || '');
    if (tel.length !== 10 || !/^\d{4,6}$/.test(pin)) throw req400('Escribe tu celular de 10 dígitos y tu PIN');
    const candidatos = await db.conductoresPorTelefono(tel);
    const c = candidatos.find((x) => x.pin_hash && verificarPassword(pin, x.pin_hash));
    if (!c) throw new ApiError(401, 'credenciales', 'Celular o PIN incorrectos');
    const token = firmarToken({ cid: c.id, rol: 'mensajero', nombre: c.nombre }, secreto, 16);
    res.json({ token, mensajero: { id: c.id, nombre: c.nombre, placa: c.placa, tipo_vehiculo: c.tipo_vehiculo } });
  });

  r.use((req, _res, next) => {
    const s = leerToken((req.header('Authorization') || '').replace(/^Bearer\s+/i, ''), secreto);
    if (!s || s.rol !== 'mensajero') throw new ApiError(401, 'sesion', 'Tu sesión venció. Ingresa de nuevo.');
    req.mensajero = s;
    next();
  });

  const pedidoPropio = async (req) => {
    const p = await db.buscarPedidoPorId(req.params.id);
    if (!p || p.conductor_id !== req.mensajero.cid) throw errores.noEncontrado('Este pedido no está asignado a ti');
    return p;
  };

  // ── Mi ruta de hoy ────────────────────────────────────────────────────
  r.get('/mi-ruta', async (req, res) => {
    const cid = req.mensajero.cid;
    const [c, viajes, pedidos] = await Promise.all([
      db.conductorPorId(cid),
      db.viajesDeConductor(cid, fechaHoyColombia(now())),
      db.pedidosDeConductor(cid, inicioHoy()),
    ]);
    if (!c || !c.activo) throw new ApiError(401, 'sesion', 'Tu usuario está inactivo. Habla con el despachador.');

    // Orden: el de la ruta optimizada; los asignados a mano van al final
    const orden = new Map();
    let n = 0;
    for (const v of viajes) for (const s of v.secuencia || []) orden.set(s.pedido_id, ++n);
    const paradas = pedidos
      .map((p) => ({
        id: p.id, guia_numero: p.guia_numero, estado: p.estado, orden: orden.get(p.id) ?? null,
        destinatario: p.destinatario, entrega: p.entrega, lat: p.lat, lng: p.lng, zona: p.zona,
        paquete: { descripcion: p.paquete?.descripcion, peso_kg: p.paquete?.peso_kg, fragil: p.paquete?.fragil },
        contra_entrega: p.servicio?.contra_entrega ? p.servicio.valor_recaudo : 0,
        novedad_tipo: p.novedad_tipo, receptor_nombre: p.receptor_nombre,
      }))
      .sort((a, b) => (a.orden ?? 9999) - (b.orden ?? 9999));

    res.json({
      mensajero: { nombre: c.nombre, placa: c.placa, tipo_vehiculo: c.tipo_vehiculo },
      viajes: viajes.map((v) => ({ id: v.id, estado: v.estado, total_paradas: v.total_paradas, km: v.km_totales })),
      paradas,
    });
  });

  // ── Salir a ruta ──────────────────────────────────────────────────────
  r.post('/viajes/:id/iniciar', async (req, res) => {
    const v = await db.viajePorId(req.params.id);
    if (!v || v.conductor_id !== req.mensajero.cid) throw errores.noEncontrado('Ruta no encontrada');
    if (v.estado !== 'planificado') return res.json({ ok: true, ya_iniciada: true });
    const pedidos = await db.actualizarPedidosDeViaje(v.id, ['asignado'], { estado: 'en_ruta' });
    await db.actualizarViaje(v.id, { estado: 'en_curso' });
    res.json({ ok: true, pedidos_en_ruta: pedidos.length });
  });

  // Pedido suelto (asignado a mano, sin ruta)
  r.post('/pedidos/:id/en-camino', async (req, res) => {
    const p = await pedidoPropio(req);
    if (p.estado !== 'asignado') return res.json({ ok: true });
    await db.actualizarPedido(p.id, { estado: 'en_ruta' });
    res.json({ ok: true });
  });

  // ── Entrega con evidencia ─────────────────────────────────────────────
  r.post('/pedidos/:id/entregar', async (req, res) => {
    const p = await pedidoPropio(req);
    if (p.estado === 'entregado') return res.json({ ok: true, ya_entregado: true }); // reintento desde la cola sin señal
    if (!['asignado', 'en_ruta'].includes(p.estado)) throw req400(`Este pedido está en estado "${p.estado}"`);
    const b = req.body || {};
    const receptor = texto(b.receptor_nombre);
    if (!receptor) throw req400('Escribe el nombre de quien recibe');
    if (p.servicio?.contra_entrega && b.recaudo_confirmado !== true) throw req400('Confirma que recibiste el pago contra entrega');

    const foto = leerImagen(b.foto, 'La foto');
    const sufijo = crypto.randomBytes(6).toString('hex');
    const anio = now().getUTCFullYear();
    const foto_url = await db.subirArchivo(`evidencias/${anio}/${p.guia_numero}-${sufijo}.${foto.ext}`, foto.buffer, foto.tipo);
    let firma_url = null;
    if (b.firma) {
      const firma = leerImagen(b.firma, 'La firma', 800_000);
      firma_url = await db.subirArchivo(`evidencias/${anio}/${p.guia_numero}-${sufijo}-firma.${firma.ext}`, firma.buffer, firma.tipo);
    }

    await db.actualizarPedido(p.id, {
      estado: 'entregado',
      receptor_nombre: receptor,
      evidencia_foto_url: foto_url,
      evidencia_firma_url: firma_url,
      entregado_en: (b.momento && !Number.isNaN(Date.parse(b.momento)) ? new Date(b.momento) : now()).toISOString(),
      entrega_lat: num(b.lat),
      entrega_lng: num(b.lng),
      recaudo_confirmado: p.servicio?.contra_entrega ? true : null,
    });
    res.json({ ok: true, foto_url });
  });

  // ── No se pudo entregar ───────────────────────────────────────────────
  r.post('/pedidos/:id/novedad', async (req, res) => {
    const p = await pedidoPropio(req);
    if (['novedad', 'reagendado', 'devuelto'].includes(p.estado)) return res.json({ ok: true, ya_reportada: true });
    if (!['asignado', 'en_ruta'].includes(p.estado)) throw req400(`Este pedido está en estado "${p.estado}"`);
    const b = req.body || {};
    if (!TIPOS_NOVEDAD.includes(b.tipo)) throw req400('Elige qué pasó');
    let novedad_foto_url = null;
    if (b.foto) {
      const foto = leerImagen(b.foto, 'La foto');
      novedad_foto_url = await db.subirArchivo(`evidencias/${now().getUTCFullYear()}/${p.guia_numero}-nov-${crypto.randomBytes(6).toString('hex')}.${foto.ext}`, foto.buffer, foto.tipo);
    }
    await db.actualizarPedido(p.id, {
      estado: 'novedad', novedad_tipo: b.tipo, novedad_descripcion: texto(b.descripcion) || null, novedad_foto_url,
      entrega_lat: num(b.lat), entrega_lng: num(b.lng),
    });
    res.json({ ok: true });
  });

  // ── Ubicación en vivo (mientras la app está abierta) ──────────────────
  r.post('/ubicacion', async (req, res) => {
    const lat = num(req.body?.lat), lng = num(req.body?.lng);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw req400('Ubicación inválida');
    await db.actualizarConductor(req.mensajero.cid, { ultima_lat: lat, ultima_lng: lng, ultima_ubicacion_en: now().toISOString() });
    res.json({ ok: true });
  });

  return r;
}

module.exports = { appRouter, leerImagen };
