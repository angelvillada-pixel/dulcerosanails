import { LOGO } from './assets/logo.js';
import { db, collection, doc, getDoc, setDoc, addDoc, deleteDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, serverTimestamp } from './firebase.js';
import { HORAS_DEFAULT, PRECIOS_DEFAULT, SERVICIO_KEYS, CATEGORIAS, fechaHoyColombia, formatCOP, comprimirImagen, to12h } from './data.js';
import { renderGaleriaPublica, renderGaleriaSkeleton } from './galeria.js';
import { renderGaleriaAdmin, cargarPromosPublicas, cargarResenasPublicas } from './admin.js';
import { mediaUrl } from './media.js';

// ── GLOBAL FUNCTIONS — defined immediately so HTML onclicks work ──
function syncBodyOverflowFromOverlays() {
  document.body.style.overflow = document.querySelector('.overlay.show') ? 'hidden' : '';
}

window.abrirOverlay = function(id) {
  const el = document.getElementById(id);
  if (id === 'overlay-cita') normalizeCitaOverlayUi();
  if (el) { el.classList.add('show'); syncBodyOverflowFromOverlays(); }
};
window.cerrarOverlay = function(id) {
  const el = document.getElementById(id);
  if (id === 'overlay-confirm' && typeof window.resolverConfirmacion === 'function') {
    window.resolverConfirmacion(false);
    return;
  }
  if (id === 'overlay-cita') normalizeCitaOverlayUi();
  if (el) { el.classList.remove('show'); syncBodyOverflowFromOverlays(); }
};
window.abrirLogin = async function() {
  try {
    await initAdminAuthWatcher();
    const { auth } = await realAdminAuth();
    if (auth.currentUser) {
      openAdminPanel();
      return;
    }
  } catch (error) {
    console.error('Firebase Auth no disponible:', error);
    setAuthError('No se pudo inicializar Firebase Auth.');
  }

  document.getElementById('auth-user').value = '';
  document.getElementById('auth-pass').value = '';
  if (!document.getElementById('auth-error')?.classList.contains('show')) setAuthError('');
  window.abrirOverlay('overlay-login');
};

window._horasDisponibles = [...HORAS_DEFAULT];
let horaSeleccionada = null;
let unsubSlots = null;
let unsubTodayAvailability = null;
let citaSubmitInFlight = false;
let adminAuthWatcherSet = false;
let adminSessionUser = null;
let confirmResolver = null;

function resolveImageSource(value, fallback = '') {
  return mediaUrl(value) || fallback;
}

document.querySelectorAll('.site-logo').forEach(el => el.src = resolveImageSource(LOGO, LOGO));
setTimeout(() => { const p=document.getElementById('preview-logo-admin'); if(p) p.src=resolveImageSource(LOGO, LOGO); },200);

const runtimeIssues = new Map();
const MARKETING_DEFAULTS = Object.freeze({
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
const MONITOR_STORAGE_KEY = 'dulce-rosa:monitor-log';
const MONITOR_MAX_ENTRIES = 50;
const MONITOR_DEDUPE_MS = 60000;
const RENDER_HEALTH_URL = 'https://dulce-rosa-api.onrender.com/health';

let marketingConfig = { ...MARKETING_DEFAULTS };
window.__marketingState = marketingConfig;
window.__trustStats = {
  reviewCount: 200,
  reviewRating: 4.9,
  galleryCount: 0,
};

const seoState = {
  logo: LOGO,
  phone: '3245683032',
};

function renderTrustCounters() {
  const counters = document.querySelectorAll('#testimonios div[style*="font-family"]');
  const trust = window.__trustStats || {};
  const reviewCountNode = document.getElementById('trust-counter-clientas') || counters[0];
  const ratingNode = document.getElementById('trust-counter-rating') || counters[1];
  const galleryNode = document.getElementById('trust-counter-fotos') || counters[2];

  if (reviewCountNode) reviewCountNode.textContent = `${Math.max(200, Number(trust.reviewCount || 0))}+`;
  if (ratingNode) ratingNode.textContent = `${Number(trust.reviewRating || 4.9).toFixed(1)}★`;
  if (galleryNode) galleryNode.textContent = `${Number(trust.galleryCount || 0)}`;
}

window.renderTrustCounters = renderTrustCounters;
window.renderGaleriaPublica = renderGaleriaPublica;

const monitorState = {
  logs: [],
  health: {
    status: 'idle',
    latencyMs: null,
    checkedAt: null,
    message: 'Sin comprobar',
    storage: null,
  },
};
const monitorDedupe = new Map();

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
  recordMonitorEvent('runtime', message, { source: key }, 'error');
  renderRuntimeIssues();
}

function clearRuntimeIssue(key) {
  if (runtimeIssues.delete(key)) renderRuntimeIssues();
}

function formatRenderIssue(scope, error) {
  const detail = error?.message || String(error || 'Error desconocido.');
  return `${scope}: ${detail}`;
}

function readLocalJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function formatMonitorTime(value) {
  if (!value) return 'Sin fecha';
  try {
    return new Date(value).toLocaleString('es-CO', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Bogota',
    });
  } catch {
    return String(value);
  }
}

function publishMonitorUpdate() {
  window.dispatchEvent(new CustomEvent('dr-monitor-update', { detail: { logs: [...monitorState.logs] } }));
}

function publishMonitorHealth() {
  window.dispatchEvent(new CustomEvent('dr-monitor-health', { detail: { ...monitorState.health } }));
}

function trimMonitorLogs(logs) {
  return [...logs]
    .filter((item) => item && item.message)
    .slice(0, MONITOR_MAX_ENTRIES);
}

function setMonitorLogs(logs) {
  monitorState.logs = trimMonitorLogs(logs);
  writeLocalJson(MONITOR_STORAGE_KEY, monitorState.logs);
  publishMonitorUpdate();
}

function initMonitorLogs() {
  monitorState.logs = trimMonitorLogs(readLocalJson(MONITOR_STORAGE_KEY, []));
}

function recordMonitorEvent(type, message, meta = {}, level = 'error') {
  const normalizedMessage = String(message || 'Sin detalle').trim();
  if (!normalizedMessage) return;

  const key = `${type}:${meta.source || 'general'}:${normalizedMessage}`;
  const now = Date.now();
  const last = monitorDedupe.get(key) || 0;
  if (now - last < MONITOR_DEDUPE_MS) return;
  monitorDedupe.set(key, now);

  const nextEntry = {
    id: `log_${now}`,
    type,
    level,
    message: normalizedMessage,
    meta,
    createdAt: new Date(now).toISOString(),
  };

  setMonitorLogs([nextEntry, ...monitorState.logs]);

  if (
    level === 'error' &&
    document.getElementById('overlay-admin')?.classList.contains('show') &&
    document.getElementById('tab-monitor')?.classList.contains('active')
  ) {
    window.showAppToast?.(`Nuevo error detectado: ${normalizedMessage}`, 'error');
  }
}

async function probeRenderHealth({ silent = false } = {}) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  monitorState.health = {
    status: 'checking',
    latencyMs: null,
    checkedAt: new Date().toISOString(),
    message: 'Comprobando Render...',
  };
  publishMonitorHealth();

  try {
    let response = await fetch(RENDER_HEALTH_URL, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (response.status === 404) {
      response = await fetch('https://dulce-rosa-api.onrender.com/', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json().catch(() => ({}));
    const latencyMs = Math.round(performance.now() - startedAt);
    const status = latencyMs > 3000 ? 'warn' : 'ok';
    const message = payload?.message || (status === 'warn' ? 'Render respondio lento.' : 'Render disponible.');

    monitorState.health = {
      status,
      latencyMs,
      checkedAt: new Date().toISOString(),
      message,
      storage: payload?.storage || null,
    };
    publishMonitorHealth();
    return monitorState.health;
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'Render no respondio a tiempo.'
      : error?.message || 'No se pudo consultar Render.';

    monitorState.health = {
      status: 'error',
      latencyMs: null,
      checkedAt: new Date().toISOString(),
      message,
      storage: null,
    };
    publishMonitorHealth();
    if (!silent) recordMonitorEvent('backend', message, { source: 'render-health' }, 'error');
    return monitorState.health;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeMarketingConfig(data = {}) {
  const incomingFaq = Array.isArray(data.faqItems) ? data.faqItems : [];
  const faqItems = [...MARKETING_DEFAULTS.faqItems].map((item, index) => {
    const incoming = incomingFaq[index] || {};
    return {
      question: incoming.question || item.question,
      answer: incoming.answer || item.answer,
    };
  });

  return {
    ...MARKETING_DEFAULTS,
    ...data,
    urgencyEnabled: data.urgencyEnabled !== false,
    faqEnabled: data.faqEnabled !== false,
    faqItems,
  };
}

function setJsonLd(id, payload) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = JSON.stringify(payload).replace(/</g, '\\u003c');
}

function updateStructuredData() {
  setJsonLd('jsonld-localbusiness', {
    '@context': 'https://schema.org',
    '@type': 'NailSalon',
    name: 'Dulce Rosa Nails Spa',
    url: 'https://dulcerosanails.pages.dev/',
    image: seoState.logo,
    telephone: `+57${String(seoState.phone || '3245683032').replace(/\D+/g, '')}`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Cr 72A #98-77',
      addressLocality: 'Medellin',
      addressRegion: 'Antioquia',
      addressCountry: 'CO',
    },
    areaServed: 'Castilla, Medellin',
    openingHoursSpecification: [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        opens: '08:00',
        closes: '19:00',
      },
    ],
  });

  const faqItems = (marketingConfig.faqItems || []).filter((item) => item.question && item.answer);
  setJsonLd(
    'jsonld-faq',
    faqItems.length && marketingConfig.faqEnabled
      ? {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faqItems.map((item) => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: {
              '@type': 'Answer',
              text: item.answer,
            },
          })),
        }
      : {},
  );
}

function renderUrgencyStrip() {
  const strip = document.getElementById('urgency-strip');
  if (!strip) return;

  if (!marketingConfig.urgencyEnabled || !marketingConfig.urgencyText?.trim()) {
    strip.style.display = 'none';
    return;
  }

  strip.style.display = 'block';
  strip.textContent = marketingConfig.urgencyText.trim();
}

function renderFaqSection() {
  const section = document.getElementById('faq');
  const title = document.getElementById('faq-title');
  const subtitle = document.getElementById('faq-subtitle');
  const grid = document.getElementById('faq-grid');
  if (!section || !title || !subtitle || !grid) return;

  const items = (marketingConfig.faqItems || []).filter((item) => item.question && item.answer);
  if (!marketingConfig.faqEnabled || !items.length) {
    section.hidden = true;
    grid.innerHTML = '';
    return;
  }

  section.hidden = false;
  title.textContent = marketingConfig.faqTitle || 'Preguntas frecuentes';
  subtitle.textContent = marketingConfig.faqSubtitle || MARKETING_DEFAULTS.faqSubtitle;
  grid.innerHTML = items
    .map(
      (item) => `
        <article class="faq-card reveal">
          <h3 class="faq-question">${item.question}</h3>
          <p class="faq-answer">${item.answer}</p>
        </article>
      `,
    )
    .join('');
  initReveal();
}

function applyMarketingConfig(data = {}) {
  marketingConfig = normalizeMarketingConfig(data);
  window.__marketingState = marketingConfig;
  renderUrgencyStrip();
  renderFaqSection();
  updateStructuredData();
}

function fieldErrorId(input) {
  return `${input.id}-error`;
}

function setFieldError(input, message = '') {
  if (!input?.id) return;
  let errorNode = document.getElementById(fieldErrorId(input));

  if (!message) {
    input.classList.remove('is-invalid');
    if (errorNode) errorNode.remove();
    return;
  }

  input.classList.add('is-invalid');
  if (!errorNode) {
    errorNode = document.createElement('span');
    errorNode.id = fieldErrorId(input);
    errorNode.className = 'field-error';
    input.insertAdjacentElement('afterend', errorNode);
  }
  errorNode.textContent = message;
}

function clearFieldError(input) {
  setFieldError(input, '');
}

function validateBookingForm() {
  const nombre = document.getElementById('inp-nombre');
  const tel = document.getElementById('inp-tel');
  const servicio = document.getElementById('inp-servicio');
  const fecha = document.getElementById('inp-fecha');
  const hora = document.getElementById('inp-hora');
  const telDigits = (tel?.value || '').replace(/\D+/g, '');
  let valid = true;

  if (!nombre?.value.trim() || nombre.value.trim().length < 2) {
    setFieldError(nombre, 'Escribe tu nombre para confirmar la reserva.');
    valid = false;
  } else clearFieldError(nombre);

  if (telDigits.length < 10) {
    setFieldError(tel, 'Escribe un WhatsApp valido de 10 digitos.');
    valid = false;
  } else clearFieldError(tel);

  if (!servicio?.value) {
    setFieldError(servicio, 'Selecciona el servicio que deseas agendar.');
    valid = false;
  } else clearFieldError(servicio);

  if (!fecha?.value) {
    setFieldError(fecha, 'Selecciona una fecha para ver los horarios.');
    valid = false;
  } else if (!hora?.value) {
    setFieldError(fecha, 'Selecciona una fecha y luego un horario disponible.');
    valid = false;
  } else {
    clearFieldError(fecha);
  }

  return valid;
}

window.validateReviewFormInputs = function() {
  const nombre = document.getElementById('res-nombre');
  const comentario = document.getElementById('res-comentario');
  const servicio = document.getElementById('res-servicio');
  let valid = true;

  if (!nombre?.value.trim() || nombre.value.trim().length < 2) {
    setFieldError(nombre, 'Escribe tu nombre para publicar la resena.');
    valid = false;
  } else clearFieldError(nombre);

  if (!comentario?.value.trim() || comentario.value.trim().length < 12) {
    setFieldError(comentario, 'Cuéntanos un poco mas de tu experiencia.');
    valid = false;
  } else clearFieldError(comentario);

  if (servicio && servicio.value.trim().length > 80) {
    setFieldError(servicio, 'El nombre del servicio es demasiado largo.');
    valid = false;
  } else if (servicio) {
    clearFieldError(servicio);
  }

  return valid;
};

function readSessionCache(key, fallback) {
  try {
    const raw = sessionStorage.getItem(`dulce-rosa:${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeSessionCache(key, value) {
  try {
    sessionStorage.setItem(`dulce-rosa:${key}`, JSON.stringify(value));
  } catch {}
}

window.writeSessionCache = writeSessionCache;

function ensureAppToastRoot() {
  let root = document.getElementById('app-toast-stack');
  if (root) return root;

  root = document.createElement('div');
  root.id = 'app-toast-stack';
  root.className = 'app-toast-stack';
  document.body.appendChild(root);
  return root;
}

window.showAppToast = function(message, type = 'info') {
  if (!message) return;

  const root = ensureAppToastRoot();
  const toast = document.createElement('div');
  toast.className = `app-toast${type === 'error' ? ' error' : ''}`;
  toast.textContent = message;
  root.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 220);
  }, 4200);
};

window.confirmAction = function(message, confirmLabel = 'Confirmar') {
  const overlay = document.getElementById('overlay-confirm');
  const messageEl = document.getElementById('confirm-message');
  const acceptBtn = document.getElementById('confirm-accept-btn');

  if (!overlay || !messageEl || !acceptBtn) {
    return Promise.resolve(window.confirm(message));
  }

  messageEl.textContent = message;
  acceptBtn.textContent = confirmLabel;
  overlay.classList.add('show');
  syncBodyOverflowFromOverlays();

  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
};

window.resolverConfirmacion = function(accepted) {
  const overlay = document.getElementById('overlay-confirm');
  if (overlay) overlay.classList.remove('show');
  syncBodyOverflowFromOverlays();

  if (confirmResolver) {
    const resolve = confirmResolver;
    confirmResolver = null;
    resolve(Boolean(accepted));
  }
};

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

function updateTodayAvailabilityChip(booked = []) {
  const chip = document.getElementById('hero-turnos-chip');
  if (!chip) return;

  const total = (window._horasDisponibles || HORAS_DEFAULT).length;
  const disponibles = Math.max(total - booked.length, 0);
  const busy = disponibles <= 0;
  chip.dataset.state = busy ? 'busy' : 'open';
  chip.innerHTML = `<span class="chip-dot" style="background:${busy ? '#ff8a65' : '#4CAF50'}"></span>${busy ? 'Agenda para otro dia' : `${disponibles} turnos hoy`}`;
}

function watchTodayAvailability() {
  if (unsubTodayAvailability) unsubTodayAvailability();

  unsubTodayAvailability = onSnapshot(
    doc(db, 'slots', fechaHoyColombia()),
    (snap) => {
      const booked = snap.exists() ? (snap.data().booked || []) : [];
      updateTodayAvailabilityChip(booked);
    },
    () => {
      updateTodayAvailabilityChip([]);
    },
  );
}

async function realAdminAuth() {
  if (window.__ensureAuth && window.__authApi) {
    const auth = window.__ensureAuth();
    await (window.__authReadyPromise || Promise.resolve());
    return { auth, authApi: window.__authApi };
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error('Firebase Auth no esta disponible.')), 7000);

    window.addEventListener(
      'fb-ready',
      async () => {
        clearTimeout(timeoutId);
        try {
          const auth = window.__ensureAuth ? window.__ensureAuth() : window.__auth;
          await (window.__authReadyPromise || Promise.resolve());
          if (auth && window.__authApi) {
            resolve({ auth, authApi: window.__authApi });
            return;
          }
          reject(new Error('Firebase Auth no se inicializo correctamente.'));
        } catch (error) {
          reject(error);
        }
      },
      { once: true },
    );
  });
}

function setAuthError(message = '') {
  const errorBox = document.getElementById('auth-error');
  if (!errorBox) return;

  if (!message) {
    errorBox.textContent = '';
    errorBox.classList.remove('show');
    return;
  }

  errorBox.textContent = message;
  errorBox.classList.add('show');
}

function mapAuthError(error) {
  const code = error?.code || '';

  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Correo o contrasena incorrectos.';
  }

  if (code === 'auth/invalid-email') {
    return 'Escribe un correo valido.';
  }

  if (code === 'auth/too-many-requests') {
    return 'Demasiados intentos fallidos. Espera unos minutos e intentalo de nuevo.';
  }

  if (code === 'auth/network-request-failed') {
    return 'No se pudo conectar con Firebase Auth. Revisa tu conexion.';
  }

  if (code === 'auth/unauthorized-domain') {
    return 'Este dominio no esta autorizado en Firebase Auth. Agrega dulcerosanails.pages.dev en Authorized domains.';
  }

  if (code === 'auth/configuration-not-found' || code === 'auth/operation-not-allowed') {
    return 'Email/Password no esta activado en Firebase Authentication.';
  }

  return error?.message || 'No se pudo iniciar sesion.';
}

function updateAdminSessionUi(user) {
  const toggle = document.getElementById('admin-toggle');
  if (toggle) toggle.textContent = user ? '🔓 Admin' : '🔐 Admin';

  const status = document.getElementById('admin-session-status');
  if (status) status.textContent = user ? `Sesion activa: ${user.email || 'Admin autenticado'}` : 'Inicia sesion con tu cuenta admin de Firebase.';

  const logoutBtn = document.getElementById('btn-admin-logout');
  if (logoutBtn) logoutBtn.style.display = user ? 'inline-flex' : 'none';

  const hint = document.getElementById('auth-hint');
  if (hint) hint.textContent = user ? `Sesion detectada: ${user.email || 'Admin autenticado'}` : 'Ingresa con el correo y la contrasena del admin creados en Firebase Auth.';
}

function openAdminPanel() {
  cerrarOverlay('overlay-login');
  adminSessionUser = adminSessionUser || window.__auth?.currentUser || null;
  abrirOverlay('overlay-admin');
  updateAdminSessionUi(adminSessionUser);
  window.ensureLegacyMirrorCurrentState?.({ silent: true }).catch(() => {});
  window.switchTab('citas');
  window.renderCitas().catch(console.error);
  window.cargarAdminConfig().catch(console.error);
  window.cargarAdminPrecios().catch(console.error);
}

async function initAdminAuthWatcher() {
  if (adminAuthWatcherSet) return;

  try {
    const { auth, authApi } = await realAdminAuth();
    adminAuthWatcherSet = true;
    authApi.onAuthStateChanged(auth, (user) => {
      adminSessionUser = user || null;
      window.__adminUser = adminSessionUser;
      updateAdminSessionUi(adminSessionUser);
      if (!adminSessionUser && document.getElementById('overlay-admin')?.classList.contains('show')) {
        cerrarOverlay('overlay-admin');
      }
    });
  } catch (error) {
    adminAuthWatcherSet = false;
    console.error('No se pudo inicializar Firebase Auth:', error);
    setAuthError('No se pudo inicializar el acceso admin. Revisa Firebase Auth.');
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
          const imagen  = resolveImageSource(info.imagen);
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
                ? `<img src="${imagen}" alt="${nombre}" loading="lazy" decoding="async"/>`
                : `<div class="service-card-emoji">${s.emoji||'💅'}</div>`}
            </div>
            <div class="service-card-body">
              <div class="service-card-name">${nombre}</div>
              <div class="service-card-desc">${desc}</div>
              <div class="service-card-price">${desde?'<span class="price-from">Desde </span>':''}${formatCOP(precio)}</div>
            </div>
            <div class="service-card-actions">
              <button class="svc-btn svc-btn-detalles" onclick="event.stopPropagation();abrirDetalles(this.closest('.service-card'))">Ver detalles</button>
              <button class="svc-btn svc-btn-share" onclick="event.stopPropagation();compartirServicio(decodeURIComponent(this.closest('.service-card').dataset.nombre), this.closest('.service-card').dataset.precio, decodeURIComponent(this.closest('.service-card').dataset.cat))">Compartir WhatsApp</button>
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
  const shareBtn = document.getElementById('det-share-btn');
  if (shareBtn) shareBtn.onclick = () => window.compartirServicio(nombre, precio, cat);

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

window.compartirServicio = function(nombre, precio, categoria) {
  const texto = encodeURIComponent(
    `Hola, mira este servicio de Dulce Rosa Nails Spa:\n\n${nombre}\nCategoria: ${categoria}\nPrecio: ${formatCOP(Number(precio || 0))}\n\nhttps://dulcerosanails.pages.dev/#servicios`,
  );
  window.open(`https://wa.me/?text=${texto}`, '_blank', 'noopener');
  window.showAppToast?.(`Enlace de ${nombre} listo para compartir.`, 'success');
};

// ── LISTENERS ──
let preciosActuales = {...PRECIOS_DEFAULT};
let serviciosActuales = {};

const cachedSiteConfig = readSessionCache('site', null);
const cachedPrecios = readSessionCache('precios', PRECIOS_DEFAULT);
const cachedServicios = readSessionCache('servicios', {});
const cachedGaleria = readSessionCache('galeria', []);
const cachedMarketing = readSessionCache('marketing', MARKETING_DEFAULTS);

initMonitorLogs();
window.__monitoring = {
  getLogs: () => [...monitorState.logs],
  clearLogs: () => setMonitorLogs([]),
  getHealth: () => ({ ...monitorState.health }),
  refreshHealth: (options) => probeRenderHealth(options),
  record: recordMonitorEvent,
  formatTime: formatMonitorTime,
};
window.__setFieldError = setFieldError;
window.__clearFieldError = clearFieldError;

if (cachedSiteConfig?.logo) document.querySelectorAll('.site-logo').forEach(el=>el.src=resolveImageSource(cachedSiteConfig.logo, LOGO));
if (cachedSiteConfig?.nequi) document.querySelectorAll('.nequi-num').forEach(el=>el.textContent=cachedSiteConfig.nequi);
if (Array.isArray(cachedSiteConfig?.horarios) && cachedSiteConfig.horarios.length) window._horasDisponibles = cachedSiteConfig.horarios;
if (cachedSiteConfig?.logo) seoState.logo = resolveImageSource(cachedSiteConfig.logo, LOGO);
if (cachedSiteConfig?.nequi) seoState.phone = cachedSiteConfig.nequi;

preciosActuales = {...PRECIOS_DEFAULT, ...(cachedPrecios || {})};
serviciosActuales = cachedServicios || {};
applyMarketingConfig(cachedMarketing);
window.__trustStats.galleryCount = Array.isArray(cachedGaleria) ? cachedGaleria.length : 0;
renderTrustCounters();

renderServicios(serviciosActuales, preciosActuales);
actualizarSelectServicios();
watchTodayAvailability();

if (Array.isArray(cachedGaleria) && cachedGaleria.length) {
  renderGaleriaPublica(cachedGaleria);
  renderGaleriaAdmin(cachedGaleria);
} else {
  renderGaleriaSkeleton();
}

onSnapshot(doc(db,'config','site'), snap => {
  if (!snap.exists()) return;
  const d = snap.data();
  writeSessionCache('site', d);
  if (d.logo) document.querySelectorAll('.site-logo').forEach(el=>el.src=resolveImageSource(d.logo, LOGO));
  if (d.nequi) document.querySelectorAll('.nequi-num').forEach(el=>el.textContent=d.nequi);
  if (d.logo) seoState.logo = resolveImageSource(d.logo, LOGO);
  if (d.nequi) seoState.phone = d.nequi;
  updateStructuredData();
  if (d.horarios) {
    window._horasDisponibles = d.horarios.length ? d.horarios : [...HORAS_DEFAULT];
    watchTodayAvailability();
    const fecha = document.getElementById('inp-fecha')?.value;
    if (fecha) window.cargarSlots();
  }
}, error => {
  recordMonitorEvent('frontend', formatRenderIssue('Configuracion', error), { source: 'config-site' }, 'warn');
  console.warn('Configuracion:', error);
});

onSnapshot(doc(db,'config','precios'), snap => {
  if (!snap.exists()) return;
  writeSessionCache('precios', snap.data());
  preciosActuales = {...PRECIOS_DEFAULT, ...snap.data()};
  renderServicios(serviciosActuales, preciosActuales);
  actualizarSelectServicios();
  updateTodayAvailabilityChip([]);
}, error => {
  recordMonitorEvent('frontend', formatRenderIssue('Precios', error), { source: 'config-precios' }, 'warn');
  console.warn('Precios:', error);
});

onSnapshot(doc(db,'config','servicios'), snap => {
  if (!snap.exists()) return;
  writeSessionCache('servicios', snap.data());
  serviciosActuales = snap.data();
  renderServicios(serviciosActuales, preciosActuales);
  actualizarSelectServicios();
}, error => {
  recordMonitorEvent('frontend', formatRenderIssue('Servicios', error), { source: 'config-servicios' }, 'warn');
  console.warn('Servicios:', error);
});

onSnapshot(collection(db,'galeria'), snap => {
  const fotos = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.orden||0)-(b.orden||0));
  writeSessionCache('galeria', fotos);
  window.__trustStats.galleryCount = fotos.length;
  renderTrustCounters();
  renderGaleriaPublica(fotos);
  renderGaleriaAdmin(fotos);
}, error => {
  recordMonitorEvent('frontend', formatRenderIssue('Galeria', error), { source: 'galeria' }, 'warn');
  console.warn('Galeria:', error);
});

onSnapshot(doc(db,'config','marketing'), snap => {
  const nextMarketing = snap.exists() ? snap.data() : MARKETING_DEFAULTS;
  writeSessionCache('marketing', nextMarketing);
  applyMarketingConfig(nextMarketing);
}, error => {
  recordMonitorEvent('frontend', formatRenderIssue('Marketing', error), { source: 'config-marketing' }, 'warn');
  console.warn('Marketing:', error);
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
  clearFieldError(document.getElementById('inp-fecha'));
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
  clearFieldError(document.getElementById('inp-fecha'));
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

  if (!validateBookingForm()) {
    return;
  }

  const hora = document.getElementById('inp-hora').value;
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
    ['inp-nombre', 'inp-tel', 'inp-servicio', 'inp-fecha'].forEach((id) => clearFieldError(document.getElementById(id)));
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
window.addEventListener('error', (event) => {
  if (String(event?.filename || '').startsWith('chrome-extension://')) return;
  if (!event?.message) return;
  recordMonitorEvent('frontend', event.message, {
    source: 'window-error',
    file: event.filename || '',
    line: event.lineno || '',
  }, 'error');
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  const message = reason?.message || String(reason || '');
  if (!message || message === '[object Object]') return;
  recordMonitorEvent('frontend', message, { source: 'unhandledrejection' }, 'error');
});

window.addEventListener('dr-reviews-stats', (event) => {
  const detail = event?.detail || {};
  window.__trustStats.reviewCount = Number(detail.count || window.__trustStats.reviewCount || 0);
  window.__trustStats.reviewRating = Number(detail.rating || window.__trustStats.reviewRating || 4.9);
  renderTrustCounters();
});

window.verificarCredenciales = async function() {
  const email = document.getElementById('auth-user').value.trim();
  const password = document.getElementById('auth-pass').value;
  const restoreButton = setBusyButton(document.getElementById('btn-auth-login'), 'Ingresando...');

  if (!email || !password) {
    setAuthError('Ingresa tu correo admin y la contrasena.');
    restoreButton();
    return;
  }

  try {
    const { auth, authApi } = await realAdminAuth();
    setAuthError('');
    await authApi.signInWithEmailAndPassword(auth, email, password);
    adminSessionUser = auth.currentUser || adminSessionUser;
    document.getElementById('auth-pass').value = '';
    openAdminPanel();
  } catch (error) {
    setAuthError(mapAuthError(error));
  } finally {
    restoreButton();
  }
};

window.cerrarSesionAdmin = async function() {
  try {
    const { auth, authApi } = await realAdminAuth();
    await authApi.signOut(auth);
    cerrarOverlay('overlay-admin');
    setAuthError('');
  } catch (error) {
    window.showAppToast?.(mapAuthError(error), 'error');
  }
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
  const scrollTopBtn = document.getElementById('scroll-top-btn');
  if(fi) fi.min=fechaHoyColombia();
  [['inp-nombre', 'input'], ['inp-tel', 'input'], ['inp-servicio', 'change'], ['inp-fecha', 'change'], ['res-nombre', 'input'], ['res-servicio', 'input'], ['res-comentario', 'input']].forEach(([id, eventName]) => {
    const field = document.getElementById(id);
    field?.addEventListener(eventName, () => clearFieldError(field));
  });
  window.addEventListener('scroll',()=>{
    document.getElementById('navbar').classList.toggle('scrolled',scrollY>40);
    if (scrollTopBtn) scrollTopBtn.classList.toggle('show', scrollY > 300);
  });
  document.getElementById('auth-user')?.addEventListener('keydown',e=>{if(e.key==='Enter')window.verificarCredenciales();});
  document.getElementById('auth-pass')?.addEventListener('keydown',e=>{if(e.key==='Enter')window.verificarCredenciales();});
  document.querySelectorAll('.overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)cerrarOverlay(o.id);}));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.overlay.show').forEach(o=>cerrarOverlay(o.id));});
  document.getElementById('lightbox')?.addEventListener('click',e=>{if(e.target!==document.getElementById('lb-img'))window.cerrarLightbox();});
  document.addEventListener('click',e=>{
    if(!e.target.closest('.service-card')) document.querySelectorAll('.service-card.tapped').forEach(c=>c.classList.remove('tapped'));
  });
  scrollTopBtn?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  initReveal();
  actualizarSelectServicios();
  updateTodayAvailabilityChip([]);
  updateStructuredData();
  setTimeout(() => {
    probeRenderHealth({ silent: true }).catch(() => {});
  }, 1400);
  // Cargar promos y reseñas desde Firebase (instantáneo, sin Render)
  cargarPromosPublicas();
  cargarResenasPublicas();
});
