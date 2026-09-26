const test = require('node:test');
const assert = require('node:assert/strict');
const { validarPedido } = require('../src/lib/validacion');
const { asignarZona, calcularTarifa, calcularEta } = require('../src/lib/calculos');
const { asignarPedidos } = require('../src/services/asignacion');
const { proximoIntento } = require('../src/services/webhooks');
const { resolverNovedad } = require('../src/services/novedades');
const { normalizarDireccion, createGeocoder } = require('../src/services/geocoding');
const { createRouteOptimizer } = require('../src/services/rutasGoogle');
const { pedidoValido } = require('./helpers');

test('validación: pedido válido no tiene errores', () => {
  assert.deepEqual(validarPedido(pedidoValido()), []);
});

test('validación: detecta campos faltantes, teléfono y webhook http', () => {
  const e = validarPedido({ pedido_id: 'X', destinatario: { nombre: 'A', telefono: '3001234567' }, webhook_url: 'http://x.co' });
  assert.ok(e.some((m) => m.includes('formato internacional')));
  assert.ok(e.some((m) => m.includes('entrega.direccion')));
  assert.ok(e.some((m) => m.includes('HTTPS')));
  assert.ok(e.some((m) => m.includes('servicio.tipo')));
});

test('validación: contra entrega exige valor_recaudo', () => {
  const e = validarPedido(pedidoValido({ servicio: { tipo: 'estandar', contra_entrega: true } }));
  assert.deepEqual(e, ['servicio.valor_recaudo es requerido cuando contra_entrega es true']);
});

test('zonas de Bogotá y fuera de cobertura', () => {
  assert.equal(asignarZona(4.70, -74.05), 'Norte');
  assert.equal(asignarZona(4.55, -74.15), 'Sur');
  assert.equal(asignarZona(6.24, -75.58, 'Medellín'), 'Medellín');
});

test('tarifa usa el mayor entre peso real y volumétrico', () => {
  // 30×20×15/5000 = 1.8 kg vol → cobrable 2 kg → 9000 + 1×1500 + 1% de 150000
  const t = calcularTarifa({ peso_kg: 1.5, largo_cm: 30, ancho_cm: 20, alto_cm: 15, valor_declarado: 150000 }, 'estandar');
  assert.equal(t.peso_cobrable_kg, 2);
  assert.equal(t.valor, 9000 + 1500 + 1500);
});

test('ETA: estándar al siguiente día hábil; same_day antes del mediodía es hoy; sábado salta domingo', () => {
  const vie9am = new Date('2026-09-25T14:00:00Z');
  assert.equal(calcularEta('estandar', vie9am).fecha_estimada, '2026-09-26');
  assert.equal(calcularEta('same_day', vie9am).fecha_estimada, '2026-09-25');
  assert.equal(calcularEta('estandar', new Date('2026-09-26T14:00:00Z')).fecha_estimada, '2026-09-28');
});

test('asignación: respeta zona, capacidad, prioridad y máximo de paradas', () => {
  const ped = (id, zona, kg, tipo = 'estandar') => ({ id, zona, paquete: { peso_kg: kg }, servicio: { tipo } });
  const conductores = [
    { id: 'n', nombre: 'Norte', zona: 'Norte', capacidad_kg: 10 },
    { id: 's', nombre: 'Sur', zona: 'Sur', capacidad_kg: 100 },
  ];
  const pedidos = [ped(1, 'Norte', 6), ped(2, 'Norte', 6, 'same_day'), ped(3, 'Sur', 1), ped(4, 'Centro', 200)];
  const { rutas, sinAsignar } = asignarPedidos(pedidos, conductores, { maxParadas: 25 });
  const norte = rutas.find((r) => r.conductor.id === 'n');
  const sur = rutas.find((r) => r.conductor.id === 's');
  assert.deepEqual(norte.pedidos.map((p) => p.id), [2]); // el urgente entra primero; el otro no cabe
  assert.deepEqual(sur.pedidos.map((p) => p.id).sort(), [1, 3]); // desborda al conductor con cupo
  assert.deepEqual(sinAsignar.map((p) => p.id), [4]); // 200 kg no cabe en nadie

  const muchos = Array.from({ length: 30 }, (_, i) => ped(i, 'Sur', 0.1));
  const r2 = asignarPedidos(muchos, [conductores[1]], { maxParadas: 25 });
  assert.equal(r2.rutas[0].pedidos.length, 25);
  assert.equal(r2.sinAsignar.length, 5);
});

test('reintentos de webhooks: 1, 5, 15 minutos y luego se agota', () => {
  const t0 = new Date('2026-01-01T00:00:00Z');
  const m = [1, 5, 15];
  assert.equal(proximoIntento(1, m, t0).toISOString(), '2026-01-01T00:01:00.000Z');
  assert.equal(proximoIntento(2, m, t0).toISOString(), '2026-01-01T00:05:00.000Z');
  assert.equal(proximoIntento(3, m, t0).toISOString(), '2026-01-01T00:15:00.000Z');
  assert.equal(proximoIntento(4, m, t0), null);
});

test('novedades: reagenda, devuelve al tercer intento, rehusado devuelve, dirección va a revisión', () => {
  const now = new Date('2026-09-25T20:00:00Z');
  const a = resolverNovedad({ novedad: { tipo: 'cliente_ausente' }, intentos_entrega: 0 }, now);
  assert.equal(a.estado, 'reagendado');
  assert.equal(a.fecha_programada, '2026-09-26');
  assert.equal(resolverNovedad({ novedad: { tipo: 'cliente_ausente' }, intentos_entrega: 2 }, now).estado, 'devuelto');
  assert.equal(resolverNovedad({ novedad: { tipo: 'rehusado' } }, now).estado, 'devuelto');
  const d = resolverNovedad({ novedad: { tipo: 'direccion_incorrecta' } }, now);
  assert.equal(d.requiere_revision, true);
  assert.equal(d.estado, undefined);
});

test('normaliza abreviaturas de direcciones colombianas', () => {
  assert.equal(normalizarDireccion('cra 15 no 93-47'), 'Carrera 15 # 93-47');
  assert.equal(normalizarDireccion('Cl. 26 Sur # 10-20'), 'Calle 26 Sur # 10-20');
});

test('geocodificador: restringe a la ciudad y marca revisión si es aproximada', async () => {
  let urlLlamada;
  const geo = createGeocoder({
    apiKey: 'K',
    fetchImpl: async (url) => {
      urlLlamada = decodeURIComponent(url);
      return { json: async () => ({ status: 'OK', results: [{ formatted_address: 'Cra. 15 #93-47, Bogotá, Colombia', partial_match: true,
        address_components: [{ long_name: 'Bogotá', short_name: 'Bogotá', types: ['locality', 'political'] }],
        geometry: { location: { lat: 4.68, lng: -74.05 }, location_type: 'ROOFTOP' } }] }) };
    },
  });
  const r = await geo({ direccion: 'cra 15 # 93-47', ciudad: 'Bogotá', departamento: 'Cundinamarca' });
  assert.ok(urlLlamada.includes('components=country:CO|locality:Bogotá'));
  assert.ok(urlLlamada.includes('Carrera 15'));
  assert.ok(urlLlamada.includes('Bogotá D.C.'));
  assert.ok(!urlLlamada.includes('Cundinamarca'), 'Bogotá no debe mezclarse con Cundinamarca');
  assert.equal(r.requiere_revision, true);
});

test('geocodificador: si Google devuelve otro municipio (Zipaquirá) lo marca para revisión', async () => {
  const zipa = { formatted_address: 'Cra. 11 #82-71, Zipaquirá, Cundinamarca, Colombia',
    address_components: [{ long_name: 'Zipaquirá', short_name: 'Zipaquirá', types: ['locality'] }, { long_name: 'Cundinamarca', short_name: 'Cundinamarca', types: ['administrative_area_level_1'] }],
    geometry: { location: { lat: 5.02, lng: -73.99 }, location_type: 'ROOFTOP' } };
  const bog = { formatted_address: 'Cra. 11 #82-71, Bogotá, Colombia',
    address_components: [{ long_name: 'Bogotá', short_name: 'Bogotá', types: ['locality'] }, { long_name: 'Bogotá, D.C.', short_name: 'Bogotá, D.C.', types: ['administrative_area_level_1'] }],
    geometry: { location: { lat: 4.667, lng: -74.052 }, location_type: 'ROOFTOP' } };
  const solo = (res) => createGeocoder({ apiKey: 'K', fetchImpl: async () => ({ json: async () => ({ status: 'OK', results: res }) }) });

  const malo = await solo([zipa])({ direccion: 'Carrera 11 # 82-71', ciudad: 'Bogotá', departamento: 'Cundinamarca' });
  assert.equal(malo.requiere_revision, true);
  assert.equal(malo.precision, 'OTRA_CIUDAD');

  const bueno = await solo([zipa, bog])({ direccion: 'Carrera 11 # 82-71', ciudad: 'Bogotá', departamento: 'Cundinamarca' });
  assert.equal(bueno.lat, 4.667); // elige el resultado que sí está en Bogotá
  assert.equal(bueno.requiere_revision, false);

  const medellin = await solo([{ formatted_address: 'Cl. 10 #43-20, Medellín, Antioquia, Colombia',
    address_components: [{ long_name: 'Medellín', short_name: 'Medellín', types: ['locality'] }], geometry: { location: { lat: 6.2, lng: -75.5 }, location_type: 'ROOFTOP' } }])({ direccion: 'Calle 10 # 43-20', ciudad: 'Medellin', departamento: 'Antioquia' });
  assert.equal(medellin.requiere_revision, false); // tildes no afectan la comparación
});

test('Google Routes: envía optimizeWaypointOrder y reordena según el índice devuelto', async () => {
  let cuerpo, headers;
  const ordenar = createRouteOptimizer({
    apiKey: 'K',
    fetchImpl: async (_u, opts) => {
      cuerpo = JSON.parse(opts.body);
      headers = opts.headers;
      return { ok: true, json: async () => ({ routes: [{ optimizedIntermediateWaypointIndex: [2, 0, 1], distanceMeters: 15300, duration: '5400s' }] }) };
    },
  });
  const r = await ordenar({ lat: 4.6, lng: -74.1 }, [{ id: 'a', lat: 1, lng: 1 }, { id: 'b', lat: 2, lng: 2 }, { id: 'c', lat: 3, lng: 3 }]);
  assert.equal(cuerpo.optimizeWaypointOrder, true);
  assert.equal(cuerpo.intermediates.length, 3);
  assert.ok(headers['X-Goog-FieldMask'].includes('optimizedIntermediateWaypointIndex'));
  assert.deepEqual(r.secuencia.map((p) => p.id), ['c', 'a', 'b']);
  assert.equal(r.km, 15.3);
  assert.equal(r.duracion_min, 90);
});
