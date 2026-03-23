// ══════════════════════════════════════════
//  API CLIENT → Render backend
// ══════════════════════════════════════════
const API = 'https://dulce-rosa-api.onrender.com';
const API_TIMEOUT_MS = 20000;
const RENDER_WAKE_TIMEOUT_MS = 45000;
const RENDER_WAKE_TTL_MS = 10 * 60 * 1000;
let renderWakePromise = null;
let renderLastReadyAt = 0;

export function serverTimestamp() { return new Date().toISOString(); }
export function arrayUnion(...items) { return { _t: 'union', items }; }
export function arrayRemove(...items) { return { _t: 'remove', items }; }

export const db = { _ref: 'db' };
export function collection(_db, path) { return { _ref: 'col', path }; }
export function doc(_db, ...parts) {
  if (_db?._ref === 'col') return { _ref: 'doc', path: `${_db.path}/${parts[0]}` };
  return { _ref: 'doc', path: parts.join('/') };
}

// Ping cada 14 min para que Render no duerma
setInterval(() => fetch(`${API}/`).catch(() => {}), 14 * 60 * 1000);

function normalizeApiError(error) {
  if (error?.name === 'AbortError') {
    return new Error('Render no respondio a tiempo. Puede estar dormido por cold start.');
  }

  if (error instanceof Error && error.name === 'TypeError') {
    return new Error(`No se pudo conectar con Render. ${error.message}`);
  }

  if (error instanceof Error) return error;

  return new Error('No se pudo conectar con Render.');
}

async function api(method, url, body, timeoutMs = API_TIMEOUT_MS) {
  if (url !== '/') await ensureRenderAwake();

  const data = await rawApi(method, url, body, timeoutMs);
  renderLastReadyAt = Date.now();
  return data;
}

async function rawApi(method, url, body, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const opts = { method, headers: { 'Content-Type': 'application/json' }, signal: controller.signal };
  if (body !== undefined) opts.body = JSON.stringify(body);

  try {
    const r = await fetch(`${API}${url}`, opts);
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${r.status}`);
    }
    return r.json();
  } catch (error) {
    throw normalizeApiError(error);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function ensureRenderAwake() {
  if (Date.now() - renderLastReadyAt < RENDER_WAKE_TTL_MS) return;
  if (renderWakePromise) return renderWakePromise;

  renderWakePromise = rawApi('GET', '/', undefined, RENDER_WAKE_TIMEOUT_MS)
    .then(() => {
      renderLastReadyAt = Date.now();
    })
    .finally(() => {
      renderWakePromise = null;
    });

  return renderWakePromise;
}

export async function getDoc(ref) {
  const data = await api('GET', `/${ref.path}`);
  const isEmpty = !data || (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0);
  return { exists: () => !isEmpty, data: () => data, id: ref.path.split('/').pop() };
}

export async function setDoc(ref, data) {
  const parts = ref.path.split('/');
  if (parts[0] === 'config') {
    await api('POST', `/config/${parts[1]}`, data);
  } else {
    await api('POST', `/${parts[0]}`, { ...data, id: parts[1] });
  }
}

export async function addDoc(colRef, data) {
  const result = await api('POST', `/${colRef.path}`, data);
  return { id: result.id };
}

export async function getDocs(colRef) {
  const data = await api('GET', `/${colRef.path}`);
  const arr = Array.isArray(data) ? data : [];
  const docs = arr.map(d => ({ id: d.id, exists: () => true, data: () => d }));
  return { docs, empty: docs.length === 0 };
}

export async function deleteDoc(ref) {
  const parts = ref.path.split('/');
  await api('DELETE', `/${parts[0]}/${parts[1]}`);
}

export async function updateDoc(ref, data) {
  const parts = ref.path.split('/');
  for (const [k, v] of Object.entries(data)) {
    if (v?._t === 'union' && parts[0] === 'slots') {
      for (const hora of v.items) await api('POST', `/slots/${parts[1]}/book`, { hora });
    } else if (v?._t === 'remove' && parts[0] === 'slots') {
      for (const hora of v.items) await api('POST', `/slots/${parts[1]}/unbook`, { hora });
    }
  }
}

export function onSnapshot(ref, callback, onError = () => {}) {
  let last = null;
  let lastError = null;

  async function poll() {
    try {
      if (ref._ref === 'doc') {
        const snap = await getDoc(ref);
        const sig = JSON.stringify(snap.data());
        if (sig === last) return;
        last = sig;
        lastError = null;
        callback(snap);
      } else {
        const snap = await getDocs(ref);
        const sig = JSON.stringify(snap.docs.map(d => d.data()));
        if (sig === last) return;
        last = sig;
        lastError = null;
        callback(snap);
      }
    } catch (e) {
      const message = e?.message || String(e);
      if (message === lastError) return;
      lastError = message;
      onError(e);
    }
  }

  poll();
  const id = setInterval(poll, 4000);
  return () => clearInterval(id);
}
