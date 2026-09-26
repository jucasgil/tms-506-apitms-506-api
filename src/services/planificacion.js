// Planificación del día: reparte pedidos entre mensajeros y ordena las paradas con Google Routes.
// La usan el panel (Rutero) y el endpoint interno.
const { asignarPedidos } = require('./asignacion');

async function planificarRutas({ db, ordenarParadas, config }, fecha, { conductorIds } = {}) {
  const [pedidos, conductores, bodega] = await Promise.all([
    db.pedidosParaRutear(fecha),
    db.conductoresActivos(),
    db.bodegaPrincipal ? db.bodegaPrincipal() : null,
  ]);
  const deposito = bodega?.lat ? { lat: Number(bodega.lat), lng: Number(bodega.lng) } : config.deposito;
  const elegidos = Array.isArray(conductorIds) && conductorIds.length ? conductores.filter((c) => conductorIds.includes(c.id)) : conductores;
  const { rutas, sinAsignar } = asignarPedidos(pedidos, elegidos, { maxParadas: config.rutas.maxParadas });

  const viajes = [];
  const errores = [];
  for (const ruta of rutas) {
    try {
      const orden = await ordenarParadas(deposito, ruta.pedidos);
      const viaje = await db.crearViaje({
        fecha,
        conductor_id: ruta.conductor.id,
        bodega_id: bodega?.id || null,
        secuencia: orden.secuencia.map((p, i) => ({
          orden: i + 1, pedido_id: p.id, guia_numero: p.guia_numero, zona: p.zona, lat: p.lat, lng: p.lng,
          destinatario: p.destinatario?.nombre, direccion: p.entrega?.direccion,
        })),
        total_paradas: orden.secuencia.length,
        km_totales: orden.km,
        duracion_min: orden.duracion_min,
        kg_totales: ruta.kg,
      });
      await db.asignarPedidos(ruta.pedidos.map((p) => p.id), ruta.conductor.id, viaje.id);
      viajes.push({
        viaje_id: viaje.id, conductor: ruta.conductor.nombre, paradas: orden.secuencia.length,
        km: orden.km, duracion_min: orden.duracion_min,
      });
    } catch (e) {
      errores.push({ conductor: ruta.conductor.nombre, error: e.message });
    }
  }

  return {
    fecha,
    deposito,
    pedidos_considerados: pedidos.length,
    viajes,
    sin_asignar: sinAsignar.map((p) => ({ id: p.id, guia_numero: p.guia_numero, zona: p.zona })),
    errores,
  };
}

module.exports = { planificarRutas };
