import {
  db,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  updateDoc,
  arrayRemove,
  serverTimestamp,
} from './firebase.js';
import { PRECIOS_DEFAULT, HORAS_DEFAULT, SERVICIO_KEYS, comprimirImagen, to12h, validarArchivoImagen } from './data.js';
import { deleteAdminMedia, mediaKey, mediaUrl, uploadAdminMedia } from './media.js';

let pendingFoto = null;
let pendingLogoMedia = null;
let galeriaEnMemoria = [];
let serviciosEnMemoria = {};
window._svcImages = {};

const PROMOS_COLLECTION = 'promociones';
const RESENAS_COLLECTION = 'resenas';

const realtimeState = {
  citas: { items: [], loading: false, error: null, unsubscribe: null, initialized: false, limit: 20, filter: 'all' },
  promosAdmin: { items: [], loading: false, error: null, unsubscribe: null },
  promosPublic: { items: [], loading: false, error: null, unsubscribe: null },
  resenasAdmin: { items: [], loading: false, error: null, unsubscribe: null },
  resenasPublic: { items: [], loading: false, error: null, unsubscribe: null },
};

let realFBPromise = null;

function realFB() {
  if (realFBPromise) return realFBPromise;

  realFBPromise = new Promise((resolve, reject) => {
    if (window.__db && window.__fb) {
      resolve({ db: window.__db, fb: window.__fb });
      return;
    }

    const timeoutId = setTimeout(() => {
      realFBPromise = null;
      reject(new Error('Firebase real no esta disponible en la pagina.'));
    }, 7000);

    window.addEventListener(
      'fb-ready',
      () => {
        clearTimeout(timeoutId);
        if (window.__db && window.__fb) {
          resolve({ db: window.__db, fb: window.__fb });
          return;
        }
        realFBPromise = null;
        reject(new Error('Firebase real reporto una inicializacion incompleta.'));
      },
      { once: true },
    );
  });

  return realFBPromise;
}

function formatError(error, fallback = 'Error desconocido.') {
  const message = error?.message || String(error || fallback);

  if (error?.code === 'not-found' && /database \(default\) does not exist/i.test(message)) {
    return `Firestore no esta activado en el proyecto "dulce-rosa". ${message}`;
  }

  if (error?.code === 'permission-denied') {
    return `Firestore rechazo la operacion por permisos o reglas. ${message}`;
  }

  return message;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sortByCreatedDesc(items) {
  return [...items].sort((left, right) => Number(right.creadoMs || 0) - Number(left.creadoMs || 0));
}

function normalizeDoc(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

function showStateMessage(message, isError = false) {
  const color = isError ? '#ff6b6b' : 'rgba(255,255,255,.62)';
  return `<div class="no-citas" style="color:${color}">${escapeHtml(message)}</div>`;
}

function publicErrorCard(message, promoMode = false) {
  const cardClass = promoMode ? 'promo-card' : 'testimonio-card';
  return `
    <div class="${cardClass} visible" style="grid-column:1/-1;box-shadow:none;border:1px solid rgba(255,107,107,.35)">
      <div style="font-size:.82rem;color:#ff6b6b;line-height:1.6">${escapeHtml(message)}</div>
    </div>
  `;
}

function tabPane(tabId) {
  return document.getElementById(`tab-${tabId}`);
}

function clearAdminError(tabId) {
  const pane = tabPane(tabId);
  const box = pane?.querySelector('.admin-inline-error');
  if (box) box.remove();
}

function showAdminError(tabId, message) {
  const pane = tabPane(tabId);
  if (!pane) return;

  let box = pane.querySelector('.admin-inline-error');
  if (!box) {
    box = document.createElement('div');
    box.className = 'admin-inline-error';
    box.style.cssText = 'margin-bottom:12px;padding:10px 14px;border-radius:10px;background:rgba(255,107,107,.12);border:1px solid rgba(255,107,107,.35);color:#ff6b6b;font-size:.8rem;';
    pane.prepend(box);
  }

  box.textContent = message;
}

function showAdminToast(message, type = 'info') {
  if (window.showAppToast) {
    window.showAppToast(message, type);
    return;
  }
  console[type === 'error' ? 'error' : 'log'](message);
}

function validarSeleccionImagen(file, scope = 'Imagen') {
  const validationError = validarArchivoImagen(file);
  if (!validationError) return null;

  const message = `${scope}: ${validationError}`;
  showAdminToast(message, 'error');
  return message;
}

function debounce(fn, wait = 300) {
  let timeoutId = null;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), wait);
  };
}

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

function currentMonthPrefix() {
  return todayIso().slice(0, 7);
}

function serviceLabel(value = '') {
  return value.split(/\s[—-]\s/)[0].trim() || 'Sin servicio';
}

function escapeCsv(value = '') {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function citasFiltradas() {
  const state = realtimeState.citas;
  const q = (document.getElementById('filtro-citas')?.value || '').trim().toLowerCase();
  const activeFilter = document.getElementById('filtro-fecha-citas')?.value || state.filter;
  const today = todayIso();
  const monthPrefix = currentMonthPrefix();
  const weekEnd = new Date(`${today}T00:00:00-05:00`);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndIso = weekEnd.toISOString().slice(0, 10);

  return [...state.items]
    .filter((cita) => {
      if (activeFilter === 'today' && cita.fecha !== today) return false;
      if (activeFilter === 'week' && (cita.fecha < today || cita.fecha > weekEndIso)) return false;
      if (activeFilter === 'month' && !String(cita.fecha || '').startsWith(monthPrefix)) return false;
      if (!q) return true;

      return (
        cita.nombre?.toLowerCase().includes(q) ||
        cita.servicio?.toLowerCase().includes(q) ||
        cita.fecha?.includes(q) ||
        cita.tel?.includes(q)
      );
    })
    .sort((left, right) => `${left.fecha}${left.hora}`.localeCompare(`${right.fecha}${right.hora}`));
}

function renderCitasStats(citas) {
  const monthPrefix = currentMonthPrefix();
  const citasMes = citas.filter((cita) => String(cita.fecha || '').startsWith(monthPrefix));
  const servicioCounts = new Map();
  const dayCounts = new Map();

  citasMes.forEach((cita) => {
    const servicio = serviceLabel(cita.servicio);
    servicioCounts.set(servicio, (servicioCounts.get(servicio) || 0) + 1);
    dayCounts.set(cita.fecha, (dayCounts.get(cita.fecha) || 0) + 1);
  });

  const topServiceEntry = [...servicioCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const topDayEntry = [...dayCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  const statTotal = document.getElementById('stat-total');
  const statHoy = document.getElementById('stat-hoy');
  const statProx = document.getElementById('stat-prox');

  if (statTotal) {
    statTotal.textContent = citasMes.length;
    statTotal.nextElementSibling.textContent = 'Citas del mes';
  }

  if (statHoy) {
    statHoy.textContent = topServiceEntry?.[1] || 0;
    statHoy.nextElementSibling.textContent = topServiceEntry?.[0] || 'Sin datos';
  }

  if (statProx) {
    statProx.textContent = topDayEntry?.[1] || 0;
    statProx.nextElementSibling.textContent = topDayEntry?.[0] || 'Sin datos';
  }
}

function ensureCitasListener() {
  const state = realtimeState.citas;
  if (state.unsubscribe || state.loading) return;

  state.loading = true;
  state.error = null;

  state.unsubscribe = onSnapshot(
    collection(db, 'citas'),
    (snap) => {
      const nextItems = snap.docs.map((item) => ({ ...item.data(), id: item.id }));
      const prevIds = new Set(state.items.map((item) => item.id));
      const newItems = nextItems.filter((item) => !prevIds.has(item.id));
      state.items = nextItems;
      state.loading = false;
      state.error = null;
      const wasInitialized = state.initialized;
      state.initialized = true;
      renderCitasStats(nextItems);
      window.renderCitas();

      if (wasInitialized && newItems.length && document.getElementById('overlay-admin')?.classList.contains('show')) {
        const latest = newItems.sort((a, b) => `${b.fecha}${b.hora}`.localeCompare(`${a.fecha}${a.hora}`))[0];
        showAdminToast(`Nueva cita: ${latest.nombre || 'Cliente'} - ${to12h(latest.hora)}`, 'success');
      }
    },
    (error) => {
      state.loading = false;
      state.error = formatError(error, 'No se pudieron cargar las citas.');
      window.renderCitas();
    },
  );
}

export function showOk(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
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
  };
}

function syncHoraChipLabels() {
  document.querySelectorAll('.hora-chip').forEach((chip) => {
    const hourValue = chip.dataset.hora || chip.textContent.trim();
    chip.textContent = to12h(hourValue);
    chip.title = to12h(hourValue);
  });
}

syncHoraChipLabels();

window.switchTab = function (tab) {
  document.querySelectorAll('.tab-btn').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach((pane) => pane.classList.toggle('active', pane.id === `tab-${tab}`));
};

window.renderCitas = async function () {
  const q = (document.getElementById('filtro-citas') || { value: '' }).value.toLowerCase();
  const lista = document.getElementById('lista-citas');
  if (!lista) return;

  lista.innerHTML = '<div class="no-citas"><span class="spin">...</span> Cargando...</div>';
  try {
    const snap = await Promise.race([
      getDocs(collection(db, 'citas')),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout al consultar citas en Render.')), 12000)),
    ]);
    const citas = snap.docs.map((item) => ({ ...item.data(), id: item.id }));
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

    clearAdminError('citas');
    document.getElementById('stat-total').textContent = citas.length;
    document.getElementById('stat-hoy').textContent = citas.filter((cita) => cita.fecha === hoy).length;
    document.getElementById('stat-prox').textContent = citas.filter((cita) => cita.fecha >= hoy).length;

    const filtradas = citas
      .filter(
        (cita) =>
          !q ||
          cita.nombre?.toLowerCase().includes(q) ||
          cita.servicio?.toLowerCase().includes(q) ||
          cita.fecha?.includes(q) ||
          cita.tel?.includes(q),
      )
      .sort((left, right) => `${left.fecha}${left.hora}`.localeCompare(`${right.fecha}${right.hora}`));

    if (!filtradas.length) {
      lista.innerHTML = '<div class="no-citas">No hay citas aun.</div>';
      return;
    }

    lista.innerHTML = filtradas
      .map(
        (cita) => `
          <div class="cita-item">
            <div class="cita-item-header">
              <div class="cita-name">Cliente: ${escapeHtml(cita.nombre || 'Sin nombre')}</div>
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                <span class="cita-badge">${escapeHtml(cita.fecha || '')} · ${to12h(cita.hora)}</span>
                <button class="btn-delete" onclick="eliminarCita('${cita.id}','${escapeHtml(cita.fecha || '')}','${escapeHtml(cita.hora || '')}')">x</button>
              </div>
            </div>
            <div class="cita-details">
              <div>Tel: ${escapeHtml(cita.tel || '')}</div>
              <div>Servicio: ${escapeHtml((cita.servicio || '').split('—')[0].trim() || 'Sin servicio')}</div>
              ${cita.nota ? `<div style="grid-column:span 2">Nota: ${escapeHtml(cita.nota)}</div>` : ''}
            </div>
          </div>
        `,
      )
      .join('');
  } catch (error) {
    const message = formatError(error, 'No se pudieron cargar las citas.');
    showAdminError('citas', message);
    lista.innerHTML = showStateMessage(message, true);
  }
};

window.eliminarCita = async function (id, fecha, hora) {
  if (!confirm('Eliminar esta cita?')) return;

  try {
    await deleteDoc(doc(db, 'citas', id));
    try {
      await updateDoc(doc(db, 'slots', fecha), { booked: arrayRemove(hora) });
    } catch (error) {
      showAdminError('citas', formatError(error, 'La cita se elimino, pero no se pudo liberar el horario.'));
    }
    await window.renderCitas();
  } catch (error) {
    showAdminError('citas', formatError(error, 'No se pudo eliminar la cita.'));
  }
};

window.exportarCitas = async function () {
  const snap = await getDocs(collection(db, 'citas'));
  const citas = snap.docs.map((item) => item.data());
  if (!citas.length) {
    alert('No hay citas.');
    return;
  }

  let txt = 'CITAS - DULCE ROSA NAILS SPA\n' + '='.repeat(44) + '\n\n';
  citas
    .sort((left, right) => `${left.fecha}${left.hora}`.localeCompare(`${right.fecha}${right.hora}`))
    .forEach((cita, index) => {
      txt += `${index + 1}. ${cita.nombre}\n   Tel: ${cita.tel}\n   Servicio: ${cita.servicio}\n   Fecha: ${cita.fecha} a las ${to12h(cita.hora)}\n`;
      if (cita.nota) txt += `   Nota: ${cita.nota}\n`;
      txt += '\n';
    });

  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
  link.download = 'citas-dulce-rosa.txt';
  link.click();
};

window.cargarAdminConfig = async function () {
  const el = document.getElementById('a-nequi');
  if (el) el.value = '324 568 3032';
  document.querySelectorAll('.hora-chip').forEach((chip) => chip.classList.add('activa'));
  syncHoraChipLabels();

  try {
    const snap = await getDoc(doc(db, 'config', 'site'));
    const data = snap.exists() ? snap.data() : {};
    clearAdminError('config');
    if (data.nequi && el) el.value = data.nequi;
    const activas = data.horarios || HORAS_DEFAULT;
    document.querySelectorAll('.hora-chip').forEach((chip) => chip.classList.toggle('activa', activas.includes(chip.dataset.hora)));
    window._horasDisponibles = activas;
  } catch (error) {
    showAdminError('config', formatError(error, 'No se pudo cargar la configuracion.'));
  }
};

window.guardarConfig = async function () {
  const restoreButton = setBusyButton(document.querySelector('#tab-config .btn-save'), 'Guardando...');

  const nequi = document.getElementById('a-nequi').value.trim();
  const horarios = [...document.querySelectorAll('.hora-chip.activa')].map((chip) => chip.dataset.hora);
  const activas = horarios.length ? horarios : [...HORAS_DEFAULT];

  try {
    const ref = doc(db, 'config', 'site');
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    await setDoc(ref, { ...data, nequi, horarios: activas });
    window._horasDisponibles = activas;
    document.querySelectorAll('.nequi-num').forEach((item) => {
      item.textContent = nequi;
    });
    clearAdminError('config');
    showOk('ok-config');
  } catch (error) {
    showAdminError('config', formatError(error, 'No se pudo guardar la configuracion.'));
  } finally {
    restoreButton();
  }
};

window.toggleHora = function (chip) {
  chip.classList.toggle('activa');
};

window.cargarAdminPrecios = async function () {
  Object.keys(PRECIOS_DEFAULT).forEach((key) => {
    const input = document.getElementById(`ap-${key}`);
    if (input && !input.value) input.value = PRECIOS_DEFAULT[key];
  });

  try {
    const snap = await getDoc(doc(db, 'config', 'precios'));
    const precios = snap.exists() ? snap.data() : PRECIOS_DEFAULT;
    clearAdminError('precios');
    Object.keys(PRECIOS_DEFAULT).forEach((key) => {
      const input = document.getElementById(`ap-${key}`);
      if (input) input.value = precios[key] || PRECIOS_DEFAULT[key];
    });
  } catch (error) {
    showAdminError('precios', formatError(error, 'No se pudieron cargar los precios.'));
  }
};

window.guardarPrecios = async function () {
  const restoreButton = setBusyButton(document.querySelector('#tab-precios .btn-save'), 'Guardando...');
  const precios = {};
  Object.keys(PRECIOS_DEFAULT).forEach((key) => {
    const input = document.getElementById(`ap-${key}`);
    if (input) precios[key] = Number(input.value) || PRECIOS_DEFAULT[key];
  });

  try {
    await setDoc(doc(db, 'config', 'precios'), precios);
    clearAdminError('precios');
    showOk('ok-precios');
  } catch (error) {
    showAdminError('precios', formatError(error, 'No se pudieron guardar los precios.'));
  } finally {
    restoreButton();
  }
};

window.cargarAdminServicios = async function () {
  const cont = document.getElementById('svc-edit-list');
  if (!cont) return;

  _renderSvcAdmin(cont, serviciosEnMemoria);
  try {
    const snap = await getDoc(doc(db, 'config', 'servicios'));
    if (snap.exists()) serviciosEnMemoria = snap.data();
    clearAdminError('servicios');
    _renderSvcAdmin(cont, serviciosEnMemoria);
  } catch (error) {
    showAdminError('servicios', formatError(error, 'No se pudieron cargar los servicios.'));
  }
};

function _renderSvcAdmin(cont, serviciosData) {
  cont.innerHTML = '';

  const btnNuevo = document.createElement('button');
  btnNuevo.className = 'btn-nuevo-svc';
  btnNuevo.textContent = '+ Nuevo servicio';
  btnNuevo.onclick = () => window.abrirFormNuevoServicio();
  cont.appendChild(btnNuevo);

  const customKeys = serviciosData._custom || [];
  const allKeys = [...SERVICIO_KEYS, ...customKeys.filter((custom) => !SERVICIO_KEYS.find((builtin) => builtin.id === custom.id))];
  const cats = [...new Set(allKeys.map((service) => service.cat))];

  cats.forEach((cat) => {
    const services = allKeys.filter((service) => service.cat === cat && !(serviciosData[service.id]?.hidden));
    if (!services.length) return;

    const catTitle = document.createElement('div');
    catTitle.className = 'svc-cat-title';
    catTitle.textContent = cat;
    cont.appendChild(catTitle);

    services.forEach((service) => {
      const info = serviciosData[service.id] || {};
      const nombre = info.nombre || service.nombre;
      const imagen = mediaUrl(info.imagen);
      const isBuiltin = !!SERVICIO_KEYS.find((item) => item.id === service.id);

      const card = document.createElement('div');
      card.className = 'svc-edit-card';

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-del-svc';
      delBtn.textContent = 'x Eliminar';
      delBtn.onclick = () => window.eliminarServicio(service.id, isBuiltin);
      card.appendChild(delBtn);

      const header = document.createElement('div');
      header.className = 'svc-edit-card-header';
      header.innerHTML = `
        <div class="svc-edit-img" id="svc-img-preview-${service.id}">${imagen ? `<img src="${imagen}" alt=""/>` : `<span>${service.emoji || 'N'}</span>`}</div>
        <label class="btn-img-svc">Imagen<input type="file" accept="image/*" style="display:none" onchange="subirImagenServicio('${service.id}',this)"/></label>
      `;
      card.appendChild(header);

      card.innerHTML += `
        <div class="a-row">
          <div class="a-field"><label class="a-label">Nombre</label><input class="a-input" id="svc-name-${service.id}" value="${escapeHtml(nombre)}"/></div>
          <div class="a-field"><label class="a-label">Precio</label><input class="a-input" type="number" id="svc-precio-${service.id}" value="${info.precio || PRECIOS_DEFAULT[service.id] || 0}"/></div>
        </div>
        <div class="a-field"><label class="a-label">Descripcion corta</label><input class="a-input" id="svc-desc-${service.id}" value="${escapeHtml(info.descripcion || service.descripcion || '')}"/></div>
        <div class="a-field"><label class="a-label">Detalles completos</label><textarea class="a-textarea" id="svc-det-${service.id}">${escapeHtml(info.detalles || service.detalles || '')}</textarea></div>
      `;

      cont.appendChild(card);
    });
  });
}

window.subirImagenServicio = async function (id, input) {
  const file = input.files[0];
  if (!file) return;
  if (validarSeleccionImagen(file, 'Imagen del servicio')) {
    input.value = '';
    return;
  }

  const prev = document.getElementById(`svc-img-preview-${id}`);
  const tempUrl = URL.createObjectURL(file);
  if (prev) prev.innerHTML = `<img src="${tempUrl}" style="width:52px;height:52px;border-radius:8px;object-fit:cover;object-position:50% 32%"/>`;

  try {
    const uploaded = await uploadAdminMedia(file, { folder: 'servicios', filename: id });
    window._svcImages[id] = uploaded;
    if (prev) prev.innerHTML = `<img src="${mediaUrl(uploaded)}" style="width:52px;height:52px;border-radius:8px;object-fit:cover;object-position:50% 32%"/>`;
    showAdminToast('Imagen del servicio subida y lista para guardar.', 'success');
  } catch (uploadError) {
    try {
      const b64 = await comprimirImagen(file, 1200, 0.82);
      window._svcImages[id] = b64;
      if (prev) prev.innerHTML = `<img src="${b64}" style="width:52px;height:52px;border-radius:8px;object-fit:cover;object-position:50% 32%"/>`;
      showAdminToast('No habia storage remoto listo. Se usara el modo compatible actual.', 'info');
    } catch (error) {
      showAdminToast(formatError(error, 'No se pudo procesar la imagen del servicio.'), 'error');
      input.value = '';
    }
  } finally {
    URL.revokeObjectURL(tempUrl);
  }
};

window.guardarServicios = async function () {
  const restoreButton = setBusyButton(document.querySelector('#tab-servicios .btn-save'), 'Guardando...');

  try {
    const snap = await getDoc(doc(db, 'config', 'servicios'));
    const existing = snap.exists() ? snap.data() : {};
    const customKeys = existing._custom || [];
    const allKeys = [...SERVICIO_KEYS, ...customKeys.filter((custom) => !SERVICIO_KEYS.find((builtin) => builtin.id === custom.id))];
    const servicios = { _custom: customKeys };
    const removedMedia = [];

    allKeys.forEach((service) => {
      const nameEl = document.getElementById(`svc-name-${service.id}`);
      if (!nameEl) return;

      const previousImage = existing[service.id]?.imagen || null;
      const nextImage = window._svcImages[service.id] || previousImage || null;
      const previousKey = mediaKey(previousImage);
      const nextKey = mediaKey(nextImage);
      if (window._svcImages[service.id] && previousKey && previousKey !== nextKey) {
        removedMedia.push(previousImage);
      }

      servicios[service.id] = {
        nombre: nameEl.value.trim() || service.nombre,
        precio: Number(document.getElementById(`svc-precio-${service.id}`)?.value) || 0,
        descripcion: document.getElementById(`svc-desc-${service.id}`)?.value.trim() || '',
        detalles: document.getElementById(`svc-det-${service.id}`)?.value.trim() || '',
        imagen: nextImage,
        emoji: service.emoji || 'N',
        cat: service.cat,
        desde: service.desde || false,
        hidden: existing[service.id]?.hidden || false,
      };
    });

    await setDoc(doc(db, 'config', 'servicios'), servicios);
    await Promise.allSettled(removedMedia.map((item) => deleteAdminMedia(item)));
    serviciosEnMemoria = servicios;
    window._svcImages = {};
    clearAdminError('servicios');
    showOk('ok-servicios');
  } catch (error) {
    showAdminError('servicios', formatError(error, 'No se pudieron guardar los servicios.'));
  } finally {
    restoreButton();
  }
};

window.abrirFormNuevoServicio = function () {
  ['ns-nombre', 'ns-precio', 'ns-desc', 'ns-detalles'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  const catEl = document.getElementById('ns-cat');
  if (catEl) catEl.value = '✨ Uñas';

  const overlay = document.getElementById('overlay-nuevo-svc');
  if (overlay) {
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
};

window.guardarNuevoServicio = async function () {
  const nombre = document.getElementById('ns-nombre')?.value.trim();
  if (!nombre) {
    alert('El nombre es obligatorio.');
    return;
  }

  const restoreButton = setBusyButton(document.querySelector('#overlay-nuevo-svc .btn-save'), 'Guardando...');

  try {
    const id = `custom_${Date.now()}`;
    const snap = await getDoc(doc(db, 'config', 'servicios'));
    const existing = snap.exists() ? snap.data() : {};
    const cat = document.getElementById('ns-cat')?.value || '✨ Uñas';
    const customKeys = [...(existing._custom || [])];

    customKeys.push({ id, nombre, cat, emoji: 'N', desde: false });

    const newData = {
      ...existing,
      _custom: customKeys,
      [id]: {
        nombre,
        precio: Number(document.getElementById('ns-precio')?.value) || 0,
        descripcion: document.getElementById('ns-desc')?.value.trim() || '',
        detalles: document.getElementById('ns-detalles')?.value.trim() || '',
        imagen: null,
        emoji: 'N',
        cat,
        desde: false,
        hidden: false,
      },
    };

    await setDoc(doc(db, 'config', 'servicios'), newData);
    serviciosEnMemoria = newData;
    clearAdminError('servicios');

    const overlay = document.getElementById('overlay-nuevo-svc');
    if (overlay) {
      overlay.classList.remove('show');
      document.body.style.overflow = '';
    }

    const cont = document.getElementById('svc-edit-list');
    if (cont) _renderSvcAdmin(cont, newData);
    showOk('ok-servicios');
  } catch (error) {
    showAdminError('servicios', formatError(error, 'No se pudo crear el servicio.'));
  } finally {
    restoreButton();
  }
};

window.eliminarServicio = async function (id, isBuiltin) {
  if (!confirm(isBuiltin ? 'Ocultar este servicio?' : 'Eliminar este servicio?')) return;

  try {
    const snap = await getDoc(doc(db, 'config', 'servicios'));
    const existing = snap.exists() ? snap.data() : {};
    const customKeys = (existing._custom || []).filter((item) => item.id !== id);
    const newData = { ...existing, _custom: customKeys };

    if (isBuiltin) newData[id] = { ...(existing[id] || {}), hidden: true };
    else delete newData[id];

    await setDoc(doc(db, 'config', 'servicios'), newData);
    serviciosEnMemoria = newData;
    clearAdminError('servicios');

    const cont = document.getElementById('svc-edit-list');
    if (cont) _renderSvcAdmin(cont, newData);
  } catch (error) {
    showAdminError('servicios', formatError(error, 'No se pudo eliminar el servicio.'));
  }
};

window.previsualizarLogo = async function (input) {
  const file = input.files[0];
  if (!file) return;
  if (validarSeleccionImagen(file, 'Logo')) {
    input.value = '';
    return;
  }

  const preview = document.getElementById('preview-logo-admin');
  const tempUrl = URL.createObjectURL(file);
  if (preview) preview.src = tempUrl;

  try {
    pendingLogoMedia = await uploadAdminMedia(file, { folder: 'logos', filename: 'logo-dulce-rosa' });
    if (preview) preview.src = mediaUrl(pendingLogoMedia);
    const btn = document.getElementById('btn-guardar-logo');
    btn.style.display = 'inline-block';
    showAdminToast('Logo subido y listo para guardar.', 'success');
  } catch (uploadError) {
    try {
      pendingLogoMedia = await comprimirImagen(file, 600, 0.82);
      if (preview) preview.src = mediaUrl(pendingLogoMedia) || pendingLogoMedia;
      const btn = document.getElementById('btn-guardar-logo');
      btn.style.display = 'inline-block';
      showAdminToast('No habia storage remoto listo. Se usara el modo compatible actual.', 'info');
    } catch (error) {
      showAdminToast(formatError(error, 'No se pudo procesar el logo.'), 'error');
      input.value = '';
    }
  } finally {
    URL.revokeObjectURL(tempUrl);
  }
};

window.guardarLogo = async function (btn) {
  if (!pendingLogoMedia) return;

  const restoreButton = setBusyButton(btn, 'Guardando...');

  try {
    const ref = doc(db, 'config', 'site');
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    const previousLogo = data.logo || null;
    await setDoc(ref, { ...data, logo: pendingLogoMedia });
    document.querySelectorAll('.site-logo').forEach((item) => {
      item.src = mediaUrl(pendingLogoMedia) || pendingLogoMedia;
    });
    if (mediaKey(previousLogo) && mediaKey(previousLogo) !== mediaKey(pendingLogoMedia)) {
      await deleteAdminMedia(previousLogo).catch(() => {});
    }
    pendingLogoMedia = null;
    btn.style.display = 'none';
    clearAdminError('logo');
    showOk('ok-logo');
  } catch (error) {
    showAdminError('logo', formatError(error, 'No se pudo guardar el logo.'));
  } finally {
    restoreButton();
  }
};

window.seleccionarFoto = async function (input) {
  const file = input.files[0];
  if (!file) return;
  if (validarSeleccionImagen(file, 'Foto de galeria')) {
    input.value = '';
    return;
  }

  const titulo = document.getElementById('foto-titulo').value.trim();
  const prev = document.getElementById('foto-preview-pending');
  const tempUrl = URL.createObjectURL(file);
  if (prev) {
    prev.innerHTML = `
      <div class="galeria-pending">
        <img src="${tempUrl}" alt=""/>
        <div><div style="color:#fff;font-size:.8rem">${escapeHtml(titulo || 'Sin titulo')}</div></div>
        <button onclick="cancelarFoto()" style="margin-left:auto;background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:1.1rem">x</button>
      </div>
    `;
    prev.style.display = 'block';
  }

  try {
    const uploaded = await uploadAdminMedia(file, { folder: 'galeria', filename: titulo || 'galeria' });
    pendingFoto = { media: uploaded, titulo };
    if (prev) {
      prev.querySelector('img').src = mediaUrl(uploaded);
    }
    document.getElementById('btn-guardar-foto').style.display = 'inline-block';
    showAdminToast('Foto subida y lista para guardar.', 'success');
  } catch (uploadError) {
    try {
      const b64 = await comprimirImagen(file, 1200, 0.8);
      pendingFoto = { media: b64, titulo };
      if (prev) {
        prev.querySelector('img').src = b64;
      }
      document.getElementById('btn-guardar-foto').style.display = 'inline-block';
      showAdminToast('No habia storage remoto listo. Se usara el modo compatible actual.', 'info');
    } catch (error) {
      showAdminToast(formatError(error, 'No se pudo procesar la foto.'), 'error');
      input.value = '';
    }
  } finally {
    URL.revokeObjectURL(tempUrl);
  }
};

window.cancelarFoto = function () {
  pendingFoto = null;
  const prev = document.getElementById('foto-preview-pending');
  if (prev) {
    prev.innerHTML = '';
    prev.style.display = 'none';
  }
  document.getElementById('btn-guardar-foto').style.display = 'none';
  document.getElementById('foto-titulo').value = '';
  const input = document.getElementById('foto-file-input');
  if (input) input.value = '';
};

window.guardarFoto = async function () {
  if (!pendingFoto) return;

  const restoreButton = setBusyButton(document.getElementById('btn-guardar-foto'), 'Subiendo...');

  try {
    await addDoc(collection(db, 'galeria'), {
      url: mediaUrl(pendingFoto.media) || pendingFoto.media,
      titulo: pendingFoto.titulo || '',
      orden: Date.now(),
      creado: serverTimestamp(),
    });
    clearAdminError('galeria');
    cancelarFoto();
    showOk('ok-galeria');
  } catch (error) {
    showAdminError('galeria', formatError(error, 'No se pudo guardar la foto.'));
  } finally {
    restoreButton();
  }
};

window.eliminarFoto = async function (id) {
  const titulo = document.querySelector(`.galeria-admin-item .del-foto[onclick="eliminarFoto('${id}')"]`)?.closest('.galeria-admin-item')?.querySelector('.g-item-label')?.textContent || 'esta foto';
  const accepted = await (window.confirmAction
    ? window.confirmAction(`Eliminar ${titulo}?`, 'Eliminar')
    : Promise.resolve(confirm(`Eliminar ${titulo}?`)));
  if (!accepted) return;

  try {
    const foto = galeriaEnMemoria.find((item) => item.id === id);
    await deleteDoc(doc(db, 'galeria', id));
    if (foto?.url) {
      await deleteAdminMedia(foto.url).catch(() => {});
    }
    clearAdminError('galeria');
    showAdminToast(`${titulo} fue eliminada.`, 'success');
  } catch (error) {
    showAdminError('galeria', formatError(error, 'No se pudo eliminar la foto.'));
    showAdminToast(`No se pudo eliminar ${titulo}.`, 'error');
  }
};

export function renderGaleriaAdmin(fotos) {
  const grid = document.getElementById('galeria-admin-grid');
  if (!grid) return;
  galeriaEnMemoria = Array.isArray(fotos) ? fotos : [];

  if (!fotos.length) {
    grid.innerHTML = '<p style="color:rgba(255,255,255,.3);font-size:.78rem">No hay fotos aun.</p>';
    return;
  }

  grid.innerHTML = fotos
    .map(
      (foto) => `
        <div class="galeria-admin-item">
          <img src="${mediaUrl(foto.url || foto.media || foto)}" alt="${escapeHtml(foto.titulo || '')}" loading="lazy"/>
          <button class="del-foto" onclick="eliminarFoto('${foto.id}')">x</button>
          ${foto.titulo ? `<div class="g-item-label">${escapeHtml(foto.titulo)}</div>` : ''}
        </div>
      `,
    )
    .join('');
}

async function ensurePromosAdminListener() {
  const state = realtimeState.promosAdmin;
  if (state.unsubscribe || state.loading) return;

  state.loading = true;
  state.error = null;
  renderAdminPromociones();

  try {
    const { db: rdb, fb } = await realFB();
    const ref = fb.collection(rdb, PROMOS_COLLECTION);
    const q = fb.query(ref, fb.orderBy('creadoMs', 'desc'));

    state.unsubscribe = fb.onSnapshot(
      q,
      (snapshot) => {
        state.loading = false;
        state.error = null;
        state.items = sortByCreatedDesc(snapshot.docs.map(normalizeDoc));
        renderAdminPromociones();
      },
      (error) => {
        state.loading = false;
        state.unsubscribe = null;
        state.error = formatError(error);
        renderAdminPromociones();
      },
    );
  } catch (error) {
    state.loading = false;
    state.error = formatError(error);
    renderAdminPromociones();
  }
}

async function ensurePromosPublicListener() {
  const state = realtimeState.promosPublic;
  if (state.unsubscribe || state.loading) return;

  state.loading = true;
  state.error = null;
  renderPromosPublicGrid();

  try {
    const { db: rdb, fb } = await realFB();
    const ref = fb.collection(rdb, PROMOS_COLLECTION);
    const q = fb.query(ref, fb.where('activa', '==', true));

    state.unsubscribe = fb.onSnapshot(
      q,
      (snapshot) => {
        state.loading = false;
        state.error = null;
        state.items = sortByCreatedDesc(snapshot.docs.map(normalizeDoc));
        renderPromosPublicGrid();
      },
      (error) => {
        state.loading = false;
        state.unsubscribe = null;
        state.error = formatError(error);
        renderPromosPublicGrid();
      },
    );
  } catch (error) {
    state.loading = false;
    state.error = formatError(error);
    renderPromosPublicGrid();
  }
}

async function ensureResenasAdminListener() {
  const state = realtimeState.resenasAdmin;
  if (state.unsubscribe || state.loading) return;

  state.loading = true;
  state.error = null;
  renderAdminResenas();

  try {
    const { db: rdb, fb } = await realFB();
    const ref = fb.collection(rdb, RESENAS_COLLECTION);
    const q = fb.query(ref, fb.orderBy('creadoMs', 'desc'));

    state.unsubscribe = fb.onSnapshot(
      q,
      (snapshot) => {
        state.loading = false;
        state.error = null;
        state.items = sortByCreatedDesc(snapshot.docs.map(normalizeDoc));
        renderAdminResenas();
      },
      (error) => {
        state.loading = false;
        state.unsubscribe = null;
        state.error = formatError(error);
        renderAdminResenas();
      },
    );
  } catch (error) {
    state.loading = false;
    state.error = formatError(error);
    renderAdminResenas();
  }
}

async function ensureResenasPublicListener() {
  const state = realtimeState.resenasPublic;
  if (state.unsubscribe || state.loading) return;

  state.loading = true;
  state.error = null;
  renderResenasPublicGrid();

  try {
    const { db: rdb, fb } = await realFB();
    const ref = fb.collection(rdb, RESENAS_COLLECTION);
    const q = fb.query(ref, fb.where('aprobada', '==', true));

    state.unsubscribe = fb.onSnapshot(
      q,
      (snapshot) => {
        state.loading = false;
        state.error = null;
        state.items = sortByCreatedDesc(snapshot.docs.map(normalizeDoc));
        renderResenasPublicGrid();
      },
      (error) => {
        state.loading = false;
        state.unsubscribe = null;
        state.error = formatError(error);
        renderResenasPublicGrid();
      },
    );
  } catch (error) {
    state.loading = false;
    state.error = formatError(error);
    renderResenasPublicGrid();
  }
}

function renderAdminPromociones() {
  const lista = document.getElementById('promo-lista');
  if (!lista) return;

  const state = realtimeState.promosAdmin;
  if (state.loading) {
    lista.innerHTML = '<div class="no-citas"><span class="spin">...</span> Cargando...</div>';
    return;
  }

  if (state.error) {
    lista.innerHTML = showStateMessage(state.error, true);
    return;
  }

  if (!state.items.length) {
    lista.innerHTML = showStateMessage('No hay promociones. Crea la primera desde el boton superior.');
    return;
  }

  lista.innerHTML = state.items
    .map(
      (promo) => `
        <div class="cita-item">
          <div class="cita-item-header">
            <div class="cita-name">Promocion: ${escapeHtml(promo.titulo || 'Sin titulo')}</div>
            <button class="btn-delete" onclick="eliminarPromocion('${promo.id}')">x Eliminar</button>
          </div>
          <div class="cita-details">
            <div>${escapeHtml(promo.descripcion || 'Sin descripcion')}</div>
            <div>${promo.descuento ? `Precio: ${escapeHtml(promo.descuento)}` : 'Sin precio visible'}</div>
            ${promo.fechafin ? `<div>Hasta: ${escapeHtml(promo.fechafin)}</div>` : '<div>Sin fecha de cierre</div>'}
          </div>
        </div>
      `,
    )
    .join('');
}

renderPromosPublicGrid = function () {
  const grid = document.getElementById('promos-grid');
  if (!grid) return;

  const state = realtimeState.promosPublic;
  const marketing = typeof currentMarketingState === 'function' ? currentMarketingState() : {};
  if (state.loading) {
    grid.innerHTML = '';
    return;
  }

  if (state.error) {
    console.warn('Promociones publicas:', state.error);
    grid.innerHTML = `
      <div class="empty-state-card">
        <h3>${escapeHtml(marketing.emptyPromosTitle || 'No hay promociones activas hoy')}</h3>
        <p>${escapeHtml(marketing.emptyPromosText || 'Escribenos por WhatsApp y te ayudamos a elegir el servicio ideal para esta semana.')}</p>
        <button class="btn-primary" type="button" onclick="abrirOverlay('overlay-cita')">Agendar cita</button>
      </div>
    `;
    return;
  }

  if (!state.items.length) {
    grid.innerHTML = `
      <div class="empty-state-card">
        <h3>${escapeHtml(marketing.emptyPromosTitle || 'No hay promociones activas hoy')}</h3>
        <p>${escapeHtml(marketing.emptyPromosText || 'Escribenos por WhatsApp y te ayudamos a elegir el servicio ideal para esta semana.')}</p>
        <button class="btn-primary" type="button" onclick="abrirOverlay('overlay-cita')">Agendar cita</button>
      </div>
    `;
    return;
  }

  const badges = ['Mas popular', 'Destacada', 'Especial'];
  const colors = ['var(--rose)', 'var(--gold)', '#4CAF50'];

  grid.innerHTML = state.items
    .map(
      (promo, index) => `
        <div class="promo-card reveal visible">
          <div class="promo-badge" style="background:${colors[index % colors.length]}">${badges[index % badges.length]}</div>
          <div class="promo-title">${escapeHtml(promo.titulo || 'Promocion')}</div>
          <div class="promo-desc">${escapeHtml(promo.descripcion || '')}</div>
          <div class="promo-precio"><span class="promo-ahora">${escapeHtml(promo.descuento || '')}</span></div>
          ${promo.fechafin ? `<div style="font-size:.72rem;color:rgba(255,255,255,.45);margin-bottom:10px">Hasta: ${escapeHtml(promo.fechafin)}</div>` : ''}
          <button class="promo-btn" onclick="abrirOverlay('overlay-cita')">Quiero esta promocion</button>
        </div>
      `,
    )
    .join('');
}

function renderAdminResenas() {
  const lista = document.getElementById('resenas-lista');
  if (!lista) return;

  const state = realtimeState.resenasAdmin;
  if (state.loading) {
    lista.innerHTML = '<div class="no-citas"><span class="spin">...</span> Cargando...</div>';
    return;
  }

  if (state.error) {
    lista.innerHTML = showStateMessage(state.error, true);
    return;
  }

  if (!state.items.length) {
    lista.innerHTML = showStateMessage('No hay resenas aun. Apareceran aqui cuando alguien envie una desde la pagina.');
    return;
  }

  const pendientes = state.items.filter((item) => !item.aprobada).length;
  const warning = pendientes
    ? `
        <div style="background:rgba(255,193,7,.12);border:1px solid rgba(255,193,7,.35);border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:.8rem;color:#ffc107">
          ${pendientes} resena${pendientes > 1 ? 's' : ''} pendiente${pendientes > 1 ? 's' : ''}. Apruebalas para que aparezcan en la web publica.
        </div>
      `
    : '';

  lista.innerHTML =
    warning +
    state.items
      .map(
        (resena) => `
          <div class="cita-item">
            <div class="cita-item-header">
              <div class="cita-name">${'★'.repeat(resena.estrellas || 5)} ${escapeHtml(resena.nombre || 'Cliente')}</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button class="btn-export" style="${resena.aprobada ? 'background:rgba(76,175,80,.2);color:#4CAF50' : ''}" onclick="aprobarResena('${resena.id}',${!resena.aprobada})">${resena.aprobada ? 'Publicada' : 'Aprobar'}</button>
                <button class="btn-delete" onclick="eliminarResena('${resena.id}')">x</button>
              </div>
            </div>
            <div class="cita-details">
              <div>Servicio: ${escapeHtml(resena.servicio || 'Sin especificar')}</div>
              <div style="grid-column:span 2;font-style:italic">"${escapeHtml(resena.comentario || '')}"</div>
            </div>
          </div>
        `,
      )
      .join('');
};

renderResenasPublicGrid = function () {
  const grid = document.getElementById('resenas-grid');
  if (!grid) return;

  const state = realtimeState.resenasPublic;
  const marketing = typeof currentMarketingState === 'function' ? currentMarketingState() : {};
  if (state.loading) {
    grid.innerHTML = '';
    return;
  }

  if (state.error) {
    console.warn('Resenas publicas:', state.error);
    grid.innerHTML = `
      <div class="empty-state-card light">
        <h3>${escapeHtml(marketing.emptyResenasTitle || 'Tu resena puede ser la proxima')}</h3>
        <p>${escapeHtml(marketing.emptyResenasText || 'Despues de tu cita puedes compartir tu experiencia y ayudar a otras clientas a elegir.')}</p>
      </div>
    `;
    return;
  }

  if (!state.items.length) {
    window.dispatchEvent(new CustomEvent('dr-reviews-stats', { detail: { count: 200, rating: 4.9 } }));
    grid.innerHTML = `
      <div class="empty-state-card light">
        <h3>${escapeHtml(marketing.emptyResenasTitle || 'Tu resena puede ser la proxima')}</h3>
        <p>${escapeHtml(marketing.emptyResenasText || 'Despues de tu cita puedes compartir tu experiencia y ayudar a otras clientas a elegir.')}</p>
      </div>
    `;
    return;
  }

  const total = state.items.length;
  const average = state.items.reduce((sum, item) => sum + Number(item.estrellas || 5), 0) / total;
  window.dispatchEvent(new CustomEvent('dr-reviews-stats', { detail: { count: total, rating: average } }));

  grid.innerHTML = state.items
    .slice(0, 6)
    .map(
      (resena) => `
        <div class="testimonio-card reveal visible">
          <div class="test-stars">${'★'.repeat(resena.estrellas || 5)}${'☆'.repeat(5 - (resena.estrellas || 5))}</div>
          <p class="test-text">"${escapeHtml(resena.comentario || '')}"</p>
          <div class="test-autor">
            <div class="test-avatar">${escapeHtml((resena.nombre || 'C').charAt(0).toUpperCase())}</div>
            <div><strong>${escapeHtml(resena.nombre || 'Clienta')}</strong><span>${escapeHtml(resena.servicio || 'Clienta')}</span></div>
          </div>
        </div>
      `,
    )
    .join('');
};

window.cargarAdminPromociones = async function () {
  renderAdminPromociones();
  await ensurePromosAdminListener();
};

window.abrirFormPromo = function () {
  ['promo-titulo', 'promo-desc', 'promo-descuento', 'promo-fin'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  const overlay = document.getElementById('overlay-nueva-promo');
  if (overlay) {
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
};

window.guardarPromocion = async function () {
  const titulo = document.getElementById('promo-titulo')?.value.trim();
  if (!titulo) {
    alert('El titulo es obligatorio.');
    return;
  }

  const restoreButton = setBusyButton(document.querySelector('#overlay-nueva-promo .btn-save'), 'Guardando...');

  try {
    const { db: rdb, fb } = await realFB();
    await fb.addDoc(fb.collection(rdb, PROMOS_COLLECTION), {
      titulo,
      descripcion: document.getElementById('promo-desc')?.value.trim() || '',
      descuento: document.getElementById('promo-descuento')?.value.trim() || '',
      fechafin: document.getElementById('promo-fin')?.value || '',
      activa: true,
      creado: fb.serverTimestamp(),
      creadoMs: Date.now(),
    });

    const overlay = document.getElementById('overlay-nueva-promo');
    if (overlay) {
      overlay.classList.remove('show');
      document.body.style.overflow = '';
    }

    realtimeState.promosAdmin.error = null;
    realtimeState.promosPublic.error = null;
    renderAdminPromociones();
    renderPromosPublicGrid();
    showOk('ok-promos');
  } catch (error) {
    const message = formatError(error, 'No se pudo guardar la promocion.');
    realtimeState.promosAdmin.error = message;
    realtimeState.promosPublic.error = message;
    renderAdminPromociones();
    renderPromosPublicGrid();
    alert(`Error al guardar la promocion: ${message}`);
  } finally {
    restoreButton();
  }
};

window.eliminarPromocion = async function (id) {
  if (!confirm('Eliminar esta promocion?')) return;

  try {
    const { db: rdb, fb } = await realFB();
    await fb.deleteDoc(fb.doc(rdb, PROMOS_COLLECTION, id));
  } catch (error) {
    const message = formatError(error, 'No se pudo eliminar la promocion.');
    realtimeState.promosAdmin.error = message;
    realtimeState.promosPublic.error = message;
    renderAdminPromociones();
    renderPromosPublicGrid();
    alert(message);
  }
};

window.cargarAdminResenas = async function () {
  renderAdminResenas();
  await ensureResenasAdminListener();
};

window.aprobarResena = async function (id, estado) {
  try {
    const { db: rdb, fb } = await realFB();
    await fb.updateDoc(fb.doc(rdb, RESENAS_COLLECTION, id), {
      aprobada: estado,
      actualizadoMs: Date.now(),
    });
  } catch (error) {
    const message = formatError(error, 'No se pudo actualizar la resena.');
    realtimeState.resenasAdmin.error = message;
    realtimeState.resenasPublic.error = message;
    renderAdminResenas();
    renderResenasPublicGrid();
    alert(message);
  }
};

window.eliminarResena = async function (id) {
  if (!confirm('Eliminar esta resena?')) return;

  try {
    const { db: rdb, fb } = await realFB();
    await fb.deleteDoc(fb.doc(rdb, RESENAS_COLLECTION, id));
  } catch (error) {
    const message = formatError(error, 'No se pudo eliminar la resena.');
    realtimeState.resenasAdmin.error = message;
    realtimeState.resenasPublic.error = message;
    renderAdminResenas();
    renderResenasPublicGrid();
    alert(message);
  }
};

export async function cargarResenasPublicas() {
  renderResenasPublicGrid();
  await ensureResenasPublicListener();
}

export async function cargarPromosPublicas() {
  renderPromosPublicGrid();
  await ensurePromosPublicListener();
}

window.enviarResena = async function (e) {
  e.preventDefault();

  const nombre = document.getElementById('res-nombre')?.value.trim();
  const estrellas = Number(document.getElementById('res-estrellas')?.value) || 5;
  const servicio = document.getElementById('res-servicio')?.value.trim() || '';
  const comentario = document.getElementById('res-comentario')?.value.trim();

  if (!nombre || !comentario) {
    alert('Nombre y comentario son obligatorios.');
    return;
  }

  const btn = document.getElementById('btn-resena');
  const restoreButton = setBusyButton(btn, 'Enviando...');

  try {
    const { db: rdb, fb } = await realFB();
    await fb.addDoc(fb.collection(rdb, RESENAS_COLLECTION), {
      nombre,
      estrellas,
      servicio,
      comentario,
      aprobada: false,
      creado: fb.serverTimestamp(),
      creadoMs: Date.now(),
    });

    realtimeState.resenasAdmin.error = null;
    const form = document.getElementById('resena-form');
    if (form) form.reset();
    const ok = document.getElementById('resena-ok');
    if (ok) {
      ok.style.display = 'block';
      setTimeout(() => {
        ok.style.display = 'none';
      }, 5000);
    }
  } catch (error) {
    const message = formatError(error, 'No se pudo enviar la resena.');
    realtimeState.resenasPublic.error = message;
    renderResenasPublicGrid();
    alert(`Error al enviar la resena: ${message}`);
  } finally {
    restoreButton();
  }
};

// Canonical production-safe overrides kept at EOF so legacy duplicates above cannot override them.
window.guardarPromocion = async function () {
  const titulo = document.getElementById('promo-titulo')?.value.trim();
  if (!titulo) {
    showAdminToast('El titulo de la promocion es obligatorio.', 'error');
    return;
  }

  const restoreButton = setBusyButton(document.querySelector('#overlay-nueva-promo .btn-save'), 'Guardando...');

  try {
    const { db: rdb, fb } = await withRealtimeTimeout(realFB(), 'Firebase');
    await withRealtimeTimeout(
      fb.addDoc(fb.collection(rdb, PROMOS_COLLECTION), {
        titulo,
        descripcion: document.getElementById('promo-desc')?.value.trim() || '',
        descuento: document.getElementById('promo-descuento')?.value.trim() || '',
        fechafin: document.getElementById('promo-fin')?.value || '',
        activa: true,
        creado: fb.serverTimestamp(),
        creadoMs: Date.now(),
      }),
      'Guardar promocion',
    );

    document.getElementById('overlay-nueva-promo')?.classList.remove('show');
    document.body.style.overflow = '';
    realtimeState.promosAdmin.error = null;
    realtimeState.promosPublic.error = null;
    renderAdminPromociones();
    renderPromosPublicGrid();
    showOk('ok-promos');
    showAdminToast(`Promocion "${titulo}" guardada.`, 'success');
  } catch (error) {
    const message = formatError(error, 'No se pudo guardar la promocion.');
    realtimeState.promosAdmin.error = message;
    realtimeState.promosPublic.error = message;
    renderAdminPromociones();
    renderPromosPublicGrid();
    showAdminToast(message, 'error');
  } finally {
    restoreButton();
  }
};

window.enviarResena = async function (e) {
  e.preventDefault();

  if (typeof window.validateReviewFormInputs === 'function' && !window.validateReviewFormInputs()) {
    return;
  }

  const nombre = document.getElementById('res-nombre')?.value.trim();
  const estrellas = Number(document.getElementById('res-estrellas')?.value) || 5;
  const servicio = document.getElementById('res-servicio')?.value.trim() || '';
  const comentario = document.getElementById('res-comentario')?.value.trim();
  const btn = document.getElementById('btn-resena');
  const restoreButton = setBusyButton(btn, 'Enviando...');

  try {
    const { db: rdb, fb } = await withRealtimeTimeout(realFB(), 'Firebase');
    await withRealtimeTimeout(
      fb.addDoc(fb.collection(rdb, RESENAS_COLLECTION), {
        nombre,
        estrellas,
        servicio,
        comentario,
        aprobada: false,
        creado: fb.serverTimestamp(),
        creadoMs: Date.now(),
      }),
      'Enviar resena',
    );

    realtimeState.resenasAdmin.error = null;
    document.getElementById('resena-form')?.reset();
    ['res-nombre', 'res-servicio', 'res-comentario'].forEach((id) => window.__clearFieldError?.(document.getElementById(id)));
    const ok = document.getElementById('resena-ok');
    if (ok) {
      ok.style.display = 'block';
      setTimeout(() => {
        ok.style.display = 'none';
      }, 5000);
    }
    showAdminToast('Resena enviada. Quedo pendiente de aprobacion.', 'success');
  } catch (error) {
    const message = formatError(error, 'No se pudo enviar la resena.');
    realtimeState.resenasPublic.error = message;
    renderResenasPublicGrid();
    showAdminToast(message, 'error');
  } finally {
    restoreButton();
  }
};

const DIRECT_REALFB_TIMEOUT_MS = 10000;

function withRealtimeTimeout(promise, label, timeoutMs = DIRECT_REALFB_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${label} no respondio a tiempo.`));
    }, timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

window.guardarPromocion = async function () {
  const titulo = document.getElementById('promo-titulo')?.value.trim();
  if (!titulo) {
    showAdminToast('El titulo de la promocion es obligatorio.', 'error');
    return;
  }

  const restoreButton = setBusyButton(document.querySelector('#overlay-nueva-promo .btn-save'), 'Guardando...');

  try {
    const { db: rdb, fb } = await withRealtimeTimeout(realFB(), 'Firebase');
    await withRealtimeTimeout(
      fb.addDoc(fb.collection(rdb, PROMOS_COLLECTION), {
        titulo,
        descripcion: document.getElementById('promo-desc')?.value.trim() || '',
        descuento: document.getElementById('promo-descuento')?.value.trim() || '',
        fechafin: document.getElementById('promo-fin')?.value || '',
        activa: true,
        creado: fb.serverTimestamp(),
        creadoMs: Date.now(),
      }),
      'Guardar promocion',
    );

    document.getElementById('overlay-nueva-promo')?.classList.remove('show');
    document.body.style.overflow = '';
    realtimeState.promosAdmin.error = null;
    realtimeState.promosPublic.error = null;
    renderAdminPromociones();
    renderPromosPublicGrid();
    showOk('ok-promos');
    showAdminToast(`Promocion "${titulo}" guardada.`, 'success');
  } catch (error) {
    const message = formatError(error, 'No se pudo guardar la promocion.');
    realtimeState.promosAdmin.error = message;
    realtimeState.promosPublic.error = message;
    renderAdminPromociones();
    renderPromosPublicGrid();
    showAdminToast(message, 'error');
  } finally {
    restoreButton();
  }
};

window.enviarResena = async function (e) {
  e.preventDefault();

  if (typeof window.validateReviewFormInputs === 'function' && !window.validateReviewFormInputs()) {
    return;
  }

  const nombre = document.getElementById('res-nombre')?.value.trim();
  const estrellas = Number(document.getElementById('res-estrellas')?.value) || 5;
  const servicio = document.getElementById('res-servicio')?.value.trim() || '';
  const comentario = document.getElementById('res-comentario')?.value.trim();
  const btn = document.getElementById('btn-resena');
  const restoreButton = setBusyButton(btn, 'Enviando...');

  try {
    const { db: rdb, fb } = await withRealtimeTimeout(realFB(), 'Firebase');
    await withRealtimeTimeout(
      fb.addDoc(fb.collection(rdb, RESENAS_COLLECTION), {
        nombre,
        estrellas,
        servicio,
        comentario,
        aprobada: false,
        creado: fb.serverTimestamp(),
        creadoMs: Date.now(),
      }),
      'Enviar resena',
    );

    realtimeState.resenasAdmin.error = null;
    document.getElementById('resena-form')?.reset();
    ['res-nombre', 'res-servicio', 'res-comentario'].forEach((id) => window.__clearFieldError?.(document.getElementById(id)));
    const ok = document.getElementById('resena-ok');
    if (ok) {
      ok.style.display = 'block';
      setTimeout(() => {
        ok.style.display = 'none';
      }, 5000);
    }
    showAdminToast('Resena enviada. Quedo pendiente de aprobacion.', 'success');
  } catch (error) {
    const message = formatError(error, 'No se pudo enviar la resena.');
    realtimeState.resenasPublic.error = message;
    renderResenasPublicGrid();
    showAdminToast(message, 'error');
  } finally {
    restoreButton();
  }
};

const MARKETING_FORM_DEFAULTS = Object.freeze({
  urgencyEnabled: true,
  urgencyText: 'Cupos limitados esta semana. Agenda hoy y asegura tu lugar.',
  emptyPromosTitle: 'No hay promociones activas hoy',
  emptyPromosText: 'Escribenos por WhatsApp y te ayudamos a elegir el servicio ideal para esta semana.',
  emptyResenasTitle: 'Tu resena puede ser la proxima',
  emptyResenasText: 'Despues de tu cita puedes compartir tu experiencia y ayudar a otras clientas a elegir.',
  emptyGaleriaText: 'Pronto veras fotos reales de nuestros trabajos mas recientes.',
  faqEnabled: true,
  faqTitle: 'Preguntas frecuentes',
  faqSubtitle: 'Resolvemos lo mas importante antes de agendar tu cita.',
  faqItems: [
    { question: 'Como confirmo mi cita?', answer: 'Tu cita se confirma con un abono previo de $10.000 al Nequi publicado en la web.' },
    { question: 'Puedo agendar para hoy?', answer: 'Si hay cupos disponibles puedes reservar hoy mismo desde la web o por WhatsApp.' },
    { question: 'Que debo llevar a mi cita?', answer: 'Solo tu referencia o idea del diseno. Si tienes una foto, agregala en la nota de la reserva.' },
  ],
});

let monitorBindingsReady = false;

function currentMarketingState() {
  return {
    ...MARKETING_FORM_DEFAULTS,
    ...(window.__marketingState || {}),
  };
}

function readMarketingForm() {
  return {
    urgencyEnabled: document.getElementById('mk-urgency-enabled')?.checked !== false,
    urgencyText: document.getElementById('mk-urgency-text')?.value.trim() || MARKETING_FORM_DEFAULTS.urgencyText,
    emptyPromosTitle: document.getElementById('mk-empty-promos-title')?.value.trim() || MARKETING_FORM_DEFAULTS.emptyPromosTitle,
    emptyPromosText: document.getElementById('mk-empty-promos-text')?.value.trim() || MARKETING_FORM_DEFAULTS.emptyPromosText,
    emptyResenasTitle: document.getElementById('mk-empty-resenas-title')?.value.trim() || MARKETING_FORM_DEFAULTS.emptyResenasTitle,
    emptyResenasText: document.getElementById('mk-empty-resenas-text')?.value.trim() || MARKETING_FORM_DEFAULTS.emptyResenasText,
    emptyGaleriaText: document.getElementById('mk-empty-galeria-text')?.value.trim() || MARKETING_FORM_DEFAULTS.emptyGaleriaText,
    faqEnabled: document.getElementById('mk-faq-enabled')?.checked !== false,
    faqTitle: document.getElementById('mk-faq-title')?.value.trim() || MARKETING_FORM_DEFAULTS.faqTitle,
    faqSubtitle: document.getElementById('mk-faq-subtitle')?.value.trim() || MARKETING_FORM_DEFAULTS.faqSubtitle,
    faqItems: [1, 2, 3].map((index) => ({
      question: document.getElementById(`mk-faq-q${index}`)?.value.trim() || MARKETING_FORM_DEFAULTS.faqItems[index - 1].question,
      answer: document.getElementById(`mk-faq-a${index}`)?.value.trim() || MARKETING_FORM_DEFAULTS.faqItems[index - 1].answer,
    })),
  };
}

function writeMarketingForm(data = {}) {
  const marketing = {
    ...MARKETING_FORM_DEFAULTS,
    ...data,
    faqItems: Array.isArray(data.faqItems) && data.faqItems.length ? data.faqItems : MARKETING_FORM_DEFAULTS.faqItems,
  };

  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
  };

  const setChecked = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(value);
  };

  setChecked('mk-urgency-enabled', marketing.urgencyEnabled);
  setValue('mk-urgency-text', marketing.urgencyText);
  setValue('mk-empty-promos-title', marketing.emptyPromosTitle);
  setValue('mk-empty-promos-text', marketing.emptyPromosText);
  setValue('mk-empty-resenas-title', marketing.emptyResenasTitle);
  setValue('mk-empty-resenas-text', marketing.emptyResenasText);
  setValue('mk-empty-galeria-text', marketing.emptyGaleriaText);
  setChecked('mk-faq-enabled', marketing.faqEnabled);
  setValue('mk-faq-title', marketing.faqTitle);
  setValue('mk-faq-subtitle', marketing.faqSubtitle);

  [1, 2, 3].forEach((index) => {
    const item = marketing.faqItems[index - 1] || {};
    setValue(`mk-faq-q${index}`, item.question || '');
    setValue(`mk-faq-a${index}`, item.answer || '');
  });
}

window.cargarAdminMarketing = async function () {
  writeMarketingForm(currentMarketingState());

  try {
    const snap = await getDoc(doc(db, 'config', 'marketing'));
    const data = snap.exists() ? snap.data() : currentMarketingState();
    writeMarketingForm(data);
    clearAdminError('marketing');
  } catch (error) {
    showAdminError('marketing', formatError(error, 'No se pudo cargar el contenido editable.'));
  }
};

window.guardarMarketing = async function () {
  const restoreButton = setBusyButton(document.querySelector('#tab-marketing .btn-save'), 'Guardando...');

  try {
    const payload = readMarketingForm();
    await setDoc(doc(db, 'config', 'marketing'), payload);
    window.__marketingState = payload;
    clearAdminError('marketing');
    showOk('ok-marketing');
    showAdminToast('Contenido de conversion actualizado.', 'success');
  } catch (error) {
    showAdminError('marketing', formatError(error, 'No se pudo guardar el contenido editable.'));
    showAdminToast('No se pudo guardar el contenido editable.', 'error');
  } finally {
    restoreButton();
  }
};

function monitorPill(status = 'idle') {
  if (status === 'ok') return '<span class="monitor-pill ok">Online</span>';
  if (status === 'warn') return '<span class="monitor-pill warn">Lento</span>';
  if (status === 'error') return '<span class="monitor-pill error">Con fallas</span>';
  if (status === 'checking') return '<span class="monitor-pill warn">Comprobando</span>';
  return '<span class="monitor-pill warn">Sin datos</span>';
}

function renderMonitorPanel() {
  const cards = document.getElementById('monitor-status-cards');
  const list = document.getElementById('monitor-log-list');
  const note = document.getElementById('monitor-note');
  if (!cards || !list) return;

  const monitorApi = window.__monitoring;
  const logs = monitorApi?.getLogs?.() || [];
  const health = monitorApi?.getHealth?.() || { status: 'idle', message: 'Sin comprobar', checkedAt: null };
  const storage = health.storage || { provider: 'disabled', ready: false, publicBaseUrl: '' };
  const errorCount = logs.filter((item) => item.level === 'error').length;
  const latest = logs[0];

  cards.innerHTML = `
    <div class="monitor-card">
      <div class="monitor-card-label">Render</div>
      <div class="monitor-card-value">${monitorPill(health.status)}</div>
      <div class="monitor-card-sub">${escapeHtml(health.message || 'Sin comprobar')}</div>
      <div class="monitor-card-sub">${health.checkedAt ? `Ultima revision: ${escapeHtml(monitorApi?.formatTime?.(health.checkedAt) || health.checkedAt)}` : 'Aun no se ha consultado.'}</div>
    </div>
    <div class="monitor-card">
      <div class="monitor-card-label">Errores frontend</div>
      <div class="monitor-card-value">${errorCount}</div>
      <div class="monitor-card-sub">${latest ? `Ultimo: ${escapeHtml(latest.message)}` : 'Sin errores registrados en esta sesion.'}</div>
    </div>
    <div class="monitor-card">
      <div class="monitor-card-label">Latencia</div>
      <div class="monitor-card-value">${health.latencyMs ? `${health.latencyMs} ms` : '--'}</div>
      <div class="monitor-card-sub">Medicion en vivo del backend usado para citas y slots.</div>
    </div>
    <div class="monitor-card">
      <div class="monitor-card-label">Storage</div>
      <div class="monitor-card-value">${escapeHtml(String(storage.provider || 'disabled')).toUpperCase()}</div>
      <div class="monitor-card-sub">${storage.ready ? 'Listo para imagenes remotas.' : 'Sin configurar. El panel usa modo compatible actual.'}</div>
      <div class="monitor-card-sub">${escapeHtml(storage.publicBaseUrl || '')}</div>
    </div>
  `;

  if (note) {
    note.textContent = 'Los logs de frontend se guardan en este navegador para diagnostico rapido. El estado de Render se consulta en vivo.';
  }

  if (!logs.length) {
    list.innerHTML = '<div class="monitor-log-empty">No hay errores recientes registrados en este navegador.</div>';
    return;
  }

  list.innerHTML = logs
    .map(
      (item) => `
        <div class="monitor-log-item">
          <div class="monitor-log-top">
            <div class="monitor-log-title">${escapeHtml(item.type || 'evento')} - ${escapeHtml(item.level || 'info')}</div>
            <div class="monitor-log-time">${escapeHtml(monitorApi?.formatTime?.(item.createdAt) || item.createdAt || '')}</div>
          </div>
          <div class="monitor-log-meta">${escapeHtml(item.message || '')}</div>
          <div class="monitor-log-meta">Origen: ${escapeHtml(item.meta?.source || 'general')}</div>
        </div>
      `,
    )
    .join('');
}

function bindMonitorPanel() {
  if (monitorBindingsReady) return;
  monitorBindingsReady = true;

  window.addEventListener('dr-monitor-update', () => {
    if (document.getElementById('tab-monitor')?.classList.contains('active')) renderMonitorPanel();
  });

  window.addEventListener('dr-monitor-health', () => {
    if (document.getElementById('tab-monitor')?.classList.contains('active')) renderMonitorPanel();
  });
}

window.cargarAdminMonitor = async function () {
  bindMonitorPanel();
  renderMonitorPanel();

  try {
    await window.__monitoring?.refreshHealth?.({ silent: true });
  } catch (error) {
    showAdminToast(error?.message || 'No se pudo consultar el estado de Render.', 'error');
  } finally {
    renderMonitorPanel();
  }
};

window.limpiarLogsMonitor = function () {
  window.__monitoring?.clearLogs?.();
  renderMonitorPanel();
  showAdminToast('Logs locales limpiados.', 'success');
};

function renderPromosPublicGrid() {
  const grid = document.getElementById('promos-grid');
  if (!grid) return;

  const state = realtimeState.promosPublic;
  const marketing = currentMarketingState();
  if (state.loading) {
    grid.innerHTML = '';
    return;
  }

  if (state.error) {
    console.warn('Promociones publicas:', state.error);
    grid.innerHTML = `
      <div class="empty-state-card">
        <h3>${escapeHtml(marketing.emptyPromosTitle)}</h3>
        <p>${escapeHtml(marketing.emptyPromosText)}</p>
        <button class="btn-primary" type="button" onclick="abrirOverlay('overlay-cita')">Agendar cita</button>
      </div>
    `;
    return;
  }

  if (!state.items.length) {
    grid.innerHTML = `
      <div class="empty-state-card">
        <h3>${escapeHtml(marketing.emptyPromosTitle)}</h3>
        <p>${escapeHtml(marketing.emptyPromosText)}</p>
        <button class="btn-primary" type="button" onclick="abrirOverlay('overlay-cita')">Quiero asesoría</button>
      </div>
    `;
    return;
  }

  const badges = ['Mas popular', 'Destacada', 'Especial'];
  const colors = ['var(--rose)', 'var(--gold)', '#4CAF50'];

  grid.innerHTML = state.items
    .map(
      (promo, index) => `
        <div class="promo-card reveal visible">
          <div class="promo-badge" style="background:${colors[index % colors.length]}">${badges[index % badges.length]}</div>
          <div class="promo-title">${escapeHtml(promo.titulo || 'Promocion')}</div>
          <div class="promo-desc">${escapeHtml(promo.descripcion || '')}</div>
          <div class="promo-precio"><span class="promo-ahora">${escapeHtml(promo.descuento || '')}</span></div>
          ${promo.fechafin ? `<div style="font-size:.72rem;color:rgba(255,255,255,.45);margin-bottom:10px">Hasta: ${escapeHtml(promo.fechafin)}</div>` : ''}
          <button class="promo-btn" onclick="abrirOverlay('overlay-cita')">Quiero esta promocion</button>
        </div>
      `,
    )
    .join('');
}

function renderResenasPublicGrid() {
  const grid = document.getElementById('resenas-grid');
  if (!grid) return;

  const state = realtimeState.resenasPublic;
  const marketing = currentMarketingState();
  if (state.loading) {
    grid.innerHTML = '';
    return;
  }

  if (state.error) {
    console.warn('Resenas publicas:', state.error);
    grid.innerHTML = `
      <div class="empty-state-card light">
        <h3>${escapeHtml(marketing.emptyResenasTitle)}</h3>
        <p>${escapeHtml(marketing.emptyResenasText)}</p>
        <button class="btn-ghost" type="button" onclick="document.getElementById('resena-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' })">Escribir una resena</button>
      </div>
    `;
    return;
  }

  if (!state.items.length) {
    grid.innerHTML = `
      <div class="empty-state-card light">
        <h3>${escapeHtml(marketing.emptyResenasTitle)}</h3>
        <p>${escapeHtml(marketing.emptyResenasText)}</p>
        <button class="btn-ghost" type="button" onclick="document.getElementById('resena-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' })">Compartir experiencia</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = state.items
    .slice(0, 6)
    .map(
      (resena) => `
        <div class="testimonio-card reveal visible">
          <div class="test-stars">${'★'.repeat(resena.estrellas || 5)}${'☆'.repeat(5 - (resena.estrellas || 5))}</div>
          <p class="test-text">"${escapeHtml(resena.comentario || '')}"</p>
          <div class="test-autor">
            <div class="test-avatar">${escapeHtml((resena.nombre || 'C').charAt(0).toUpperCase())}</div>
            <div><strong>${escapeHtml(resena.nombre || 'Clienta')}</strong><span>${escapeHtml(resena.servicio || 'Clienta')}</span></div>
          </div>
        </div>
      `,
    )
    .join('');
}

window.enviarResena = async function (e) {
  e.preventDefault();

  if (typeof window.validateReviewFormInputs === 'function' && !window.validateReviewFormInputs()) {
    return;
  }

  const nombre = document.getElementById('res-nombre')?.value.trim();
  const estrellas = Number(document.getElementById('res-estrellas')?.value) || 5;
  const servicio = document.getElementById('res-servicio')?.value.trim() || '';
  const comentario = document.getElementById('res-comentario')?.value.trim();
  const btn = document.getElementById('btn-resena');
  const restoreButton = setBusyButton(btn, 'Enviando...');

  try {
    const { db: rdb, fb } = await realFB();
    await fb.addDoc(fb.collection(rdb, RESENAS_COLLECTION), {
      nombre,
      estrellas,
      servicio,
      comentario,
      aprobada: false,
      creado: fb.serverTimestamp(),
      creadoMs: Date.now(),
    });

    realtimeState.resenasAdmin.error = null;
    document.getElementById('resena-form')?.reset();
    ['res-nombre', 'res-servicio', 'res-comentario'].forEach((id) => window.__clearFieldError?.(document.getElementById(id)));
    const ok = document.getElementById('resena-ok');
    if (ok) {
      ok.style.display = 'block';
      setTimeout(() => {
        ok.style.display = 'none';
      }, 5000);
    }
    showAdminToast('Resena enviada. Quedo pendiente de aprobacion.', 'success');
  } catch (error) {
    const message = formatError(error, 'No se pudo enviar la resena.');
    realtimeState.resenasPublic.error = message;
    renderResenasPublicGrid();
    showAdminToast(message, 'error');
  } finally {
    restoreButton();
  }
};

function initAdminFilters() {
  const searchInput = document.getElementById('filtro-citas');
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = 'true';
    searchInput.addEventListener('input', () => window.debouncedRenderCitas());
  }

  const dateSelect = document.getElementById('filtro-fecha-citas');
  if (dateSelect && !dateSelect.dataset.bound) {
    dateSelect.dataset.bound = 'true';
    dateSelect.addEventListener('change', () => {
      realtimeState.citas.filter = dateSelect.value;
      realtimeState.citas.limit = 20;
      window.renderCitas();
    });
  }
}


window.debouncedRenderCitas = debounce(() => {
  realtimeState.citas.limit = 20;
  window.renderCitas();
}, 300);

window.setCitasFilter = function (filter) {
  realtimeState.citas.filter = filter;
  realtimeState.citas.limit = 20;
  const dateSelect = document.getElementById('filtro-fecha-citas');
  if (dateSelect) dateSelect.value = filter;
  document.querySelectorAll('.filter-chip').forEach((button) => {
    button.classList.toggle('active', button.dataset.filter === filter);
  });
  window.renderCitas();
};

window.cargarMasCitas = function () {
  realtimeState.citas.limit += 20;
  window.renderCitas();
};

window.renderCitas = async function () {
  const lista = document.getElementById('lista-citas');
  if (!lista) return;

  initAdminFilters();
  ensureCitasListener();
  const state = realtimeState.citas;

  if (state.loading && !state.initialized) {
    lista.innerHTML = '<div class="no-citas"><span class="spin">...</span> Cargando...</div>';
    return;
  }

  if (state.error) {
    showAdminError('citas', state.error);
    lista.innerHTML = showStateMessage(state.error, true);
    return;
  }

  clearAdminError('citas');
  renderCitasStats(state.items);

  const filtradas = citasFiltradas();
  if (!filtradas.length) {
    lista.innerHTML = '<div class="no-citas">No hay citas para ese filtro.</div>';
    return;
  }

  const visibles = filtradas.slice(0, state.limit);
  lista.innerHTML =
    visibles
      .map(
        (cita) => `
          <div class="cita-item">
            <div class="cita-item-header">
              <div class="cita-name">Cliente: ${escapeHtml(cita.nombre || 'Sin nombre')}</div>
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                <span class="cita-badge">${escapeHtml(cita.fecha || '')} · ${to12h(cita.hora)}</span>
                <button class="btn-delete" onclick="eliminarCita('${cita.id}','${escapeHtml(cita.fecha || '')}','${escapeHtml(cita.hora || '')}','${escapeHtml(cita.nombre || 'esta clienta')}')">Eliminar</button>
              </div>
            </div>
            <div class="cita-details">
              <div>Tel: ${escapeHtml(cita.tel || '')}</div>
              <div>Servicio: ${escapeHtml(serviceLabel(cita.servicio))}</div>
              ${cita.nota ? `<div style="grid-column:span 2">Nota: ${escapeHtml(cita.nota)}</div>` : ''}
            </div>
          </div>
        `,
      )
      .join('') +
    (filtradas.length > visibles.length
      ? `<button class="btn-export btn-load-more" onclick="cargarMasCitas()">Cargar 20 mas</button>`
      : '');
};

window.eliminarCita = async function (id, fecha, hora, nombre = 'esta clienta') {
  const accepted = await (window.confirmAction
    ? window.confirmAction(`Eliminar la cita de ${nombre}?`, 'Eliminar')
    : Promise.resolve(confirm(`Eliminar la cita de ${nombre}?`)));
  if (!accepted) return;

  try {
    await deleteDoc(doc(db, 'citas', id));
    showAdminToast(`Cita de ${nombre} eliminada.`, 'success');
    try {
      await updateDoc(doc(db, 'slots', fecha), { booked: arrayRemove(hora) });
    } catch (error) {
      showAdminError('citas', formatError(error, 'La cita se elimino, pero no se pudo liberar el horario.'));
    }
  } catch (error) {
    showAdminError('citas', formatError(error, 'No se pudo eliminar la cita.'));
    showAdminToast(`No se pudo eliminar la cita de ${nombre}.`, 'error');
  }
};

window.exportarCitas = async function () {
  const citas = [...realtimeState.citas.items];
  if (!citas.length) {
    showAdminToast('No hay citas para exportar.', 'info');
    return;
  }

  const rows = [
    ['Nombre', 'Telefono', 'Servicio', 'Fecha', 'Hora_24h', 'Hora_12h', 'Nota', 'Creado'],
    ...citas
      .sort((left, right) => `${left.fecha}${left.hora}`.localeCompare(`${right.fecha}${right.hora}`))
      .map((cita) => [
        cita.nombre || '',
        cita.tel || '',
        serviceLabel(cita.servicio),
        cita.fecha || '',
        cita.hora || '',
        to12h(cita.hora || ''),
        cita.nota || '',
        cita.creado || '',
      ]),
  ];

  const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  link.download = `citas-dulce-rosa-${todayIso()}.csv`;
  link.click();
  showAdminToast('CSV exportado.', 'success');
};

window.guardarNuevoServicio = async function () {
  const nombre = document.getElementById('ns-nombre')?.value.trim();
  if (!nombre) {
    showAdminToast('El nombre del servicio es obligatorio.', 'error');
    return;
  }

  const restoreButton = setBusyButton(document.querySelector('#overlay-nuevo-svc .btn-save'), 'Guardando...');

  try {
    const id = `custom_${Date.now()}`;
    const snap = await getDoc(doc(db, 'config', 'servicios'));
    const existing = snap.exists() ? snap.data() : {};
    const cat = document.getElementById('ns-cat')?.value || 'Uñas';
    const customKeys = [...(existing._custom || [])];

    customKeys.push({ id, nombre, cat, emoji: 'N', desde: false });

    const newData = {
      ...existing,
      _custom: customKeys,
      [id]: {
        nombre,
        precio: Number(document.getElementById('ns-precio')?.value) || 0,
        descripcion: document.getElementById('ns-desc')?.value.trim() || '',
        detalles: document.getElementById('ns-detalles')?.value.trim() || '',
        imagen: null,
        emoji: 'N',
        cat,
        desde: false,
        hidden: false,
      },
    };

    await setDoc(doc(db, 'config', 'servicios'), newData);
    serviciosEnMemoria = newData;
    clearAdminError('servicios');

    document.getElementById('overlay-nuevo-svc')?.classList.remove('show');
    document.body.style.overflow = '';

    const cont = document.getElementById('svc-edit-list');
    if (cont) _renderSvcAdmin(cont, newData);
    showOk('ok-servicios');
    showAdminToast(`Servicio "${nombre}" creado.`, 'success');
  } catch (error) {
    showAdminError('servicios', formatError(error, 'No se pudo crear el servicio.'));
    showAdminToast('No se pudo crear el servicio.', 'error');
  } finally {
    restoreButton();
  }
};

window.eliminarServicio = async function (id, isBuiltin, nombre = '') {
  const resolvedName =
    nombre ||
    document.getElementById(`svc-name-${id}`)?.value.trim() ||
    serviciosEnMemoria[id]?.nombre ||
    'este servicio';

  const accepted = await (window.confirmAction
    ? window.confirmAction(isBuiltin ? `Ocultar ${resolvedName}?` : `Eliminar ${resolvedName}?`, isBuiltin ? 'Ocultar' : 'Eliminar')
    : Promise.resolve(confirm(isBuiltin ? `Ocultar ${resolvedName}?` : `Eliminar ${resolvedName}?`)));
  if (!accepted) return;

  try {
    const snap = await getDoc(doc(db, 'config', 'servicios'));
    const existing = snap.exists() ? snap.data() : {};
    const customKeys = (existing._custom || []).filter((item) => item.id !== id);
    const newData = { ...existing, _custom: customKeys };

    if (isBuiltin) newData[id] = { ...(existing[id] || {}), hidden: true };
    else delete newData[id];

    await setDoc(doc(db, 'config', 'servicios'), newData);
    serviciosEnMemoria = newData;
    clearAdminError('servicios');

    const cont = document.getElementById('svc-edit-list');
    if (cont) _renderSvcAdmin(cont, newData);
    showAdminToast(`${resolvedName} fue eliminado.`, 'success');
  } catch (error) {
    showAdminError('servicios', formatError(error, 'No se pudo eliminar el servicio.'));
    showAdminToast(`No se pudo eliminar ${resolvedName}.`, 'error');
  }
};

window.guardarPromocion = async function () {
  const titulo = document.getElementById('promo-titulo')?.value.trim();
  if (!titulo) {
    showAdminToast('El titulo de la promocion es obligatorio.', 'error');
    return;
  }

  const restoreButton = setBusyButton(document.querySelector('#overlay-nueva-promo .btn-save'), 'Guardando...');

  try {
    const { db: rdb, fb } = await realFB();
    await fb.addDoc(fb.collection(rdb, PROMOS_COLLECTION), {
      titulo,
      descripcion: document.getElementById('promo-desc')?.value.trim() || '',
      descuento: document.getElementById('promo-descuento')?.value.trim() || '',
      fechafin: document.getElementById('promo-fin')?.value || '',
      activa: true,
      creado: fb.serverTimestamp(),
      creadoMs: Date.now(),
    });

    document.getElementById('overlay-nueva-promo')?.classList.remove('show');
    document.body.style.overflow = '';
    realtimeState.promosAdmin.error = null;
    realtimeState.promosPublic.error = null;
    renderAdminPromociones();
    renderPromosPublicGrid();
    showOk('ok-promos');
    showAdminToast(`Promocion "${titulo}" guardada.`, 'success');
  } catch (error) {
    const message = formatError(error, 'No se pudo guardar la promocion.');
    realtimeState.promosAdmin.error = message;
    realtimeState.promosPublic.error = message;
    renderAdminPromociones();
    renderPromosPublicGrid();
    showAdminToast(message, 'error');
  } finally {
    restoreButton();
  }
};

window.eliminarPromocion = async function (id) {
  const titulo = realtimeState.promosAdmin.items.find((item) => item.id === id)?.titulo || 'esta promocion';
  const accepted = await (window.confirmAction
    ? window.confirmAction(`Eliminar ${titulo}?`, 'Eliminar')
    : Promise.resolve(confirm(`Eliminar ${titulo}?`)));
  if (!accepted) return;

  try {
    const { db: rdb, fb } = await realFB();
    await fb.deleteDoc(fb.doc(rdb, PROMOS_COLLECTION, id));
    showAdminToast(`Promocion "${titulo}" eliminada.`, 'success');
  } catch (error) {
    const message = formatError(error, 'No se pudo eliminar la promocion.');
    realtimeState.promosAdmin.error = message;
    realtimeState.promosPublic.error = message;
    renderAdminPromociones();
    renderPromosPublicGrid();
    showAdminToast(message, 'error');
  }
};

window.aprobarResena = async function (id, estado) {
  const nombre = realtimeState.resenasAdmin.items.find((item) => item.id === id)?.nombre || 'la resena';

  try {
    const { db: rdb, fb } = await realFB();
    await fb.updateDoc(fb.doc(rdb, RESENAS_COLLECTION, id), {
      aprobada: estado,
      actualizadoMs: Date.now(),
    });
    showAdminToast(
      estado ? `Reseña de ${nombre} publicada.` : `Reseña de ${nombre} devuelta a pendiente.`,
      'success',
    );
  } catch (error) {
    const message = formatError(error, 'No se pudo actualizar la resena.');
    realtimeState.resenasAdmin.error = message;
    realtimeState.resenasPublic.error = message;
    renderAdminResenas();
    renderResenasPublicGrid();
    showAdminToast(message, 'error');
  }
};

window.eliminarResena = async function (id) {
  const nombre = realtimeState.resenasAdmin.items.find((item) => item.id === id)?.nombre || 'esta reseña';
  const accepted = await (window.confirmAction
    ? window.confirmAction(`Eliminar la reseña de ${nombre}?`, 'Eliminar')
    : Promise.resolve(confirm(`Eliminar la reseña de ${nombre}?`)));
  if (!accepted) return;

  try {
    const { db: rdb, fb } = await realFB();
    await fb.deleteDoc(fb.doc(rdb, RESENAS_COLLECTION, id));
    showAdminToast(`Reseña de ${nombre} eliminada.`, 'success');
  } catch (error) {
    const message = formatError(error, 'No se pudo eliminar la resena.');
    realtimeState.resenasAdmin.error = message;
    realtimeState.resenasPublic.error = message;
    renderAdminResenas();
    renderResenasPublicGrid();
    showAdminToast(message, 'error');
  }
};

window.enviarResena = async function (e) {
  e.preventDefault();

  const nombre = document.getElementById('res-nombre')?.value.trim();
  const estrellas = Number(document.getElementById('res-estrellas')?.value) || 5;
  const servicio = document.getElementById('res-servicio')?.value.trim() || '';
  const comentario = document.getElementById('res-comentario')?.value.trim();

  if (!nombre || !comentario) {
    showAdminToast('Nombre y comentario son obligatorios.', 'error');
    return;
  }

  const btn = document.getElementById('btn-resena');
  const restoreButton = setBusyButton(btn, 'Enviando...');

  try {
    const { db: rdb, fb } = await realFB();
    await fb.addDoc(fb.collection(rdb, RESENAS_COLLECTION), {
      nombre,
      estrellas,
      servicio,
      comentario,
      aprobada: false,
      creado: fb.serverTimestamp(),
      creadoMs: Date.now(),
    });

    realtimeState.resenasAdmin.error = null;
    document.getElementById('resena-form')?.reset();
    const ok = document.getElementById('resena-ok');
    if (ok) {
      ok.style.display = 'block';
      setTimeout(() => {
        ok.style.display = 'none';
      }, 5000);
    }
    showAdminToast('Reseña enviada. Quedó pendiente de aprobación.', 'success');
  } catch (error) {
    const message = formatError(error, 'No se pudo enviar la resena.');
    realtimeState.resenasPublic.error = message;
    renderResenasPublicGrid();
    showAdminToast(message, 'error');
  } finally {
    restoreButton();
  }
};
