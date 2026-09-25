// Reparte los pedidos del día entre los conductores activos.
// Regla: primero conductores de la misma zona; luego conductores sin zona o con capacidad libre.
// Respeta capacidad en kg y el máximo de paradas por ruta (25 por el límite de Google Routes).

const peso = (p) => Number(p.paquete?.peso_kg) || 0;
const prioridad = (p) => ({ same_day: 0, express: 1, estandar: 2 }[p.servicio?.tipo] ?? 2);

function asignarPedidos(pedidos, conductores, { maxParadas = 25 } = {}) {
  const cargas = conductores.map((c) => ({ conductor: c, pedidos: [], kg: 0 }));
  const cabe = (carga, p) =>
    carga.pedidos.length < maxParadas && carga.kg + peso(p) <= (Number(carga.conductor.capacidad_kg) || Infinity);
  const asignar = (carga, p) => {
    carga.pedidos.push(p);
    carga.kg += peso(p);
  };

  // Urgentes primero para que nunca se queden sin cupo
  const orden = [...pedidos].sort((a, b) => prioridad(a) - prioridad(b));
  const sinAsignar = [];

  for (const p of orden) {
    const candidatos = [
      ...cargas.filter((c) => c.conductor.zona && c.conductor.zona === p.zona),
      ...cargas.filter((c) => !c.conductor.zona),
      ...cargas.filter((c) => c.conductor.zona && c.conductor.zona !== p.zona),
    ];
    // Dentro de cada grupo, el menos cargado primero para balancear
    const elegido = candidatos
      .filter((c) => cabe(c, p))
      .sort((a, b) => {
        const grupo = (c) => (c.conductor.zona === p.zona ? 0 : !c.conductor.zona ? 1 : 2);
        return grupo(a) - grupo(b) || a.pedidos.length - b.pedidos.length;
      })[0];
    if (elegido) asignar(elegido, p);
    else sinAsignar.push(p);
  }

  return { rutas: cargas.filter((c) => c.pedidos.length > 0), sinAsignar };
}

module.exports = { asignarPedidos };
