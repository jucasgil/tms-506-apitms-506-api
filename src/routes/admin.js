// API del panel del TMS (/v1/admin). Requiere iniciar sesión con usuario y contraseña.
const express = require('express');
const { ApiError, errores } = require('../lib/errores');
const { hashPassword, verificarPassword, firmarToken, leerToken } = require('../lib/sesion');
const { hashApiKey, nuevaApiKey, nuevoSecreto, asignarZona, fechaHoyColombia } = require('../lib/calculos');
const { crearPedido } = require('../services/pedidos');
const { planificarRutas } = require('../services/planificacion');

const CANCELABLES = ['pendiente', 'guia_generada', 'asignado', 'reagendado'];
const ASIGNABLES = ['guia_generada', 'reagendado', 'asignado', 'novedad'];
const TIPOS_NOVEDAD = ['cliente_ausente', 'direccion_incorrecta', 'rehusado', 'acceso_restringido', 'dano_paquete', 'otro'];
const ROLES = ['admin', 'despachador'];

const req400 = (msg) => new ApiError(400, 'validacion', msg);
const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const inicioDiaUTC = (fecha) => `${fecha}T05:00:00.000Z`; // 00:00 en Bogotá

function adminRouter(deps) {
  const { db, geocodificar, ordenarParadas, config, now = () => new Date() } = deps;
  const r = express.Router();
  const secreto = config.internalSecret;

  // ── Sesión ────────────────────────────────────────────────────────────
  r.post('/login', async (req, res) => {
    const email = texto(req.body?.email).toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) throw req400('Correo y contraseña son requeridos');
    const u = await db.usuarioPorEmail(email);
    if (!u || !verificarPassword(password, u.password_hash))
      throw new ApiError(401, 'credenciales', 'Correo o contraseña incorrectos');
    const token = firmarToken({ uid: u.id, rol: u.rol, nombre: u.nombre, email: u.email }, secreto);
    res.json({ token, usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol } });
  });

  r.use((req, _res, next) => {
    const token = (req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
    const s = leerToken(token, secreto);
    if (!s) throw new ApiError(401, 'sesion', 'Sesión vencida o inválida. Inicia sesión de nuevo.');
    req.usuario = s;
    next();
  });
  const soloAdmin = (req, _res, next) => {
    if (req.usuario.rol !== 'admin') throw new ApiError(403, 'permiso', 'Solo un administrador puede hacer esto');
    next();
  };

  r.get('/me', (req, res) => res.json({ usuario: req.usuario }));

  r.put('/me/password', async (req, res) => {
    const { actual, nueva } = req.body || {};
    if (!nueva || String(nueva).length < 8) throw req400('La nueva contraseña debe tener al menos 8 caracteres');
    const u = await db.usuarioPorEmail(req.usuario.email);
    if (!u || !verificarPassword(actual, u.password_hash)) throw new ApiError(401, 'credenciales', 'La contraseña actual no es correcta');
    await db.actualizarUsuario(u.id, { password_hash: hashPassword(nueva) });
    res.json({ ok: true });
  });

  // ── Resumen del día ───────────────────────────────────────────────────
  r.get('/resumen', async (req, res) => {
    const fecha = req.query.fecha || fechaHoyColombia(now());
    const [activos, hoy, conductores, viajes] = await Promise.all([
      db.pedidosActivos(),
      db.pedidosActualizadosDesde(inicioDiaUTC(fecha)),
      db.listarConductores(),
      db.listarViajes(fecha),
    ]);
    const cuenta = (lista, fn) => lista.filter(fn).length;
    const porZona = {};
    for (const p of activos) porZona[p.zona || 'Sin zona'] = (porZona[p.zona || 'Sin zona'] || 0) + 1;
    res.json({
      fecha,
      activos: {
        total: activos.length,
        sin_asignar: cuenta(activos, (p) => ['guia_generada', 'reagendado', 'pendiente'].includes(p.estado)),
        asignados: cuenta(activos, (p) => p.estado === 'asignado'),
        en_ruta: cuenta(activos, (p) => p.estado === 'en_ruta'),
        novedades: cuenta(activos, (p) => p.estado === 'novedad'),
        requieren_revision: cuenta(activos, (p) => p.requiere_revision),
      },
      hoy: {
        entregados: cuenta(hoy, (p) => p.estado === 'entregado'),
        devueltos: cuenta(hoy, (p) => p.estado === 'devuelto'),
        cancelados: cuenta(hoy, (p) => p.estado === 'cancelado'),
      },
      por_zona: porZona,
      mensajeros_activos: cuenta(conductores, (c) => c.activo),
      viajes: viajes.map((v) => ({ id: v.id, conductor: v.conductor?.nombre, estado: v.estado, paradas: v.total_paradas, km: v.km_totales })),
    });
  });

  // ── Mapa (monitoreo) ──────────────────────────────────────────────────
  r.get('/mapa', async (_req, res) => {
    const [pedidos, bodega, conductores] = await Promise.all([db.pedidosActivos(), db.bodegaPrincipal(), db.listarConductores()]);
    const nombres = Object.fromEntries(conductores.map((c) => [c.id, c.nombre]));
    const hace2h = now().getTime() - 2 * 3600e3;
    res.json({
      deposito: bodega?.lat ? { lat: Number(bodega.lat), lng: Number(bodega.lng), nombre: bodega.nombre } : { ...config.deposito, nombre: 'Bodega' },
      pedidos: pedidos.filter((p) => p.lat).map((p) => ({ ...p, conductor: nombres[p.conductor_id] || null })),
      mensajeros: conductores
        .filter((c) => c.activo && c.ultima_lat && Date.parse(c.ultima_ubicacion_en) > hace2h)
        .map((c) => ({ id: c.id, nombre: c.nombre, lat: Number(c.ultima_lat), lng: Number(c.ultima_lng), actualizado_en: c.ultima_ubicacion_en })),
    });
  });

  // ── Órdenes ───────────────────────────────────────────────────────────
  r.get('/pedidos', async (req, res) => {
    const limite = Math.min(Number(req.query.limite) || 50, 200);
    const pagina = Math.max(Number(req.query.pagina) || 1, 1);
    const { filas, total } = await db.listarPedidos({ ...req.query, limite, offset: (pagina - 1) * limite });
    res.json({ filas, total, pagina, limite });
  });

  r.get('/pedidos/:id', async (req, res) => {
    const p = await db.buscarPedidoPorId(req.params.id);
    if (!p) throw errores.noEncontrado('Pedido no encontrado');
    delete p.cliente;
    res.json({ ...p, historial: await db.historial(p.id) });
  });

  r.post('/pedidos', async (req, res) => {
    const b = { ...req.body };
    const cliente = b.cliente_id ? { id: b.cliente_id } : await db.clienteInterno();
    if (!cliente) throw new ApiError(500, 'config', 'Falta el cliente interno "Venta directa". Ejecuta la migración 002.');
    b.pedido_id = texto(b.pedido_id) || `MAN-${Date.now().toString(36).toUpperCase()}`;
    delete b.cliente_id;
    const { pedido } = await crearPedido(deps, cliente, b, { requiereWebhook: false });
    res.status(201).json(pedido);
  });

  // Acciones del despachador sobre un pedido. Cada cambio de estado dispara el aviso al OMS vía Supabase.
  r.post('/pedidos/:id/accion', async (req, res) => {
    const p = await db.buscarPedidoPorId(req.params.id);
    if (!p) throw errores.noEncontrado('Pedido no encontrado');
    const { accion } = req.body || {};
    let cambios;
    switch (accion) {
      case 'asignar': {
        if (!req.body.conductor_id) throw req400('Selecciona un mensajero');
        if (!ASIGNABLES.includes(p.estado)) throw req400(`No se puede asignar un pedido en estado "${p.estado}"`);
        cambios = { conductor_id: req.body.conductor_id, estado: 'asignado', viaje_id: null };
        break;
      }
      case 'desasignar':
        if (p.estado !== 'asignado') throw req400('Solo se puede quitar el mensajero de un pedido asignado');
        cambios = { conductor_id: null, viaje_id: null, estado: 'guia_generada' };
        break;
      case 'en_ruta':
        if (!p.conductor_id) throw req400('Asigna un mensajero antes de despachar');
        cambios = { estado: 'en_ruta' };
        break;
      case 'entregado':
        if (!['asignado', 'en_ruta'].includes(p.estado)) throw req400('Solo se entrega un pedido asignado o en ruta');
        cambios = { estado: 'entregado', receptor_nombre: texto(req.body.receptor_nombre) || null };
        break;
      case 'novedad':
        if (!TIPOS_NOVEDAD.includes(req.body.novedad_tipo)) throw req400('Tipo de novedad inválido');
        cambios = { estado: 'novedad', novedad_tipo: req.body.novedad_tipo, novedad_descripcion: texto(req.body.novedad_descripcion) || null };
        break;
      case 'cancelar':
        if (!CANCELABLES.includes(p.estado)) throw req400(`No se puede cancelar un pedido en estado "${p.estado}"`);
        cambios = { estado: 'cancelado', conductor_id: null, viaje_id: null };
        break;
      case 'liberar':
        if (!['asignado', 'en_ruta', 'novedad', 'reagendado'].includes(p.estado)) throw req400(`No se puede devolver un pedido en estado "${p.estado}"`);
        cambios = { estado: 'guia_generada', conductor_id: null, viaje_id: null, fecha_programada: null };
        break;
      case 'revisado':
        cambios = { requiere_revision: false };
        break;
      default:
        throw req400('Acción no reconocida');
    }
    res.json(await db.actualizarPedido(p.id, cambios));
  });

  r.post('/pedidos/:id/direccion', async (req, res) => {
    const p = await db.buscarPedidoPorId(req.params.id);
    if (!p) throw errores.noEncontrado('Pedido no encontrado');
    const entrega = { ...p.entrega, direccion: texto(req.body.direccion) || p.entrega.direccion, ciudad: texto(req.body.ciudad) || p.entrega.ciudad };
    const geo = await geocodificar(entrega);
    res.json(await db.actualizarPedido(p.id, {
      entrega: { ...entrega, direccion_formateada: geo.direccion_formateada, precision: geo.precision },
      lat: geo.lat, lng: geo.lng, zona: asignarZona(geo.lat, geo.lng, entrega.ciudad), requiere_revision: false,
    }));
  });

  // ── Mensajeros ────────────────────────────────────────────────────────
  const camposConductor = (b) => {
    const f = {};
    for (const k of ['nombre', 'telefono', 'email', 'placa', 'tipo_vehiculo', 'zona']) if (k in b) f[k] = texto(b[k]) || null;
    if (f.telefono) f.telefono = f.telefono.replace(/\D/g, '').slice(-10) || null;
    if ('capacidad_kg' in b) f.capacidad_kg = Number(b.capacidad_kg) || 50;
    if ('activo' in b) f.activo = Boolean(b.activo);
    if (b.pin) {
      if (!/^\d{4,6}$/.test(String(b.pin))) throw req400('El PIN debe tener entre 4 y 6 números');
      f.pin_hash = hashPassword(String(b.pin));
    }
    return f;
  };
  // Nunca se envía el PIN (ni su huella) al navegador
  const publico = ({ pin_hash, ...c }) => ({ ...c, tiene_pin: Boolean(pin_hash) });
  r.get('/conductores', async (_req, res) => res.json((await db.listarConductores()).map(publico)));
  r.post('/conductores', async (req, res) => {
    const f = camposConductor(req.body || {});
    if (!f.nombre) throw req400('El nombre es requerido');
    res.status(201).json(publico(await db.crearConductor({ activo: true, ...f })));
  });
  r.patch('/conductores/:id', async (req, res) => res.json(publico(await db.actualizarConductor(req.params.id, camposConductor(req.body || {})))));

  // ── Rutero ────────────────────────────────────────────────────────────
  r.get('/viajes', async (req, res) => res.json(await db.listarViajes(req.query.fecha || fechaHoyColombia(now()))));

  r.post('/rutas/optimizar', async (req, res) => {
    const ids = Array.isArray(req.body?.conductor_ids) ? req.body.conductor_ids : undefined;
    if (ids && !ids.length) throw req400('Elige al menos un mensajero');
    res.json(await planificarRutas({ db, ordenarParadas, config }, req.body?.fecha || fechaHoyColombia(now()), { conductorIds: ids }));
  });

  // Cambiar el mensajero de una ruta (antes o después de salir)
  r.post('/viajes/:id/mensajero', async (req, res) => {
    const v = await db.viajePorId(req.params.id);
    if (!v) throw errores.noEncontrado('Viaje no encontrado');
    if (!['planificado', 'en_curso'].includes(v.estado)) throw req400('Esta ruta ya terminó o fue deshecha');
    const cid = req.body?.conductor_id;
    const c = (await db.listarConductores()).find((x) => x.id === cid && x.activo);
    if (!c) throw req400('Elige un mensajero activo');
    const pedidos = await db.actualizarPedidosDeViaje(v.id, ['asignado', 'en_ruta'], { conductor_id: c.id });
    await db.actualizarViaje(v.id, { conductor_id: c.id });
    res.json({ ok: true, mensajero: c.nombre, pedidos_movidos: pedidos.length });
  });

  r.post('/viajes/:id/iniciar', async (req, res) => {
    const v = await db.viajePorId(req.params.id);
    if (!v) throw errores.noEncontrado('Viaje no encontrado');
    if (v.estado !== 'planificado') throw req400('El viaje ya fue iniciado o cerrado');
    const pedidos = await db.actualizarPedidosDeViaje(v.id, ['asignado'], { estado: 'en_ruta' });
    await db.actualizarViaje(v.id, { estado: 'en_curso' });
    res.json({ ok: true, pedidos_en_ruta: pedidos.length });
  });

  r.post('/viajes/:id/cancelar', async (req, res) => {
    const v = await db.viajePorId(req.params.id);
    if (!v) throw errores.noEncontrado('Viaje no encontrado');
    if (v.estado === 'cancelado') throw req400('Esta ruta ya fue deshecha');
    // Los pedidos no entregados vuelven a "por asignar"; los entregados no se tocan
    const pedidos = await db.actualizarPedidosDeViaje(v.id, ['asignado', 'en_ruta', 'novedad', 'reagendado'], { estado: 'guia_generada', conductor_id: null, viaje_id: null, fecha_programada: null });
    await db.actualizarViaje(v.id, { estado: 'cancelado' });
    res.json({ ok: true, pedidos_liberados: pedidos.length });
  });

  r.post('/viajes/:id/finalizar', async (req, res) => {
    const v = await db.viajePorId(req.params.id);
    if (!v) throw errores.noEncontrado('Viaje no encontrado');
    res.json(await db.actualizarViaje(v.id, { estado: 'finalizado' }));
  });

  // ── Sellers (clientes OMS) ────────────────────────────────────────────
  r.get('/clientes', async (_req, res) => res.json(await db.listarClientes()));
  r.post('/clientes', soloAdmin, async (req, res) => {
    const nombre = texto(req.body?.cliente_nombre);
    const entorno = req.body?.entorno === 'live' ? 'live' : 'sandbox';
    if (!nombre) throw req400('El nombre del cliente es requerido');
    const apiKey = nuevaApiKey(entorno === 'live' ? 'live' : 'test');
    const webhookSecret = nuevoSecreto();
    const c = await db.crearCliente({ cliente_nombre: nombre, entorno, api_key_hash: hashApiKey(apiKey), webhook_secret: webhookSecret });
    // La llave solo se muestra esta vez: en la base queda únicamente su huella
    res.status(201).json({ ...c, api_key: apiKey, webhook_secret: webhookSecret });
  });
  r.patch('/clientes/:id', soloAdmin, async (req, res) => {
    const c = {};
    if ('activa' in (req.body || {})) c.activa = Boolean(req.body.activa);
    if (req.body?.cliente_nombre) c.cliente_nombre = texto(req.body.cliente_nombre);
    res.json(await db.actualizarCliente(req.params.id, c));
  });

  // ── Bodegas ───────────────────────────────────────────────────────────
  r.get('/bodegas', async (_req, res) => res.json(await db.listarBodegas()));
  r.post('/bodegas', soloAdmin, async (req, res) => {
    const b = req.body || {};
    if (!texto(b.nombre) || !texto(b.direccion) || !texto(b.ciudad)) throw req400('Nombre, dirección y ciudad son requeridos');
    const geo = await geocodificar({ direccion: b.direccion, ciudad: b.ciudad, departamento: texto(b.departamento) || '' });
    res.status(201).json(await db.crearBodega({
      nombre: texto(b.nombre), direccion: texto(b.direccion), ciudad: texto(b.ciudad),
      lat: geo.lat, lng: geo.lng, principal: Boolean(b.principal), activa: true,
    }));
  });
  r.post('/bodegas/:id/reubicar', soloAdmin, async (req, res) => {
    const b = (await db.listarBodegas()).find((x) => x.id === req.params.id);
    if (!b) throw errores.noEncontrado('Bodega no encontrada');
    const direccion = texto(req.body?.direccion) || b.direccion;
    const ciudad = texto(req.body?.ciudad) || b.ciudad;
    const geo = await geocodificar({ direccion, ciudad });
    res.json({ ...(await db.actualizarBodega(b.id, { direccion, ciudad, lat: geo.lat, lng: geo.lng })), direccion_google: geo.direccion_formateada, requiere_revision: geo.requiere_revision });
  });
  r.patch('/bodegas/:id', soloAdmin, async (req, res) => {
    const c = {};
    if ('principal' in req.body) c.principal = Boolean(req.body.principal);
    if ('activa' in req.body) c.activa = Boolean(req.body.activa);
    res.json(await db.actualizarBodega(req.params.id, c));
  });

  // ── Usuarios del panel ────────────────────────────────────────────────
  r.get('/usuarios', soloAdmin, async (_req, res) => res.json(await db.listarUsuarios()));
  r.post('/usuarios', soloAdmin, async (req, res) => {
    const b = req.body || {};
    const email = texto(b.email).toLowerCase();
    if (!email || !texto(b.nombre)) throw req400('Nombre y correo son requeridos');
    if (!b.password || String(b.password).length < 8) throw req400('La contraseña debe tener al menos 8 caracteres');
    res.status(201).json(await db.crearUsuario({
      email, nombre: texto(b.nombre), rol: ROLES.includes(b.rol) ? b.rol : 'despachador', password_hash: hashPassword(b.password), activo: true,
    }));
  });
  r.patch('/usuarios/:id', soloAdmin, async (req, res) => {
    const b = req.body || {};
    const c = {};
    if ('activo' in b) {
      if (req.params.id === req.usuario.uid && !b.activo) throw req400('No puedes desactivar tu propio usuario');
      c.activo = Boolean(b.activo);
    }
    if (ROLES.includes(b.rol)) c.rol = b.rol;
    if (b.password) {
      if (String(b.password).length < 8) throw req400('La contraseña debe tener al menos 8 caracteres');
      c.password_hash = hashPassword(b.password);
    }
    res.json(await db.actualizarUsuario(req.params.id, c));
  });

  return r;
}

module.exports = { adminRouter };
