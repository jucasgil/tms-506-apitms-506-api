const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEntorno, servidor, pedidoValido, API_KEY, SECRETO } = require('./helpers');

const auth = { 'X-API-Key': API_KEY };
const interno = { 'X-Internal-Secret': SECRETO };

test('flujo completo: crear, consultar, rutear, entregar, rastrear', async (t) => {
  const { app, db, enviados, notificaciones } = crearEntorno();
  const { req, cerrar } = await servidor(app);
  t.after(cerrar);

  // Salud
  assert.equal((await req('GET', '/health')).body.status, 'OK');

  // Sin API Key → 401
  assert.equal((await req('POST', '/v1/pedidos', { body: pedidoValido() })).status, 401);
  assert.equal((await req('POST', '/v1/pedidos', { body: pedidoValido(), headers: { 'X-API-Key': 'mala' } })).status, 401);

  // JSON inválido → 400
  assert.equal((await req('POST', '/v1/pedidos', { body: '{mal', headers: auth })).status, 400);

  // Esquema inválido → 400 con detalle
  const inval = await req('POST', '/v1/pedidos', { body: { pedido_id: 'X' }, headers: auth });
  assert.equal(inval.status, 400);
  assert.ok(Array.isArray(inval.body.detalle) && inval.body.detalle.length > 3);

  // Crear pedido → 201 con guía y PDF real
  const c = await req('POST', '/v1/pedidos', { body: pedidoValido(), headers: auth });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.guia_numero, 'T506-2026-000001');
  assert.equal(c.body.tracking_url, 'https://tms.test/rastreo/T506-2026-000001');
  assert.equal(c.body.eta.fecha_estimada, '2026-09-26');
  assert.equal(c.body.tarifa.valor, 12000);
  const pdf = db.s.pdfs['2026/T506-2026-000001.pdf'];
  assert.ok(pdf && pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 3000);
  assert.equal(db.s.pedidos[0].zona, 'Norte');

  // Duplicado → 409
  assert.equal((await req('POST', '/v1/pedidos', { body: pedidoValido(), headers: auth })).status, 409);

  // Dirección imposible → 422
  const d422 = await req('POST', '/v1/pedidos', { body: pedidoValido({ pedido_id: 'ORD-X', entrega: { direccion: 'Calle inexistente', ciudad: 'Bogotá', departamento: 'Cundinamarca' } }), headers: auth });
  assert.equal(d422.status, 422);

  // Segundo pedido en el sur, contra entrega
  const c2 = await req('POST', '/v1/pedidos', {
    body: pedidoValido({ pedido_id: 'ORD-002', entrega: { direccion: 'Calle 38 Sur # 72-10', ciudad: 'Bogotá', departamento: 'Cundinamarca' }, servicio: { tipo: 'same_day', contra_entrega: true, valor_recaudo: 85000 } }),
    headers: auth,
  });
  assert.equal(c2.status, 201);
  assert.equal(c2.body.eta.fecha_estimada, '2026-09-25');

  // Consultar
  const g = await req('GET', '/v1/pedidos/ORD-001', { headers: auth });
  assert.equal(g.status, 200);
  assert.equal(g.body.estado, 'guia_generada');
  assert.equal(g.body.historial.length, 1);
  assert.equal((await req('GET', '/v1/pedidos/NO-EXISTE', { headers: auth })).status, 404);

  // Optimizar rutas: endpoint interno protegido
  assert.equal((await req('POST', '/v1/internos/rutas/optimizar', { body: {} })).status, 401);
  const r = await req('POST', '/v1/internos/rutas/optimizar', { body: {}, headers: interno });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.viajes.length, 2);
  assert.deepEqual(r.body.viajes.map((v) => v.conductor).sort(), ['Ana Gómez', 'Carlos Ramírez']);
  assert.equal(db.s.pedidos[0].estado, 'asignado');
  assert.equal(db.s.viajes[0].secuencia[0].orden, 1);

  // Ya asignado → no se puede cancelar
  assert.equal((await req('DELETE', '/v1/pedidos/ORD-001', { headers: auth })).status, 409);

  // Conductor marca "en ruta" y luego "entregado" con evidencia (así llega desde el trigger de Supabase)
  const p1 = db.s.pedidos[0];
  const cambio = async (cambios) => {
    const anterior = { ...p1 };
    await db.actualizarPedido(p1.id, cambios);
    return req('POST', '/v1/internos/estado', { body: { record: { ...p1 }, old_record: anterior }, headers: interno });
  };
  assert.equal((await cambio({ estado: 'en_ruta' })).body.webhook, 'entregado');
  await cambio({ estado: 'entregado', evidencia_foto_url: 'https://cdn.test/foto.jpg', receptor_nombre: 'Laura' });

  const ultimo = enviados.at(-1);
  assert.equal(ultimo.url, 'https://oms.test/carrier/update');
  assert.equal(ultimo.secreto, 'whsec_demo');
  assert.equal(ultimo.payload.evento, 'pedido.entregado');
  assert.equal(ultimo.payload.pedido_id, 'ORD-001');
  assert.equal(ultimo.payload.evidencia.foto_url, 'https://cdn.test/foto.jpg');
  assert.equal(ultimo.payload.conductor.nombre, 'Carlos Ramírez');
  assert.deepEqual(notificaciones, ['en_ruta', 'entregado']);

  // Sin cambio de estado → se ignora
  const igual = await req('POST', '/v1/internos/estado', { body: { record: p1, old_record: p1 }, headers: interno });
  assert.equal(igual.body.omitido, true);

  // Rastreo público
  const rj = await req('GET', '/v1/rastreo/T506-2026-000001');
  assert.equal(rj.body.estado, 'entregado');
  assert.equal(rj.body.historial.length, 4);
  assert.equal(rj.body.destinatario, undefined); // sin datos personales
  const html = await req('GET', '/rastreo/T506-2026-000001');
  assert.ok(html.body.includes('Entrega confirmada'));
  assert.equal((await req('GET', '/rastreo/NO-EXISTE')).status, 404);
});

test('cancelación antes del despacho', async (t) => {
  const { app } = crearEntorno();
  const { req, cerrar } = await servidor(app);
  t.after(cerrar);
  await req('POST', '/v1/pedidos', { body: pedidoValido(), headers: auth });
  const d = await req('DELETE', '/v1/pedidos/ORD-001', { headers: auth });
  assert.equal(d.status, 200);
  assert.equal(d.body.guia_anulada, 'T506-2026-000001');
  assert.equal((await req('GET', '/v1/rastreo/T506-2026-000001')).status, 404);
});

test('novedad: se reagenda automáticamente y el OMS recibe ambos eventos', async (t) => {
  const { app, db, enviados } = crearEntorno();
  const { req, cerrar } = await servidor(app);
  t.after(cerrar);
  await req('POST', '/v1/pedidos', { body: pedidoValido(), headers: auth });
  const p = db.s.pedidos[0];
  const anterior = { ...p };
  await db.actualizarPedido(p.id, { estado: 'novedad', novedad_tipo: 'cliente_ausente', novedad_descripcion: 'No abrió' });
  const r = await req('POST', '/v1/internos/estado', { body: { record: { ...p }, old_record: anterior }, headers: interno });
  assert.equal(r.body.accion_novedad, 'reagendar_siguiente_dia');
  assert.equal(p.estado, 'reagendado');
  assert.equal(p.intentos_entrega, 1);
  assert.equal(enviados[0].payload.novedad.tipo, 'cliente_ausente');

  // El trigger dispararía de nuevo con "reagendado"
  const r2 = await req('POST', '/v1/internos/estado', { body: { record: { ...p }, old_record: { ...p, estado: 'novedad' } }, headers: interno });
  assert.equal(r2.status, 200);
  assert.equal(enviados[1].payload.evento, 'pedido.reagendado');
  assert.ok(enviados[1].payload.nueva_fecha_estimada);
});

test('webhook caído: queda en cola, se reintenta y se agota tras 4 intentos', async (t) => {
  const { app, db } = crearEntorno({ webhookOk: false });
  const { req, cerrar } = await servidor(app);
  t.after(cerrar);
  await req('POST', '/v1/pedidos', { body: pedidoValido(), headers: auth });
  const p = db.s.pedidos[0];
  const anterior = { ...p };
  await db.actualizarPedido(p.id, { estado: 'en_ruta' });
  const r = await req('POST', '/v1/internos/estado', { body: { record: { ...p }, old_record: anterior }, headers: interno });
  assert.equal(r.body.webhook, 'en_cola');
  assert.equal(db.s.cola.length, 1);
  assert.equal(db.s.cola[0].intentos, 1);

  for (let i = 0; i < 3; i++) await req('POST', '/v1/internos/reintentar-webhooks', { body: {}, headers: interno });
  assert.equal(db.s.cola[0].intentos, 4);
  assert.equal(db.s.cola[0].agotado, true);
});
