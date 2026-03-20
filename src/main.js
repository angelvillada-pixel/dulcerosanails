import { LOGO } from './assets/logo.js';
import { db, collection, doc, getDoc, setDoc, addDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, serverTimestamp } from './firebase.js';
import { HORAS_DEFAULT, PRECIOS_DEFAULT, PRECIO_IDS, fechaHoyColombia, formatCOP } from './data.js';
import { renderGaleriaPublica } from './galeria.js';
import { renderGaleriaAdmin } from './admin.js';
import './admin.js';

// ── Estado global ──
window._horasDisponibles = [...HORAS_DEFAULT];
let horaSeleccionada = null;
let unsubSlots = null;

// ── Cargar logo ──
document.querySelectorAll('.site-logo').forEach(el => el.src = LOGO);

// ── Listeners en tiempo real ──
onSnapshot(doc(db, 'config', 'site'), snap => {
  if (!snap.exists()) return;
  const d = snap.data();
  if (d.logo)    document.querySelectorAll('.site-logo').forEach(el => el.src = d.logo);
  if (d.nequi)   document.querySelectorAll('.nequi-num').forEach(el => el.textContent = d.nequi);
  if (d.horarios?.length) window._horasDisponibles = d.horarios;
});

onSnapshot(doc(db, 'config', 'precios'), snap => {
  if (!snap.exists()) return;
  const p = snap.data();
  Object.entries(PRECIO_IDS).forEach(([elId, key]) => {
    const el = document.getElementById(elId);
    if (el && p[key]) el.textContent = formatCOP(p[key]);
  });
  actualizarSelectPrecios(p);
});

onSnapshot(collection(db, 'galeria'), snap => {
  const fotos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));
  renderGaleriaPublica(fotos);
  renderGaleriaAdmin(fotos);
});

function actualizarSelectPrecios(p) {
  const items = [
    ['Esmaltado Tradicional Manos', p.esmaltado_manos],
    ['Esmaltado Tradicional Pies',  p.esmaltado_pies],
    ['Semipermanente Hombres',      p.semi_hombres],
    ['Semipermanente Mujeres',      p.semi_mujeres],
    ['Press On',                    p.press_on],
    ['Dipping de Acrílico',         p.dipping],
    ['Acrílicas',                   p.acrilicas],
    ['Poligel',                     p.poligel],
    ['Retoque Press On',            p.ret_press_on],
    ['Retoque Acrílicas',           p.ret_acrilicas],
    ['Retoque Poligel',             p.ret_poligel],
    ['Retiro Semipermanente',       p.ret_semi],
    ['Retiro Press On',             p.ret_press_on2],
    ['Retiro Acrílicas',            p.ret_acrilicas2]
  ];
  const sel = document.getElementById('inp-servicio');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="" disabled selected>Selecciona un servicio</option>';
  const grupos = { 'Esmaltado': [0,1,2,3], 'Uñas': [4,5,6,7], 'Retoques': [8,9,10], 'Retiros': [11,12,13] };
  Object.entries(grupos).forEach(([g, idxs]) => {
    const og = document.createElement('optgroup');
    og.label = g;
    idxs.forEach(i => {
      const o = document.createElement('option');
      const v = items[i][1];
      o.textContent = items[i][0] + (v ? ' — ' + formatCOP(v) : '');
      o.value = o.textContent;
      og.appendChild(o);
    });
    sel.appendChild(og);
  });
  if (cur) sel.value = cur;
}

// ── Slots ──
window.cargarSlots = async function() {
  const fecha = document.getElementById('inp-fecha').value;
  if (!fecha) return;
  horaSeleccionada = null;
  document.getElementById('inp-hora').value = '';
  if (unsubSlots) { unsubSlots(); unsubSlots = null; }
  document.getElementById('slots-grid').innerHTML =
    '<div class="slots-loading"><span class="spin">⏳</span> Cargando...</div>';
  unsubSlots = onSnapshot(doc(db, 'slots', fecha), snap => {
    const booked = snap.exists() ? (snap.data().booked || []) : [];
    renderSlots(booked);
  });
};

function renderSlots(booked) {
  const grid = document.getElementById('slots-grid');
  grid.innerHTML = '';
  window._horasDisponibles.forEach(h => {
    const ok = booked.includes(h);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slot-btn' + (ok ? ' taken' : '');
    b.textContent = h;
    if (!ok) b.onclick = () => selSlot(h, b);
    grid.appendChild(b);
  });
}

function selSlot(h, el) {
  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  horaSeleccionada = h;
  document.getElementById('inp-hora').value = h;
}

// ── Enviar cita ──
window.enviarCita = async function(e) {
  e.preventDefault();
  const hora = document.getElementById('inp-hora').value;
  if (!hora) { alert('Por favor selecciona un horario.'); return; }
  const fecha    = document.getElementById('inp-fecha').value;
  const nombre   = document.getElementById('inp-nombre').value.trim();
  const tel      = document.getElementById('inp-tel').value.trim();
  const servicio = document.getElementById('inp-servicio').value;
  const nota     = document.getElementById('inp-nota').value.trim();
  const booked   = await getDoc(doc(db, 'slots', fecha));
  if (booked.exists() && (booked.data().booked || []).includes(hora)) {
    alert('Este horario acaba de ser reservado. Elige otro.'); window.cargarSlots(); return;
  }
  const btn = document.getElementById('btn-submit');
  btn.textContent = '⏳ Enviando...'; btn.disabled = true;
  try {
    const ref = doc(db, 'slots', fecha);
    const s = await getDoc(ref);
    if (s.exists()) await updateDoc(ref, { booked: arrayUnion(hora) });
    else await setDoc(ref, { booked: [hora] });
    await addDoc(collection(db, 'citas'), { nombre, tel, servicio, fecha, hora, nota, creado: serverTimestamp() });
    await fetch('https://formsubmit.co/ajax/anacjimenez79@gmail.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        _subject: '💅 Nueva cita — Dulce Rosa Nails Spa',
        Nombre: nombre, Teléfono: tel, Servicio: servicio,
        Fecha: fecha, Hora: hora, Nota: nota || 'Sin comentarios', _template: 'table'
      })
    });
    const toast = document.getElementById('toast');
    toast.classList.remove('toast-error');
    toast.textContent = '🌸 ¡Cita enviada! Te contactaremos para confirmar y recibir el abono.';
    toast.classList.add('show');
    btn.textContent = '✅ ¡Cita solicitada!';
    btn.style.background = 'linear-gradient(135deg,#4CAF50,#66BB6A)';
  } catch (err) {
    btn.textContent = '✦ Solicitar cita ahora'; btn.disabled = false;
    const toast = document.getElementById('toast');
    toast.classList.add('show', 'toast-error');
    toast.textContent = '❌ Error al enviar. Inténtalo de nuevo.';
  }
};

// ── Admin Auth ──
const AU = 'DulceRosa28', AP = 'luciana28';

window.abrirLogin = function() {
  document.getElementById('auth-user').value = '';
  document.getElementById('auth-pass').value = '';
  document.getElementById('auth-error').classList.remove('show');
  document.getElementById('overlay-login').classList.add('show');
};

window.cerrarOverlay = function(id) { document.getElementById(id).classList.remove('show'); };

window.verificarCredenciales = function() {
  if (document.getElementById('auth-user').value === AU &&
      document.getElementById('auth-pass').value === AP) {
    window.cerrarOverlay('overlay-login');
    document.getElementById('overlay-admin').classList.add('show');
    window.switchTab('citas');
    window.renderCitas().catch(console.error);
    window.cargarAdminConfig().catch(console.error);
    window.cargarAdminPrecios().catch(console.error);
  } else {
    document.getElementById('auth-error').classList.add('show');
  }
};

// ── Init DOM ──
document.addEventListener('DOMContentLoaded', () => {
  // Fecha mínima en hora colombiana
  const fi = document.querySelector('input[type="date"]');
  if (fi) fi.min = fechaHoyColombia();

  document.getElementById('auth-pass')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') window.verificarCredenciales();
  });

  window.addEventListener('scroll', () =>
    document.getElementById('navbar').classList.toggle('scrolled', scrollY > 40));

  const obs = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.style.opacity = '1'; e.target.style.transform = 'translateY(0)'; }
  }), { threshold: 0.1 });

  document.querySelectorAll('.service-card').forEach(el => {
    el.style.cssText = 'opacity:0;transform:translateY(22px);transition:opacity .5s ease,transform .5s ease';
    obs.observe(el);
  });

  document.querySelectorAll('.overlay').forEach(o =>
    o.addEventListener('click', e => { if (e.target === o) o.classList.remove('show'); }));
});
