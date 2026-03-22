import { db, collection, doc, getDoc, setDoc, addDoc, getDocs, deleteDoc, onSnapshot, updateDoc, arrayRemove, serverTimestamp } from './firebase.js';
import { PRECIOS_DEFAULT, HORAS_DEFAULT, SERVICIO_KEYS, comprimirImagen, formatCOP, to12h } from './data.js';

const API = 'https://dulce-rosa-api.onrender.com';
let pendingFoto = null;
let serviciosEnMemoria = {};
window._svcImages = {};

// ── FETCH con timeout y error real ──
async function api(url, opts = {}, ms = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(API + url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Error ' + r.status); }
    return r.json();
  } catch (e) {
    clearTimeout(t);
    if (e.name === 'AbortError') throw new Error('Timeout — el servidor está despertando, espera 30s e intenta de nuevo.');
    throw e;
  }
}

export function showOk(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}

// ── TABS ──
window.switchTab = function(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
};

// ── CITAS ──
window.renderCitas = async function() {
  const q = (document.getElementById('filtro-citas') || { value: '' }).value.toLowerCase();
  const lista = document.getElementById('lista-citas');
  if (!lista) return;
  lista.innerHTML = '<div class="no-citas"><span class="spin">⏳</span> Cargando...</div>';
  try {
    const snap = await Promise.race([
      getDocs(collection(db, 'citas')),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))
    ]);
    const citas = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
    document.getElementById('stat-total').textContent = citas.length;
    document.getElementById('stat-hoy').textContent = citas.filter(c => c.fecha === hoy).length;
    document.getElementById('stat-prox').textContent = citas.filter(c => c.fecha >= hoy).length;
    const fil = citas
      .filter(c => !q || c.nombre?.toLowerCase().includes(q) || c.servicio?.toLowerCase().includes(q) || c.fecha?.includes(q) || c.tel?.includes(q))
      .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
    if (!fil.length) { lista.innerHTML = '<div class="no-citas">No hay citas aún 🌸</div>'; return; }
    lista.innerHTML = fil.map(c => `
      <div class="cita-item">
        <div class="cita-item-header">
          <div class="cita-name">👤 ${c.nombre}</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <span class="cita-badge">${c.fecha} · ${to12h(c.hora)}</span>
            <button class="btn-delete" onclick="eliminarCita('${c.id}','${c.fecha}','${c.hora}')">✕</button>
          </div>
        </div>
        <div class="cita-details">
          <div>📞 ${c.tel}</div>
          <div>💅 ${(c.servicio || '').split('—')[0].trim()}</div>
          ${c.nota ? `<div style="grid-column:span 2">📝 ${c.nota}</div>` : ''}
        </div>
      </div>`).join('');
  } catch (e) {
    lista.innerHTML = `<div class="no-citas">❌ ${e?.message === 'timeout' ? 'Toca 🔄 Actualizar.' : e?.message || e}</div>`;
  }
};

window.eliminarCita = async function(id, fecha, hora) {
  if (!confirm('¿Eliminar esta cita?')) return;
  await deleteDoc(doc(db, 'citas', id));
  try { await updateDoc(doc(db, 'slots', fecha), { booked: arrayRemove(hora) }); } catch {}
  window.renderCitas();
};

window.exportarCitas = async function() {
  const snap = await getDocs(collection(db, 'citas'));
  const citas = snap.docs.map(d => d.data());
  if (!citas.length) { alert('No hay citas.'); return; }
  let txt = 'CITAS — DULCE ROSA NAILS SPA\n' + '='.repeat(44) + '\n\n';
  citas.sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora))
    .forEach((c, i) => { txt += `${i + 1}. ${c.nombre}\n   Tel: ${c.tel}\n   Servicio: ${c.servicio}\n   Fecha: ${c.fecha} a las ${to12h(c.hora)}\n${c.nota ? '   Nota: ' + c.nota + '\n' : ''}\n`; });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
  a.download = 'citas-dulce-rosa.txt';
  a.click();
};

// ── CONFIG ──
window.cargarAdminConfig = async function() {
  const el = document.getElementById('a-nequi');
  if (el) el.value = '324 568 3032';
  document.querySelectorAll('.hora-chip').forEach(c => c.classList.add('activa'));
  try {
    const snap = await getDoc(doc(db, 'config', 'site'));
    const d = snap.exists() ? snap.data() : {};
    if (d.nequi && el) el.value = d.nequi;
    const activas = d.horarios || HORAS_DEFAULT;
    document.querySelectorAll('.hora-chip').forEach(chip => chip.classList.toggle('activa', activas.includes(chip.dataset.hora)));
    window._horasDisponibles = activas;
  } catch (e) { console.warn('Config load:', e); }
};

window.guardarConfig = async function() {
  const btn = document.querySelector('#tab-config .btn-save');
  if (btn) { btn.textContent = '⏳ Guardando...'; btn.disabled = true; }
  const nequi = document.getElementById('a-nequi').value.trim();
  const horarios = [...document.querySelectorAll('.hora-chip.activa')].map(c => c.dataset.hora);
  const activas = horarios.length ? horarios : [...HORAS_DEFAULT];
  window._horasDisponibles = activas;
  document.querySelectorAll('.nequi-num').forEach(el => el.textContent = nequi);
  showOk('ok-config');
  try {
    const ref = doc(db, 'config', 'site');
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    await setDoc(ref, { ...data, nequi, horarios: activas });
  } catch (e) { console.warn('Config save:', e); }
  if (btn) { btn.textContent = '💾 Guardar configuración'; btn.disabled = false; }
};

window.toggleHora = function(chip) { chip.classList.toggle('activa'); };

// ── PRECIOS ──
window.cargarAdminPrecios = async function() {
  Object.keys(PRECIOS_DEFAULT).forEach(k => {
    const el = document.getElementById('ap-' + k);
    if (el && !el.value) el.value = PRECIOS_DEFAULT[k];
  });
  try {
    const snap = await getDoc(doc(db, 'config', 'precios'));
    const p = snap.exists() ? snap.data() : PRECIOS_DEFAULT;
    Object.keys(PRECIOS_DEFAULT).forEach(k => {
      const el = document.getElementById('ap-' + k);
      if (el) el.value = p[k] || PRECIOS_DEFAULT[k];
    });
  } catch (e) { console.warn('Precios load:', e); }
};

window.guardarPrecios = async function() {
  const precios = {};
  Object.keys(PRECIOS_DEFAULT).forEach(k => {
    const el = document.getElementById('ap-' + k);
    if (el) precios[k] = Number(el.value) || PRECIOS_DEFAULT[k];
  });
  try { await setDoc(doc(db, 'config', 'precios'), precios); showOk('ok-precios'); }
  catch (e) { console.warn('Precios save:', e); }
};

// ── SERVICIOS ──
window.cargarAdminServicios = async function() {
  const cont = document.getElementById('svc-edit-list');
  if (!cont) return;
  _renderSvcAdmin(cont, serviciosEnMemoria);
  try {
    const snap = await getDoc(doc(db, 'config', 'servicios'));
    if (snap.exists()) { serviciosEnMemoria = snap.data(); _renderSvcAdmin(cont, serviciosEnMemoria); }
  } catch (e) { console.warn('servicios load:', e); }
};

function _renderSvcAdmin(cont, serviciosData) {
  cont.innerHTML = '';
  const btnNuevo = document.createElement('button');
  btnNuevo.className = 'btn-nuevo-svc';
  btnNuevo.textContent = '＋ Nuevo servicio';
  btnNuevo.onclick = () => window.abrirFormNuevoServicio();
  cont.appendChild(btnNuevo);
  const customKeys = serviciosData._custom || [];
  const allKeys = [...SERVICIO_KEYS, ...customKeys.filter(c => !SERVICIO_KEYS.find(k => k.id === c.id))];
  const cats = [...new Set(allKeys.map(s => s.cat))];
  cats.forEach(cat => {
    const svcs = allKeys.filter(s => s.cat === cat && !(serviciosData[s.id]?.hidden));
    if (!svcs.length) return;
    const catTitle = document.createElement('div');
    catTitle.className = 'svc-cat-title'; catTitle.textContent = cat;
    cont.appendChild(catTitle);
    svcs.forEach(s => {
      const info = serviciosData[s.id] || {};
      const nombre = info.nombre || s.nombre;
      const imagen = info.imagen || null;
      const isBuiltin = !!SERVICIO_KEYS.find(k => k.id === s.id);
      const card = document.createElement('div');
      card.className = 'svc-edit-card';
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-del-svc'; delBtn.textContent = '✕ Eliminar';
      delBtn.onclick = () => window.eliminarServicio(s.id, isBuiltin);
      card.appendChild(delBtn);
      const header = document.createElement('div');
      header.className = 'svc-edit-card-header';
      header.innerHTML = `<div class="svc-edit-img" id="svc-img-preview-${s.id}">${imagen ? `<img src="${imagen}" alt=""/>` : `<span>${s.emoji || '💅'}</span>`}</div>
        <label class="btn-img-svc">📷 Imagen<input type="file" accept="image/*" style="display:none" onchange="subirImagenServicio('${s.id}',this)"/></label>`;
      card.appendChild(header);
      card.innerHTML += `
        <div class="a-row">
          <div class="a-field"><label class="a-label">Nombre</label><input class="a-input" id="svc-name-${s.id}" value="${nombre.replace(/"/g,'&quot;')}"/></div>
          <div class="a-field"><label class="a-label">Precio</label><input class="a-input" type="number" id="svc-precio-${s.id}" value="${info.precio || PRECIOS_DEFAULT[s.id] || 0}"/></div>
        </div>
        <div class="a-field"><label class="a-label">Descripción corta</label><input class="a-input" id="svc-desc-${s.id}" value="${(info.descripcion || s.descripcion || '').replace(/"/g,'&quot;')}"/></div>
        <div class="a-field"><label class="a-label">Detalles completos</label><textarea class="a-textarea" id="svc-det-${s.id}">${info.detalles || s.detalles || ''}</textarea></div>`;
      cont.appendChild(card);
    });
  });
}

window.subirImagenServicio = function(id, input) {
  const file = input.files[0];
  if (!file) return;
  comprimirImagen(file, 600, 0.88).then(b64 => {
    window._svcImages[id] = b64;
    const prev = document.getElementById('svc-img-preview-' + id);
    if (prev) prev.innerHTML = `<img src="${b64}" style="width:52px;height:52px;border-radius:8px;object-fit:cover"/>`;
  });
};

window.guardarServicios = async function() {
  const btn = document.querySelector('#tab-servicios .btn-save');
  if (btn) { btn.textContent = '⏳ Guardando...'; btn.disabled = true; }
  try {
    const snap = await getDoc(doc(db, 'config', 'servicios'));
    const existing = snap.exists() ? snap.data() : {};
    const customKeys = existing._custom || [];
    const allKeys = [...SERVICIO_KEYS, ...customKeys.filter(c => !SERVICIO_KEYS.find(k => k.id === c.id))];
    const servicios = { _custom: customKeys };
    allKeys.forEach(s => {
      const nameEl = document.getElementById('svc-name-' + s.id);
      if (!nameEl) return;
      servicios[s.id] = {
        nombre:      nameEl.value.trim() || s.nombre,
        precio:      Number(document.getElementById('svc-precio-' + s.id)?.value) || 0,
        descripcion: document.getElementById('svc-desc-' + s.id)?.value.trim() || '',
        detalles:    document.getElementById('svc-det-' + s.id)?.value.trim() || '',
        imagen:      window._svcImages[s.id] || existing[s.id]?.imagen || null,
        emoji: s.emoji || '💅', cat: s.cat, desde: s.desde || false,
        hidden: existing[s.id]?.hidden || false
      };
    });
    await setDoc(doc(db, 'config', 'servicios'), servicios);
    serviciosEnMemoria = servicios;
    window._svcImages = {};
    showOk('ok-servicios');
  } catch (e) { alert('Error: ' + (e?.message || e)); }
  if (btn) { btn.textContent = '💾 Guardar cambios'; btn.disabled = false; }
};

window.abrirFormNuevoServicio = function() {
  ['ns-nombre','ns-precio','ns-desc','ns-detalles'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const catEl = document.getElementById('ns-cat'); if (catEl) catEl.value = '✨ Uñas';
  const ov = document.getElementById('overlay-nuevo-svc');
  if (ov) { ov.classList.add('show'); document.body.style.overflow = 'hidden'; }
};

window.guardarNuevoServicio = async function() {
  const nombre = document.getElementById('ns-nombre')?.value.trim();
  if (!nombre) { alert('El nombre es obligatorio.'); return; }
  const precio   = Number(document.getElementById('ns-precio')?.value) || 0;
  const cat      = document.getElementById('ns-cat')?.value || '✨ Uñas';
  const desc     = document.getElementById('ns-desc')?.value.trim() || '';
  const detalles = document.getElementById('ns-detalles')?.value.trim() || '';
  const id = 'custom_' + Date.now();
  const snap = await getDoc(doc(db, 'config', 'servicios'));
  const existing = snap.exists() ? snap.data() : {};
  const customKeys = [...(existing._custom || [])];
  customKeys.push({ id, nombre, cat, emoji: '💅', desde: false });
  const newData = { ...existing, _custom: customKeys, [id]: { nombre, precio, descripcion: desc, detalles, imagen: null, emoji: '💅', cat, desde: false, hidden: false } };
  await setDoc(doc(db, 'config', 'servicios'), newData);
  serviciosEnMemoria = newData;
  const ov = document.getElementById('overlay-nuevo-svc');
  if (ov) { ov.classList.remove('show'); document.body.style.overflow = ''; }
  const cont = document.getElementById('svc-edit-list');
  if (cont) _renderSvcAdmin(cont, newData);
};

window.eliminarServicio = async function(id, isBuiltin) {
  if (!confirm(isBuiltin ? '¿Ocultar este servicio?' : '¿Eliminar este servicio?')) return;
  const snap = await getDoc(doc(db, 'config', 'servicios'));
  const existing = snap.exists() ? snap.data() : {};
  const customKeys = (existing._custom || []).filter(c => c.id !== id);
  const newData = { ...existing, _custom: customKeys };
  if (isBuiltin) newData[id] = { ...(existing[id] || {}), hidden: true };
  else delete newData[id];
  await setDoc(doc(db, 'config', 'servicios'), newData);
  serviciosEnMemoria = newData;
  const cont = document.getElementById('svc-edit-list');
  if (cont) _renderSvcAdmin(cont, newData);
};

// ── LOGO ──
window.previsualizarLogo = function(input) {
  const file = input.files[0]; if (!file) return;
  comprimirImagen(file, 300, 0.85).then(b64 => {
    document.getElementById('preview-logo-admin').src = b64;
    const btn = document.getElementById('btn-guardar-logo');
    btn.dataset.b64 = b64; btn.style.display = 'inline-block';
  });
};
window.guardarLogo = async function(btn) {
  const b64 = btn.dataset.b64; if (!b64) return;
  try {
    const ref = doc(db, 'config', 'site');
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    await setDoc(ref, { ...data, logo: b64 });
    document.querySelectorAll('.site-logo').forEach(el => el.src = b64);
    showOk('ok-logo');
  } catch (e) { console.warn('Logo save:', e); }
};

// ── GALERÍA ──
window.seleccionarFoto = function(input) {
  const file = input.files[0]; if (!file) return;
  const titulo = document.getElementById('foto-titulo').value.trim();
  comprimirImagen(file, 600, 0.82).then(b64 => {
    pendingFoto = { b64, titulo };
    const prev = document.getElementById('foto-preview-pending');
    if (prev) {
      prev.innerHTML = `<div class="galeria-pending"><img src="${b64}" alt=""/><div><div style="color:#fff;font-size:.8rem">${titulo||'Sin título'}</div></div><button onclick="cancelarFoto()" style="margin-left:auto;background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:1.1rem">✕</button></div>`;
      prev.style.display = 'block';
    }
    document.getElementById('btn-guardar-foto').style.display = 'inline-block';
  });
};
window.cancelarFoto = function() {
  pendingFoto = null;
  const prev = document.getElementById('foto-preview-pending');
  if (prev) { prev.innerHTML = ''; prev.style.display = 'none'; }
  document.getElementById('btn-guardar-foto').style.display = 'none';
  document.getElementById('foto-titulo').value = '';
  const inp = document.getElementById('foto-file-input'); if (inp) inp.value = '';
};
window.guardarFoto = async function() {
  if (!pendingFoto) return;
  const btn = document.getElementById('btn-guardar-foto');
  btn.textContent = '⏳ Subiendo...'; btn.disabled = true;
  try {
    await addDoc(collection(db, 'galeria'), { url: pendingFoto.b64, titulo: pendingFoto.titulo || '', orden: Date.now(), creado: serverTimestamp() });
    cancelarFoto(); showOk('ok-galeria');
  } catch (e) { alert('Error: ' + (e?.message || e)); }
  btn.textContent = '💾 Guardar foto'; btn.disabled = false;
};
window.eliminarFoto = async function(id) {
  if (!confirm('¿Eliminar esta foto?')) return;
  await deleteDoc(doc(db, 'galeria', id));
};
export function renderGaleriaAdmin(fotos) {
  const grid = document.getElementById('galeria-admin-grid'); if (!grid) return;
  if (!fotos.length) { grid.innerHTML = '<p style="color:rgba(255,255,255,.3);font-size:.78rem">No hay fotos aún.</p>'; return; }
  grid.innerHTML = fotos.map(f => `
    <div class="galeria-admin-item">
      <img src="${f.url}" alt="${f.titulo||''}" loading="lazy"/>
      <button class="del-foto" onclick="eliminarFoto('${f.id}')">✕</button>
      ${f.titulo ? `<div class="g-item-label">${f.titulo}</div>` : ''}
    </div>`).join('');
}

// ══════════════════════════════════════════
// ── PROMOCIONES — CRUD COMPLETO ──
// ══════════════════════════════════════════
window.cargarAdminPromociones = async function() {
  const lista = document.getElementById('promo-lista'); if (!lista) return;
  lista.innerHTML = '<div class="no-citas"><span class="spin">⏳</span> Cargando...</div>';
  try {
    const promos = await api('/promociones');
    if (!promos.length) {
      lista.innerHTML = '<div class="no-citas">No hay promociones. Crea la primera con el botón de arriba ☝️</div>';
      return;
    }
    lista.innerHTML = promos.map(p => `
      <div class="cita-item">
        <div class="cita-item-header">
          <div class="cita-name">🎁 ${p.titulo}</div>
          <button class="btn-delete" onclick="eliminarPromocion('${p.id}')">✕ Eliminar</button>
        </div>
        <div class="cita-details">
          <div>${p.descripcion || ''}</div>
          <div>${p.descuento ? '🏷️ ' + p.descuento : ''}</div>
          ${p.fechafin ? `<div>📅 Hasta: ${p.fechafin}</div>` : ''}
        </div>
      </div>`).join('');
  } catch (e) {
    lista.innerHTML = `<div class="no-citas" style="color:#ff6b6b">❌ ${e?.message}<br><small>Toca 🔄 Actualizar para reintentar.</small></div>`;
  }
};

window.abrirFormPromo = function() {
  ['promo-titulo','promo-desc','promo-descuento','promo-inicio','promo-fin'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const ov = document.getElementById('overlay-nueva-promo');
  if (ov) { ov.classList.add('show'); document.body.style.overflow = 'hidden'; }
};

window.guardarPromocion = async function() {
  const titulo = document.getElementById('promo-titulo')?.value.trim();
  if (!titulo) { alert('El título es obligatorio.'); return; }
  const btn = document.querySelector('#overlay-nueva-promo .btn-save');
  if (btn) { btn.textContent = '⏳ Guardando...'; btn.disabled = true; }
  try {
    await api('/promociones', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titulo,
        descripcion: document.getElementById('promo-desc')?.value.trim() || '',
        descuento:   document.getElementById('promo-descuento')?.value.trim() || '',
        fechainicio: document.getElementById('promo-inicio')?.value || '',
        fechafin:    document.getElementById('promo-fin')?.value || ''
      })
    });
    const ov = document.getElementById('overlay-nueva-promo');
    if (ov) { ov.classList.remove('show'); document.body.style.overflow = ''; }
    window.cargarAdminPromociones();
    showOk('ok-promos');
  } catch (e) { alert('❌ Error: ' + (e?.message || e)); }
  if (btn) { btn.textContent = '💾 Guardar promoción'; btn.disabled = false; }
};

window.eliminarPromocion = async function(id) {
  if (!confirm('¿Eliminar esta promoción?')) return;
  try { await api('/promociones/' + id, { method: 'DELETE' }); window.cargarAdminPromociones(); }
  catch (e) { alert('Error: ' + (e?.message || e)); }
};

// ══════════════════════════════════════════
// ── RESEÑAS — CRUD COMPLETO ──
// ══════════════════════════════════════════
window.cargarAdminResenas = async function() {
  const lista = document.getElementById('resenas-lista'); if (!lista) return;
  lista.innerHTML = '<div class="no-citas"><span class="spin">⏳</span> Cargando...</div>';
  try {
    const resenas = await api('/resenas');
    if (!resenas.length) {
      lista.innerHTML = '<div class="no-citas">No hay reseñas aún. Aparecerán aquí cuando alguien envíe una desde la página.</div>';
      return;
    }
    const pendientes = resenas.filter(r => !r.aprobada).length;
    lista.innerHTML = `
      ${pendientes > 0 ? `<div style="background:rgba(255,193,7,.12);border:1px solid rgba(255,193,7,.35);border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:.8rem;color:#ffc107">⚠️ ${pendientes} reseña${pendientes>1?'s':''} pendiente${pendientes>1?'s':''} de aprobación — Las reseñas <strong>sólo aparecen en la web pública</strong> después de que hagas clic en ✅ Aprobar.</div>` : ''}
      ${resenas.map(r => `
      <div class="cita-item">
        <div class="cita-item-header">
          <div class="cita-name">⭐ ${'★'.repeat(r.estrellas||5)} ${r.nombre}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn-export" style="${r.aprobada?'background:rgba(76,175,80,.2);color:#4CAF50':''}" onclick="aprobarResena('${r.id}',${!r.aprobada})">${r.aprobada?'✅ Publicada':'⏳ Aprobar'}</button>
            <button class="btn-delete" onclick="eliminarResena('${r.id}')">✕</button>
          </div>
        </div>
        <div class="cita-details">
          <div>💅 ${r.servicio||'Sin especificar'}</div>
          <div style="grid-column:span 2;font-style:italic">"${r.comentario||''}"</div>
        </div>
      </div>`).join('')}`;
  } catch (e) {
    lista.innerHTML = `<div class="no-citas" style="color:#ff6b6b">❌ ${e?.message}<br><small>Toca 🔄 Actualizar.</small></div>`;
  }
};

window.aprobarResena = async function(id, estado) {
  try {
    await api('/resenas/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aprobada: estado }) });
    window.cargarAdminResenas();
  } catch (e) { alert('Error: ' + (e?.message || e)); }
};

window.eliminarResena = async function(id) {
  if (!confirm('¿Eliminar esta reseña?')) return;
  try { await api('/resenas/' + id, { method: 'DELETE' }); window.cargarAdminResenas(); }
  catch (e) { alert('Error: ' + (e?.message || e)); }
};

// ── ENVIAR RESEÑA PÚBLICA ──
window.enviarResena = async function(e) {
  e.preventDefault();
  const nombre     = document.getElementById('res-nombre')?.value.trim();
  const estrellas  = document.getElementById('res-estrellas')?.value;
  const servicio   = document.getElementById('res-servicio')?.value.trim();
  const comentario = document.getElementById('res-comentario')?.value.trim();
  if (!nombre || !comentario) { alert('Nombre y comentario son obligatorios.'); return; }
  const btn = document.getElementById('btn-resena');
  btn.disabled = true; btn.textContent = '⏳ Enviando...';
  try {
    await api('/resenas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, estrellas: Number(estrellas)||5, servicio, comentario })
    }, 35000);
    document.getElementById('resena-form').reset();
    const ok = document.getElementById('resena-ok');
    if (ok) { ok.style.display = 'block'; setTimeout(() => ok.style.display = 'none', 5000); }
  } catch (err) {
    alert('❌ ' + (err?.message || 'Error al enviar. Intenta de nuevo.'));
  }
  btn.disabled = false; btn.textContent = '💅 Enviar reseña';
};
