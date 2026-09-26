const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEntorno, servidor, pedidoValido, API_KEY } = require('./helpers');

async function sesion(req, email = 'admin@506.co', password = 'clave-segura-1') {
  const r = await req('POST', '/v1/admin/login', { body: { email, password } });
  return { r, h: { Authorization: `Bearer ${r.body.token}` } };
}

test('login: rechaza credenciales malas y protege el panel', async (t) => {
  const { app } = crearEntorno();
  const { req, cerrar } = await servidor(app);
  t.after(cerrar);
  assert.equal((await req('POST', '/v1/admin/login', { body: { email: 'admin@506.co', password: 'mala' } })).status, 401);
  assert.equal((await req('GET', '/v1/admin/pedidos')).status, 401);
  assert.equal((await req('GET', '/v1/admin/pedidos', { headers: { Authorization: 'Bearer abc.def' } })).status, 401);
  const { r, h } = await sesion(req);
  assert.equal(r.status, 200);
  assert.equal(r.body.usuario.rol, 'admin');
  assert.equal((await req('GET', '/v1/admin/me', { headers: h })).body.usuario.email, 'admin@506.co');
});

test('panel: orden manual, asignación, novedad, entrega y resumen', async (t) => {
  const { app, db } = crearEntorno();
  const { req, cerrar } = await servidor(app);
  t.after(cerrar);
  const { h } = await sesion(req);

  // Orden manual sin OMS ni webhook
  const base = pedidoValido();
  delete base.webhook_url;
  delete base.pedido_id;
  const o = await req('POST', '/v1/admin/pedidos', { body: base, headers: h });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  assert.match(o.body.pedido_oms_id, /^MAN-/);
  assert.equal(o.body.cliente_id, 'cli-interno');
  assert.equal(o.body.webhook_url, null);

  // Mensajero nuevo y asignación manual
  const m = await req('POST', '/v1/admin/conductores', { body: { nombre: '506-7', telefono: '3001112233', placa: 'ABC123', tipo_vehiculo: 'Moto', capacidad_kg: 30 }, headers: h });
  assert.equal(m.status, 201);
  const asig = await req('POST', `/v1/admin/pedidos/${o.body.id}/accion`, { body: { accion: 'asignar', conductor_id: m.body.id }, headers: h });
  assert.equal(asig.body.estado, 'asignado');
  assert.equal((await req('POST', `/v1/admin/pedidos/${o.body.id}/accion`, { body: { accion: 'volar' }, headers: h })).status, 400);

  // Novedad con tipo inválido y válido
  assert.equal((await req('POST', `/v1/admin/pedidos/${o.body.id}/accion`, { body: { accion: 'novedad', novedad_tipo: 'x' }, headers: h })).status, 400);
  const nov = await req('POST', `/v1/admin/pedidos/${o.body.id}/accion`, { body: { accion: 'novedad', novedad_tipo: 'cliente_ausente' }, headers: h });
  assert.equal(nov.body.estado, 'novedad');

  // Reasignar y entregar
  await req('POST', `/v1/admin/pedidos/${o.body.id}/accion`, { body: { accion: 'asignar', conductor_id: m.body.id }, headers: h });
  const ent = await req('POST', `/v1/admin/pedidos/${o.body.id}/accion`, { body: { accion: 'entregado', receptor_nombre: 'Portería' }, headers: h });
  assert.equal(ent.body.estado, 'entregado');
  assert.equal((await req('POST', `/v1/admin/pedidos/${o.body.id}/accion`, { body: { accion: 'cancelar' }, headers: h })).status, 400);

  // Detalle con historial
  const det = await req('GET', `/v1/admin/pedidos/${o.body.id}`, { headers: h });
  assert.ok(det.body.historial.length >= 4);
  assert.equal(det.body.cliente, undefined);

  const res = await req('GET', '/v1/admin/resumen', { headers: h });
  assert.equal(res.body.hoy.entregados, 1);
  assert.equal(db.s.conductores.length, 3);
});

test('rutero: optimizar, iniciar y deshacer viajes', async (t) => {
  const { app, db } = crearEntorno();
  const { req, cerrar } = await servidor(app);
  t.after(cerrar);
  const { h } = await sesion(req);
  await req('POST', '/v1/pedidos', { body: pedidoValido(), headers: { 'X-API-Key': API_KEY } });
  await req('POST', '/v1/pedidos', { body: pedidoValido({ pedido_id: 'ORD-2', entrega: { direccion: 'Calle 40 Sur # 70-10', ciudad: 'Bogotá', departamento: 'Cundinamarca' } }), headers: { 'X-API-Key': API_KEY } });

  const opt = await req('POST', '/v1/admin/rutas/optimizar', { body: {}, headers: h });
  assert.equal(opt.body.viajes.length, 2);
  const [v1, v2] = db.s.viajes;

  const ini = await req('POST', `/v1/admin/viajes/${v1.id}/iniciar`, { headers: h });
  assert.equal(ini.body.pedidos_en_ruta, 1);
  assert.equal(v1.estado, 'en_curso');
  assert.equal((await req('POST', `/v1/admin/viajes/${v1.id}/iniciar`, { headers: h })).status, 400);

  const can = await req('POST', `/v1/admin/viajes/${v2.id}/cancelar`, { headers: h });
  assert.equal(can.body.pedidos_liberados, 1);
  assert.equal(db.s.pedidos.find((p) => p.viaje_id === null && p.estado === 'guia_generada') !== undefined, true);
});

test('sellers, bodegas y usuarios: solo admin, llave visible una sola vez', async (t) => {
  const { app, db } = crearEntorno();
  const { req, cerrar } = await servidor(app);
  t.after(cerrar);
  const { h } = await sesion(req);

  const c = await req('POST', '/v1/admin/clientes', { body: { cliente_nombre: 'Tienda X', entorno: 'sandbox' }, headers: h });
  assert.equal(c.status, 201);
  assert.match(c.body.api_key, /^tk_test_/);
  const lista = await req('GET', '/v1/admin/clientes', { headers: h });
  assert.ok(lista.body.every((x) => !x.api_key_hash && !x.api_key));
  // La llave recién creada funciona contra la API pública
  const ped = await req('POST', '/v1/pedidos', { body: pedidoValido({ pedido_id: 'TX-1' }), headers: { 'X-API-Key': c.body.api_key } });
  assert.equal(ped.status, 201);

  const b = await req('POST', '/v1/admin/bodegas', { body: { nombre: 'Principal', direccion: 'Calle 13 # 68-10', ciudad: 'Bogotá', principal: true }, headers: h });
  assert.equal(b.status, 201);
  assert.ok(b.body.lat);

  const u = await req('POST', '/v1/admin/usuarios', { body: { email: 'Despacho@506.co', nombre: 'Despacho', password: 'otra-clave-99', rol: 'despachador' }, headers: h });
  assert.equal(u.status, 201);
  assert.equal(u.body.email, 'despacho@506.co');
  const d = await sesion(req, 'despacho@506.co', 'otra-clave-99');
  assert.equal(d.r.status, 200);
  assert.equal((await req('GET', '/v1/admin/usuarios', { headers: d.h })).status, 403);
  assert.equal((await req('POST', '/v1/admin/clientes', { body: { cliente_nombre: 'Y' }, headers: d.h })).status, 403);
  assert.equal((await req('GET', '/v1/admin/pedidos', { headers: d.h })).status, 200);
  assert.equal((await req('PATCH', '/v1/admin/usuarios/u1', { body: { activo: false }, headers: h })).status, 400);

  // Cambio de contraseña
  assert.equal((await req('PUT', '/v1/admin/me/password', { body: { actual: 'x', nueva: 'nueva-clave-123' }, headers: d.h })).status, 401);
  assert.equal((await req('PUT', '/v1/admin/me/password', { body: { actual: 'otra-clave-99', nueva: 'nueva-clave-123' }, headers: d.h })).status, 200);
  assert.equal((await sesion(req, 'despacho@506.co', 'nueva-clave-123')).r.status, 200);
  assert.equal(db.s.usuarios.length, 2);
});

test('rutero: elegir mensajeros que salen y cambiar el mensajero de una ruta', async (t) => {
  const { app, db } = crearEntorno();
  const { req, cerrar } = await servidor(app);
  t.after(cerrar);
  const { h } = await sesion(req);
  await req('POST', '/v1/pedidos', { body: pedidoValido(), headers: { 'X-API-Key': API_KEY } });
  await req('POST', '/v1/pedidos', { body: pedidoValido({ pedido_id: 'ORD-2', entrega: { direccion: 'Calle 40 Sur # 70-10', ciudad: 'Bogotá', departamento: 'Cundinamarca' } }), headers: { 'X-API-Key': API_KEY } });

  assert.equal((await req('POST', '/v1/admin/rutas/optimizar', { body: { conductor_ids: [] }, headers: h })).status, 400);
  // Solo sale Ana (zona Sur): se lleva también el pedido del Norte
  const opt = await req('POST', '/v1/admin/rutas/optimizar', { body: { conductor_ids: ['c2'] }, headers: h });
  assert.equal(opt.body.viajes.length, 1);
  assert.equal(opt.body.viajes[0].conductor, 'Ana Gómez');
  assert.ok(db.s.pedidos.every((p) => p.conductor_id === 'c2'));

  const v = db.s.viajes[0];
  await req('POST', `/v1/admin/viajes/${v.id}/iniciar`, { headers: h });
  const cam = await req('POST', `/v1/admin/viajes/${v.id}/mensajero`, { body: { conductor_id: 'c1' }, headers: h });
  assert.equal(cam.body.mensajero, 'Carlos Ramírez');
  assert.equal(cam.body.pedidos_movidos, 2);
  assert.equal(v.conductor_id, 'c1');
  assert.ok(db.s.pedidos.every((p) => p.conductor_id === 'c1' && p.estado === 'en_ruta'));
  assert.equal((await req('POST', `/v1/admin/viajes/${v.id}/mensajero`, { body: { conductor_id: 'nadie' }, headers: h })).status, 400);
});

