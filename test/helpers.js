// Dependencias simuladas para probar la API sin Supabase, Google ni Twilio reales.
const { hashApiKey } = require('../src/lib/calculos');
const { hashPassword } = require('../src/lib/sesion');
const { errores } = require('../src/lib/errores');
const { generarGuiaPdf } = require('../src/services/guiaPdf');
const { createApp } = require('../src/app');

const API_KEY = 'tk_test_123';
const SECRETO = 'secreto-interno';

function fakeDb() {
  const s = {
    apiKeys: [{ id: 'cli-1', cliente_nombre: 'OMS Demo', api_key_hash: hashApiKey(API_KEY), webhook_secret: 'whsec_demo', activa: true }],
    pedidos: [], eventos: [], viajes: [], cola: [], pdfs: {}, seq: 0, bodegas: [],
    usuarios: [{ id: 'u1', email: 'admin@506.co', nombre: 'Admin', rol: 'admin', activo: true, password_hash: hashPassword('clave-segura-1') }],
    conductores: [
      { id: 'c1', nombre: 'Carlos Ramírez', zona: 'Norte', capacidad_kg: 50, activo: true },
      { id: 'c2', nombre: 'Ana Gómez', zona: 'Sur', capacidad_kg: 50, activo: true },
    ],
  };
  const conConductor = (p) => p && { ...p, conductor: s.conductores.find((c) => c.id === p.conductor_id) || null };
  return {
    s,
    buscarApiKey: async (h) => s.apiKeys.find((k) => k.api_key_hash === h && k.activa) || null,
    siguienteGuia: async () => ++s.seq,
    buscarPedido: async (cli, oms) => conConductor(s.pedidos.find((p) => p.cliente_id === cli && p.pedido_oms_id === oms)),
    buscarPedidoPorGuia: async (g) => conConductor(s.pedidos.find((p) => p.guia_numero === g)),
    buscarPedidoPorId: async (id) => {
      const p = conConductor(s.pedidos.find((p) => p.id === id));
      return p && { ...p, cliente: { webhook_secret: 'whsec_demo' } };
    },
    historial: async (id) => s.eventos.filter((e) => e.pedido_id === id),
    crearPedido: async (f) => {
      if (s.pedidos.some((p) => p.cliente_id === f.cliente_id && p.pedido_oms_id === f.pedido_oms_id)) throw errores.duplicado(f.pedido_oms_id);
      const p = { id: `p${s.pedidos.length + 1}`, creada_en: new Date().toISOString(), intentos_entrega: 0, conductor_id: null, ...f };
      s.pedidos.push(p);
      s.eventos.push({ pedido_id: p.id, estado: p.estado, creado_en: p.creada_en });
      return p;
    },
    actualizarPedido: async (id, c) => {
      const p = s.pedidos.find((p) => p.id === id);
      if (c.estado && c.estado !== p.estado) s.eventos.push({ pedido_id: id, estado: c.estado, creado_en: new Date().toISOString() });
      Object.assign(p, c);
      return p;
    },
    pedidosParaRutear: async () => s.pedidos.filter((p) => ['guia_generada', 'reagendado'].includes(p.estado) && !p.conductor_id),
    conductoresActivos: async () => s.conductores.filter((c) => c.activo),
    crearViaje: async (f) => { const v = { id: `v${s.viajes.length + 1}`, estado: 'planificado', ...f }; s.viajes.push(v); return v; },
    asignarPedidos: async (ids, cid, vid) => ids.forEach((id) => {
      Object.assign(s.pedidos.find((p) => p.id === id), { conductor_id: cid, viaje_id: vid, estado: 'asignado' });
      s.eventos.push({ pedido_id: id, estado: 'asignado', creado_en: new Date().toISOString() }); // como el trigger real
    }),
    encolarWebhook: async (f) => { const w = { id: `w${s.cola.length + 1}`, entregado: false, agotado: false, ...f }; s.cola.push(w); return w; },
    webhooksVencidos: async () => s.cola.filter((w) => !w.entregado && !w.agotado),
    actualizarWebhook: async (id, c) => Object.assign(s.cola.find((w) => w.id === id), c),
    subirPdf: async (ruta, buf) => { s.pdfs[ruta] = buf; return `https://cdn.test/guias/${ruta}`; },

    // Panel
    usuarioPorEmail: async (e) => s.usuarios.find((u) => u.email === e && u.activo) || null,
    listarUsuarios: async () => s.usuarios.map(({ password_hash, ...u }) => u),
    crearUsuario: async (f) => { const u = { id: `u${s.usuarios.length + 1}`, ...f }; s.usuarios.push(u); return u; },
    actualizarUsuario: async (id, c) => Object.assign(s.usuarios.find((u) => u.id === id), c),
    listarPedidos: async ({ estado } = {}) => {
      const filas = s.pedidos.filter((p) => !estado || estado.split(',').includes(p.estado));
      return { filas, total: filas.length };
    },
    pedidosActivos: async () => s.pedidos.filter((p) => !['entregado', 'devuelto', 'cancelado'].includes(p.estado)),
    pedidosActualizadosDesde: async () => s.pedidos,
    listarConductores: async () => s.conductores,
    crearConductor: async (f) => { const c = { id: `c${s.conductores.length + 1}`, ...f }; s.conductores.push(c); return c; },
    actualizarConductor: async (id, c) => Object.assign(s.conductores.find((x) => x.id === id), c),
    listarViajes: async () => s.viajes,
    viajePorId: async (id) => s.viajes.find((v) => v.id === id) || null,
    actualizarViaje: async (id, c) => Object.assign(s.viajes.find((v) => v.id === id), c),
    actualizarPedidosDeViaje: async (vid, origen, c) => {
      const ps = s.pedidos.filter((p) => p.viaje_id === vid && origen.includes(p.estado));
      ps.forEach((p) => Object.assign(p, c));
      return ps.map((p) => ({ id: p.id }));
    },
    listarClientes: async () => s.apiKeys.map(({ api_key_hash, webhook_secret, ...c }) => c),
    clienteInterno: async () => ({ id: 'cli-interno', cliente_nombre: 'Venta directa' }),
    crearCliente: async (f) => { const c = { id: `cli-${s.apiKeys.length + 1}`, activa: true, ...f }; s.apiKeys.push(c); return { id: c.id, cliente_nombre: c.cliente_nombre, entorno: c.entorno, activa: true }; },
    actualizarCliente: async (id, c) => Object.assign(s.apiKeys.find((k) => k.id === id), c),
    listarBodegas: async () => s.bodegas,
    bodegaPrincipal: async () => s.bodegas.find((b) => b.principal) || null,
    crearBodega: async (f) => { const b = { id: `b${s.bodegas.length + 1}`, ...f }; s.bodegas.push(b); return b; },
    actualizarBodega: async (id, c) => Object.assign(s.bodegas.find((b) => b.id === id), c),
  };
}

// Geocodificador simulado: "Norte" → punto en Usaquén; "Sur" → Kennedy; "inexistente" → 422
const fakeGeocoder = async (entrega) => {
  if (/inexistente/i.test(entrega.direccion)) throw errores.direccion({ motivo: 'Google no encontró la dirección' });
  const sur = /sur/i.test(entrega.direccion);
  return {
    lat: sur ? 4.55 + Math.random() * 0.02 : 4.70 + Math.random() * 0.02,
    lng: sur ? -74.15 : -74.05,
    direccion_formateada: `${entrega.direccion}, ${entrega.ciudad}, Colombia`,
    precision: 'ROOFTOP',
    requiere_revision: false,
  };
};

const fakeRoutes = async (_dep, pedidos) => ({ secuencia: [...pedidos].reverse(), km: 12.5, duracion_min: 80 });

function crearEntorno({ webhookOk = true } = {}) {
  const db = fakeDb();
  const enviados = [];
  const notificaciones = [];
  const config = {
    baseUrl: 'https://tms.test',
    internalSecret: SECRETO,
    deposito: { lat: 4.64, lng: -74.10 },
    empresa: { nombre: 'Transportadora 506', prefijoGuia: 'T506' },
    rutas: { maxParadas: 25 },
    webhooks: { reintentosMin: [1, 5, 15], timeoutMs: 1000 },
  };
  const app = createApp({
    config, db,
    geocodificar: fakeGeocoder,
    ordenarParadas: fakeRoutes,
    generarPdf: generarGuiaPdf,
    notificar: async (p) => { notificaciones.push(p.estado); return { enviado: true }; },
    enviarWebhook: async (url, payload, secreto) => { enviados.push({ url, payload, secreto }); return { ok: webhookOk, status: webhookOk ? 200 : 503 }; },
    now: () => new Date('2026-09-25T14:00:00Z'), // 9:00 am en Bogotá
  });
  return { app, db, enviados, notificaciones };
}

async function servidor(app) {
  const srv = app.listen(0);
  await new Promise((ok) => srv.once('listening', ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const req = async (metodo, ruta, { body, headers = {} } = {}) => {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const tipo = r.headers.get('content-type') || '';
    return { status: r.status, body: tipo.includes('json') ? await r.json() : await r.text() };
  };
  return { req, cerrar: () => new Promise((ok) => srv.close(ok)) };
}

const pedidoValido = (o = {}) => ({
  pedido_id: 'ORD-001',
  destinatario: { nombre: 'Laura Martínez', telefono: '+573001234567' },
  entrega: { direccion: 'Cra 15 # 93-47 Apto 301', ciudad: 'Bogotá', departamento: 'Cundinamarca', referencia: 'Torre azul' },
  paquete: { peso_kg: 1.5, largo_cm: 30, ancho_cm: 20, alto_cm: 15, descripcion: 'Ropa', valor_declarado: 150000 },
  servicio: { tipo: 'estandar' },
  webhook_url: 'https://oms.test/carrier/update',
  ...o,
});

module.exports = { crearEntorno, servidor, pedidoValido, API_KEY, SECRETO };
