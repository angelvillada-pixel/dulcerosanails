import { LOGO } from './assets/logo.js';
import { db, collection, doc, getDoc, setDoc, addDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, serverTimestamp } from './firebase.js';
import { HORAS_DEFAULT, PRECIOS_DEFAULT, SERVICIO_KEYS, CATEGORIAS, fechaHoyColombia, formatCOP, comprimirImagen, to12h } from './data.js';
import { renderGaleriaPublica } from './galeria.js';
import { renderGaleriaAdmin, showOk } from './admin.js';
import './admin.js';

// ── GLOBAL FUNCTIONS — defined immediately so HTML onclicks work ──
window.abrirOverlay = function(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('show'); document.body.style.overflow = 'hidden'; }
};
window.cerrarOverlay = function(id) {
  const el = document.getElementById(id);
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

document.querySelectorAll('.site-logo').forEach(el => el.src = LOGO);
setTimeout(() => { const p=document.getElementById('preview-logo-admin'); if(p) p.src=LOGO; },200);

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
  if (!snap.exists()) return;
  const d = snap.data();
  if (d.logo) document.querySelectorAll('.site-logo').forEach(el=>el.src=d.logo);
  if (d.nequi) document.querySelectorAll('.nequi-num').forEach(el=>el.textContent=d.nequi);
  if (d.horarios) {
    window._horasDisponibles = d.horarios.length ? d.horarios : [...HORAS_DEFAULT];
    const fecha = document.getElementById('inp-fecha')?.value;
    if (fecha) window.cargarSlots();
  }
});

onSnapshot(doc(db,'config','precios'), snap => {
  if (!snap.exists()) return;
  preciosActuales = {...PRECIOS_DEFAULT, ...snap.data()};
  renderServicios(serviciosActuales, preciosActuales);
  actualizarSelectServicios();
});

onSnapshot(doc(db,'config','servicios'), snap => {
  if (!snap.exists()) return;
  serviciosActuales = snap.data();
  renderServicios(serviciosActuales, preciosActuales);
  actualizarSelectServicios();
});

onSnapshot(collection(db,'galeria'), snap => {
  const fotos = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.orden||0)-(b.orden||0));
  renderGaleriaPublica(fotos);
  renderGaleriaAdmin(fotos);
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
    allKeys.filter(s=>s.cat===cat).forEach(s => {
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
    const booked = snap.exists() ? (snap.data().booked||[]) : [];
    renderSlots(booked);
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
    b.type='button'; b.className='slot-btn'+(taken?' taken':''); b.textContent=h;
    if (!taken) b.onclick = () => selSlot(h,b);
    grid.appendChild(b);
  });
}

function selSlot(h, el) {
  document.querySelectorAll('.slot-btn').forEach(b=>b.classList.remove('selected'));
  el.classList.add('selected'); horaSeleccionada=h;
  document.getElementById('inp-hora').value=h;
}

// ── ENVIAR CITA ──
window.enviarCita = async function(e) {
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
    mostrarToast(`🌸 ¡Cita enviada! Tu cita es el ${fecha} a las ${to12h(hora)}. Te contactaremos para confirmar el abono.`,false);
    btn.textContent='✅ ¡Cita solicitada!'; btn.style.background='linear-gradient(135deg,#4CAF50,#66BB6A)';
    // Show WhatsApp confirmation button
    const waMsg = encodeURIComponent(`Hola Dulce Rosa 💅\nQuiero confirmar mi cita:\n• Servicio: ${servicio.split('—')[0].trim()}\n• Fecha: ${fecha}\n• Hora: ${hora}\nNombre: ${nombre}\nTeléfono: ${tel}`);
    const waBtn = document.getElementById('wa-confirm-btn');
    if(waBtn){ waBtn.href=`https://wa.me/573245683032?text=${waMsg}`; waBtn.style.display='flex'; }
  } catch(err) {
    console.error('Error cita:',err);
    mostrarToast('❌ Error al enviar. Intenta de nuevo.',true);
    btn.textContent='✦ Solicitar cita ahora'; btn.disabled=false;
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


// ── PROMOCIONES DINÁMICAS (REST) ──
async function cargarPromociones() {
  try {
    const r = await fetch('https://dulce-rosa-api.onrender.com/promociones');
    if (!r.ok) return;
    const promos = await r.json();
    if (!Array.isArray(promos) || !promos.length) return;
    const grid = document.getElementById('promos-grid');
    if (!grid) return;
    const badges = ['🔥 Más popular','⭐ Destacada','💚 Especial'];
    const colors = ['var(--rose)','var(--gold)','#4CAF50'];
    grid.innerHTML = promos.map((p,i) => `
      <div class="promo-card reveal">
        <div class="promo-badge" style="background:${colors[i%3]}">${badges[i%3]}</div>
        <div class="promo-title">${p.titulo}</div>
        <div class="promo-desc">${p.descripcion||''}</div>
        <div class="promo-precio"><span class="promo-ahora">${p.descuento||''}</span></div>
        ${p.fechafin?'<div style="font-size:.72rem;color:rgba(255,255,255,.45);margin-bottom:10px">Hasta: '+p.fechafin+'</div>':''}
        <button class="promo-btn" onclick="abrirOverlay('overlay-cita')">¡Quiero esto!</button>
      </div>`).join('');
    initReveal();
  } catch(e) { /* silently fail, static promos remain */ }
}

// ── RESEÑAS DINÁMICAS (REST) ──
async function cargarResenasPublicas() {
  try {
    const r = await fetch('https://dulce-rosa-api.onrender.com/resenas?aprobada=true');
    if (!r.ok) return;
    const resenas = await r.json();
    const grid = document.getElementById('resenas-grid');
    if (!grid || !Array.isArray(resenas) || !resenas.length) return;
    grid.innerHTML = resenas.slice(0,6).map(r => `
      <div class="testimonio-card reveal">
        <div class="test-stars">${'★'.repeat(r.estrellas||5)}${'☆'.repeat(5-(r.estrellas||5))}</div>
        <p class="test-text">"${r.comentario}"</p>
        <div class="test-autor">
          <div class="test-avatar">${r.nombre?r.nombre[0].toUpperCase():'C'}</div>
          <div><strong>${r.nombre}</strong><span>${r.servicio||'Clienta'}</span></div>
        </div>
      </div>`).join('');
    initReveal();
  } catch(e) { /* silently fail */ }
}

document.addEventListener('DOMContentLoaded',()=>{
  const fi=document.getElementById('inp-fecha');
  if(fi) fi.min=fechaHoyColombia();
  window.addEventListener('scroll',()=>document.getElementById('navbar').classList.toggle('scrolled',scrollY>40));
  document.getElementById('auth-pass')?.addEventListener('keydown',e=>{if(e.key==='Enter')window.verificarCredenciales();});
  document.querySelectorAll('.overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)cerrarOverlay(o.id);}));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.overlay.show').forEach(o=>cerrarOverlay(o.id));});
  document.getElementById('lightbox')?.addEventListener('click',e=>{if(e.target!==document.getElementById('lb-img'))window.cerrarLightbox();});
  // Close tapped card on outside click
  document.addEventListener('click',e=>{
    if(!e.target.closest('.service-card')) document.querySelectorAll('.service-card.tapped').forEach(c=>c.classList.remove('tapped'));
  });
  initReveal();
  actualizarSelectServicios();
  // Load REST data (won't block)
  cargarPromociones();
  cargarResenasPublicas();
});
