// Genera la guía de transporte en PDF (etiqueta 4×6 pulgadas) con código de barras Code 128 y QR de rastreo.
// Se genera dentro del backend: no requiere Docupilot ni plantillas externas.
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');
const QRCode = require('qrcode');

const fmtCOP = (v) => `$${Math.round(v || 0).toLocaleString('es-CO')}`;

async function generarGuiaPdf(g, { empresa }) {
  const barras = await bwipjs.toBuffer({ bcid: 'code128', text: g.guia_numero, scale: 3, height: 12, includetext: false });
  const qr = await QRCode.toBuffer(g.tracking_url, { margin: 0, width: 220 });

  const doc = new PDFDocument({ size: [288, 432], margin: 14 }); // 4×6 in
  const partes = [];
  doc.on('data', (c) => partes.push(c));
  const fin = new Promise((ok) => doc.on('end', () => ok(Buffer.concat(partes))));

  const W = 260, X = 14;
  const linea = (y) => doc.moveTo(X, y).lineTo(X + W, y).lineWidth(0.8).stroke('#000');

  // Encabezado
  doc.rect(X, 14, W, 34).fill('#0D2137');
  doc.fill('#FFF').font('Helvetica-Bold').fontSize(14).text(empresa.nombre.toUpperCase(), X + 8, 20, { width: W - 16 });
  doc.font('Helvetica').fontSize(8).text(`Servicio: ${g.servicio_tipo.replace('_', ' ').toUpperCase()}`, X + 8, 36);
  doc.fill('#000');

  // Número de guía y código de barras
  doc.font('Helvetica-Bold').fontSize(16).text(g.guia_numero, X, 56, { width: W, align: 'center' });
  doc.image(barras, X + 20, 76, { width: W - 40, height: 40 });
  linea(124);

  // Destinatario
  doc.font('Helvetica-Bold').fontSize(8).text('DESTINATARIO', X, 130);
  doc.font('Helvetica-Bold').fontSize(12).text(g.destinatario.nombre, X, 141, { width: W });
  doc.font('Helvetica').fontSize(9).text(g.destinatario.telefono, X, 157);
  doc.font('Helvetica').fontSize(10).text(g.direccion_mostrar, X, 170, { width: W });
  const yRef = doc.y + 2;
  if (g.entrega.referencia) doc.fontSize(8).text(`Ref: ${g.entrega.referencia}`, X, yRef, { width: W });
  if (g.entrega.instrucciones) doc.fontSize(8).text(`Instrucciones: ${g.entrega.instrucciones}`, X, doc.y + 1, { width: W });
  linea(236);

  // Zona grande para el clasificador en bodega
  doc.rect(X, 242, 120, 44).lineWidth(1.5).stroke('#000');
  doc.font('Helvetica').fontSize(7).text('ZONA', X + 6, 246);
  doc.font('Helvetica-Bold').fontSize(18).text(g.zona || '-', X + 6, 258, { width: 110 });

  // Datos del paquete
  doc.font('Helvetica').fontSize(8);
  const col = X + 130;
  doc.text(`Peso: ${g.paquete.peso_kg} kg`, col, 244);
  doc.text(`Medidas: ${g.paquete.largo_cm}×${g.paquete.ancho_cm}×${g.paquete.alto_cm} cm`, col, 256);
  doc.text(`Declarado: ${fmtCOP(g.paquete.valor_declarado)}`, col, 268);
  doc.text(`Pedido: ${g.pedido_oms_id}`, col, 280, { width: 130 });
  linea(294);

  // Contra entrega
  if (g.servicio.contra_entrega) {
    doc.rect(X, 299, W, 22).fill('#000');
    doc.fill('#FFF').font('Helvetica-Bold').fontSize(12)
      .text(`COBRAR AL ENTREGAR: ${fmtCOP(g.servicio.valor_recaudo)}`, X, 304, { width: W, align: 'center' });
    doc.fill('#000');
  }

  // Contenido + QR
  doc.font('Helvetica').fontSize(8).text(`Contenido: ${g.paquete.descripcion}`, X, 328, { width: 160 });
  if (g.paquete.fragil) doc.font('Helvetica-Bold').fontSize(11).text('FRÁGIL', X, 350);
  doc.font('Helvetica').fontSize(7).text(`Creada: ${g.fecha_creacion}`, X, 372);
  doc.text(`Entrega estimada: ${g.eta.fecha_estimada}`, X, 382);
  doc.image(qr, X + W - 80, 326, { width: 80 });
  doc.fontSize(6).text('Rastrea tu envío', X + W - 80, 408, { width: 80, align: 'center' });

  doc.end();
  return fin;
}

module.exports = { generarGuiaPdf };
