// Validación del cuerpo de POST /v1/pedidos según la documentación de API v1.0
const SERVICIOS = ['estandar', 'express', 'same_day'];

const esTexto = (v) => typeof v === 'string' && v.trim().length > 0;
const esNumeroPositivo = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

function validarPedido(body) {
  const e = [];
  if (!body || typeof body !== 'object') return ['El cuerpo debe ser un objeto JSON'];

  if (!esTexto(body.pedido_id)) e.push('pedido_id es requerido');

  const d = body.destinatario || {};
  if (!esTexto(d.nombre)) e.push('destinatario.nombre es requerido');
  if (!esTexto(d.telefono)) e.push('destinatario.telefono es requerido');
  else if (!/^\+\d{10,15}$/.test(d.telefono.replace(/[\s-]/g, '')))
    e.push('destinatario.telefono debe estar en formato internacional, ej: +573001234567');

  const en = body.entrega || {};
  for (const c of ['direccion', 'ciudad', 'departamento']) if (!esTexto(en[c])) e.push(`entrega.${c} es requerido`);

  const p = body.paquete || {};
  for (const c of ['peso_kg', 'largo_cm', 'ancho_cm', 'alto_cm'])
    if (!esNumeroPositivo(p[c])) e.push(`paquete.${c} debe ser un número mayor que 0`);
  if (!esTexto(p.descripcion)) e.push('paquete.descripcion es requerido');
  if (typeof p.valor_declarado !== 'number' || p.valor_declarado < 0)
    e.push('paquete.valor_declarado es requerido (COP, número ≥ 0)');

  const s = body.servicio || {};
  if (!SERVICIOS.includes(s.tipo)) e.push(`servicio.tipo debe ser uno de: ${SERVICIOS.join(', ')}`);
  if (s.contra_entrega === true && !esNumeroPositivo(s.valor_recaudo))
    e.push('servicio.valor_recaudo es requerido cuando contra_entrega es true');

  if (!esTexto(body.webhook_url)) e.push('webhook_url es requerido');
  else {
    try {
      const u = new URL(body.webhook_url);
      if (u.protocol !== 'https:') e.push('webhook_url debe usar HTTPS');
    } catch {
      e.push('webhook_url no es una URL válida');
    }
  }
  return e;
}

module.exports = { validarPedido, SERVICIOS };
