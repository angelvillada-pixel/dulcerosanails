import { db, collection, doc, getDoc, setDoc, addDoc, getDocs, deleteDoc, updateDoc, arrayRemove, serverTimestamp } from './firebase.js';
import { PRECIOS_DEFAULT, HORAS_DEFAULT, formatCOP } from './data.js';

export function renderGaleriaAdmin(fotos) {
  const grid = document.getElementById('galeria-admin-grid');
  if (!grid) return;
  if (!fotos.length) {
    grid.innerHTML = '<p style="color:rgba(255,255,255,.3);font-size:.8rem">No hay fotos aún.</p>';
    return;
  }
  grid.innerHTML = fotos.map(f => `
    <div class="galeria-admin-item">
      <img src="${f.url}" alt="${f.titulo || ''}"/>
      <button class="del-foto" onclick="eliminarFoto('${f.id}')">✕</button>
      ${f.titulo ? `<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.6);color:#fff;font-size:.7rem;padding:4px 6px">${f.titulo}</div>` : ''}
    </div>`).join('');
}

// ── Admin tabs ──
window.switchTab = function(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
};

// ── Citas ──
window.renderCitas = async function() {
  const q = (document.getElementById('filtro-citas') || { value: '' }).value.toLowerCase();
  const lista = document.getElementById('lista-citas');
  lista.innerHTML = '<div class="no-citas"><span class="spin">⏳</span> Cargando...</div>';
  try {
    const snap = await getDocs(collection(db, 'citas'));
    const citas = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
    document.getElementById('stat-total').textContent = citas.length;
    document.getElementById('stat-hoy').textContent   = citas.filter(c => c.fecha === hoy).length;
    document.getElementById('stat-prox').textContent  = citas.filter(c => c.fecha >= hoy).length;
    const fil = citas
      .filter(c => !q || c.nombre?.toLowerCase().includes(q) || c.servicio?.toLowerCase().includes(q) || c.fecha?.includes(q) || c.tel?.includes(q))
      .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
    if (!fil.length) { lista.innerHTML = '<div class="no-citas">No hay citas aún 🌸</div>'; return; }
    lista.innerHTML = fil.map(c => `
      <div class="cita-item">
        <div class="cita-item-header">
          <div class="cita-name">👤 ${c.nombre}</div>
          <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">
            <span class="cita-badge">${c.fecha} · ${c.hora}</span>
            <button class="btn-delete" onclick="eliminarCita('${c.id}','${c.fecha}','${c.hora}')">✕</button>
          </div>
        </div>
        <div class="cita-details">
          <div>📞 ${c.tel}</div>
          <div>💅 ${(c.servicio || '').split('—')[0].trim()}</div>
          ${c.nota ? `<div style="grid-column:span 2">📝 ${c.nota}</div>` : ''}
        </div>
      </div>`).join('');
  } catch (e) { lista.innerHTML = '<div class="no-citas">Error cargando citas.</div>'; }
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
    .forEach((c, i) => {
      txt += `${i + 1}. ${c.nombre}\n   Tel: ${c.tel}\n   Servicio: ${c.servicio}\n   Fecha: ${c.fecha} a las ${c.hora}\n${c.nota ? '   Nota: ' + c.nota + '\n' : ''}\n`;
    });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
  a.download = 'citas-dulce-rosa.txt';
  a.click();
};

// ── Config ──
window.cargarAdminConfig = async function() {
  document.getElementById('a-nequi').value = '324 568 3032';
  document.querySelectorAll('.hora-chip').forEach(c => c.classList.add('activa'));
  try {
    const snap = await getDoc(doc(db, 'config', 'site'));
    const d = snap.exists() ? snap.data() : {};
    if (d.nequi) document.getElementById('a-nequi').value = d.nequi;
    const activas = d.horarios || HORAS_DEFAULT;
    document.querySelectorAll('.hora-chip').forEach(chip =>
      chip.classList.toggle('activa', activas.includes(chip.dataset.hora)));
  } catch (e) { console.warn('Firebase config:', e); }
};

window.guardarConfig = async function() {
  const nequi = document.getElementById('a-nequi').value.trim();
  const horarios = [];
  document.querySelectorAll('.hora-chip.activa').forEach(c => horarios.push(c.dataset.hora));
  const horasActivas = horarios.length ? horarios : [...HORAS_DEFAULT];
  window._horasDisponibles = horasActivas;
  document.querySelectorAll('.nequi-num').forEach(el => el.textContent = nequi);
  showOk('ok-config');
  try {
    const ref = doc(db, 'config', 'site');
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    await setDoc(ref, { ...data, nequi, horarios: horasActivas });
  } catch (e) { console.warn('Firebase config save:', e); }
};

window.toggleHora = function(chip) { chip.classList.toggle('activa'); };

// ── Precios ──
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
  } catch (e) { console.warn('Firebase precios:', e); }
};

window.guardarPrecios = async function() {
  const precios = {};
  Object.keys(PRECIOS_DEFAULT).forEach(k => {
    const el = document.getElementById('ap-' + k);
    if (el) precios[k] = Number(el.value) || PRECIOS_DEFAULT[k];
  });
  try {
    await setDoc(doc(db, 'config', 'precios'), precios);
    showOk('ok-precios');
  } catch (e) { console.warn('Firebase precios save:', e); }
};

// ── Logo ──
window.previsualizarLogo = function(input) {
  const file = input.files[0];
  if (!file) return;
  comprimirImagen(file, 300, 0.85).then(b64 => {
    document.getElementById('preview-logo-admin').src = b64;
    document.getElementById('btn-guardar-logo').dataset.b64 = b64;
    document.getElementById('btn-guardar-logo').style.display = 'inline-block';
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
  } catch (e) { console.warn('Firebase logo save:', e); }
};

// ── Galería ──
window.subirFoto = function(input) {
  const file = input.files[0];
  if (!file) return;
  const titulo = document.getElementById('foto-titulo').value.trim();
  comprimirImagen(file, 600, 0.75).then(async b64 => {
    try {
      await addDoc(collection(db, 'galeria'), { url: b64, titulo, orden: Date.now(), creado: serverTimestamp() });
      document.getElementById('foto-titulo').value = '';
      input.value = '';
      showOk('ok-galeria');
    } catch (e) { console.warn('Firebase foto:', e); }
  });
};

window.eliminarFoto = async function(id) {
  if (!confirm('¿Eliminar esta foto?')) return;
  await deleteDoc(doc(db, 'galeria', id));
};

// ── Utils ──
function showOk(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

function comprimirImagen(file, maxW = 600, quality = 0.8) {
  return new Promise(res => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        res(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
