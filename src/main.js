import { LOGO } from './assets/logo.js';
import { db, collection, doc, getDoc, setDoc, addDoc, deleteDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, serverTimestamp } from './firebase.js';
import { HORAS_DEFAULT, PRECIOS_DEFAULT, SERVICIO_KEYS, CATEGORIAS, fechaHoyColombia, formatCOP, comprimirImagen, to12h } from './data.js';
import { renderGaleriaPublica } from './galeria.js';
import { renderGaleriaAdmin, cargarPromosPublicas, cargarResenasPublicas } from './admin.js';

// ── GLOBAL FUNCTIONS — defined immediately so HTML onclicks work ──
window.abrirOverlay = function(id) {
  const el = document.getElementById(id);
  if (id === 'overlay-cita') normalizeCitaOverlayUi();
  if (el) { el.classList.add('show'); document.body.style.overflow = 'hidden'; }
};
window.cerrarOverlay = function(id) {
  const el = document.getElementById(id);
  if (id === 'overlay-cita') normalizeCitaOverlayUi();
  if (el) { el.classList.remove('show'); document.body.style.overflow = ''; }
};
window.abrirLogin = function() {
  document.getElementById('auth-user').value = '';
  document.getElementById('auth-pass').value = '';
  document.getElementById('auth-error').classList.remove('show');
  window.abrirOverlay('overlay-login');
};

window._horasDisponibles = [...HORAS_DEFAULT];
let horaSeleccionada = null;
let unsubSlots = null;
let citaSubmitInFlight = false;

document.querySelectorAll('.site-logo').forEach(el => el.src = LOGO);
setTimeout(() => { const p=document.getElementById('preview-logo-admin'); if(p) p.src=LOGO; },200);

const runtimeIssues = new Map();

function ensureRuntimeBanner() {
  let banner = document.getElementById('runtime-status-banner');
  if (banner) return banner;

  banner = document.createElement('div');
  banner.id = 'runtime-status-banner';
  banner.style.cssText = 'display:none;position:fixed;left:16px;right:16px;bottom:16px;z-index:1200;padding:12px 16px;border-radius:14px;background:rgba(42,21,32,.96);border:1px solid rgba(255,107,107,.35);color:#fff;font:500 13px/1.5 "DM Sans",sans-serif;box-shadow:0 16px 40px rgba(0,0,0,.28);';
  document.body.appendChild(banner);
  return banner;
}

function renderRuntimeIssues() {
  const banner = ensureRuntimeBanner();
  if (!runtimeIssues.size) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }

  banner.style.display = 'block';
  banner.innerHTML = [...runtimeIssues.values()].map(msg => `<div>${msg}</div>`).join('');
}

function setRuntimeIssue(key, message) {
  runtimeIssues.set(key, message);
  renderRuntimeIssues();
}

function clearRuntimeIssue(key) {
  if (runtimeIssues.delete(key)) renderRuntimeIssues();
}

function formatRenderIssue(scope, error) {
  const detail = error?.message || String(error || 'Error desconocido.');
  return `${scope}: ${detail}`;
}

function setBusyButton(button, busyLabel) {
  if (!button) return () => {};

  const idleLabel = button.dataset.idleLabel || button.textContent;
  button.dataset.idleLabel = idleLabel;
  button.textContent = busyLabel;
  button.disabled = true;

  return () => {
    button.textContent = idleLabel;
    button.disabled = false;
    button.style.background = '';
  };
}

function resetSlotsPlaceholder() {
  const grid = document.getElementById('slots-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="slots-ph">Selecciona primero una fecha.</div>';
}

function normalizeCitaOverlayUi() {
  if (citaSubmitInFlight) return;

  const btn = document.getElementById('btn-submit');
  if (btn) {
    const idleLabel = btn.dataset.idleLabel || btn.textContent;
    btn.dataset.idleLabel = idleLabel;
    btn.textContent = idleLabel;
    btn.disabled = false;
    btn.style.background = '';
  }

  const waBtn = document.getElementById('wa-confirm-btn');
  if (waBtn) {
    waBtn.style.display = 'none';
    waBtn.href = '#';
  }
}

// ── RENDER SERVICIOS ──
function renderServicios(serviciosData={}, preciosData={}) {
  const cont = document.getElementById('servicios-container');
  if (!cont) return;
  // Merge SERVICIO_KEYS with any custom services from DB
  const customKeys = serviciosData._custom || [];
  const allKeys = [...SERVICIO_KEYS];
  customKeys.forEach(c => { if (!allKeys.find(k=>k.id===c.id)) allKeys.push(c); });

  // Filter out hidden services
  const visibleKeys = allKeys.filter(s => !(serviciosActuales[s.id]?.hidden));
  const cats = [...new Set(visibleKeys.map(s=>s.cat))];
  cont.innerHTML = cats.map((cat,ci) => {
    const svcs = visibleKeys.filter(s=>s.cat===cat);
    return `<div class="service-category reveal" style="transition-delay:${ci*.08}s">
      <div class="category-label">${cat}</div>
      <div class="services-grid">
        ${svcs.map((s,si) => {
          const info = serviciosData[s.id] || {};
          const nombre  = info.nombre || s.nombre;
          const imagen  = info.imagen || null;
          const precio  = info.precio || preciosData[s.id] || PRECIOS_DEFAULT[s.id] || 0;
          const desc    = info.descripcion || s.descripcion || '';
          const detalles= info.detalles || s.detalles || '';
          const desde   = info.desde || s.desde || false;
          return `<div class="service-card reveal" style="transition-delay:${(ci*4+si)*.05}s"
            data-id="${s.id}" data-nombre="${encodeURIComponent(nombre)}"
            data-precio="${precio}" data-desc="${encodeURIComponent(desc)}"
            data-detalles="${encodeURIComponent(detalles)}"
            data-imagen="${imagen||''}" data-cat="${encodeURIComponent(cat)}"
            data-desde="${desde}"
            onclick="handleCardTap(this)">
            <div class="service-card-img-wrap">
              ${imagen
                ? `<img src="${imagen}" alt="${nombre}" loading="lazy"/>`
                : `<div class="service-card-emoji">${s.emoji||'💅'}</div>`}
            </div>
            <div class="service-card-body">
              <div class="service-card-name">${nombre}</div>
              <div class="service-card-desc">${desc}</div>
              <div class="service-card-price">${desde?'<span class="price-from">Desde </span>':''}${formatCOP(precio)}</div>
            </div>
            <div class="service-card-actions">
              <button class="svc-btn svc-btn-detalles" onclick="event.stopPropagation();abrirDetalles(this.closest('.service-card'))">Ver detalles</button>
              <button class="svc-btn svc-btn-agendar" onclick="event.stopPropagation();abrirCitaConServicio(decodeURIComponent(this.closest('.service-card').dataset.nombre))">Agendar cita</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
  initReveal();
}

// ── CARD TAP (mobile toggle) ──
window.handleCardTap = function(card) {
  const isMobile = window.matchMedia('(max-width:960px)').matches;
  if (!isMobile) return;
  const wasTapped = card.classList.contains('tapped');
  document.querySelectorAll('.service-card.tapped').forEach(c=>c.classList.remove('tapped'));
  if (!wasTapped) card.classList.add('tapped');
};

// ── MODAL DETALLES ──
window.abrirDetalles = function(card) {
  const nombre   = decodeURIComponent(card.dataset.nombre);
  const precio   = card.dataset.precio;
  const desc     = decodeURIComponent(card.dataset.desc);
  const detalles = decodeURIComponent(card.dataset.detalles);
  const imagen   = card.dataset.imagen;
  const cat      = decodeURIComponent(card.dataset.cat);
  const desde    = card.dataset.desde === 'true';

  document.getElementById('det-cat').textContent    = cat;
  document.getElementById('det-nombre').textContent = nombre;
  document.getElementById('det-precio').textContent = (desde?'Desde ':'') + formatCOP(Number(precio));
  document.getElementById('det-desc').textContent   = desc;
  document.getElementById('det-detalles').textContent = detalles;
  document.getElementById('det-nombre-btn').textContent = `Agendar — ${nombre}`;

  const imgEl = document.getElementById('det-img');
  const emojiEl = document.getElementById('det-emoji');
  if (imagen) { imgEl.src=imagen; imgEl.style.display='block'; emojiEl.style.display='none'; }
  else { imgEl.style.display='none'; emojiEl.style.display='flex'; }

  abrirOverlay('overlay-detalles');
};

window.agendarDesdeDetalles = function() {
  const nombre = document.getElementById('det-nombre').textContent;
  cerrarOverlay('overlay-detalles');
  abrirCitaConServicio(nombre);
};

window.abrirCitaConServicio = function(nombre) {
  abrirOverlay('overlay-cita');
  setTimeout(() => {
    const sel = document.getElementById('inp-servicio');
    if (!sel) return;
    for (const opt of sel.options) {
      if (opt.text.toLowerCase().includes(nombre.toLowerCase())) { sel.value=opt.value; break; }
    }
  }, 300);
};

// ── LISTENERS ──
let preciosActuales = {...PRECIOS_DEFAULT};
let serviciosActuales = {};

renderServicios({}, PRECIOS_DEFAULT);
actualizarSelectServicios();

onSnapshot(doc(db,'config','site'), snap => {
  clearRuntimeIssue('site');
  if (!snap.exists()) return;
  const d = snap.data();
  if (d.logo) document.querySelectorAll('.site-logo').forEach(el=>el.src=d.logo);
  if (d.nequi) document.querySelectorAll('.nequi-num').forEach(el=>el.textContent=d.nequi);
  if (d.horarios) {
    window._horasDisponibles = d.horarios.length ? d.horarios : [...HORAS_DEFAULT];
    const fecha = document.getElementById('inp-fecha')?.value;
    if (fecha) window.cargarSlots();
  }
}, error => {
  setRuntimeIssue('site', formatRenderIssue('Configuracion', error));
});

onSnapshot(doc(db,'config','precios'), snap => {
  clearRuntimeIssue('precios');
  if (!snap.exists()) return;
  preciosActuales = {...PRECIOS_DEFAULT, ...snap.data()};
  renderServicios(serviciosActuales, preciosActuales);
  actualizarSelectServicios();
}, error => {
  setRuntimeIssue('precios', formatRenderIssue('Precios', error));
});

onSnapshot(doc(db,'config','servicios'), snap => {
  clearRuntimeIssue('servicios');
  if (!snap.exists()) return;
  serviciosActuales = snap.data();
  renderServicios(serviciosActuales, preciosActuales);
  actualizarSelectServicios();
}, error => {
  setRuntimeIssue('servicios', formatRenderIssue('Servicios', error));
});

onSnapshot(collection(db,'galeria'), snap => {
  clearRuntimeIssue('galeria');
  const fotos = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.orden||0)-(b.orden||0));
  renderGaleriaPublica(fotos);
  renderGaleriaAdmin(fotos);
}, error => {
  setRuntimeIssue('galeria', formatRenderIssue('Galeria', error));
});

function actualizarSelectServicios() {
  const sel = document.getElementById('inp-servicio');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="" disabled selected>Selecciona un servicio</option>';
  const customKeys = serviciosActuales._custom || [];
  const allKeys = [...SERVICIO_KEYS, ...customKeys.filter(c=>!SERVICIO_KEYS.find(k=>k.id===c.id))];
  // Filter out hidden services
  const visibleKeys = allKeys.filter(s => !(serviciosActuales[s.id]?.hidden));
  const cats = [...new Set(visibleKeys.map(s=>s.cat))];
  cats.forEach(cat => {
    const og = document.createElement('optgroup');
    og.label = cat.replace(/^[^\s]+ /,'');
    visibleKeys.filter(s=>s.cat===cat).forEach(s => {
      const info = serviciosActuales[s.id] || {};
      const nombre = info.nombre || s.nombre;
      const precio = info.precio || preciosActuales[s.id] || PRECIOS_DEFAULT[s.id] || 0;
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
// abrirOverlay/cerrarOverlay defined above

// ── SLOTS ──
window.cargarSlots = async function() {
  const fecha = document.getElementById('inp-fecha').value;
  if (!fecha) return;
  horaSeleccionada = null;
  document.getElementById('inp-hora').value = '';
  if (unsubSlots) { unsubSlots(); unsubSlots=null; }
  document.getElementById('slots-grid').innerHTML='<div class="slots-loading"><span class="spin">⏳</span> Cargando...</div>';
  unsubSlots = onSnapshot(doc(db,'slots',fecha), snap => {
    clearRuntimeIssue('slots');
    const booked = snap.exists() ? (snap.data().booked||[]) : [];
    renderSlots(booked);
  }, error => {
    setRuntimeIssue('slots', formatRenderIssue('Horarios', error));
    renderSlotsError(error?.message || 'No se pudieron cargar los horarios.');
  });
};

function renderSlots(booked) {
  const grid = document.getElementById('slots-grid');
  const horas = window._horasDisponibles || HORAS_DEFAULT;
  if (!horas.length) { grid.innerHTML='<div class="slots-ph">No hay horarios disponibles.</div>'; return; }
  grid.innerHTML='';
  horas.forEach(h => {
    const taken = booked.includes(h);
    const b = document.createElement('button');
    b.type='button'; b.className='slot-btn'+(taken?' taken':''); b.textContent=to12h(h);
    if (!taken) b.onclick = () => selSlot(h,b);
    grid.appendChild(b);
  });
}

function renderSlotsError(message) {
  const grid = document.getElementById('slots-grid');
  if (!grid) return;
  grid.innerHTML = `<div class="slots-ph" style="color:#ff6b6b">${message}</div>`;
}

function selSlot(h, el) {
  document.querySelectorAll('.slot-btn').forEach(b=>b.classList.remove('selected'));
  el.classList.add('selected'); horaSeleccionada=h;
  document.getElementById('inp-hora').value=h;
}

// ── ENVIAR CITA ──
window._enviarCitaLegacy = async function(e) {
  e.preventDefault();
  const hora = document.getElementById('inp-hora').value;
  if (!hora) { mostrarToast('Por favor selecciona un horario.',true); return; }
  const fecha=document.getElementById('inp-fecha').value,
        nombre=document.getElementById('inp-nombre').value.trim(),
        tel=document.getElementById('inp-tel').value.trim(),
        servicio=document.getElementById('inp-servicio').value,
        nota=document.getElementById('inp-nota').value.trim();
  const btn = document.getElementById('btn-submit');
  btn.textContent='⏳ Enviando...'; btn.disabled=true;
  try {
    const slotSnap = await getDoc(doc(db,'slots',fecha));
    if (slotSnap.exists() && (slotSnap.data().booked||[]).includes(hora)) {
      mostrarToast('Este horario acaba de ser tomado. Elige otro.',true);
      btn.textContent='✦ Solicitar cita ahora'; btn.disabled=false;
    const waBtn2=document.getElementById('wa-confirm-btn');if(waBtn2)waBtn2.style.display='none';
      window.cargarSlots(); return;
    }
    await addDoc(collection(db,'citas'),{nombre,tel,servicio,fecha,hora,nota,creado:serverTimestamp()});
    await updateDoc(doc(db,'slots',fecha),{booked:arrayUnion(hora)});
    try {
      await fetch('https://formsubmit.co/ajax/anacjimenez79@gmail.com',{
        method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({_subject:'💅 Nueva cita — Dulce Rosa',Nombre:nombre,Teléfono:tel,Servicio:servicio,Fecha:fecha,Hora:hora,Nota:nota||'Sin comentarios',_template:'table'})
      });
    } catch{}
    clearRuntimeIssue('citas-form');
    mostrarToast(`🌸 ¡Cita enviada! Tu cita es el ${fecha} a las ${to12h(hora)}. Te contactaremos para confirmar el abono.`,false);
    btn.textContent='✅ ¡Cita solicitada!'; btn.style.background='linear-gradient(135deg,#4CAF50,#66BB6A)';
    // Show WhatsApp confirmation button
    const waMsg = encodeURIComponent(`Hola Dulce Rosa 💅\nQuiero confirmar mi cita:\n• Servicio: ${servicio.split('—')[0].trim()}\n• Fecha: ${fecha}\n• Hora: ${hora}\nNombre: ${nombre}\nTeléfono: ${tel}`);
    const waBtn = document.getElementById('wa-confirm-btn');
    if(waBtn){ waBtn.href=`https://wa.me/573245683032?text=${waMsg}`; waBtn.style.display='flex'; }
  } catch(err) {
    console.error('Error cita:',err);
    const message = err?.message || 'Error al enviar la cita.';
    setRuntimeIssue('citas-form', formatRenderIssue('Citas', err));
    mostrarToast('❌ Error al enviar. Intenta de nuevo.',true);
    btn.textContent='✦ Solicitar cita ahora'; btn.disabled=false;
  }
};

window.enviarCita = async function(e) {
  e.preventDefault();

  const hora = document.getElementById('inp-hora').value;
  if (!hora) {
    mostrarToast('Por favor selecciona un horario.', true);
    return;
  }

  const fecha = document.getElementById('inp-fecha').value;
  const nombre = document.getElementById('inp-nombre').value.trim();
  const tel = document.getElementById('inp-tel').value.trim();
  const servicio = document.getElementById('inp-servicio').value;
  const nota = document.getElementById('inp-nota').value.trim();
  const btn = document.getElementById('btn-submit');
  const restoreButton = setBusyButton(btn, 'Enviando...');
  const servicioNombre = (servicio.split(/\s[-\u2014]\s/)[0] || servicio).trim();
  let shouldAutoRestore = true;
  let citaCreada = null;
  citaSubmitInFlight = true;

  try {
    const slotSnap = await getDoc(doc(db, 'slots', fecha));
    if (slotSnap.exists() && (slotSnap.data().booked || []).includes(hora)) {
      const waBtnBusy = document.getElementById('wa-confirm-btn');
      if (waBtnBusy) waBtnBusy.style.display = 'none';
      mostrarToast('Este horario acaba de ser tomado. Elige otro.', true);
      window.cargarSlots();
      return;
    }

    citaCreada = await addDoc(collection(db, 'citas'), {
      nombre,
      tel,
      servicio,
      fecha,
      hora,
      nota,
      creado: serverTimestamp(),
    });

    try {
      await updateDoc(doc(db, 'slots', fecha), { booked: arrayUnion(hora) });
    } catch (slotError) {
      if (citaCreada?.id) {
        try {
          await deleteDoc(doc(db, 'citas', citaCreada.id));
        } catch (rollbackError) {
          console.error('Rollback cita:', rollbackError);
        }
      }
      throw slotError;
    }

    try {
      await fetch('https://formsubmit.co/ajax/anacjimenez79@gmail.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          _subject: 'Nueva cita - Dulce Rosa',
          Nombre: nombre,
          Telefono: tel,
          Servicio: servicio,
          Fecha: fecha,
          Hora: to12h(hora),
          Nota: nota || 'Sin comentarios',
          _template: 'table',
        }),
      });
    } catch {}

    clearRuntimeIssue('citas-form');
    mostrarToast(`Tu cita es el ${fecha} a las ${to12h(hora)}. Te contactaremos para confirmar el abono.`, false);

    const form = document.getElementById('citaForm');
    if (form) form.reset();
    horaSeleccionada = null;
    document.getElementById('inp-hora').value = '';
    if (unsubSlots) {
      unsubSlots();
      unsubSlots = null;
    }
    resetSlotsPlaceholder();

    btn.textContent = 'Cita enviada';
    btn.style.background = 'linear-gradient(135deg,#4CAF50,#66BB6A)';
    shouldAutoRestore = false;
    setTimeout(() => {
      restoreButton();
    }, 2600);

    const waMsg = encodeURIComponent(
      `Hola Dulce Rosa\nQuiero confirmar mi cita:\n- Servicio: ${servicioNombre}\n- Fecha: ${fecha}\n- Hora: ${to12h(hora)}\nNombre: ${nombre}\nTelefono: ${tel}`,
    );
    const waBtn = document.getElementById('wa-confirm-btn');
    if (waBtn) {
      waBtn.href = `https://wa.me/573245683032?text=${waMsg}`;
      waBtn.style.display = 'flex';
    }
  } catch (err) {
    console.error('Error cita:', err);
    const message = err?.message || 'Error al enviar la cita.';
    setRuntimeIssue('citas-form', formatRenderIssue('Citas', err));
    mostrarToast(message, true);
  } finally {
    citaSubmitInFlight = false;
    if (shouldAutoRestore) restoreButton();
  }
};

function mostrarToast(msg,esError) {
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='toast show'+(esError?' toast-error':'');
  setTimeout(()=>t.classList.remove('show'),5000);
}

// ── AUTH ADMIN ──
const AU='DulceRosa28', AP='luciana28';
// abrirLogin defined above
window.verificarCredenciales=function(){
  if(document.getElementById('auth-user').value===AU && document.getElementById('auth-pass').value===AP){
    cerrarOverlay('overlay-login');
    abrirOverlay('overlay-admin');
    window.switchTab('citas');
    window.renderCitas().catch(console.error);
    window.cargarAdminConfig().catch(console.error);
    window.cargarAdminPrecios().catch(console.error);
  } else { document.getElementById('auth-error').classList.add('show'); }
};

// ── REVEAL ANIMATIONS ──
function initReveal() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');obs.unobserve(e.target);}});
  },{threshold:0,rootMargin:'0px 0px -30px 0px'});
  document.querySelectorAll('.reveal,.reveal-left,.reveal-right').forEach(el=>{
    const r=el.getBoundingClientRect();
    if(r.top<window.innerHeight&&r.bottom>=0) el.classList.add('visible');
    else obs.observe(el);
  });
}


document.addEventListener('DOMContentLoaded',()=>{
  const fi=document.getElementById('inp-fecha');
  if(fi) fi.min=fechaHoyColombia();
  window.addEventListener('scroll',()=>document.getElementById('navbar').classList.toggle('scrolled',scrollY>40));
  document.getElementById('auth-pass')?.addEventListener('keydown',e=>{if(e.key==='Enter')window.verificarCredenciales();});
  document.querySelectorAll('.overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)cerrarOverlay(o.id);}));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.overlay.show').forEach(o=>cerrarOverlay(o.id));});
  document.getElementById('lightbox')?.addEventListener('click',e=>{if(e.target!==document.getElementById('lb-img'))window.cerrarLightbox();});
  document.addEventListener('click',e=>{
    if(!e.target.closest('.service-card')) document.querySelectorAll('.service-card.tapped').forEach(c=>c.classList.remove('tapped'));
  });
  initReveal();
  actualizarSelectServicios();
  // Cargar promos y reseñas desde Firebase (instantáneo, sin Render)
  cargarPromosPublicas();
  cargarResenasPublicas();
});
