/* Panel TMS — Transportadora 506 */
(() => {
  'use strict';

  // ── Utilidades ───────────────────────────────────────────────
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hoy = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
  const fmtFechaHora = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  const fmtCOP = (v) => `$${Math.round(Number(v) || 0).toLocaleString('es-CO')}`;
  const iniciales = (n) => String(n || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const debounce = (fn, ms = 350) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const ESTADOS = {
    pendiente: ['Pendiente', 'b-gray'],
    guia_generada: ['Por asignar', 'b-blue'],
    reagendado: ['Reagendado', 'b-blue'],
    asignado: ['Asignado', 'b-purple'],
    en_ruta: ['En ruta', 'b-amber'],
    novedad: ['Novedad', 'b-orange'],
    entregado: ['Entregado', 'b-green'],
    devuelto: ['Devuelto', 'b-red'],
    cancelado: ['Cancelado', 'b-gray'],
  };
  const COLOR_ESTADO = { pendiente: '#8a8f9e', guia_generada: '#2438d6', reagendado: '#2438d6', asignado: '#6A4CE0', en_ruta: '#C98A00', novedad: '#E8590C' };
  const NOVEDADES = {
    cliente_ausente: 'Cliente ausente', direccion_incorrecta: 'Dirección incorrecta', rehusado: 'Rehusado por el cliente',
    acceso_restringido: 'Acceso restringido', dano_paquete: 'Paquete dañado', otro: 'Otro',
  };
  const ZONAS = ['Norte', 'Centro', 'Occidente', 'Sur'];
  const VEHICULOS = ['Moto', 'Carry 700 Kg', 'Camioneta', 'Furgón', 'Bicicleta'];
  const SERVICIOS = { estandar: 'Estándar', express: 'Express', same_day: 'Same day' };
  const COLORES_RUTA = ['#2438d6', '#E8590C', '#1f8a4c', '#6A4CE0', '#D93A3A', '#0FA3B1', '#B8960C', '#D6409F', '#12142b', '#1D17A6'];
  const badge = (e) => { const [t, c] = ESTADOS[e] || [e, 'b-gray']; return `<span class="badge ${c}">${esc(t)}</span>`; };

  const I = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
    box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    route: '<circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="5" r="2.2"/><path d="M8.2 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.8"/>',
    store: '<path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6"/>',
    warehouse: '<path d="M3 21V9l9-5 9 5v12M7 21v-8h10v8M7 17h10"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.6c2.6.3 4.4 2 5 5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
    star: '<path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${I[n]}</svg>`;

  // ── Estado y API ────────────────────────────────────────────
  const S = {
    token: null, usuario: null, conductores: null, timers: [],
    get esAdmin() { return this.usuario?.rol === 'admin'; },
  };
  try { S.token = localStorage.getItem('tms506_token'); S.usuario = JSON.parse(localStorage.getItem('tms506_usuario') || 'null'); } catch { /* sin almacenamiento */ }

  function guardarSesion(token, usuario) {
    S.token = token; S.usuario = usuario;
    try { localStorage.setItem('tms506_token', token); localStorage.setItem('tms506_usuario', JSON.stringify(usuario)); } catch { /* */ }
  }
  function cerrarSesion() {
    S.token = null; S.usuario = null; S.conductores = null;
    try { localStorage.removeItem('tms506_token'); localStorage.removeItem('tms506_usuario'); } catch { /* */ }
    location.hash = '#/login';
    render();
  }

  async function api(method, path, body) {
    const r = await fetch(`/v1/admin${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(S.token && { Authorization: `Bearer ${S.token}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/login') { cerrarSesion(); throw new Error('Tu sesión venció'); }
    if (!r.ok) {
      const det = Array.isArray(data.detalle) ? `: ${data.detalle.join('; ')}` : '';
      throw new Error((data.mensaje || 'Error inesperado') + det);
    }
    return data;
  }

  async function conductores(forzar) {
    if (!S.conductores || forzar) S.conductores = await api('GET', '/conductores');
    return S.conductores;
  }

  let toastT;
  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast show${err ? ' err' : ''}`;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.className = 'toast'), err ? 5000 : 2600);
  }
  const fallo = (e) => toast(e.message || String(e), true);

  async function conBoton(btn, fn) {
    const txt = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try { return await fn(); } catch (e) { fallo(e); } finally { btn.disabled = false; btn.innerHTML = txt; }
  }

  function copiar(texto) {
    navigator.clipboard?.writeText(texto).then(() => toast('Copiado'), () => toast('No se pudo copiar', true));
  }

  // ── Modales y panel lateral ─────────────────────────────────
  function abrirCapa(html, { tipo = 'modal' } = {}) {
    const ov = document.createElement('div');
    ov.className = `overlay${tipo === 'modal' ? ' center' : ''}`;
    ov.innerHTML = `<div class="${tipo}">${html}</div>`;
    const cerrar = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') cerrar(); };
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) cerrar(); });
    ov.addEventListener('click', (e) => { if (e.target.closest('[data-cerrar]')) cerrar(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    return { el: ov, cerrar };
  }
  const cabecera = (titulo, sub = '') => `<div class="modal-head"><div class="grow"><h2>${titulo}</h2>${sub ? `<div class="muted small">${sub}</div>` : ''}</div><button class="btn icon-btn" data-cerrar aria-label="Cerrar">${icon('x')}</button></div>`;

  function confirmar(titulo, texto, { boton = 'Confirmar', peligro } = {}) {
    return new Promise((ok) => {
      const m = abrirCapa(`${cabecera(titulo)}<div class="modal-body">${texto}</div>
        <div class="modal-foot"><button class="btn" data-no>Volver</button><button class="btn ${peligro ? 'btn-danger' : 'btn-primary'}" data-si>${boton}</button></div>`);
      $('[data-si]', m.el).onclick = () => { m.cerrar(); ok(true); };
      $('[data-no]', m.el).onclick = () => { m.cerrar(); ok(false); };
    });
  }

  // ── Enrutador ───────────────────────────────────────────────
  const RUTAS = {
    resumen: { titulo: 'Resumen', sub: 'Tu operación de hoy', icono: 'home', fn: vistaResumen },
    monitoreo: { titulo: 'Monitoreo', sub: 'Pedidos activos en el mapa', icono: 'radar', fn: vistaMonitoreo },
    ordenes: { titulo: 'Órdenes', sub: 'Todos los pedidos', icono: 'box', fn: vistaOrdenes },
    'nueva-orden': { titulo: 'Nueva orden', sub: 'Crear un pedido manualmente', icono: 'plus', fn: vistaNuevaOrden },
    rutero: { titulo: 'Rutero', sub: 'Planificación de rutas del día', icono: 'route', fn: vistaRutero },
    mensajeros: { titulo: 'Mensajeros', sub: 'Flota y conductores', icono: 'truck', fn: vistaMensajeros },
    sellers: { titulo: 'Sellers', sub: 'Clientes conectados por API', icono: 'store', fn: vistaSellers },
    bodegas: { titulo: 'Bodegas', sub: 'Puntos de salida de las rutas', icono: 'warehouse', fn: vistaBodegas },
    usuarios: { titulo: 'Usuarios', sub: 'Acceso al panel', icono: 'users', fn: vistaUsuarios, admin: true },
  };
  const MENU = [
    ['Operación', ['resumen', 'monitoreo', 'ordenes', 'rutero']],
    ['Configuración', ['mensajeros', 'sellers', 'bodegas', 'usuarios']],
  ];

  function rutaActual() {
    const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
    return { nombre: path || 'resumen', params: new URLSearchParams(qs || '') };
  }

  function render() {
    S.timers.forEach(clearInterval);
    S.timers = [];
    const app = $('#app');
    if (!S.token) return vistaLogin(app);
    const { nombre, params } = rutaActual();
    if (nombre === 'login') { location.hash = '#/resumen'; return; }
    const ruta = RUTAS[nombre] && (!RUTAS[nombre].admin || S.esAdmin) ? RUTAS[nombre] : RUTAS.resumen;
    if (!$('.layout', app)) montarEstructura(app);
    $$('.nav a[data-r]').forEach((a) => a.classList.toggle('active', a.dataset.r === (RUTAS[nombre] ? nombre : 'resumen')));
    $('.topbar h1').textContent = ruta.titulo;
    $('.topbar .sub').textContent = ruta.sub;
    $('.sidebar').classList.remove('open');
    const c = $('.content');
    c.innerHTML = '<div class="loading"><span class="spinner"></span> Cargando…</div>';
    window.scrollTo(0, 0);
    Promise.resolve(ruta.fn(c, params)).catch((e) => { c.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; });
  }
  window.addEventListener('hashchange', render);

  function montarEstructura(app) {
    const u = S.usuario;
    const nav = MENU.map(([sec, items]) => `<div class="nav-sec">${sec}</div>` + items
      .filter((k) => !RUTAS[k].admin || S.esAdmin)
      .map((k) => `<a href="#/${k}" data-r="${k}">${icon(RUTAS[k].icono)}<span>${RUTAS[k].titulo}</span></a>`).join('')).join('');
    app.innerHTML = `
      <div class="layout">
        <aside class="sidebar">
          <div class="brand"><img class="brand-logo" src="/brand/logo-506-blanco.svg" alt="506 Logistics"><span class="tag-tms">TMS</span></div>
          <div class="nav-cta"><a href="#/nueva-orden" class="btn btn-lime btn-block">${icon('plus')} Nueva orden</a></div>
          <nav class="nav">${nav}</nav>
          <div class="sidebar-foot">506 Logistics · TMS v1.0</div>
        </aside>
        <div class="main">
          <header class="topbar">
            <button class="menu-btn" aria-label="Menú">${icon('menu').replace('<svg', '<svg width="24" height="24"')}</button>
            <div><h1></h1><div class="sub"></div></div>
            <div class="spacer"></div>
            <div class="user-wrap">
              <button class="user-chip" aria-haspopup="true" aria-expanded="false">
                <span class="avatar">${esc(iniciales(u.nombre))}</span>
                <span class="uname"><b>${esc(u.nombre)}</b><br><span class="muted small">${u.rol === 'admin' ? 'Administrador' : 'Despachador'}</span></span>
              </button>
              <div class="user-menu" role="menu">
                <button data-pass role="menuitem">Cambiar contraseña</button>
                <button data-salir role="menuitem">Cerrar sesión</button>
              </div>
            </div>
          </header>
          <main class="content"></main>
        </div>
      </div>`;
    $('.menu-btn', app).onclick = () => $('.sidebar').classList.toggle('open');
    const chip = $('.user-chip', app);
    chip.onclick = (e) => { e.stopPropagation(); const m = $('.user-menu', app); m.classList.toggle('open'); chip.setAttribute('aria-expanded', m.classList.contains('open')); };
    document.addEventListener('click', () => $('.user-menu')?.classList.remove('open'));
    $('[data-salir]', app).onclick = cerrarSesion;
    $('[data-pass]', app).onclick = modalCambiarPassword;
  }

  // ── Login ───────────────────────────────────────────────────
  function vistaLogin(app) {
    app.innerHTML = `
      <div class="login">
        <div class="login-art">
          <div class="brand" style="padding:0"><img class="brand-logo" src="/brand/logo-506-blanco.svg" alt="506 Logistics" style="height:42px"><span class="tag-tms">TMS</span></div>
          <div><h2>Cada pedido,<br><em>en su ruta.</em></h2><p>Recibe los pedidos de tus clientes, genera las guías, arma las rutas del día y sigue cada entrega desde un solo lugar.</p></div>
          <div class="small" style="color:#6d73a8">© 506 Logistics S.A.S · Tecnología y logística para empresas</div>
          <div class="stripes"></div>
        </div>
        <div class="login-form">
          <form novalidate>
            <div><h1>Iniciar sesión</h1><p class="muted">Panel de operación del TMS</p></div>
            <div class="field"><label for="le">Correo</label><input id="le" class="input" type="email" autocomplete="username" required></div>
            <div class="field"><label for="lp">Contraseña</label><input id="lp" class="input" type="password" autocomplete="current-password" required></div>
            <div class="alert alert-err hidden" id="lerr"></div>
            <button class="btn btn-primary btn-block" type="submit">Entrar</button>
          </form>
        </div>
      </div>`;
    const f = $('form', app);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const err = $('#lerr');
      err.classList.add('hidden');
      await conBoton($('button[type=submit]', f), async () => {
        try {
          const r = await api('POST', '/login', { email: $('#le').value, password: $('#lp').value });
          guardarSesion(r.token, r.usuario);
          location.hash = '#/resumen';
          render();
        } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
      });
    };
    $('#le').focus();
  }

  function modalCambiarPassword() {
    const m = abrirCapa(`${cabecera('Cambiar contraseña')}
      <form><div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
        <div class="field"><label>Contraseña actual</label><input class="input" type="password" name="actual" autocomplete="current-password" required></div>
        <div class="field"><label>Nueva contraseña (mínimo 8 caracteres)</label><input class="input" type="password" name="nueva" autocomplete="new-password" minlength="8" required></div>
      </div><div class="modal-foot"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn-primary">Guardar</button></div></form>`);
    $('form', m.el).onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      await conBoton($('.btn-primary', m.el), async () => { await api('PUT', '/me/password', d); m.cerrar(); toast('Contraseña actualizada'); });
    };
  }

  // ── Resumen ─────────────────────────────────────────────────
  async function vistaResumen(c) {
    const r = await api('GET', '/resumen');
    const a = r.activos;
    const kpi = (lbl, val, hint, href, alerta) => `<a class="card kpi${alerta && val ? ' alert' : ''}" href="${href}" style="text-decoration:none;color:inherit">
      <div class="lbl">${lbl}</div><div class="val">${val}</div><div class="hint">${hint}</div></a>`;
    const zonas = Object.entries(r.por_zona).sort((x, y) => y[1] - x[1]);
    const max = Math.max(1, ...zonas.map((z) => z[1]));
    c.innerHTML = `
      <div class="kpis">
        ${kpi('Por asignar', a.sin_asignar, 'Esperando ruta', '#/ordenes?estado=guia_generada,reagendado', true)}
        ${kpi('Asignados', a.asignados, 'Con mensajero', '#/ordenes?estado=asignado')}
        ${kpi('En ruta', a.en_ruta, 'Saliendo a entregar', '#/ordenes?estado=en_ruta')}
        ${kpi('Entregados hoy', r.hoy.entregados, `${r.hoy.devueltos} devueltos`, '#/ordenes?estado=entregado')}
        ${kpi('Novedades', a.novedades, 'Requieren acción', '#/ordenes?estado=novedad', true)}
        ${kpi('Revisar dirección', a.requieren_revision, 'Google no fue exacto', '#/ordenes?revision=true', true)}
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-head"><h3>Pedidos activos por zona</h3><span class="grow"></span><span class="muted small">${a.total} activos</span></div>
          <div class="card-pad">${zonas.length ? `<div class="bars">${zonas.map(([z, n]) => `<div class="bar-row"><span>${esc(z)}</span><div class="bar"><i style="width:${(n / max) * 100}%"></i></div><b class="num">${n}</b></div>`).join('')}</div>` : '<div class="empty">No hay pedidos activos</div>'}</div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Rutas de hoy</h3><span class="grow"></span><a class="btn btn-sm" href="#/rutero">Abrir rutero</a></div>
          ${r.viajes.filter((v) => v.estado !== 'cancelado').length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Mensajero</th><th>Paradas</th><th>Km</th><th>Estado</th></tr></thead><tbody>
            ${r.viajes.filter((v) => v.estado !== 'cancelado').map((v) => `<tr><td>${esc(v.conductor || '—')}</td><td>${v.paradas ?? '—'}</td><td>${v.km ?? '—'}</td><td>${badgeViaje(v.estado)}</td></tr>`).join('')}
          </tbody></table></div>` : `<div class="empty">Aún no hay rutas para hoy.<br><br><a class="btn btn-primary" href="#/rutero">${icon('route')} Planificar rutas</a></div>`}
        </div>
      </div>
      <p class="muted small" style="margin-top:14px">${r.mensajeros_activos} mensajeros activos · Actualizado ${fmtFechaHora(new Date().toISOString())}</p>`;
    S.timers.push(setInterval(() => { if (rutaActual().nombre === 'resumen') vistaResumen(c).catch(() => {}); }, 60000));
  }
  const badgeViaje = (e) => ({ planificado: '<span class="badge b-blue">Planificado</span>', en_curso: '<span class="badge b-amber">En curso</span>', finalizado: '<span class="badge b-green">Finalizado</span>', cancelado: '<span class="badge b-gray">Deshecho</span>' }[e] || esc(e));

  // ── Mapas ───────────────────────────────────────────────────
  function crearMapa(el, centro) {
    const m = L.map(el, { zoomControl: true }).setView([centro.lat, centro.lng], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m);
    setTimeout(() => m.invalidateSize(), 50);
    return m;
  }
  const marcadorBodega = (d) => L.marker([d.lat, d.lng], { icon: L.divIcon({ className: '', html: '<div class="pin-depot">506</div>', iconSize: [30, 30], iconAnchor: [15, 15] }) }).bindTooltip(esc(d.nombre || 'Bodega'));
  const marcadorNumero = (lat, lng, n, color) => L.marker([lat, lng], { icon: L.divIcon({ className: '', html: `<div class="pin" style="background:${color}"><b>${n}</b></div>`, iconSize: [26, 26], iconAnchor: [13, 26] }) });

  async function vistaMonitoreo(c) {
    c.innerHTML = `<div class="card">
      <div class="card-head"><div class="legend">
        ${[['Por asignar', 'guia_generada'], ['Asignado', 'asignado'], ['En ruta', 'en_ruta'], ['Novedad', 'novedad']].map(([t, k]) => `<span><i class="dot" style="background:${COLOR_ESTADO[k]}"></i>${t}</span>`).join('')}
        <span><i class="dot" style="background:#fff;border:2px solid #FF7A1A"></i>Revisar dirección</span>
      </div><span class="grow"></span><span class="muted small" id="mcount"></span><button class="btn btn-sm" id="mref">${icon('refresh')} Actualizar</button></div>
      <div id="mapa" class="map map-lg"></div></div>
      <p class="muted small" style="margin-top:10px">Los mensajeros aparecen en el mapa mientras tienen la app abierta (última ubicación de las 2 horas recientes).</p>`;
    const d = await api('GET', '/mapa');
    const mapa = crearMapa($('#mapa'), d.deposito);
    const capa = L.layerGroup().addTo(mapa);
    const pintar = (datos) => {
      capa.clearLayers();
      marcadorBodega(datos.deposito).addTo(capa);
      const pts = [[datos.deposito.lat, datos.deposito.lng]];
      for (const p of datos.pedidos) {
        const lat = Number(p.lat), lng = Number(p.lng);
        pts.push([lat, lng]);
        L.circleMarker([lat, lng], {
          radius: 8, weight: p.requiere_revision ? 3 : 2, color: p.requiere_revision ? '#FF7A1A' : '#fff',
          fillColor: COLOR_ESTADO[p.estado] || '#8796A8', fillOpacity: 0.95,
        }).bindPopup(`<b>${esc(p.guia_numero)}</b><br>${esc(p.destinatario_nombre)}<br>${esc(p.direccion)}<br>${badge(p.estado)}${p.conductor ? `<br>🚚 ${esc(p.conductor)}` : ''}<br><a href="#/ordenes?id=${p.id}">Ver orden</a>`).addTo(capa);
      }
      for (const m of datos.mensajeros || []) {
        pts.push([m.lat, m.lng]);
        L.marker([m.lat, m.lng], { icon: L.divIcon({ className: '', html: `<div class="pin-moto" title="${esc(m.nombre)}">🚚<b>${esc(m.nombre)}</b></div>`, iconSize: [90, 28], iconAnchor: [14, 14] }), zIndexOffset: 1000 })
          .bindPopup(`<b>${esc(m.nombre)}</b><br>Última ubicación: ${fmtFechaHora(m.actualizado_en)}`).addTo(capa);
      }
      $('#mcount').textContent = `${datos.pedidos.length} pedidos activos · ${(datos.mensajeros || []).length} mensajeros con GPS`;
      if (pts.length > 1) mapa.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
    };
    pintar(d);
    $('#mref').onclick = (e) => conBoton(e.currentTarget, async () => pintar(await api('GET', '/mapa')));
    S.timers.push(setInterval(async () => { if (rutaActual().nombre === 'monitoreo') pintar(await api('GET', '/mapa').catch(() => d)); }, 60000));
  }

  // ── Órdenes ─────────────────────────────────────────────────
  const F = { q: '', estado: '', zona: '', conductor_id: '', desde: '', hasta: '', revision: '', pagina: 1 };
  const seleccion = new Set();

  async function vistaOrdenes(c, params) {
    for (const k of ['estado', 'revision', 'zona']) if (params.has(k)) { Object.assign(F, { q: '', estado: '', zona: '', conductor_id: '', desde: '', hasta: '', revision: '', pagina: 1 }); break; }
    for (const [k, v] of params) if (k in F) F[k] = v;
    seleccion.clear();
    const cs = await conductores();
    const opcEstado = [['', 'Todos los estados'], ['guia_generada,reagendado', 'Por asignar'], ['asignado', 'Asignado'], ['en_ruta', 'En ruta'], ['novedad', 'Novedad'], ['entregado', 'Entregado'], ['devuelto', 'Devuelto'], ['cancelado', 'Cancelado']];
    c.innerHTML = `
      <div class="card">
        <div class="card-head" style="flex-wrap:wrap">
          <div class="input-search grow" style="min-width:220px">${icon('search')}<input class="input" id="fq" placeholder="Buscar guía, pedido, destinatario o dirección" value="${esc(F.q)}"></div>
          <select class="input" id="fe" style="width:auto">${opcEstado.map(([v, t]) => `<option value="${v}" ${F.estado === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <select class="input" id="fz" style="width:auto"><option value="">Todas las zonas</option>${ZONAS.map((z) => `<option ${F.zona === z ? 'selected' : ''}>${z}</option>`).join('')}</select>
          <select class="input" id="fc" style="width:auto"><option value="">Todos los mensajeros</option>${cs.map((m) => `<option value="${m.id}" ${F.conductor_id === m.id ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('')}</select>
          <input class="input" type="date" id="fd" value="${F.desde}" title="Creados desde" style="width:auto">
          <input class="input" type="date" id="fh" value="${F.hasta}" title="Creados hasta" style="width:auto">
          <label class="check"><input type="checkbox" id="fr" ${F.revision === 'true' ? 'checked' : ''}> Revisar dirección</label>
        </div>
        <div class="bulkbar hidden" id="bulk"><b id="bulkn"></b><select class="input" id="bulkc" style="width:auto"><option value="">Asignar a mensajero…</option>${cs.filter((m) => m.activo).map((m) => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('')}</select><button class="btn btn-primary btn-sm" id="bulkgo">Asignar</button><button class="btn btn-sm" id="bulkx">Quitar selección</button></div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th style="width:36px"><input type="checkbox" id="selall" aria-label="Seleccionar todo"></th><th>Guía</th><th>Destinatario</th><th>Dirección</th><th>Zona</th><th>Mensajero</th><th>Estado</th><th>Seller</th><th>Creada</th>
        </tr></thead><tbody id="tb"></tbody></table></div>
        <div class="pager" id="pg"></div>
      </div>`;
    const recargar = async () => {
      const qs = new URLSearchParams(Object.entries({ ...F, limite: 50 }).filter(([, v]) => v !== '' && v !== null));
      const tb = $('#tb');
      tb.innerHTML = '<tr><td colspan="9"><div class="loading"><span class="spinner"></span></div></td></tr>';
      const r = await api('GET', `/pedidos?${qs}`);
      tb.innerHTML = r.filas.length ? r.filas.map((p) => `
        <tr class="clickable" data-id="${p.id}">
          <td onclick="event.stopPropagation()"><input type="checkbox" class="sel" value="${p.id}" ${seleccion.has(p.id) ? 'checked' : ''} aria-label="Seleccionar"></td>
          <td><b class="mono">${esc(p.guia_numero)}</b><div class="muted small">${esc(p.pedido_oms_id)}</div></td>
          <td>${esc(p.destinatario_nombre)}<div class="muted small">${esc(p.destinatario_telefono)}</div></td>
          <td style="max-width:260px">${esc(p.direccion)}<div class="muted small">${esc(p.ciudad)} ${p.requiere_revision ? '<span class="tag tag-warn">Revisar</span>' : ''}</div></td>
          <td>${esc(p.zona || '—')}</td>
          <td>${esc(p.conductor?.nombre || '—')}</td>
          <td>${badge(p.estado)}${p.novedad_tipo && p.estado === 'novedad' ? `<div class="muted small">${esc(NOVEDADES[p.novedad_tipo])}</div>` : ''}</td>
          <td class="small">${esc(p.cliente?.cliente_nombre || '—')}</td>
          <td class="small muted">${fmtFechaHora(p.creada_en)}</td>
        </tr>`).join('') : '<tr><td colspan="9"><div class="empty">No hay órdenes con estos filtros</div></td></tr>';
      const paginas = Math.max(1, Math.ceil(r.total / r.limite));
      $('#pg').innerHTML = `<span>${r.total} órdenes</span><button class="btn btn-sm" ${F.pagina <= 1 ? 'disabled' : ''} data-p="-1">Anterior</button><span>Página ${F.pagina} de ${paginas}</span><button class="btn btn-sm" ${F.pagina >= paginas ? 'disabled' : ''} data-p="1">Siguiente</button>`;
      $$('#pg [data-p]').forEach((b) => (b.onclick = () => { F.pagina += Number(b.dataset.p); recargar().catch(fallo); }));
      $$('#tb tr[data-id]').forEach((tr) => (tr.onclick = () => abrirPedido(tr.dataset.id, recargar)));
      $$('#tb .sel').forEach((cb) => (cb.onchange = () => { cb.checked ? seleccion.add(cb.value) : seleccion.delete(cb.value); pintarBulk(); }));
      $('#selall').checked = false;
    };
    const pintarBulk = () => { $('#bulk').classList.toggle('hidden', !seleccion.size); $('#bulkn').textContent = `${seleccion.size} seleccionadas`; };
    const cambiar = (k, v) => { F[k] = v; F.pagina = 1; recargar().catch(fallo); };
    $('#fq').oninput = debounce((e) => cambiar('q', e.target.value.trim()));
    $('#fe').onchange = (e) => cambiar('estado', e.target.value);
    $('#fz').onchange = (e) => cambiar('zona', e.target.value);
    $('#fc').onchange = (e) => cambiar('conductor_id', e.target.value);
    $('#fd').onchange = (e) => cambiar('desde', e.target.value);
    $('#fh').onchange = (e) => cambiar('hasta', e.target.value);
    $('#fr').onchange = (e) => cambiar('revision', e.target.checked ? 'true' : '');
    $('#selall').onchange = (e) => { $$('#tb .sel').forEach((cb) => { cb.checked = e.target.checked; e.target.checked ? seleccion.add(cb.value) : seleccion.delete(cb.value); }); pintarBulk(); };
    $('#bulkx').onclick = () => { seleccion.clear(); $$('#tb .sel').forEach((cb) => (cb.checked = false)); pintarBulk(); };
    $('#bulkgo').onclick = (e) => conBoton(e.currentTarget, async () => {
      const cid = $('#bulkc').value;
      if (!cid) return toast('Elige un mensajero', true);
      let ok = 0; const errs = [];
      for (const id of seleccion) {
        try { await api('POST', `/pedidos/${id}/accion`, { accion: 'asignar', conductor_id: cid }); ok++; } catch (ex) { errs.push(ex.message); }
      }
      seleccion.clear(); pintarBulk();
      toast(errs.length ? `${ok} asignadas · ${errs.length} no se pudieron (${errs[0]})` : `${ok} órdenes asignadas`, errs.length > 0);
      await recargar();
    });
    await recargar();
    if (params.get('id')) abrirPedido(params.get('id'), recargar);
  }

  async function abrirPedido(id, alCambiar) {
    const d = abrirCapa('<div class="loading"><span class="spinner"></span> Cargando…</div>', { tipo: 'drawer' });
    const cs = await conductores();
    const pintar = async () => {
      const p = await api('GET', `/pedidos/${id}`);
      const dest = p.destinatario || {}, en = p.entrega || {}, pq = p.paquete || {}, sv = p.servicio || {};
      const asignable = ['guia_generada', 'reagendado', 'asignado', 'novedad'].includes(p.estado);
      const activos = cs.filter((m) => m.activo);
      const acciones = [];
      if (asignable) acciones.push(`<div class="row"><select class="input grow" id="asig"><option value="">Asignar mensajero…</option>${activos.map((m) => `<option value="${m.id}" ${m.id === p.conductor_id ? 'selected' : ''}>${esc(m.nombre)}${m.zona ? ` · ${esc(m.zona)}` : ''}</option>`).join('')}</select><button class="btn btn-primary" data-a="asignar">Asignar</button></div>`);
      const fila = [];
      if (p.estado === 'asignado') fila.push(`<button class="btn" data-a="en_ruta">${icon('truck')} Despachar</button>`, '<button class="btn" data-a="desasignar">Quitar mensajero</button>');
      if (['asignado', 'en_ruta'].includes(p.estado)) fila.push('<button class="btn" data-a="entregado">✓ Marcar entregado</button>', '<button class="btn" data-a="novedad">Reportar novedad</button>');
      if (['en_ruta', 'novedad', 'reagendado'].includes(p.estado)) fila.push('<button class="btn" data-a="liberar">Devolver a por asignar</button>');
      if (['pendiente', 'guia_generada', 'asignado', 'reagendado'].includes(p.estado)) fila.push('<button class="btn btn-danger" data-a="cancelar">Cancelar orden</button>');
      if (fila.length) acciones.push(`<div class="row">${fila.join('')}</div>`);
      d.el.querySelector('.drawer').innerHTML = `
        <div class="drawer-head"><div class="grow"><div class="muted small">Guía</div><h2 class="mono" style="font-size:20px">${esc(p.guia_numero)}</h2>
          <div class="row" style="margin-top:6px">${badge(p.estado)}<span class="tag">${esc(SERVICIOS[sv.tipo] || sv.tipo)}</span>${p.zona ? `<span class="tag">${esc(p.zona)}</span>` : ''}${p.requiere_revision ? '<span class="tag tag-warn">Revisar dirección</span>' : ''}</div></div>
          <a class="btn btn-sm" href="${esc(p.pdf_url)}" target="_blank" rel="noopener">${icon('file')} Guía PDF</a>
          <button class="btn icon-btn" data-cerrar aria-label="Cerrar">${icon('x')}</button></div>
        <div class="drawer-body">
          ${acciones.length ? `<div class="sec"><h4>Acciones</h4><div class="actions-box">${acciones.join('')}</div></div>` : ''}
          ${p.estado === 'novedad' && p.novedad_tipo ? `<div class="alert alert-warn sec"><b>Novedad:</b> ${esc(NOVEDADES[p.novedad_tipo])}${p.novedad_descripcion ? ` — ${esc(p.novedad_descripcion)}` : ''}${p.novedad_accion ? `<br><span class="small">Acción automática: ${esc(p.novedad_accion.replace(/_/g, ' '))}</span>` : ''}</div>` : ''}
          <div class="sec"><h4>Destinatario</h4><dl class="kv">
            <dt>Nombre</dt><dd>${esc(dest.nombre)}</dd><dt>Teléfono</dt><dd><a href="tel:${esc(dest.telefono)}">${esc(dest.telefono)}</a></dd>
            <dt>Dirección</dt><dd>${esc(en.direccion)}, ${esc(en.ciudad)}<div class="muted small">Google: ${esc(en.direccion_formateada || '—')}</div></dd>
            ${en.referencia ? `<dt>Referencia</dt><dd>${esc(en.referencia)}</dd>` : ''}${en.instrucciones ? `<dt>Instrucciones</dt><dd>${esc(en.instrucciones)}</dd>` : ''}
          </dl>
          <details style="margin-top:10px" ${p.requiere_revision ? 'open' : ''}><summary class="small" style="cursor:pointer;font-weight:600">Corregir dirección</summary>
            <div class="grid-2" style="margin-top:10px"><input class="input span-2" id="cdir" value="${esc(en.direccion)}"><input class="input" id="cciu" value="${esc(en.ciudad)}"><div class="row"><button class="btn btn-sm" id="cgo">Ubicar de nuevo</button>${p.requiere_revision ? '<button class="btn btn-sm" data-a="revisado">Está bien así</button>' : ''}</div></div>
          </details></div>
          <div class="sec"><h4>Paquete y servicio</h4><dl class="kv">
            <dt>Contenido</dt><dd>${esc(pq.descripcion)}${pq.fragil ? ' · <b>Frágil</b>' : ''}</dd>
            <dt>Peso / medidas</dt><dd>${esc(pq.peso_kg)} kg · ${esc(pq.largo_cm)}×${esc(pq.ancho_cm)}×${esc(pq.alto_cm)} cm</dd>
            <dt>Valor declarado</dt><dd>${fmtCOP(pq.valor_declarado)}</dd>
            ${sv.contra_entrega ? `<dt>Contra entrega</dt><dd><b>${fmtCOP(sv.valor_recaudo)}</b></dd>` : ''}
            <dt>Tarifa</dt><dd>${p.tarifa ? fmtCOP(p.tarifa.valor) : '—'}</dd>
            <dt>Entrega estimada</dt><dd>${esc(p.fecha_programada || p.eta?.fecha_estimada || '—')}</dd>
            <dt>Mensajero</dt><dd>${esc(p.conductor?.nombre || '—')}</dd>
            <dt>Pedido del cliente</dt><dd class="mono">${esc(p.pedido_oms_id)}</dd>
            <dt>Rastreo</dt><dd><a href="${esc(p.tracking_url)}" target="_blank" rel="noopener">Abrir página pública</a></dd>
            ${p.receptor_nombre ? `<dt>Recibió</dt><dd>${esc(p.receptor_nombre)}</dd>` : ''}
            ${p.entregado_en ? `<dt>Entregado</dt><dd>${fmtFechaHora(p.entregado_en)}${p.recaudo_confirmado ? ' · <b>recaudo confirmado</b>' : ''}</dd>` : ''}
          </dl>
          ${p.evidencia_foto_url || p.evidencia_firma_url || p.novedad_foto_url ? `<div class="row" style="margin-top:12px;align-items:flex-start">
            ${p.evidencia_foto_url ? `<a href="${esc(p.evidencia_foto_url)}" target="_blank" rel="noopener"><img src="${esc(p.evidencia_foto_url)}" alt="Foto de entrega" style="width:150px;height:150px;object-fit:cover;border-radius:10px;border:1px solid var(--line)"></a>` : ''}
            ${p.evidencia_firma_url ? `<a href="${esc(p.evidencia_firma_url)}" target="_blank" rel="noopener"><img src="${esc(p.evidencia_firma_url)}" alt="Firma" style="width:150px;height:150px;object-fit:contain;border-radius:10px;border:1px solid var(--line);background:#fff"></a>` : ''}
            ${p.novedad_foto_url ? `<a href="${esc(p.novedad_foto_url)}" target="_blank" rel="noopener"><img src="${esc(p.novedad_foto_url)}" alt="Foto de la novedad" style="width:150px;height:150px;object-fit:cover;border-radius:10px;border:1px solid var(--line)"></a>` : ''}
          </div>` : ''}
          <dl class="kv" style="display:none">
          </dl></div>
          <div class="sec"><h4>Historial</h4><ul class="timeline">${(p.historial || []).slice().reverse().map((h) => `<li><b>${esc((ESTADOS[h.estado] || [h.estado])[0])}</b><div class="muted small">${fmtFechaHora(h.creado_en)}</div></li>`).join('') || '<li class="muted">Sin eventos</li>'}</ul></div>
        </div>`;
      const accion = async (btn, body) => conBoton(btn, async () => {
        await api('POST', `/pedidos/${id}/accion`, body);
        toast('Orden actualizada');
        await pintar();
        alCambiar?.();
      });
      $$('[data-a]', d.el).forEach((b) => (b.onclick = async () => {
        const a = b.dataset.a;
        if (a === 'asignar') {
          const cid = $('#asig', d.el).value;
          if (!cid) return toast('Elige un mensajero', true);
          return accion(b, { accion: 'asignar', conductor_id: cid });
        }
        if (a === 'liberar' && !(await confirmar('Devolver a por asignar', 'El pedido sale de la ruta y del celular del mensajero, y queda listo para una nueva ruta.', { boton: 'Devolver' }))) return;
        if (a === 'cancelar' && !(await confirmar('Cancelar orden', `La guía <b>${esc(p.guia_numero)}</b> quedará anulada y se avisará al cliente.`, { boton: 'Cancelar orden', peligro: true }))) return;
        if (a === 'entregado') return modalEntrega(p, (body) => accion(b, body));
        if (a === 'novedad') return modalNovedad(p, (body) => accion(b, body));
        accion(b, { accion: a });
      }));
      const cgo = $('#cgo', d.el);
      if (cgo) cgo.onclick = () => conBoton(cgo, async () => {
        await api('POST', `/pedidos/${id}/direccion`, { direccion: $('#cdir', d.el).value, ciudad: $('#cciu', d.el).value });
        toast('Dirección ubicada de nuevo');
        await pintar(); alCambiar?.();
      });
    };
    pintar().catch((e) => { d.el.querySelector('.drawer').innerHTML = `${cabecera('Error')}<div class="drawer-body"><div class="alert alert-err">${esc(e.message)}</div></div>`; });
  }

  function modalEntrega(p, enviar) {
    const m = abrirCapa(`${cabecera('Marcar como entregado', esc(p.guia_numero))}<form><div class="modal-body">
      <div class="field"><label>¿Quién recibió?</label><input class="input" name="receptor_nombre" placeholder="Nombre de quien recibe" value="${esc(p.destinatario?.nombre)}"></div>
      <p class="muted small">Se avisará al cliente que el pedido fue entregado.</p></div>
      <div class="modal-foot"><button type="button" class="btn" data-cerrar>Volver</button><button class="btn btn-primary">Confirmar entrega</button></div></form>`);
    $('form', m.el).onsubmit = (e) => { e.preventDefault(); m.cerrar(); enviar({ accion: 'entregado', ...Object.fromEntries(new FormData(e.target)) }); };
  }
  function modalNovedad(p, enviar) {
    const m = abrirCapa(`${cabecera('Reportar novedad', esc(p.guia_numero))}<form><div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
      <div class="field"><label>Tipo de novedad</label><select class="input" name="novedad_tipo" required>${Object.entries(NOVEDADES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label>Detalle (opcional)</label><textarea class="input" name="novedad_descripcion" rows="3"></textarea></div>
      <p class="muted small">Cliente ausente y acceso restringido se reprograman solos para el siguiente día hábil (máximo 2 veces). Rehusado pasa a devolución.</p></div>
      <div class="modal-foot"><button type="button" class="btn" data-cerrar>Volver</button><button class="btn btn-primary">Reportar</button></div></form>`);
    $('form', m.el).onsubmit = (e) => { e.preventDefault(); m.cerrar(); enviar({ accion: 'novedad', ...Object.fromEntries(new FormData(e.target)) }); };
  }

  // ── Nueva orden ─────────────────────────────────────────────
  async function vistaNuevaOrden(c) {
    const clientes = await api('GET', '/clientes');
    c.innerHTML = `<form class="card" novalidate style="max-width:980px">
      <div class="card-head"><h3>Datos del pedido</h3></div>
      <div class="card-pad">
        <div class="grid-3" style="margin-bottom:22px">
          <div class="field"><label>Seller</label><select class="input" name="cliente_id"><option value="">Venta directa</option>${clientes.filter((x) => x.activa && x.cliente_nombre !== 'Venta directa').map((x) => `<option value="${x.id}">${esc(x.cliente_nombre)}</option>`).join('')}</select></div>
          <div class="field"><label>N.º de pedido (opcional)</label><input class="input" name="pedido_id" placeholder="Se genera si lo dejas vacío"></div>
          <div class="field"><label>Servicio</label><select class="input" name="tipo">${Object.entries(SERVICIOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        </div>
        <h4 class="muted small" style="text-transform:uppercase;letter-spacing:.8px;margin:0 0 10px">Destinatario</h4>
        <div class="grid-2" style="margin-bottom:22px">
          <div class="field"><label>Nombre *</label><input class="input" name="nombre" required></div>
          <div class="field"><label>Celular *</label><input class="input" name="telefono" placeholder="300 123 4567" required></div>
          <div class="field span-2"><label>Dirección *</label><input class="input" name="direccion" placeholder="Cra 15 # 93-47 Apto 301" required></div>
          <div class="field"><label>Ciudad *</label><input class="input" name="ciudad" value="Bogotá" required></div>
          <div class="field"><label>Departamento *</label><input class="input" name="departamento" value="Bogotá D.C." required></div>
          <div class="field"><label>Referencia</label><input class="input" name="referencia" placeholder="Torre, conjunto, portería…"></div>
          <div class="field"><label>Instrucciones</label><input class="input" name="instrucciones" placeholder="Llamar antes de llegar"></div>
        </div>
        <h4 class="muted small" style="text-transform:uppercase;letter-spacing:.8px;margin:0 0 10px">Paquete</h4>
        <div class="grid-4" style="margin-bottom:14px">
          <div class="field"><label>Peso (kg) *</label><input class="input" name="peso_kg" type="number" step="0.1" min="0.1" value="1" required></div>
          <div class="field"><label>Largo (cm) *</label><input class="input" name="largo_cm" type="number" min="1" value="30" required></div>
          <div class="field"><label>Ancho (cm) *</label><input class="input" name="ancho_cm" type="number" min="1" value="20" required></div>
          <div class="field"><label>Alto (cm) *</label><input class="input" name="alto_cm" type="number" min="1" value="15" required></div>
          <div class="field span-2"><label>Contenido *</label><input class="input" name="descripcion" required></div>
          <div class="field"><label>Valor declarado (COP) *</label><input class="input" name="valor_declarado" type="number" min="0" value="0" required></div>
          <div class="field" style="justify-content:flex-end"><label class="check"><input type="checkbox" name="fragil"> Frágil</label></div>
        </div>
        <div class="row" style="margin-bottom:6px"><label class="check"><input type="checkbox" name="contra_entrega" id="ce"> Cobrar contra entrega</label>
          <input class="input hidden" id="cev" name="valor_recaudo" type="number" min="1" placeholder="Valor a cobrar (COP)" style="width:220px"></div>
        <div class="alert alert-err hidden" id="nerr" style="margin-top:14px"></div>
      </div>
      <div class="modal-foot" style="border-top:1px solid var(--line)"><a class="btn" href="#/ordenes">Cancelar</a><button class="btn btn-primary" type="submit">${icon('plus')} Crear orden y generar guía</button></div>
    </form>`;
    $('#ce').onchange = (e) => $('#cev').classList.toggle('hidden', !e.target.checked);
    $('form', c).onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const err = $('#nerr');
      err.classList.add('hidden');
      const tel = String(f.telefono || '').replace(/[\s()-]/g, '');
      const body = {
        cliente_id: f.cliente_id || undefined,
        pedido_id: f.pedido_id || undefined,
        referencia: undefined,
        destinatario: { nombre: f.nombre, telefono: tel.startsWith('+') ? tel : `+57${tel}` },
        entrega: { direccion: f.direccion, ciudad: f.ciudad, departamento: f.departamento, referencia: f.referencia || undefined, instrucciones: f.instrucciones || undefined },
        paquete: { peso_kg: Number(f.peso_kg), largo_cm: Number(f.largo_cm), ancho_cm: Number(f.ancho_cm), alto_cm: Number(f.alto_cm), descripcion: f.descripcion, valor_declarado: Number(f.valor_declarado), fragil: Boolean(f.fragil) },
        servicio: { tipo: f.tipo, contra_entrega: Boolean(f.contra_entrega), valor_recaudo: f.contra_entrega ? Number(f.valor_recaudo) : 0 },
      };
      await conBoton($('button[type=submit]', c), async () => {
        try {
          const p = await api('POST', '/pedidos', body);
          c.innerHTML = `<div class="card card-pad" style="max-width:640px">
            <div class="alert alert-ok" style="margin-bottom:16px">Orden creada y guía generada</div>
            <div class="muted small">Guía</div><h2 class="mono" style="margin:4px 0 12px">${esc(p.guia_numero)}</h2>
            <dl class="kv"><dt>Destinatario</dt><dd>${esc(p.destinatario.nombre)}</dd><dt>Dirección</dt><dd>${esc(p.entrega.direccion_formateada || p.entrega.direccion)}</dd><dt>Zona</dt><dd>${esc(p.zona)}</dd>
            ${p.requiere_revision ? '<dt>Atención</dt><dd><span class="tag tag-warn">Google no ubicó el número exacto: revisa la dirección</span></dd>' : ''}</dl>
            <div class="row" style="margin-top:20px"><a class="btn btn-primary" href="${esc(p.pdf_url)}" target="_blank" rel="noopener">${icon('file')} Abrir guía PDF</a><a class="btn" href="#/ordenes?id=${p.id}">Ver orden</a><button class="btn" id="otra">${icon('plus')} Crear otra</button></div></div>`;
          $('#otra').onclick = () => vistaNuevaOrden(c);
        } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
      });
    };
  }

  // ── Mensajeros ──────────────────────────────────────────────
  async function vistaMensajeros(c) {
    const lista = await conductores(true);
    const fil = { nombre: '', telefono: '', placa: '', tipo: '' };
    c.innerHTML = `<div class="row" style="margin-bottom:14px"><span class="muted grow" id="mcnt"></span><button class="btn btn-primary" id="nuevo">${icon('plus')} Nuevo mensajero</button></div>
      <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Teléfono</th><th>Placa</th><th>Tipo de vehículo</th><th>Zona</th><th class="num">Capacidad</th><th>App</th><th>Activo</th><th></th></tr>
      <tr class="tbl-filters"><td><input class="input" data-f="nombre" placeholder="Buscar"></td><td><input class="input" data-f="telefono" placeholder="Buscar"></td><td><input class="input" data-f="placa" placeholder="Buscar"></td>
      <td><select class="input" data-f="tipo"><option value="">Todos</option>${VEHICULOS.map((v) => `<option>${v}</option>`).join('')}</select></td><td></td><td></td><td></td><td></td><td></td></tr></thead><tbody id="mtb"></tbody></table></div></div>`;
    const pintar = () => {
      const f = lista.filter((m) => (m.nombre || '').toLowerCase().includes(fil.nombre) && (m.telefono || '').includes(fil.telefono) && (m.placa || '').toLowerCase().includes(fil.placa) && (!fil.tipo || m.tipo_vehiculo === fil.tipo));
      $('#mcnt').textContent = `${lista.filter((m) => m.activo).length} activos de ${lista.length}`;
      $('#mtb').innerHTML = f.length ? f.map((m) => `<tr>
        <td><b>${esc(m.nombre)}</b>${m.email ? `<div class="muted small">${esc(m.email)}</div>` : ''}</td><td>${esc(m.telefono || '—')}</td><td class="mono">${esc(m.placa || '—')}</td><td>${esc(m.tipo_vehiculo || '—')}</td><td>${esc(m.zona || 'Cualquiera')}</td><td class="num">${esc(m.capacidad_kg)} kg</td>
        <td>${m.tiene_pin ? `<span class="badge b-green">Con PIN</span>${m.ultima_ubicacion_en ? `<div class="muted small">GPS ${fmtFechaHora(m.ultima_ubicacion_en)}</div>` : ''}` : '<span class="badge b-gray">Sin PIN</span>'}</td>
        <td><label class="switch"><input type="checkbox" data-act="${m.id}" ${m.activo ? 'checked' : ''}><span></span></label></td>
        <td><button class="btn btn-sm icon-btn" data-ed="${m.id}" aria-label="Editar">${icon('edit')}</button></td></tr>`).join('') : '<tr><td colspan="9"><div class="empty">No hay mensajeros. Crea el primero.</div></td></tr>';
      $$('[data-act]').forEach((cb) => (cb.onchange = async () => {
        try { const r = await api('PATCH', `/conductores/${cb.dataset.act}`, { activo: cb.checked }); Object.assign(lista.find((m) => m.id === r.id), r); S.conductores = lista; pintar(); toast(cb.checked ? 'Mensajero activado' : 'Mensajero desactivado'); } catch (e) { cb.checked = !cb.checked; fallo(e); }
      }));
      $$('[data-ed]').forEach((b) => (b.onclick = () => modalMensajero(lista.find((m) => m.id === b.dataset.ed), () => vistaMensajeros(c))));
    };
    $$('[data-f]', c).forEach((i) => (i.oninput = i.onchange = () => { fil[i.dataset.f] = i.value.toLowerCase(); if (i.dataset.f === 'tipo') fil.tipo = i.value; pintar(); }));
    $('#nuevo').onclick = () => modalMensajero(null, () => vistaMensajeros(c));
    pintar();
  }

  function modalMensajero(m, listo) {
    const v = m || { capacidad_kg: 50, activo: true };
    const md = abrirCapa(`${cabecera(m ? 'Editar mensajero' : 'Nuevo mensajero')}<form><div class="modal-body"><div class="grid-2">
      <div class="field span-2"><label>Nombre o código *</label><input class="input" name="nombre" value="${esc(v.nombre)}" placeholder="506-7" required></div>
      <div class="field"><label>Teléfono</label><input class="input" name="telefono" value="${esc(v.telefono)}"></div>
      <div class="field"><label>Correo (para la app)</label><input class="input" name="email" type="email" value="${esc(v.email)}"></div>
      <div class="field"><label>Placa</label><input class="input" name="placa" value="${esc(v.placa)}" style="text-transform:uppercase"></div>
      <div class="field"><label>Tipo de vehículo</label><select class="input" name="tipo_vehiculo"><option value="">—</option>${VEHICULOS.map((t) => `<option ${v.tipo_vehiculo === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Zona</label><select class="input" name="zona"><option value="">Cualquier zona</option>${ZONAS.map((z) => `<option ${v.zona === z ? 'selected' : ''}>${z}</option>`).join('')}</select></div>
      <div class="field"><label>Capacidad (kg)</label><input class="input" name="capacidad_kg" type="number" min="1" value="${esc(v.capacidad_kg)}"></div>
      <div class="field span-2"><label>PIN de la app (4 a 6 números)${v.tiene_pin ? ' — déjalo vacío para no cambiarlo' : ''}</label><input class="input" name="pin" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" autocomplete="off" placeholder="${v.tiene_pin ? '••••' : 'Ej: 4821'}"></div>
      <div class="span-2 alert alert-warn small">El mensajero entra a <b>${esc(location.origin)}/app</b> con su celular (el de arriba) y este PIN.</div>
    </div></div><div class="modal-foot"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn-primary">Guardar</button></div></form>`);
    $('form', md.el).onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      f.placa = (f.placa || '').toUpperCase();
      if (!f.pin) delete f.pin;
      if (!m && !f.telefono) return toast('El celular es necesario para que el mensajero entre a la app', true);
      await conBoton($('.btn-primary', md.el), async () => {
        if (m) await api('PATCH', `/conductores/${m.id}`, f); else await api('POST', '/conductores', f);
        md.cerrar(); S.conductores = null; toast('Mensajero guardado'); listo();
      });
    };
  }

  // ── Rutero ──────────────────────────────────────────────────
  let fechaRutero = null;
  async function vistaRutero(c) {
    fechaRutero = fechaRutero || hoy();
    c.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="card-head" style="flex-wrap:wrap">
        <div class="field" style="flex-direction:row;align-items:center;gap:10px"><label for="rf">Fecha</label><input type="date" class="input" id="rf" value="${fechaRutero}" style="width:auto"></div>
        <span class="grow"></span>
        <button class="btn" id="rref">${icon('refresh')} Actualizar</button>
        <button class="btn btn-primary" id="ropt">${icon('route')} Optimizar rutas</button></div>
        <div class="card-pad small muted" style="padding-top:12px;padding-bottom:12px">"Optimizar rutas" te pregunta qué mensajeros salen hoy, reparte entre ellos los pedidos por asignar según zona y capacidad, y ordena las paradas de cada uno con Google (máximo 25 por ruta). Luego puedes cambiar el mensajero de cualquier ruta.</div>
        <div id="rres"></div></div>
      <div class="rutero"><div class="viajes" id="rv"></div><div class="card"><div id="rmap" class="map map-lg" style="border-radius:var(--radius)"></div></div></div>`;
    const md = await api('GET', '/mapa');
    const mapa = crearMapa($('#rmap'), md.deposito);
    const capa = L.layerGroup().addTo(mapa);
    const cargar = async () => {
      const [todos, cs] = await Promise.all([api('GET', `/viajes?fecha=${fechaRutero}`), conductores(true)]);
      const viajes = todos.filter((v) => v.estado !== 'cancelado');
      const activosR = cs.filter((m) => m.activo);
      capa.clearLayers();
      marcadorBodega(md.deposito).addTo(capa);
      const pts = [[md.deposito.lat, md.deposito.lng]];
      viajes.forEach((v, i) => {
        const color = COLORES_RUTA[i % COLORES_RUTA.length];
        const linea = [[md.deposito.lat, md.deposito.lng]];
        (v.secuencia || []).forEach((s) => {
          const ll = [Number(s.lat), Number(s.lng)];
          linea.push(ll); pts.push(ll);
          marcadorNumero(ll[0], ll[1], s.orden, color).bindPopup(`<b>${s.orden}. ${esc(s.guia_numero)}</b><br>${esc(s.destinatario || '')}<br>${esc(s.direccion || '')}<br>🚚 ${esc(v.conductor?.nombre || '')}`).addTo(capa);
        });
        linea.push([md.deposito.lat, md.deposito.lng]);
        L.polyline(linea, { color, weight: 3, opacity: 0.8, dashArray: v.estado === 'planificado' ? '6 6' : null }).addTo(capa);
        v._color = color;
        v._n = i + 1;
      });
      if (pts.length > 1) mapa.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
      $('#rv').innerHTML = viajes.length ? viajes.map((v) => `
        <div class="card viaje" style="border-left-color:${v._color}">
          <div class="head"><span class="avatar" style="background:${v._color};color:#fff" title="Ruta ${v._n}">${v._n}</span><div class="grow"><b>${esc(v.conductor?.nombre || 'Sin mensajero')}</b><div class="muted small">${esc(v.conductor?.tipo_vehiculo || '')} ${esc(v.conductor?.placa || '')}</div></div>${badgeViaje(v.estado)}</div>
          <div class="stats"><span><b>${v.total_paradas ?? 0}</b> paradas</span><span><b>${v.km_totales ?? '—'}</b> km</span><span><b>${v.duracion_min ? `${Math.floor(v.duracion_min / 60)}h ${v.duracion_min % 60}m` : '—'}</b> manejo</span><span><b>${v.kg_totales ?? '—'}</b> kg</span></div>
          <div class="btns">
            ${v.estado === 'planificado' ? `<button class="btn btn-primary btn-sm" data-ini="${v.id}">${icon('truck')} Iniciar ruta</button><button class="btn btn-sm" data-can="${v.id}">Deshacer</button>` : ''}
            ${v.estado === 'en_curso' ? `<button class="btn btn-sm" data-fin="${v.id}">Finalizar ruta</button>` : ''}
            ${['en_curso', 'finalizado'].includes(v.estado) ? `<button class="btn btn-sm" data-can="${v.id}">Deshacer</button>` : ''}
            <a class="btn btn-sm" href="#/ordenes?conductor_id=${v.conductor_id}&estado=asignado,en_ruta">Ver órdenes</a>
          </div>
          ${['planificado', 'en_curso'].includes(v.estado) ? `<div class="btns"><select class="input" data-cmsel="${v.id}" style="flex:1;min-height:34px;padding:5px 10px">${activosR.map((m) => `<option value="${m.id}" ${m.id === v.conductor_id ? 'selected' : ''}>${esc(m.nombre)}${m.zona ? ` · ${esc(m.zona)}` : ''}</option>`).join('')}</select><button class="btn btn-sm" data-cm="${v.id}">Cambiar mensajero</button></div>` : ''}
          <details><summary class="small" style="padding:0 16px 10px;cursor:pointer;font-weight:600">Orden de paradas</summary><ol>${(v.secuencia || []).map((s) => `<li><span class="mono">${esc(s.guia_numero)}</span> · ${esc(s.direccion || '')}</li>`).join('')}</ol></details>
        </div>`).join('') : `<div class="card card-pad empty">No hay rutas para esta fecha.<br><br>Pulsa <b>Optimizar rutas</b> para armarlas con los pedidos por asignar.</div>`;
      $$('[data-ini]').forEach((b) => (b.onclick = async () => {
        if (!(await confirmar('Iniciar ruta', 'Los pedidos de esta ruta pasarán a <b>En ruta</b> y se avisará a los clientes y destinatarios.', { boton: 'Iniciar ruta' }))) return;
        conBoton(b, async () => { const r = await api('POST', `/viajes/${b.dataset.ini}/iniciar`); toast(`${r.pedidos_en_ruta} pedidos en ruta`); await cargar(); });
      }));
      $$('[data-can]').forEach((b) => (b.onclick = async () => {
        if (!(await confirmar('Deshacer ruta', 'Los pedidos que no se entregaron vuelven a quedar por asignar. Los ya entregados no cambian.', { boton: 'Deshacer', peligro: true }))) return;
        conBoton(b, async () => { const r = await api('POST', `/viajes/${b.dataset.can}/cancelar`); toast(`${r.pedidos_liberados} pedidos liberados`); await cargar(); });
      }));
      $$('[data-fin]').forEach((b) => (b.onclick = () => conBoton(b, async () => { await api('POST', `/viajes/${b.dataset.fin}/finalizar`); toast('Ruta finalizada'); await cargar(); })));
      $$('[data-cm]').forEach((b) => (b.onclick = () => {
        const cid = $(`[data-cmsel="${b.dataset.cm}"]`).value;
        const v = viajes.find((x) => x.id === b.dataset.cm);
        if (cid === v.conductor_id) return toast('Ese mensajero ya tiene esta ruta');
        conBoton(b, async () => { const r = await api('POST', `/viajes/${b.dataset.cm}/mensajero`, { conductor_id: cid }); toast(`Ruta pasada a ${r.mensajero} (${r.pedidos_movidos} pedidos)`); await cargar(); });
      }));
    };
    $('#rf').onchange = (e) => { fechaRutero = e.target.value; $('#rres').innerHTML = ''; cargar().catch(fallo); };
    $('#rref').onclick = (e) => conBoton(e.currentTarget, cargar);
    const optimizar = async (btn, ids) => conBoton(btn, async () => {
      const r = await api('POST', '/rutas/optimizar', { fecha: fechaRutero, conductor_ids: ids });
      const pl = (n, uno, varios) => `<b>${n}</b> ${n === 1 ? uno : varios}`;
      const paradas = r.viajes.reduce((a, v) => a + v.paradas, 0);
      const partes = [`${pl(r.viajes.length, 'ruta nueva', 'rutas nuevas')} con ${pl(paradas, 'parada', 'paradas')}`];
      if (r.sin_asignar.length) partes.push(`${pl(r.sin_asignar.length, 'pedido no cupo', 'pedidos no cupieron')} (sin mensajero disponible o sin capacidad)`);
      if (!r.pedidos_considerados) partes.splice(0, 1, 'No había pedidos por asignar');
      $('#rres').innerHTML = `<div class="card-pad" style="padding-top:0"><div class="alert ${r.errores.length ? 'alert-err' : r.sin_asignar.length ? 'alert-warn' : 'alert-ok'}">${partes.join(' · ')}${r.errores.map((x) => `<br>${esc(x.conductor)}: ${esc(x.error)}`).join('')}</div></div>`;
      await cargar();
    });
    $('#ropt').onclick = async () => {
      const activos = (await conductores(true)).filter((m) => m.activo);
      if (!activos.length) return toast('No hay mensajeros activos. Créalos en Mensajeros.', true);
      const m = abrirCapa(`${cabecera('¿Quiénes salen a ruta?', 'Los pedidos por asignar se repartirán solo entre los mensajeros marcados')}
        <form><div class="modal-body"><label class="check" style="margin-bottom:10px"><input type="checkbox" id="todos" checked> <b>Todos</b></label>
        <div style="display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow:auto">${activos.map((c) => `<label class="check" style="border:1px solid var(--line);border-radius:10px;padding:10px 12px"><input type="checkbox" name="c" value="${c.id}" checked> <span class="grow"><b>${esc(c.nombre)}</b><div class="muted small">${esc(c.tipo_vehiculo || 'Vehículo')} · Zona ${esc(c.zona || 'cualquiera')} · ${esc(c.capacidad_kg)} kg</div></span></label>`).join('')}</div></div>
        <div class="modal-foot"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn-primary">${icon('route')} Optimizar rutas</button></div></form>`);
      const cajas = $$('input[name=c]', m.el);
      $('#todos', m.el).onchange = (e) => cajas.forEach((c) => (c.checked = e.target.checked));
      cajas.forEach((c) => (c.onchange = () => ($('#todos', m.el).checked = cajas.every((x) => x.checked))));
      $('form', m.el).onsubmit = async (e) => {
        e.preventDefault();
        const ids = cajas.filter((c) => c.checked).map((c) => c.value);
        if (!ids.length) return toast('Marca al menos un mensajero', true);
        m.cerrar();
        await optimizar($('#ropt'), ids);
      };
    };
    await cargar();
  }

  // ── Sellers ─────────────────────────────────────────────────
  async function vistaSellers(c) {
    const lista = await api('GET', '/clientes');
    const base = `${location.origin}/v1`;
    c.innerHTML = `<div class="card card-pad" style="margin-bottom:16px"><div class="row"><div class="grow"><b>URL de la API para los sellers</b><div class="muted small">Entrégala junto con su llave y la documentación de integración.</div></div>
        <div class="secret-box" style="max-width:460px"><span>${esc(base)}</span><button class="btn btn-sm" data-copy="${esc(base)}">${icon('copy')}</button></div></div></div>
      <div class="row" style="margin-bottom:14px"><span class="grow"></span>${S.esAdmin ? `<button class="btn btn-primary" id="nuevo">${icon('plus')} Nuevo seller</button>` : ''}</div>
      <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Seller</th><th>Entorno</th><th>Creado</th><th>Activo</th></tr></thead><tbody>
      ${lista.map((x) => `<tr><td><b>${esc(x.cliente_nombre)}</b>${x.cliente_nombre === 'Venta directa' ? '<div class="muted small">Órdenes creadas en este panel</div>' : ''}</td>
        <td>${x.entorno === 'live' ? '<span class="badge b-green">Producción</span>' : '<span class="badge b-amber">Pruebas</span>'}</td><td class="muted small">${fmtFechaHora(x.creada_en)}</td>
        <td>${x.cliente_nombre === 'Venta directa' ? '—' : `<label class="switch"><input type="checkbox" data-act="${x.id}" ${x.activa ? 'checked' : ''} ${S.esAdmin ? '' : 'disabled'}><span></span></label>`}</td></tr>`).join('')}
      </tbody></table></div></div>`;
    $$('[data-copy]', c).forEach((b) => (b.onclick = () => copiar(b.dataset.copy)));
    $$('[data-act]', c).forEach((cb) => (cb.onchange = async () => {
      try { await api('PATCH', `/clientes/${cb.dataset.act}`, { activa: cb.checked }); toast(cb.checked ? 'Seller activado' : 'Seller desactivado: su llave deja de funcionar'); } catch (e) { cb.checked = !cb.checked; fallo(e); }
    }));
    const nb = $('#nuevo');
    if (nb) nb.onclick = () => {
      const m = abrirCapa(`${cabecera('Nuevo seller')}<form><div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
        <div class="field"><label>Nombre del seller *</label><input class="input" name="cliente_nombre" required></div>
        <div class="field"><label>Entorno</label><select class="input" name="entorno"><option value="sandbox">Pruebas (sandbox)</option><option value="live">Producción</option></select></div>
      </div><div class="modal-foot"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn-primary">Crear y generar llave</button></div></form>`);
      $('form', m.el).onsubmit = async (e) => {
        e.preventDefault();
        await conBoton($('.btn-primary', m.el), async () => {
          const r = await api('POST', '/clientes', Object.fromEntries(new FormData(e.target)));
          $('.modal', m.el).innerHTML = `${cabecera(`Llaves de ${esc(r.cliente_nombre)}`)}<div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
            <div class="alert alert-warn"><b>Cópialas ahora.</b> Por seguridad no se vuelven a mostrar: si se pierden, crea un seller nuevo y desactiva este.</div>
            <div class="field"><label>API Key (header X-API-Key)</label><div class="secret-box"><span>${esc(r.api_key)}</span><button class="btn btn-sm" data-copy="${esc(r.api_key)}">${icon('copy')}</button></div></div>
            <div class="field"><label>Secreto de webhooks (header X-Webhook-Secret)</label><div class="secret-box"><span>${esc(r.webhook_secret)}</span><button class="btn btn-sm" data-copy="${esc(r.webhook_secret)}">${icon('copy')}</button></div></div>
          </div><div class="modal-foot"><button class="btn btn-primary" data-cerrar>Listo</button></div>`;
          $$('[data-copy]', m.el).forEach((b) => (b.onclick = () => copiar(b.dataset.copy)));
          $('[data-cerrar].btn-primary', m.el).addEventListener('click', () => vistaSellers(c));
        });
      };
    };
  }

  // ── Bodegas ─────────────────────────────────────────────────
  async function vistaBodegas(c) {
    const lista = await api('GET', '/bodegas');
    c.innerHTML = `<div class="row" style="margin-bottom:14px"><span class="muted grow">La bodega principal es el punto de salida y regreso de todas las rutas.</span>${S.esAdmin ? `<button class="btn btn-primary" id="nuevo">${icon('plus')} Nueva bodega</button>` : ''}</div>
      <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Bodega</th><th>Dirección</th><th>Coordenadas</th><th>Principal</th><th>Activa</th><th></th></tr></thead><tbody>
      ${lista.length ? lista.map((b) => `<tr><td><b>${esc(b.nombre)}</b></td><td>${esc(b.direccion)}, ${esc(b.ciudad)}</td><td class="mono small">${Number(b.lat).toFixed(5)}, ${Number(b.lng).toFixed(5)}</td>
        <td>${b.principal ? '<span class="badge b-green">Principal</span>' : S.esAdmin ? `<button class="btn btn-sm" data-pri="${b.id}">${icon('star')} Hacer principal</button>` : '—'}</td>
        <td><label class="switch"><input type="checkbox" data-act="${b.id}" ${b.activa ? 'checked' : ''} ${S.esAdmin ? '' : 'disabled'}><span></span></label></td>
        <td>${S.esAdmin ? `<button class="btn btn-sm" data-reu="${b.id}" data-dir="${esc(b.direccion)}" data-ciu="${esc(b.ciudad)}">Reubicar</button>` : ''}</td></tr>`).join('')
        : '<tr><td colspan="6"><div class="empty">Aún no hay bodegas. Mientras tanto, las rutas salen del punto configurado en Vercel (DEPOSITO_LAT / DEPOSITO_LNG).</div></td></tr>'}
      </tbody></table></div></div>`;
    $$('[data-pri]', c).forEach((b) => (b.onclick = () => conBoton(b, async () => { await api('PATCH', `/bodegas/${b.dataset.pri}`, { principal: true }); toast('Bodega principal actualizada'); vistaBodegas(c); })));
    $$('[data-reu]', c).forEach((b) => (b.onclick = () => {
      const m = abrirCapa(`${cabecera('Reubicar bodega', 'Vuelve a ubicar la dirección con Google')}<form><div class="modal-body"><div class="grid-2">
        <div class="field span-2"><label>Dirección</label><input class="input" name="direccion" value="${esc(b.dataset.dir)}" required></div>
        <div class="field"><label>Ciudad</label><input class="input" name="ciudad" value="${esc(b.dataset.ciu)}" required></div>
      </div></div><div class="modal-foot"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn-primary">Ubicar</button></div></form>`);
      $('form', m.el).onsubmit = async (e) => {
        e.preventDefault();
        await conBoton($('.btn-primary', m.el), async () => {
          const r = await api('POST', `/bodegas/${b.dataset.reu}/reubicar`, Object.fromEntries(new FormData(e.target)));
          m.cerrar();
          toast(r.requiere_revision ? `Ubicada en: ${r.direccion_google}. Revisa que sea correcta.` : `Ubicada en: ${r.direccion_google}`, r.requiere_revision);
          vistaBodegas(c);
        });
      };
    }));
    $$('[data-act]', c).forEach((cb) => (cb.onchange = async () => { try { await api('PATCH', `/bodegas/${cb.dataset.act}`, { activa: cb.checked }); toast('Bodega actualizada'); } catch (e) { cb.checked = !cb.checked; fallo(e); } }));
    const nb = $('#nuevo');
    if (nb) nb.onclick = () => {
      const m = abrirCapa(`${cabecera('Nueva bodega')}<form><div class="modal-body"><div class="grid-2">
        <div class="field span-2"><label>Nombre *</label><input class="input" name="nombre" required></div>
        <div class="field span-2"><label>Dirección *</label><input class="input" name="direccion" required></div>
        <div class="field"><label>Ciudad *</label><input class="input" name="ciudad" value="Bogotá" required></div>
        <div class="field"><label>Departamento</label><input class="input" name="departamento" value="Bogotá D.C."></div>
        <label class="check span-2"><input type="checkbox" name="principal" ${lista.length ? '' : 'checked'}> Bodega principal (salida de las rutas)</label>
      </div></div><div class="modal-foot"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn-primary">Guardar</button></div></form>`);
      $('form', m.el).onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        f.principal = Boolean(f.principal);
        await conBoton($('.btn-primary', m.el), async () => { await api('POST', '/bodegas', f); m.cerrar(); toast('Bodega creada'); vistaBodegas(c); });
      };
    };
  }

  // ── Usuarios ────────────────────────────────────────────────
  async function vistaUsuarios(c) {
    const lista = await api('GET', '/usuarios');
    c.innerHTML = `<div class="row" style="margin-bottom:14px"><span class="muted grow">Los despachadores operan pedidos y rutas. Los administradores además gestionan sellers, bodegas y usuarios.</span><button class="btn btn-primary" id="nuevo">${icon('plus')} Nuevo usuario</button></div>
      <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Activo</th><th></th></tr></thead><tbody>
      ${lista.map((u) => `<tr><td><b>${esc(u.nombre)}</b>${u.id === S.usuario.id ? ' <span class="tag">Tú</span>' : ''}</td><td>${esc(u.email)}</td>
        <td><select class="input" data-rol="${u.id}" style="width:auto" ${u.id === S.usuario.id ? 'disabled' : ''}><option value="despachador" ${u.rol === 'despachador' ? 'selected' : ''}>Despachador</option><option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>Administrador</option></select></td>
        <td><label class="switch"><input type="checkbox" data-act="${u.id}" ${u.activo ? 'checked' : ''} ${u.id === S.usuario.id ? 'disabled' : ''}><span></span></label></td>
        <td><button class="btn btn-sm" data-pw="${u.id}">Nueva contraseña</button></td></tr>`).join('')}
      </tbody></table></div></div>`;
    $$('[data-rol]', c).forEach((s) => (s.onchange = async () => { try { await api('PATCH', `/usuarios/${s.dataset.rol}`, { rol: s.value }); toast('Rol actualizado'); } catch (e) { fallo(e); } }));
    $$('[data-act]', c).forEach((cb) => (cb.onchange = async () => { try { await api('PATCH', `/usuarios/${cb.dataset.act}`, { activo: cb.checked }); toast('Usuario actualizado'); } catch (e) { cb.checked = !cb.checked; fallo(e); } }));
    $$('[data-pw]', c).forEach((b) => (b.onclick = () => {
      const m = abrirCapa(`${cabecera('Asignar nueva contraseña')}<form><div class="modal-body"><div class="field"><label>Nueva contraseña (mínimo 8)</label><input class="input" name="password" type="text" minlength="8" required></div><p class="muted small">Compártela con la persona por un canal seguro.</p></div>
        <div class="modal-foot"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn-primary">Guardar</button></div></form>`);
      $('form', m.el).onsubmit = async (e) => { e.preventDefault(); await conBoton($('.btn-primary', m.el), async () => { await api('PATCH', `/usuarios/${b.dataset.pw}`, Object.fromEntries(new FormData(e.target))); m.cerrar(); toast('Contraseña actualizada'); }); };
    }));
    $('#nuevo').onclick = () => {
      const m = abrirCapa(`${cabecera('Nuevo usuario')}<form><div class="modal-body"><div class="grid-2">
        <div class="field span-2"><label>Nombre *</label><input class="input" name="nombre" required></div>
        <div class="field span-2"><label>Correo *</label><input class="input" name="email" type="email" required></div>
        <div class="field"><label>Contraseña inicial *</label><input class="input" name="password" type="text" minlength="8" required></div>
        <div class="field"><label>Rol</label><select class="input" name="rol"><option value="despachador">Despachador</option><option value="admin">Administrador</option></select></div>
      </div></div><div class="modal-foot"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn-primary">Crear usuario</button></div></form>`);
      $('form', m.el).onsubmit = async (e) => { e.preventDefault(); await conBoton($('.btn-primary', m.el), async () => { await api('POST', '/usuarios', Object.fromEntries(new FormData(e.target))); m.cerrar(); toast('Usuario creado'); vistaUsuarios(c); }); };
    };
  }

  render();
})();
