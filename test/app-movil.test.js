const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEntorno, servidor, pedidoValido, API_KEY } = require('./helpers');

// JPEG mínimo válido en base64 (1×1 px)
const FOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

async function preparar(t, extra = {}) {
  const env = crearEntorno();
  const { req, cerrar } = await servidor(env.app);
  t.after(cerrar);
  const adm = (await req('POST', '/v1/admin/login', { body: { email: 'admin@506.co', password: 'clave-segura-1' } })).body.token;
  const H = { Authorization: `Bearer ${adm}` };
  // Mensajero con PIN desde el panel
  const m = await req('POST', '/v1/admin/conductores', { body: { nombre: '506-9', telefono: '+57 300 555 1234', pin: '4821', zona: 'Norte', capacidad_kg: 100, ...extra }, headers: H });
  return { ...env, req, H, m: m.body };
}

test('panel: el PIN se guarda como huella y nunca vuelve al navegador', async (t) => {
  const { req, H, m, db } = await preparar(t);
  assert.equal(m.tiene_pin, true);
  assert.equal(m.pin_hash, undefined);
  assert.equal(m.telefono, '3005551234');
  const lista = (await req('GET', '/v1/admin/conductores', { headers: H })).body;
  assert.ok(lista.every((c) => c.pin_hash === undefined));
  assert.match(db.s.conductores.find((c) => c.id === m.id).pin_hash, /^scrypt\$/);
  assert.equal((await req('POST', '/v1/admin/conductores', { body: { nombre: 'X', pin: '12' }, headers: H })).status, 400);
});

test('app: login, ruta del día, iniciar, entregar con foto y firma, novedad, ubicación', async (t) => {
  const { req, H, m, db, enviados } = await preparar(t);

  assert.equal((await req('POST', '/v1/app/login', { body: { telefono: '3005551234', pin: '0000' } })).status, 401);
  assert.equal((await req('GET', '/v1/app/mi-ruta')).status, 401);
  assert.equal((await req('GET', '/v1/app/mi-ruta', { headers: H })).status, 401); // token de panel no sirve
  const lg = await req('POST', '/v1/app/login', { body: { telefono: '(300) 555-1234', pin: '4821' } });
  assert.equal(lg.status, 200);
  const A = { Authorization: `Bearer ${lg.body.token}` };

  // Tres pedidos en el norte, uno contra entrega; se rutean al mensajero
  for (const [i, ce] of [[1, false], [2, true], [3, false]]) {
    await req('POST', '/v1/pedidos', { headers: { 'X-API-Key': API_KEY }, body: pedidoValido({ pedido_id: `N-${i}`, servicio: ce ? { tipo: 'estandar', contra_entrega: true, valor_recaudo: 85000 } : { tipo: 'estandar' } }) });
  }
  db.s.conductores.forEach((c) => { if (c.id !== m.id) c.activo = false; });
  const opt = await req('POST', '/v1/admin/rutas/optimizar', { body: {}, headers: H });
  assert.equal(opt.body.viajes.length, 1);

  const ruta = (await req('GET', '/v1/app/mi-ruta', { headers: A })).body;
  assert.equal(ruta.paradas.length, 3);
  assert.deepEqual(ruta.paradas.map((p) => p.orden), [1, 2, 3]);
  assert.equal(ruta.viajes[0].estado, 'planificado');
  assert.equal(ruta.paradas.filter((p) => p.contra_entrega === 85000).length, 1);

  const ini = await req('POST', `/v1/app/viajes/${ruta.viajes[0].id}/iniciar`, { headers: A });
  assert.equal(ini.body.pedidos_en_ruta, 3);

  const [p1, p2, p3] = ruta.paradas;
  const pCE = ruta.paradas.find((p) => p.contra_entrega);
  const pNormal = ruta.paradas.find((p) => !p.contra_entrega);

  // Validaciones de la entrega
  assert.equal((await req('POST', `/v1/app/pedidos/${pNormal.id}/entregar`, { headers: A, body: { receptor_nombre: 'Laura' } })).status, 400); // sin foto
  assert.equal((await req('POST', `/v1/app/pedidos/${pNormal.id}/entregar`, { headers: A, body: { foto: FOTO } })).status, 400); // sin nombre
  assert.equal((await req('POST', `/v1/app/pedidos/${pCE.id}/entregar`, { headers: A, body: { foto: FOTO, receptor_nombre: 'Ana' } })).status, 400); // sin confirmar recaudo
  assert.equal((await req('POST', `/v1/app/pedidos/${pNormal.id}/entregar`, { headers: A, body: { foto: 'data:text/html;base64,PGI+', receptor_nombre: 'X' } })).status, 400);

  const ent = await req('POST', `/v1/app/pedidos/${pNormal.id}/entregar`, { headers: A, body: { foto: FOTO, firma: FOTO.replace('jpeg', 'png'), receptor_nombre: 'Laura M', lat: 4.7, lng: -74.05 } });
  assert.equal(ent.status, 200, JSON.stringify(ent.body));
  const guardado = db.s.pedidos.find((p) => p.id === pNormal.id);
  assert.equal(guardado.estado, 'entregado');
  assert.match(guardado.evidencia_foto_url, /evidencias\/2026\/T506-2026-\d+-[0-9a-f]{12}\.jpg$/);
  assert.match(guardado.evidencia_firma_url, /-firma\.png$/);
  assert.equal(guardado.entrega_lat, 4.7);
  // Reintento desde la cola sin señal: no falla ni duplica
  assert.equal((await req('POST', `/v1/app/pedidos/${pNormal.id}/entregar`, { headers: A, body: { foto: FOTO, receptor_nombre: 'Laura M' } })).body.ya_entregado, true);

  const ce = await req('POST', `/v1/app/pedidos/${pCE.id}/entregar`, { headers: A, body: { foto: FOTO, receptor_nombre: 'Ana', recaudo_confirmado: true } });
  assert.equal(ce.status, 200);
  assert.equal(db.s.pedidos.find((p) => p.id === pCE.id).recaudo_confirmado, true);

  // Novedad sobre el que queda
  const resto = [p1, p2, p3].find((p) => p.id !== pNormal.id && p.id !== pCE.id);
  assert.equal((await req('POST', `/v1/app/pedidos/${resto.id}/novedad`, { headers: A, body: { tipo: 'nada' } })).status, 400);
  const nov = await req('POST', `/v1/app/pedidos/${resto.id}/novedad`, { headers: A, body: { tipo: 'cliente_ausente', descripcion: 'Nadie abrió', foto: FOTO } });
  assert.equal(nov.status, 200);
  assert.equal(db.s.pedidos.find((p) => p.id === resto.id).estado, 'novedad');

  // El webhook de entrega lleva la evidencia (lo dispara el trigger de Supabase → /internos/estado)
  const p = db.s.pedidos.find((x) => x.id === pNormal.id);
  const w = await req('POST', '/v1/internos/estado', { headers: { 'X-Internal-Secret': 'secreto-interno' }, body: { record: p, old_record: { ...p, estado: 'en_ruta' } } });
  assert.equal(w.status, 200);
  assert.equal(enviados.at(-1).payload.evidencia.nombre_receptor, 'Laura M');
  assert.ok(enviados.at(-1).payload.evidencia.firma_url);

  // Ubicación en vivo y mapa del panel
  assert.equal((await req('POST', '/v1/app/ubicacion', { headers: A, body: { lat: 999, lng: 0 } })).status, 400);
  await req('POST', '/v1/app/ubicacion', { headers: A, body: { lat: 4.71, lng: -74.04 } });
  const mapa = (await req('GET', '/v1/admin/mapa', { headers: H })).body;
  assert.equal(mapa.mensajeros.length, 1);
  assert.equal(mapa.mensajeros[0].nombre, '506-9');

  // Resumen del día en la app: 2 entregados + 1 novedad
  const fin = (await req('GET', '/v1/app/mi-ruta', { headers: A })).body;
  assert.equal(fin.paradas.filter((x) => x.estado === 'entregado').length, 2);
});

test('app: un mensajero no puede tocar pedidos de otro', async (t) => {
  const { req, H, db } = await preparar(t);
  await req('POST', '/v1/admin/conductores', { body: { nombre: 'Otro', telefono: '3110000000', pin: '1111' }, headers: H });
  await req('POST', '/v1/pedidos', { headers: { 'X-API-Key': API_KEY }, body: pedidoValido({ pedido_id: 'AJENO' }) });
  const ped = db.s.pedidos[0];
  const otro = db.s.conductores.find((c) => c.nombre === 'Otro');
  await req('POST', `/v1/admin/pedidos/${ped.id}/accion`, { headers: H, body: { accion: 'asignar', conductor_id: otro.id } });
  const A = { Authorization: `Bearer ${(await req('POST', '/v1/app/login', { body: { telefono: '3005551234', pin: '4821' } })).body.token}` };
  assert.equal((await req('POST', `/v1/app/pedidos/${ped.id}/entregar`, { headers: A, body: { foto: FOTO, receptor_nombre: 'X' } })).status, 404);
  assert.equal((await req('GET', '/v1/app/mi-ruta', { headers: A })).body.paradas.length, 0);
});
