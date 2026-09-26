// Acceso a datos en Supabase. Toda la persistencia pasa por aquí.
const { createClient } = require('@supabase/supabase-js');
const { errores, ApiError } = require('../lib/errores');

function createDb({ url, serviceKey, bucketGuias }) {
  if (!url || !serviceKey) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

  const q = async (promesa) => {
    const { data, error } = await promesa;
    if (error) throw Object.assign(new Error(`Supabase: ${error.message}`), { pg: error });
    return data;
  };

  return {
    async buscarApiKey(hash) {
      return q(sb.from('api_keys').select('id, cliente_nombre, webhook_secret, entorno, activa').eq('api_key_hash', hash).eq('activa', true).maybeSingle());
    },

    async siguienteGuia() {
      return q(sb.rpc('siguiente_guia'));
    },

    async buscarPedido(clienteId, pedidoOmsId) {
      return q(sb.from('pedidos').select('*, conductor:conductores(nombre, telefono, vehiculo)').eq('cliente_id', clienteId).eq('pedido_oms_id', pedidoOmsId).maybeSingle());
    },

    async buscarPedidoPorGuia(guia) {
      return q(sb.from('pedidos').select('*, conductor:conductores(nombre, vehiculo)').eq('guia_numero', guia).maybeSingle());
    },

    async buscarPedidoPorId(id) {
      return q(sb.from('pedidos').select('*, conductor:conductores(nombre, telefono, vehiculo), cliente:api_keys(webhook_secret)').eq('id', id).maybeSingle());
    },

    async historial(pedidoId) {
      return q(sb.from('pedido_eventos').select('estado, creado_en').eq('pedido_id', pedidoId).order('creado_en'));
    },

    async crearPedido(fila) {
      const { data, error } = await sb.from('pedidos').insert(fila).select().single();
      if (error?.code === '23505') throw errores.duplicado(fila.pedido_oms_id);
      if (error) throw new Error(`Supabase: ${error.message}`);
      return data;
    },

    async actualizarPedido(id, cambios) {
      return q(sb.from('pedidos').update(cambios).eq('id', id).select().single());
    },

    async pedidosParaRutear(fecha) {
      return q(
        sb.from('pedidos')
          .select('id, guia_numero, pedido_oms_id, zona, lat, lng, paquete, servicio, entrega, destinatario')
          .in('estado', ['guia_generada', 'reagendado'])
          .is('conductor_id', null)
          .not('lat', 'is', null)
          .or(`fecha_programada.is.null,fecha_programada.lte.${fecha}`)
      );
    },

    async conductoresActivos() {
      return q(sb.from('conductores').select('*').eq('activo', true));
    },

    async crearViaje(fila) {
      return q(sb.from('viajes').insert(fila).select().single());
    },

    async asignarPedidos(ids, conductorId, viajeId) {
      return q(sb.from('pedidos').update({ conductor_id: conductorId, viaje_id: viajeId, estado: 'asignado' }).in('id', ids).select('id'));
    },

    async encolarWebhook(fila) {
      return q(sb.from('webhook_pendientes').insert(fila).select().single());
    },

    async webhooksVencidos(limite = 50) {
      return q(sb.from('webhook_pendientes').select('*').eq('entregado', false).eq('agotado', false).lte('proximo_intento', new Date().toISOString()).order('proximo_intento').limit(limite));
    },

    async actualizarWebhook(id, cambios) {
      return q(sb.from('webhook_pendientes').update(cambios).eq('id', id));
    },

    // ── Panel: usuarios ────────────────────────────────────────────────────
    async usuarioPorEmail(email) {
      return q(sb.from('usuarios').select('*').eq('email', email.toLowerCase().trim()).eq('activo', true).maybeSingle());
    },
    async listarUsuarios() {
      return q(sb.from('usuarios').select('id, email, nombre, rol, activo, creado_en').order('creado_en'));
    },
    async crearUsuario(f) {
      const { data, error } = await sb.from('usuarios').insert(f).select('id, email, nombre, rol, activo').single();
      if (error?.code === '23505') throw new ApiError(409, 'duplicado', 'Ya existe un usuario con ese correo');
      if (error) throw new Error(`Supabase: ${error.message}`);
      return data;
    },
    async actualizarUsuario(id, c) {
      return q(sb.from('usuarios').update(c).eq('id', id).select('id, email, nombre, rol, activo').single());
    },

    // ── Panel: pedidos ─────────────────────────────────────────────────────
    async listarPedidos({ estado, zona, conductor_id, cliente_id, q: texto, desde, hasta, revision, limite = 50, offset = 0 } = {}) {
      let c = sb.from('pedidos')
        .select('id, guia_numero, pedido_oms_id, estado, zona, destinatario_nombre, destinatario_telefono, direccion, ciudad, peso_kg, servicio_tipo, requiere_revision, fecha_programada, creada_en, actualizado_en, pdf_url, lat, lng, conductor_id, viaje_id, novedad_tipo, conductor:conductores(nombre), cliente:api_keys(cliente_nombre)', { count: 'exact' })
        .order('creada_en', { ascending: false })
        .range(offset, offset + limite - 1);
      if (estado) c = c.in('estado', String(estado).split(','));
      if (zona) c = c.eq('zona', zona);
      if (conductor_id) c = c.eq('conductor_id', conductor_id);
      if (cliente_id) c = c.eq('cliente_id', cliente_id);
      if (revision === 'true') c = c.eq('requiere_revision', true);
      if (desde) c = c.gte('creada_en', `${desde}T05:00:00Z`);
      if (hasta) c = c.lt('creada_en', new Date(new Date(`${hasta}T05:00:00Z`).getTime() + 864e5).toISOString());
      if (texto) {
        const t = String(texto).replace(/[,()%*]/g, ' ').trim();
        if (t) c = c.or(`guia_numero.ilike.%${t}%,pedido_oms_id.ilike.%${t}%,destinatario_nombre.ilike.%${t}%,direccion.ilike.%${t}%`);
      }
      const { data, error, count } = await c;
      if (error) throw new Error(`Supabase: ${error.message}`);
      return { filas: data, total: count };
    },
    async pedidosActivos() {
      return q(sb.from('pedidos').select('id, estado, zona, requiere_revision, conductor_id, lat, lng, guia_numero, destinatario_nombre, direccion, creada_en, actualizado_en')
        .not('estado', 'in', '(entregado,devuelto,cancelado)'));
    },
    async pedidosActualizadosDesde(iso) {
      return q(sb.from('pedidos').select('id, estado, zona').gte('actualizado_en', iso));
    },

    // ── Panel: mensajeros ──────────────────────────────────────────────────
    async listarConductores() {
      return q(sb.from('conductores').select('*').order('nombre'));
    },
    async crearConductor(f) {
      return q(sb.from('conductores').insert(f).select().single());
    },
    async actualizarConductor(id, c) {
      return q(sb.from('conductores').update(c).eq('id', id).select().single());
    },

    // ── Panel: viajes ──────────────────────────────────────────────────────
    async listarViajes(fecha) {
      return q(sb.from('viajes').select('*, conductor:conductores(nombre, telefono, placa, tipo_vehiculo)').eq('fecha', fecha).order('creado_en'));
    },
    async viajePorId(id) {
      return q(sb.from('viajes').select('*').eq('id', id).maybeSingle());
    },
    async actualizarViaje(id, c) {
      return q(sb.from('viajes').update(c).eq('id', id).select().single());
    },
    async actualizarPedidosDeViaje(viajeId, estadosOrigen, cambios) {
      return q(sb.from('pedidos').update(cambios).eq('viaje_id', viajeId).in('estado', estadosOrigen).select('id'));
    },

    // ── Panel: sellers (clientes OMS) ──────────────────────────────────────
    async listarClientes() {
      return q(sb.from('api_keys').select('id, cliente_nombre, entorno, activa, creada_en').order('creada_en'));
    },
    async clienteInterno() {
      return q(sb.from('api_keys').select('id, cliente_nombre').eq('api_key_hash', 'interno-sin-llave').maybeSingle());
    },
    async crearCliente(f) {
      return q(sb.from('api_keys').insert(f).select('id, cliente_nombre, entorno, activa, creada_en').single());
    },
    async actualizarCliente(id, c) {
      return q(sb.from('api_keys').update(c).eq('id', id).select('id, cliente_nombre, entorno, activa').single());
    },

    // ── Panel: bodegas ─────────────────────────────────────────────────────
    async listarBodegas() {
      return q(sb.from('bodegas').select('*').order('creado_en'));
    },
    async bodegaPrincipal() {
      return q(sb.from('bodegas').select('*').eq('principal', true).eq('activa', true).limit(1).maybeSingle());
    },
    async crearBodega(f) {
      if (f.principal) await q(sb.from('bodegas').update({ principal: false }).eq('principal', true));
      return q(sb.from('bodegas').insert(f).select().single());
    },
    async actualizarBodega(id, c) {
      if (c.principal) await q(sb.from('bodegas').update({ principal: false }).neq('id', id));
      return q(sb.from('bodegas').update(c).eq('id', id).select().single());
    },

    async subirPdf(ruta, buffer) {
      await q(sb.storage.from(bucketGuias).upload(ruta, buffer, { contentType: 'application/pdf', upsert: true }));
      return sb.storage.from(bucketGuias).getPublicUrl(ruta).data.publicUrl;
    },
  };
}

module.exports = { createDb };
