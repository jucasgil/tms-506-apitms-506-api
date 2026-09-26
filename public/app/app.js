/* App del mensajero — Transportadora 506 */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COP = (v) => `$${Math.round(Number(v) || 0).toLocaleString('es-CO')}`;
  const hora = (iso) => new Date(iso).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' });

  const NOVEDADES = [
    ['cliente_ausente', 'No había nadie / no contestó'],
    ['direccion_incorrecta', 'La dirección está mal o no existe'],
    ['acceso_restringido', 'No me dejaron entrar'],
    ['rehusado', 'El cliente no lo quiso recibir'],
    ['dano_paquete', 'El paquete está dañado'],
    ['otro', 'Otro motivo'],
  ];
  const I = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
    out: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    chat: '<path d="M4 20l1.5-4A8 8 0 1 1 9 19.2z"/>',
    nav: '<path d="M3 11l18-8-8 18-2-8z"/>',
    waze: '<circle cx="12" cy="11" r="8"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M9 14a4 4 0 0 0 6 0M7 18l-1 3"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.5"/>',
    truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    map: '<path d="M9 4l6 2 6-2v14l-6 2-6-2-6 2V6z"/><path d="M9 4v14M15 6v14"/>',
    box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I[n]}</svg>`;

  // ── Almacenamiento local (tolerante a navegadores sin permiso) ─────────
  const guardar = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };
  const leer = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };

  const S = {
    token: leer('m506_token', null),
    mensajero: leer('m506_mensajero', null),
    ruta: null,
    cola: leer('m506_cola', []), // acciones pendientes por falta de señal
    pos: null,
    ultimaPosEnviada: 0,
  };

  let toastT;
  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast show${err ? ' err' : ''}`;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.className = 'toast'), err ? 4500 : 2500);
  }

  class SinSenal extends Error {}
  async function api(method, path, body) {
    let r;
    try {
      r = await fetch(`/v1/app${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(S.token && { Authorization: `Bearer ${S.token}` }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new SinSenal('Sin señal');
    }
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/login') { salir(); throw new Error(data.mensaje || 'Ingresa de nuevo'); }
    if (!r.ok) throw new Error(data.mensaje || 'No se pudo completar');
    return data;
  }

  function salir() {
    S.token = null; S.mensajero = null; S.ruta = null;
    guardar('m506_token', null); guardar('m506_mensajero', null);
    location.hash = '';
    render();
  }

  // ── Cola sin señal ────────────────────────────────────────────────────
  function encolar(accion) {
    S.cola.push({ ...accion, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
    try { guardar('m506_cola', S.cola); } catch { toast('Memoria llena: no se pudo guardar la foto', true); }
  }
  let vaciando = false;
  async function vaciarCola() {
    if (vaciando || !S.cola.length || !S.token) return;
    vaciando = true;
    try {
      for (const a of [...S.cola]) {
        try {
          await api('POST', a.path, a.body);
        } catch (e) {
          if (e instanceof SinSenal) break; // seguimos sin señal: se intenta luego
          toast(`No se pudo enviar ${a.guia}: ${e.message}`, true); // error real: se descarta
        }
        S.cola = S.cola.filter((x) => x.id !== a.id);
        guardar('m506_cola', S.cola);
      }
      if (!S.cola.length) { toast('Entregas pendientes enviadas'); await cargarRuta(true); }
    } finally { vaciando = false; }
  }
  window.addEventListener('online', vaciarCola);
  setInterval(vaciarCola, 30000);

  // ── GPS ───────────────────────────────────────────────────────────────
  let gpsIniciado = false;
  function iniciarGps() {
    if (gpsIniciado || !navigator.geolocation) return;
    gpsIniciado = true;
    navigator.geolocation.watchPosition(
      (p) => {
        S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy };
        if (Date.now() - S.ultimaPosEnviada > 60000) {
          S.ultimaPosEnviada = Date.now();
          api('POST', '/ubicacion', { lat: S.pos.lat, lng: S.pos.lng }).catch(() => {});
        }
        $('#gpsoff')?.classList.add('hidden');
      },
      () => $('#gpsoff')?.classList.remove('hidden'),
      { enableHighAccuracy: true, maximumAge: 20000, timeout: 30000 }
    );
  }

  // ── Datos de la ruta ──────────────────────────────────────────────────
  const pendienteEnCola = (id) => S.cola.find((a) => a.pedido_id === id);
  const estadoVisible = (p) => (pendienteEnCola(p.id) ? pendienteEnCola(p.id).estado_local : p.estado);
  const esPendiente = (p) => ['asignado', 'en_ruta'].includes(estadoVisible(p));

  async function cargarRuta(silencioso) {
    try {
      S.ruta = await api('GET', '/mi-ruta');
      guardar('m506_ruta', S.ruta);
    } catch (e) {
      if (e instanceof SinSenal) { S.ruta = S.ruta || leer('m506_ruta', null); if (!silencioso) toast('Sin señal: mostrando la última ruta guardada', true); }
      else throw e;
    }
  }

  // ── Enrutador simple por hash ─────────────────────────────────────────
  function render() {
    const app = $('#app');
    if (!S.token) return vistaLogin(app);
    iniciarGps();
    const [vista, id] = location.hash.replace(/^#\/?/, '').split('/');
    window.scrollTo(0, 0);
    if (vista === 'parada' && id) return vistaParada(app, id);
    if (vista === 'entregar' && id) return vistaEntregar(app, id);
    if (vista === 'novedad' && id) return vistaNovedad(app, id);
    return vistaRuta(app);
  }
  window.addEventListener('hashchange', render);
  const ir = (h) => { location.hash = h; };
  const buscarParada = (id) => S.ruta?.paradas.find((p) => p.id === id);

  // ── Ingreso ───────────────────────────────────────────────────────────
  function vistaLogin(app) {
    app.innerHTML = `<div class="login">
      <div class="top"><span class="mark">506</span><b>Mensajeros</b></div>
      <h1>Tu ruta,<br><em>en tu mano.</em></h1>
      <p>Ingresa con tu celular y el PIN que te dio el despachador.</p>
      <form novalidate>
        <div class="field"><label for="tel">Celular</label><input id="tel" class="input" type="tel" inputmode="numeric" autocomplete="tel" placeholder="300 123 4567" required></div>
        <div class="field"><label for="pin">PIN</label><input id="pin" class="input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="current-password" placeholder="••••" required></div>
        <div class="err hidden" id="lerr"></div>
        <button class="btn btn-lime" type="submit">Ingresar</button>
      </form></div>`;
    $('form', app).onsubmit = async (e) => {
      e.preventDefault();
      const b = $('button', e.target);
      b.disabled = true; b.innerHTML = '<span class="spin"></span>';
      try {
        const r = await api('POST', '/login', { telefono: $('#tel').value, pin: $('#pin').value });
        S.token = r.token; S.mensajero = r.mensajero;
        guardar('m506_token', r.token); guardar('m506_mensajero', r.mensajero);
        render();
      } catch (ex) {
        $('#lerr').textContent = ex instanceof SinSenal ? 'Sin conexión. Revisa tus datos o el wifi.' : ex.message;
        $('#lerr').classList.remove('hidden');
        b.disabled = false; b.textContent = 'Ingresar';
      }
    };
  }

  // ── Ruta del día ──────────────────────────────────────────────────────
  async function vistaRuta(app) {
    app.innerHTML = `<header class="bar"><span class="mark">506</span><div class="grow"><h1>Mi ruta</h1><div class="sub">${esc(S.mensajero?.nombre)} · ${new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <button class="iconbtn" id="ref" aria-label="Actualizar">${icon('refresh')}</button><button class="iconbtn" id="out" aria-label="Salir">${icon('out')}</button></header>
      <div class="wrap" id="w"><div class="loading"><span class="spin"></span></div></div>`;
    $('#out').onclick = () => { if (confirm('¿Cerrar sesión en este celular?')) salir(); };
    $('#ref').onclick = async () => { $('#w').innerHTML = '<div class="loading"><span class="spin"></span></div>'; await cargarRuta(); pintar(); vaciarCola(); };
    try { await cargarRuta(S.cola.length > 0); } catch (e) { $('#w').innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
    pintar();

    function pintar() {
      const w = $('#w');
      if (!w) return;
      const ps = S.ruta?.paradas || [];
      const pend = ps.filter(esPendiente);
      const hechas = ps.filter((p) => estadoVisible(p) === 'entregado');
      const fallas = ps.filter((p) => ['novedad', 'devuelto'].includes(estadoVisible(p)));
      const viajePlan = (S.ruta?.viajes || []).find((v) => v.estado === 'planificado');
      const sueltosAsignados = pend.filter((p) => p.estado === 'asignado' && !p.orden);
      const cod = pend.reduce((a, p) => a + (p.contra_entrega || 0), 0);
      const recaudado = hechas.reduce((a, p) => a + (p.contra_entrega || 0), 0);

      const tarjeta = (p, i) => {
        const e = estadoVisible(p);
        const cls = e === 'entregado' ? 'done' : ['novedad', 'devuelto'].includes(e) ? 'done fail' : i === 0 ? 'next' : '';
        const chip = pendienteEnCola(p.id) ? '<span class="chip pend">Se enviará con señal</span>'
          : e === 'entregado' ? `<span class="chip ok">Entregado${p.receptor_nombre ? ` a ${esc(p.receptor_nombre)}` : ''}</span>`
          : e === 'novedad' ? '<span class="chip warn">No entregado</span>'
          : e === 'en_ruta' ? '<span class="chip blue">En camino</span>' : '<span class="chip">Por salir</span>';
        return `<button class="stop ${cls}" data-id="${p.id}">
          <span class="num">${e === 'entregado' ? icon('check').replace('<svg', '<svg width="20" height="20"') : esc(p.orden ?? '•')}</span>
          <span class="body"><div class="name">${esc(p.destinatario?.nombre)}</div><div class="addr">${esc(p.entrega?.direccion)}</div>
          <div class="meta">${chip}${p.contra_entrega && esPendiente(p) ? `<span class="chip cod">Cobrar ${COP(p.contra_entrega)}</span>` : ''}${p.paquete?.fragil ? '<span class="chip warn">Frágil</span>' : ''}<span class="chip">${esc(p.zona || '')}</span></div></span></button>`;
      };

      w.innerHTML = `
        <div class="banner off hidden" id="gpsoff">${icon('alert').replace('<svg', '<svg width="20" height="20"')} Activa la ubicación del celular para registrar las entregas.</div>
        ${S.cola.length ? `<div class="banner q">${S.cola.length} entrega(s) guardadas sin señal. Se enviarán solas al recuperar conexión.</div>` : ''}
        <div class="stats"><div class="stat"><b>${pend.length}</b><span>Pendientes</span></div><div class="stat"><b>${hechas.length}</b><span>Entregados</span></div><div class="stat"><b>${fallas.length}</b><span>Novedades</span></div></div>
        ${ps.length ? `<div class="progress"><i style="width:${Math.round(((hechas.length + fallas.length) / ps.length) * 100)}%"></i></div>` : ''}
        ${cod || recaudado ? `<div class="card small" style="display:flex;justify-content:space-between"><span>Por cobrar: <b>${COP(cod)}</b></span><span>Recaudado: <b>${COP(recaudado)}</b></span></div>` : ''}
        ${pend.length ? `<div class="sec-title">Próximas paradas</div>${pend.map(tarjeta).join('')}` : ps.length ? `<div class="card" style="text-align:center"><b>¡Ruta terminada!</b><div class="muted small">No tienes paradas pendientes.</div></div>` : `<div class="empty">${icon('box')}<p><b>No tienes pedidos asignados todavía.</b><br>Cuando el despachador arme tu ruta aparecerán aquí. Toca ↻ para actualizar.</p></div>`}
        ${hechas.length + fallas.length ? `<div class="sec-title">Terminadas</div>${[...hechas, ...fallas].map((p) => tarjeta(p, -1)).join('')}` : ''}`;

      $$('.stop', w).forEach((b) => (b.onclick = () => ir(`#/parada/${b.dataset.id}`)));

      const f = document.createElement('div');
      f.className = 'footer';
      const botones = [];
      if (viajePlan || sueltosAsignados.length) botones.push(`<button class="btn btn-lime" id="salir">${icon('truck')} Salir a ruta</button>`);
      else if (pend.length) botones.push(`<a class="btn btn-navy" id="navall" target="_blank" rel="noopener">${icon('map')} Abrir ruta en Google Maps</a>`);
      if (botones.length) { f.innerHTML = `<div class="footer-in">${botones.join('')}</div>`; w.appendChild(f); }
      const na = $('#navall');
      if (na) {
        const pts = pend.filter((p) => p.lat).slice(0, 10).map((p) => `${p.lat},${p.lng}`);
        const dest = pts.pop();
        na.href = `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${dest}${pts.length ? `&waypoints=${encodeURIComponent(pts.join('|'))}` : ''}`;
      }
      const sb = $('#salir');
      if (sb) sb.onclick = async () => {
        sb.disabled = true; sb.innerHTML = '<span class="spin"></span>';
        try {
          if (viajePlan) await api('POST', `/viajes/${viajePlan.id}/iniciar`);
          for (const p of sueltosAsignados) await api('POST', `/pedidos/${p.id}/en-camino`);
          toast('¡Buena ruta! Los clientes fueron avisados');
          await cargarRuta(true); pintar();
        } catch (e) { toast(e instanceof SinSenal ? 'Sin señal. Intenta de nuevo en un momento.' : e.message, true); sb.disabled = false; sb.innerHTML = `${icon('truck')} Salir a ruta`; }
      };
    }
  }

  // ── Detalle de parada ─────────────────────────────────────────────────
  function vistaParada(app, id) {
    const p = buscarParada(id);
    if (!p) return ir('#/');
    const tel = String(p.destinatario?.telefono || '').replace(/[^\d+]/g, '');
    const wa = tel.replace(/^\+/, '');
    const e = estadoVisible(p);
    const en = p.entrega || {};
    app.innerHTML = `<header class="bar"><button class="back" onclick="history.back()" aria-label="Volver">${icon('back')}</button><div class="grow"><h1>Parada ${esc(p.orden ?? '')}</h1><div class="sub mono">${esc(p.guia_numero)}</div></div></header>
      <div class="wrap">
        ${p.contra_entrega && esPendiente(p) ? `<div class="cod-box">Cobrar al entregar: ${COP(p.contra_entrega)}</div>` : ''}
        <div class="card"><div class="muted small">Entregar a</div><h2>${esc(p.destinatario?.nombre)}</h2>
          <div class="big-addr">${esc(en.direccion)}</div><div class="muted">${esc(en.ciudad)}${p.zona ? ` · ${esc(p.zona)}` : ''}</div>
          ${en.referencia ? `<div class="note"><b>Referencia:</b> ${esc(en.referencia)}</div>` : ''}
          ${en.instrucciones ? `<div class="note"><b>Instrucciones:</b> ${esc(en.instrucciones)}</div>` : ''}
        </div>
        <div class="grid4" style="margin-bottom:12px">
          <a class="act" href="tel:${esc(tel)}">${icon('phone')}Llamar</a>
          <a class="act" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">${icon('chat')}WhatsApp</a>
          <a class="act" href="https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${p.lat},${p.lng}" target="_blank" rel="noopener">${icon('nav')}Maps</a>
          <a class="act" href="https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes" target="_blank" rel="noopener">${icon('waze')}Waze</a>
        </div>
        <div class="card"><dl class="kv"><dt>Paquete</dt><dd>${esc(p.paquete?.descripcion)}${p.paquete?.fragil ? ' · <b>Frágil</b>' : ''}</dd><dt>Peso</dt><dd>${esc(p.paquete?.peso_kg)} kg</dd><dt>Teléfono</dt><dd>${esc(p.destinatario?.telefono)}</dd></dl></div>
        ${e === 'entregado' ? `<div class="card" style="text-align:center"><b style="color:var(--green)">Entregado${p.receptor_nombre ? ` a ${esc(p.receptor_nombre)}` : ''}</b></div>` : ''}
        ${e === 'novedad' ? '<div class="card" style="text-align:center"><b style="color:var(--orange)">Reportado como no entregado</b></div>' : ''}
      </div>
      ${esPendiente(p) ? `<div class="footer"><div class="footer-in"><button class="btn btn-lime" id="ent">${icon('check')} Entregar</button><button class="btn btn-warn btn-sm" id="nov">No se pudo entregar</button></div></div>` : ''}`;
    if ($('#ent')) {
      $('#ent').onclick = () => ir(`#/entregar/${id}`);
      $('#nov').onclick = () => ir(`#/novedad/${id}`);
    }
  }

  // ── Foto: se reduce en el celular antes de enviar (≈150–300 KB) ────────
  function comprimir(file, max = 1280, calidad = 0.72) {
    return new Promise((ok, mal) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL('image/jpeg', calidad));
      };
      img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo leer la foto')); };
      img.src = url;
    });
  }
  function campoFoto(cont, onFoto) {
    cont.innerHTML = `<label class="photo"><div class="ph">${icon('camera')}<div><b>Tomar foto</b></div><div class="small">Del paquete entregado o de la fachada</div></div><input type="file" accept="image/*" capture="environment"></label>`;
    $('input', cont).onchange = async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const data = await comprimir(f);
        onFoto(data);
        $('.photo', cont).innerHTML = `<img src="${data}" alt="Foto tomada"><input type="file" accept="image/*" capture="environment">`;
        $('input', cont).onchange = e.target.onchange;
      } catch (ex) { toast(ex.message, true); }
    };
  }

  // ── Firma táctil ──────────────────────────────────────────────────────
  function campoFirma(cont) {
    cont.innerHTML = '<div class="sign"><canvas></canvas><button type="button" class="clear">Borrar</button><div class="hint">Firma aquí con el dedo</div></div>';
    const cv = $('canvas', cont);
    const ctx = cv.getContext('2d');
    let dibujando = false, trazos = 0;
    const ajustar = () => { const r = cv.getBoundingClientRect(); const d = window.devicePixelRatio || 1; cv.width = r.width * d; cv.height = r.height * d; ctx.scale(d, d); ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0B1F33'; };
    requestAnimationFrame(ajustar);
    const pt = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', (e) => { dibujando = true; cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pt(e)); $('.hint', cont).classList.add('hidden'); });
    cv.addEventListener('pointermove', (e) => { if (!dibujando) return; ctx.lineTo(...pt(e)); ctx.stroke(); trazos++; });
    cv.addEventListener('pointerup', () => { dibujando = false; });
    $('.clear', cont).onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); trazos = 0; $('.hint', cont).classList.remove('hidden'); };
    return () => {
      if (trazos < 5) return null;
      const out = document.createElement('canvas'); // fondo blanco para que se vea en cualquier visor
      out.width = cv.width; out.height = cv.height;
      const o = out.getContext('2d'); o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height); o.drawImage(cv, 0, 0);
      return out.toDataURL('image/png');
    };
  }

  // Envío con respaldo sin señal
  async function enviarOEncolar(p, path, body, estadoLocal, okMsg) {
    try {
      await api('POST', path, body);
      toast(okMsg);
      await cargarRuta(true);
    } catch (e) {
      if (!(e instanceof SinSenal)) throw e;
      encolar({ path, body, pedido_id: p.id, guia: p.guia_numero, estado_local: estadoLocal });
      toast('Sin señal: quedó guardado y se enviará solo');
    }
    ir('#/');
  }

  // ── Entregar ──────────────────────────────────────────────────────────
  function vistaEntregar(app, id) {
    const p = buscarParada(id);
    if (!p || !esPendiente(p)) return ir('#/');
    let foto = null;
    app.innerHTML = `<header class="bar"><button class="back" onclick="history.back()" aria-label="Volver">${icon('back')}</button><div class="grow"><h1>Entregar</h1><div class="sub">${esc(p.destinatario?.nombre)} · <span class="mono">${esc(p.guia_numero)}</span></div></div></header>
      <form class="wrap" novalidate>
        <div class="field"><label>1. Foto de la entrega *</label><div id="foto"></div></div>
        <div class="field"><label for="rec">2. ¿Quién recibe? *</label><input id="rec" class="input" value="${esc(p.destinatario?.nombre)}" autocomplete="off"></div>
        <div class="field"><label>3. Firma de quien recibe (opcional)</label><div id="firma"></div></div>
        ${p.contra_entrega ? `<label class="check"><input type="checkbox" id="cod"><span>Recibí <b>${COP(p.contra_entrega)}</b> del cliente</span></label>` : ''}
        <div class="err hidden" id="err"></div>
        <div class="footer"><div class="footer-in"><button class="btn btn-lime" type="submit">${icon('check')} Confirmar entrega</button></div></div>
      </form>`;
    campoFoto($('#foto'), (d) => (foto = d));
    const firma = campoFirma($('#firma'));
    $('form', app).onsubmit = async (e) => {
      e.preventDefault();
      const err = $('#err');
      const falta = !foto ? 'Toma la foto de la entrega' : !$('#rec').value.trim() ? 'Escribe quién recibe' : p.contra_entrega && !$('#cod').checked ? 'Confirma que recibiste el pago' : null;
      if (falta) { err.textContent = falta; err.classList.remove('hidden'); err.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      const b = $('button[type=submit]', app);
      b.disabled = true; b.innerHTML = '<span class="spin"></span> Enviando…';
      try {
        await enviarOEncolar(p, `/pedidos/${p.id}/entregar`, {
          foto, firma: firma(), receptor_nombre: $('#rec').value.trim(), recaudo_confirmado: Boolean($('#cod')?.checked),
          lat: S.pos?.lat ?? null, lng: S.pos?.lng ?? null, momento: new Date().toISOString(),
        }, 'entregado', '¡Entregado!');
      } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); b.disabled = false; b.innerHTML = `${icon('check')} Confirmar entrega`; }
    };
  }

  // ── No se pudo entregar ───────────────────────────────────────────────
  function vistaNovedad(app, id) {
    const p = buscarParada(id);
    if (!p || !esPendiente(p)) return ir('#/');
    let foto = null;
    app.innerHTML = `<header class="bar"><button class="back" onclick="history.back()" aria-label="Volver">${icon('back')}</button><div class="grow"><h1>No entregado</h1><div class="sub">${esc(p.destinatario?.nombre)} · <span class="mono">${esc(p.guia_numero)}</span></div></div></header>
      <form class="wrap" novalidate>
        <div class="field"><label>¿Qué pasó? *</label><div class="opts">${NOVEDADES.map(([k, t]) => `<label class="opt"><input type="radio" name="tipo" value="${k}">${t}</label>`).join('')}</div></div>
        <div class="field"><label for="desc">Detalle (opcional)</label><textarea id="desc" class="input" placeholder="Ej: la portería no respondió, dejé aviso"></textarea></div>
        <div class="field"><label>Foto (opcional, recomendada)</label><div id="foto"></div></div>
        <div class="err hidden" id="err"></div>
        <div class="footer"><div class="footer-in"><button class="btn btn-navy" type="submit">Reportar</button></div></div>
      </form>`;
    campoFoto($('#foto'), (d) => (foto = d));
    $('form', app).onsubmit = async (e) => {
      e.preventDefault();
      const tipo = $('input[name=tipo]:checked', app)?.value;
      const err = $('#err');
      if (!tipo) { err.textContent = 'Elige qué pasó'; err.classList.remove('hidden'); return; }
      const b = $('button[type=submit]', app);
      b.disabled = true; b.innerHTML = '<span class="spin"></span> Enviando…';
      try {
        await enviarOEncolar(p, `/pedidos/${p.id}/novedad`, { tipo, descripcion: $('#desc').value.trim(), foto, lat: S.pos?.lat ?? null, lng: S.pos?.lng ?? null }, 'novedad', 'Novedad reportada');
      } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); b.disabled = false; b.textContent = 'Reportar'; }
    };
  }

  // Instalación como app
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {});

  render();
  vaciarCola();
})();
