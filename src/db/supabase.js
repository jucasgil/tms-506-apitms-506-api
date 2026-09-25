// Acceso a datos en Supabase. Toda la persistencia pasa por aquí.
const { createClient } = require('@supabase/supabase-js');
const { errores } = require('../lib/errores');

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

    async subirPdf(ruta, buffer) {
      await q(sb.storage.from(bucketGuias).upload(ruta, buffer, { contentType: 'application/pdf', upsert: true }));
      return sb.storage.from(bucketGuias).getPublicUrl(ruta).data.publicUrl;
    },
  };
}

module.exports = { createDb };
