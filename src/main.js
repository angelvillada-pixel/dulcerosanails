import { LOGO } from './assets/logo.js';
import { db, collection, doc, getDoc, setDoc, addDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, serverTimestamp } from './firebase.js';
import { HORAS_DEFAULT, PRECIOS_DEFAULT, SERVICIO_KEYS, CATEGORIAS, fechaHoyColombia, formatCOP, comprimirImagen } from './data.js';
import { renderGaleriaPublica } from './galeria.js';
import { renderGaleriaAdmin, showOk } from './admin.js';
import './admin.js';

// ── ESTADO GLOBAL ──
window._horasDisponibles = [...HORAS_DEFAULT];
let horaSeleccionada = null;
let unsubSlots = null;

// ── LOGO ──
document.querySelectorAll('.site-logo').forEach(el => el.src = LOGO);
document.getElementById('preview-logo-admin').src = LOGO;

// ── RENDER SERVICIOS ──
function renderServicios(serviciosData = {}, preciosData = {}) {
  const cont = document.getElementById('servicios-container');
  if (!cont) return;
  const cats = [...new Set(SERVICIO_KEYS.map(s => s.cat))];
  cont.innerHTML = cats.map((cat, ci) => {
    const svcs = SERVICIO_KEYS.filter(s => s.cat === cat);
    return `<div class="service-category reveal" style="transition-delay:${ci * 0.08}s">
      <div class="category-label">${cat}</div>
      <div class="services-grid">
        ${svcs.map((s, si) => {
          const info = serviciosData[s.id] || {};
          const nombre = info.nombre || s.nombre;
          const imagen = info.imagen || null;
          const precio = preciosData[s.id] || PRECIOS_DEFAULT[s.id];
          return `<div class="service-card reveal" style="transition-delay:${(ci * 4 + si) * 0.05}s">
            <div class="service-img-zone">
              ${imagen
                ? `<img class="svc-img" src="${imagen}" alt="${nombre}"/>`
                : `<span class="svc-emoji">${s.emoji}</span>`}
            </div>
            <div class="service-name" id="sn-${s.id}">${nombre}</div>
            <div class="service-price">${s.desde ? '<span class="price-from">Desde </span>' : ''}${formatCOP(precio)}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
  initReveal();
}

// ── LISTENERS TIEMPO REAL ──
let preciosActuales = { ...PRECIOS_DEFAULT };
let serviciosActuales = {};

onSnapshot(doc(db, 'config', 'site'), snap => {
  if (!snap.exists()) return;
  const d = snap.data();
  if (d.logo) document.querySelectorAll('.site-logo').forEach(el => el.src = d.logo);
  if (d.nequi) document.querySelectorAll('.nequi-num').forEach(el => el.textContent = d.nequi);
  if (d.horarios) {
    // Always update, even if empty array (means all blocked)
    window._horasDisponibles = d.horarios.length ? d.horarios : [...HORAS_DEFAULT];
    // Regenerar slots si hay una fecha seleccionada
    const fecha = document.getElementById('inp-fecha')?.value;
    if (fecha) window.cargarSlots();
  }
});

onSnapshot(doc(db, 'config', 'precios'), snap => {
  if (!snap.exists()) return;
  preciosActuales = { ...PRECIOS_DEFAULT, ...snap.data() };
  renderServicios(serviciosActuales, preciosActuales);
  actualizarSelectServicios();
});

onSnapshot(doc(db, 'config', 'servicios'), snap => {
  if (!snap.exists()) return;
  serviciosActuales = snap.data();
  renderServicios(serviciosActuales, preciosActuales);
  actualizarSelectServicios();
});

onSnapshot(collection(db, 'galeria'), snap => {
  const fotos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));
  renderGaleriaPublica(fotos);
  renderGaleriaAdmin(fotos);
});

// Render inicial
renderServicios({}, PRECIOS_DEFAULT);

function actualizarSelectServicios() {
  const sel = document.getElementById('inp-servicio');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="" disabled selected>Selecciona un servicio</option>';
  const cats = [...new Set(SERVICIO_KEYS.map(s => s.cat))];
  cats.forEach(cat => {
    const og = document.createElement('optgroup');
    og.label = cat.replace(/^[^\s]+ /, '');
    SERVICIO_KEYS.filter(s => s.cat === cat).forEach(s => {
      const info = serviciosActuales[s.id] || {};
      const nombre = info.nombre || s.nombre;
      const precio = preciosActuales[s.id] || PRECIOS_DEFAULT[s.id];
      const o = document.createElement('option');
      o.textContent = `${nombre} — ${formatCOP(precio)}`;
      o.value = o.textContent;
      og.appendChild(o);
    });
    sel.appendChild(og);
  });
  if (cur) sel.value = cur;
}

// ── OVERLAYS ──
window.abrirOverlay = function(id) {
  document.getElementById(id).classList.add('show');
  document.body.style.overflow = 'hidden';
};
window.cerrarOverlay = function(id) {
  document.getElementById(id).classList.remove('show');
  document.body.style.overflow = '';
};

// ── SLOTS ──
window.cargarSlots = async function() {
  const fecha = document.getElementById('inp-fecha').value;
  if (!fecha) return;
  horaSeleccionada = null;
  document.getElementById('inp-hora').value = '';
  if (unsubSlots) { unsubSlots(); unsubSlots = null; }
  document.getElementById('slots-grid').innerHTML =
    '<div class="slots-loading"><span class="spin">⏳</span> Cargando horarios...</div>';
  unsubSlots = onSnapshot(doc(db, 'slots', fecha), snap => {
    const booked = snap.exists() ? (snap.data().booked || []) : [];
    renderSlots(booked);
  });
};

function renderSlots(booked) {
  const grid = document.getElementById('slots-grid');
  const horas = window._horasDisponibles || HORAS_DEFAULT;
  if (!horas.length) {
    grid.innerHTML = '<div class="slots-ph">No hay horarios disponibles configurados.</div>';
    return;
  }
  grid.innerHTML = '';
  horas.forEach(h => {
    const taken = booked.includes(h);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slot-btn' + (taken ? ' taken' : '');
    b.textContent = h;
    if (!taken) b.onclick = () => selSlot(h, b);
    grid.appendChild(b);
  });
}

function selSlot(h, el) {
  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  horaSeleccionada = h;
  document.getElementById('inp-hora').value = h;
}

// ── ENVIAR CITA ──
window.enviarCita = async function(e) {
  e.preventDefault();
  const hora = document.getElementById('inp-hora').value;
  if (!hora) { mostrarToast('Por favor selecciona un horario disponible.', true); return; }
  const fecha    = document.getElementById('inp-fecha').value;
  const nombre   = document.getElementById('inp-nombre').value.trim();
  const tel      = document.getElementById('inp-tel').value.trim();
  const servicio = document.getElementById('inp-servicio').value;
  const nota     = document.getElementById('inp-nota').value.trim();

  const btn = document.getElementById('btn-submit');
  btn.textContent = '⏳ Enviando...'; btn.disabled = true;

  try {
    // Verificar que el slot sigue libre
    const slotSnap = await getDoc(doc(db, 'slots', fecha));
    if (slotSnap.exists() && (slotSnap.data().booked || []).includes(hora)) {
      mostrarToast('Este horario acaba de ser tomado. Elige otro.', true);
      btn.textContent = '✦ Solicitar cita ahora'; btn.disabled = false;
      window.cargarSlots(); return;
    }
    // Bloquear slot
    const ref = doc(db, 'slots', fecha);
    const s = await getDoc(ref);
    if (s.exists()) await updateDoc(ref, { booked: arrayUnion(hora) });
    else await setDoc(ref, { booked: [hora] });
    // Guardar cita
    await addDoc(collection(db, 'citas'), { nombre, tel, servicio, fecha, hora, nota, creado: serverTimestamp() });
    // Email
    try {
      await fetch('https://formsubmit.co/ajax/anacjimenez79@gmail.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ _subject: '💅 Nueva cita — Dulce Rosa Nails Spa',
          Nombre: nombre, Teléfono: tel, Servicio: servicio, Fecha: fecha, Hora: hora,
          Nota: nota || 'Sin comentarios', _template: 'table' })
      });
    } catch {}
    mostrarToast('🌸 ¡Cita enviada! Te contactaremos para confirmar y recibir el abono.', false);
    btn.textContent = '✅ ¡Cita solicitada!';
    btn.style.background = 'linear-gradient(135deg,#4CAF50,#66BB6A)';
  } catch (err) {
    console.error('Error cita:', err);
    mostrarToast('❌ Error al enviar. Verifica tu conexión e intenta de nuevo.', true);
    btn.textContent = '✦ Solicitar cita ahora'; btn.disabled = false;
  }
};

function mostrarToast(msg, esError) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast show' + (esError ? ' toast-error' : '');
  setTimeout(() => toast.classList.remove('show'), 5000);
}

// ── AUTH ADMIN ──
const AU = 'DulceRosa28', AP = 'luciana28';

window.abrirLogin = function() {
  document.getElementById('auth-user').value = '';
  document.getElementById('auth-pass').value = '';
  document.getElementById('auth-error').classList.remove('show');
  abrirOverlay('overlay-login');
};

window.verificarCredenciales = function() {
  if (document.getElementById('auth-user').value === AU &&
      document.getElementById('auth-pass').value === AP) {
    cerrarOverlay('overlay-login');
    abrirOverlay('overlay-admin');
    window.switchTab('citas');
    window.renderCitas().catch(console.error);
    window.cargarAdminConfig().catch(console.error);
    window.cargarAdminPrecios().catch(console.error);
  } else {
    document.getElementById('auth-error').classList.add('show');
  }
};

// ── REVEAL ANIMATIONS ──
function initReveal() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
  }, { threshold: 0, rootMargin: '0px 0px -30px 0px' });
  document.querySelectorAll('.reveal, .reveal-left, .reveal-right').forEach(el => {
    // Elementos ya en viewport: hacerlos visibles inmediatamente
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom >= 0) {
      el.classList.add('visible');
    } else {
      obs.observe(el);
    }
  });
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  // Fecha mínima colombiana
  const fi = document.getElementById('inp-fecha');
  if (fi) fi.min = fechaHoyColombia();

  // Scroll nav
  window.addEventListener('scroll', () =>
    document.getElementById('navbar').classList.toggle('scrolled', scrollY > 40));

  // Enter en login
  document.getElementById('auth-pass')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') window.verificarCredenciales();
  });

  // Cerrar overlays al click en fondo
  document.querySelectorAll('.overlay').forEach(o =>
    o.addEventListener('click', e => { if (e.target === o) cerrarOverlay(o.id); }));

  // ESC cierra overlays
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.overlay.show').forEach(o => cerrarOverlay(o.id));
  });

  // Lightbox cierra al click fondo
  document.getElementById('lightbox')?.addEventListener('click', e => {
    if (e.target === document.getElementById('lightbox') || e.target.tagName !== 'IMG') window.cerrarLightbox();
  });

  // Init animations (delay ensures layout is computed)
  initReveal();
  setTimeout(initReveal, 200);
  actualizarSelectServicios();
});
