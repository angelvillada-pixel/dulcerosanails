import { db, collection, doc, getDoc, setDoc, addDoc, getDocs, deleteDoc, onSnapshot, updateDoc, arrayRemove, serverTimestamp } from './firebase.js';
import { PRECIOS_DEFAULT, HORAS_DEFAULT, SERVICIO_KEYS, CATEGORIAS, comprimirImagen, formatCOP } from './data.js';

function waitForFirebase() {
  return new Promise(resolve => {
    if (window.__db) return resolve();
    window.addEventListener('fb-ready', resolve, { once: true });
    setTimeout(resolve, 5000);
  });
}

let pendingFoto = null; // { b64, titulo }
window._svcImages = {}; // Map de id -> b64 para imágenes de servicios pendientes

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
    // Add timeout to avoid hanging forever
    const snap = await Promise.race([
      getDocs(collection(db, 'citas')),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
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
            <span class="cita-badge">${c.fecha} · ${c.hora}</span>
            <button class="btn-delete" onclick="eliminarCita('${c.id}','${c.fecha}','${c.hora}')">✕</button>
          </div>
        </div>
        <div class="cita-details">
          <div>📞 ${c.tel}</div><div>💅 ${(c.servicio || '').split('—')[0].trim()}</div>
          ${c.nota ? `<div style="grid-column:span 2">📝 ${c.nota}</div>` : ''}
        </div>
      </div>`).join('');
  } catch (e) {
    const msg = e?.message === 'timeout' ? 'La conexión tardó mucho. Toca 🔄 Actualizar.' : 'Error: ' + (e?.message || e);
    lista.innerHTML = `<div class="no-citas">${msg}</div>`;
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
    .forEach((c, i) => { txt += `${i + 1}. ${c.nombre}\n   Tel: ${c.tel}\n   Servicio: ${c.servicio}\n   Fecha: ${c.fecha} a las ${c.hora}\n${c.nota ? '   Nota: ' + c.nota + '\n' : ''}\n`; });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
  a.download = 'citas-dulce-rosa.txt'; a.click();
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
    if (btn) { btn.textContent = '💾 Guardar configuración'; btn.disabled = false; }
  } catch (e) { console.warn('Config save:', e); if (btn) { btn.textContent = '💾 Guardar configuración'; btn.disabled = false; } }
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

// ── SERVICIOS (nombres + imágenes) ──
window.cargarAdminServicios = async function() {
  // Render immediately with defaults, no waiting
  const cont = document.getElementById('svc-edit-list');
  if (!cont) return;
  cont.innerHTML = '';
  let serviciosData = {};
  // Render right away
  _renderSvcList(cont, serviciosData);
  // Then update from Firebase in background
  try {
    const snap = await getDoc(doc(db, 'config', 'servicios'));
    if (snap.exists()) { serviciosData = snap.data(); _renderSvcList(cont, serviciosData); }
  } catch (e) { console.warn('servicios load:', e); }
};

function _renderSvcList(cont, serviciosData) {
  cont.innerHTML = '';
  CATEGORIAS.forEach(cat => {
    const svcs = SERVICIO_KEYS.filter(s => s.cat === cat);
    const catDiv = document.createElement('div');
    catDiv.innerHTML = `<div class="svc-cat-title">${cat}</div>`;
    svcs.forEach(s => {
      const info = serviciosData[s.id] || {};
      const nombre = info.nombre || s.nombre;
      const imagen = info.imagen || null;
      const card = document.createElement('div');
      card.className = 'svc-edit-card';
      card.innerHTML = `
        <div class="svc-edit-img" id="svc-img-preview-${s.id}">
          ${imagen ? `<img src="${imagen}" alt="${nombre}"/>` : `<span>${s.emoji}</span>`}
        </div>
        <div class="svc-edit-body">
          <input type="text" id="svc-name-${s.id}" value="${nombre}" placeholder="${s.nombre}"/>
        </div>
        <label class="btn-img-svc">
          📷 Imagen
          <input type="file" accept="image/*" style="display:none" onchange="subirImagenServicio('${s.id}',this)"/>
        </label>`;
      catDiv.appendChild(card);
    });
    cont.appendChild(catDiv);
  });
}

window.subirImagenServicio = function(id, input) {
  const file = input.files[0];
  if (!file) return;
  comprimirImagen(file, 80, 0.45).then(b64 => {  // tiny thumbnail to stay under Firestore 1MB limit
    window._svcImages[id] = b64;
    const prev = document.getElementById('svc-img-preview-' + id);
    if (prev) prev.innerHTML = `<img src="${b64}" alt="" style="width:44px;height:44px;border-radius:6px;object-fit:cover"/>`;
  });
};

window.guardarServicios = async function() {
  const btn = document.querySelector('#tab-servicios .btn-save');
  if (btn) { btn.textContent = '⏳ Guardando...'; btn.disabled = true; }
  try {
    // Obtener nombres actuales del DOM
    const servicios = {};
    SERVICIO_KEYS.forEach(s => {
      const nameEl = document.getElementById('svc-name-' + s.id);
      servicios[s.id] = {
        nombre: nameEl ? (nameEl.value.trim() || s.nombre) : s.nombre,
        imagen: window._svcImages[s.id] || null
      };
    });
    // Preservar imágenes existentes si no se subió una nueva
    const snap = await getDoc(doc(db, 'config', 'servicios'));
    const existing = snap.exists() ? snap.data() : {};
    SERVICIO_KEYS.forEach(s => {
      if (!servicios[s.id].imagen && existing[s.id]?.imagen) {
        servicios[s.id].imagen = existing[s.id].imagen;
      }
    });
    await setDoc(doc(db, 'config', 'servicios'), servicios);
    window._svcImages = {}; // limpiar pendientes
    showOk('ok-servicios');
    if (btn) { btn.textContent = '💾 Guardar nombres e imágenes'; btn.disabled = false; }
  } catch (e) {
    console.error('Servicios save error:', e);
    const msg = e?.code === 'permission-denied' ? 'Firebase: permiso denegado. Revisa las reglas de Firestore.' 
      : e?.code === 'unavailable' ? 'Firebase no disponible. Verifica tu conexión.'
      : 'Error: ' + (e?.message || e);
    alert(msg);
    if (btn) { btn.textContent = '💾 Guardar nombres e imágenes'; btn.disabled = false; }
  }
};

// ── LOGO ──
window.previsualizarLogo = function(input) {
  const file = input.files[0];
  if (!file) return;
  comprimirImagen(file, 300, 0.85).then(b64 => {
    document.getElementById('preview-logo-admin').src = b64;
    const btn = document.getElementById('btn-guardar-logo');
    btn.dataset.b64 = b64; btn.style.display = 'inline-block';
  });
};

window.guardarLogo = async function(btn) {
  const b64 = btn.dataset.b64;
  if (!b64) return;
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
  const file = input.files[0];
  if (!file) return;
  const titulo = document.getElementById('foto-titulo').value.trim();
  comprimirImagen(file, 380, 0.62).then(b64 => {
    pendingFoto = { b64, titulo, file };
    // Show preview
    const prev = document.getElementById('foto-preview-pending');
    if (prev) {
      prev.innerHTML = `<div class="galeria-pending">
        <img src="${b64}" alt=""/>
        <div>
          <div style="color:#fff;font-size:.8rem">${titulo || 'Sin título'}</div>
          <div style="color:rgba(255,255,255,.4);font-size:.72rem">${(b64.length / 1024).toFixed(0)}KB comprimida</div>
        </div>
        <button onclick="cancelarFoto()" style="margin-left:auto;background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:1.1rem">✕</button>
      </div>`;
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
  const input = document.getElementById('foto-file-input');
  if (input) input.value = '';
};

window.guardarFoto = async function() {
  if (!pendingFoto) return;
  const btn = document.getElementById('btn-guardar-foto');
  btn.textContent = '⏳ Subiendo...'; btn.disabled = true;
  try {
    await addDoc(collection(db, 'galeria'), {
      url: pendingFoto.b64,
      titulo: pendingFoto.titulo || '',
      orden: Date.now(),
      creado: serverTimestamp()
    });
    // Fade out title
    const titleEl = document.getElementById('foto-titulo');
    if (titleEl) { titleEl.classList.add('foto-titulo-fade'); setTimeout(() => { titleEl.value = ''; titleEl.classList.remove('foto-titulo-fade'); }, 400); }
    cancelarFoto();
    showOk('ok-galeria');
    btn.textContent = '💾 Guardar foto'; btn.disabled = false;
  } catch (e) {
    console.error('Foto save error:', e);
    btn.textContent = '💾 Guardar foto'; btn.disabled = false;
    alert('Error al guardar. La imagen puede ser demasiado grande. Intenta con una imagen más pequeña.');
  }
};

window.eliminarFoto = async function(id) {
  if (!confirm('¿Eliminar esta foto?')) return;
  await deleteDoc(doc(db, 'galeria', id));
};

// ── RENDERIZAR GALERÍA EN ADMIN ──
export function renderGaleriaAdmin(fotos) {
  const grid = document.getElementById('galeria-admin-grid');
  if (!grid) return;
  if (!fotos.length) { grid.innerHTML = '<p style="color:rgba(255,255,255,.3);font-size:.78rem">No hay fotos aún.</p>'; return; }
  grid.innerHTML = fotos.map(f => `
    <div class="galeria-admin-item">
      <img src="${f.url}" alt="${f.titulo || ''}" loading="lazy"/>
      <button class="del-foto" onclick="eliminarFoto('${f.id}')">✕</button>
      ${f.titulo ? `<div class="g-item-label">${f.titulo}</div>` : ''}
    </div>`).join('');
}

// ── UTILS ──
export function showOk(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}