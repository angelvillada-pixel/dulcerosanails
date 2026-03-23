const API = 'https://dulce-rosa-api.onrender.com';
const API_TIMEOUT_MS = 10000;
const RENDER_RETRY_ATTEMPTS = 3;
const RENDER_RETRY_DELAY_MS = 5000;
const RENDER_WAKE_TTL_MS = 10 * 60 * 1000;
const DIRECT_FIRESTORE_ROOTS = new Set(['config', 'galeria']);

let renderWakePromise = null;
let renderLastReadyAt = 0;
let realFirebasePromise = null;

export function serverTimestamp() {
  return new Date().toISOString();
}

export function arrayUnion(...items) {
  return { _t: 'union', items };
}

export function arrayRemove(...items) {
  return { _t: 'remove', items };
}

export const db = { _ref: 'db' };

export function collection(_db, path) {
  return { _ref: 'col', path };
}

export function doc(_db, ...parts) {
  if (_db?._ref === 'col') return { _ref: 'doc', path: `${_db.path}/${parts[0]}` };
  return { _ref: 'doc', path: parts.join('/') };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rootOf(ref) {
  return ref.path.split('/')[0];
}

function shouldUseDirectFirestore(ref) {
  return DIRECT_FIRESTORE_ROOTS.has(rootOf(ref));
}

async function getRealFirebase() {
  if (realFirebasePromise) return realFirebasePromise;

  realFirebasePromise = new Promise((resolve, reject) => {
    if (window.__db && window.__fb) {
      resolve({ db: window.__db, fb: window.__fb });
      return;
    }

    const timeoutId = setTimeout(() => {
      realFirebasePromise = null;
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
        realFirebasePromise = null;
        reject(new Error('Firebase real reporto una inicializacion incompleta.'));
      },
      { once: true },
    );
  });

  return realFirebasePromise;
}

function toRealRef(ref, dbInstance, fb) {
  const parts = ref.path.split('/');
  if (ref._ref === 'doc') return fb.doc(dbInstance, ...parts);
  return fb.collection(dbInstance, ref.path);
}

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

function isRetriableRenderError(error) {
  const message = error?.message || '';
  return (
    message.includes('Render no respondio a tiempo') ||
    message.includes('No se pudo conectar con Render') ||
    /^HTTP 5\d\d/.test(message)
  );
}

async function rawRenderApi(method, url, body, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  try {
    const response = await fetch(`${API}${url}`, opts);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return response.json();
  } catch (error) {
    throw normalizeApiError(error);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function renderApiWithRetry(method, url, body, timeoutMs = API_TIMEOUT_MS) {
  let lastError = null;

  for (let attempt = 0; attempt < RENDER_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await rawRenderApi(method, url, body, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt === RENDER_RETRY_ATTEMPTS - 1 || !isRetriableRenderError(error)) break;
      await sleep(RENDER_RETRY_DELAY_MS);
    }
  }

  throw lastError || new Error('No se pudo conectar con Render.');
}

async function ensureRenderAwake() {
  if (Date.now() - renderLastReadyAt < RENDER_WAKE_TTL_MS) return;
  if (renderWakePromise) return renderWakePromise;

  renderWakePromise = renderApiWithRetry('GET', '/')
    .then(() => {
      renderLastReadyAt = Date.now();
    })
    .finally(() => {
      renderWakePromise = null;
    });

  return renderWakePromise;
}

async function renderApi(method, url, body, timeoutMs = API_TIMEOUT_MS) {
  if (url !== '/') await ensureRenderAwake();
  const data = await renderApiWithRetry(method, url, body, timeoutMs);
  renderLastReadyAt = Date.now();
  return data;
}

function emptyDocSnapshot(ref, data) {
  const isEmpty = !data || (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0);
  return { exists: () => !isEmpty, data: () => data, id: ref.path.split('/').pop() };
}

function renderDocsSnapshot(data) {
  const arr = Array.isArray(data) ? data : [];
  const docs = arr.map((item) => ({ id: item.id, exists: () => true, data: () => item }));
  return { docs, empty: docs.length === 0 };
}

async function renderGetDoc(ref) {
  const data = await renderApi('GET', `/${ref.path}`);
  return emptyDocSnapshot(ref, data);
}

async function renderSetDoc(ref, data) {
  const parts = ref.path.split('/');
  if (parts[0] === 'config') {
    await renderApi('POST', `/config/${parts[1]}`, data);
    return;
  }
  await renderApi('POST', `/${parts[0]}`, { ...data, id: parts[1] });
}

async function renderAddDoc(colRef, data) {
  const result = await renderApi('POST', `/${colRef.path}`, data);
  return { id: result.id };
}

async function renderGetDocs(colRef) {
  const data = await renderApi('GET', `/${colRef.path}`);
  return renderDocsSnapshot(data);
}

async function renderDeleteDoc(ref) {
  const parts = ref.path.split('/');
  await renderApi('DELETE', `/${parts[0]}/${parts[1]}`);
}

async function renderUpdateDoc(ref, data) {
  const parts = ref.path.split('/');
  for (const value of Object.values(data)) {
    if (value?._t === 'union' && parts[0] === 'slots') {
      for (const hour of value.items) await renderApi('POST', `/slots/${parts[1]}/book`, { hora: hour });
    } else if (value?._t === 'remove' && parts[0] === 'slots') {
      for (const hour of value.items) await renderApi('POST', `/slots/${parts[1]}/unbook`, { hora: hour });
    }
  }
}

async function tryDirectFirestore(ref, operation, fallback) {
  try {
    const { db: dbInstance, fb } = await getRealFirebase();
    return await operation(dbInstance, fb, toRealRef(ref, dbInstance, fb));
  } catch (error) {
    console.warn(`Firebase directo fallo para ${ref.path}. Se usa fallback.`, error);
    return fallback(error);
  }
}

export async function getDoc(ref) {
  if (!shouldUseDirectFirestore(ref)) return renderGetDoc(ref);

  return tryDirectFirestore(
    ref,
    async (_db, fb, realRef) => fb.getDoc(realRef),
    () => renderGetDoc(ref),
  );
}

export async function setDoc(ref, data) {
  if (!shouldUseDirectFirestore(ref)) return renderSetDoc(ref, data);

  return tryDirectFirestore(
    ref,
    async (_db, fb, realRef) => fb.setDoc(realRef, data),
    () => renderSetDoc(ref, data),
  );
}

export async function addDoc(colRef, data) {
  if (!shouldUseDirectFirestore(colRef)) return renderAddDoc(colRef, data);

  return tryDirectFirestore(
    colRef,
    async (_db, fb, realRef) => fb.addDoc(realRef, data),
    () => renderAddDoc(colRef, data),
  );
}

export async function getDocs(colRef) {
  if (!shouldUseDirectFirestore(colRef)) return renderGetDocs(colRef);

  return tryDirectFirestore(
    colRef,
    async (_db, fb, realRef) => fb.getDocs(realRef),
    () => renderGetDocs(colRef),
  );
}

export async function deleteDoc(ref) {
  if (!shouldUseDirectFirestore(ref)) return renderDeleteDoc(ref);

  return tryDirectFirestore(
    ref,
    async (_db, fb, realRef) => fb.deleteDoc(realRef),
    () => renderDeleteDoc(ref),
  );
}

export async function updateDoc(ref, data) {
  if (!shouldUseDirectFirestore(ref)) return renderUpdateDoc(ref, data);

  return tryDirectFirestore(
    ref,
    async (_db, fb, realRef) => fb.updateDoc(realRef, data),
    () => renderUpdateDoc(ref, data),
  );
}

function startRenderPolling(ref, callback, onError = () => {}) {
  let last = null;
  let lastError = null;

  async function poll() {
    try {
      if (ref._ref === 'doc') {
        const snap = await renderGetDoc(ref);
        const sig = JSON.stringify(snap.data());
        if (sig === last) return;
        last = sig;
        lastError = null;
        callback(snap);
      } else {
        const snap = await renderGetDocs(ref);
        const sig = JSON.stringify(snap.docs.map((docItem) => docItem.data()));
        if (sig === last) return;
        last = sig;
        lastError = null;
        callback(snap);
      }
    } catch (error) {
      const message = error?.message || String(error);
      if (message === lastError) return;
      lastError = message;
      onError(error);
    }
  }

  poll();
  const intervalId = setInterval(poll, 4000);
  return () => clearInterval(intervalId);
}

export function onSnapshot(ref, callback, onError = () => {}) {
  if (!shouldUseDirectFirestore(ref)) return startRenderPolling(ref, callback, onError);

  let unsubDirect = null;
  let unsubFallback = null;
  let active = true;

  (async () => {
    try {
      const { db: dbInstance, fb } = await getRealFirebase();
      if (!active) return;
      const realRef = toRealRef(ref, dbInstance, fb);
      unsubDirect = fb.onSnapshot(
        realRef,
        callback,
        (error) => {
          console.warn(`Firebase directo escuchando ${ref.path} fallo. Se usa fallback.`, error);
          onError(error);
          if (unsubDirect) {
            unsubDirect();
            unsubDirect = null;
          }
          if (!unsubFallback && active) unsubFallback = startRenderPolling(ref, callback, onError);
        },
      );
    } catch (error) {
      console.warn(`Firebase directo no disponible para ${ref.path}. Se usa fallback.`, error);
      onError(error);
      if (!unsubFallback && active) unsubFallback = startRenderPolling(ref, callback, onError);
    }
  })();

  return () => {
    active = false;
    if (unsubDirect) unsubDirect();
    if (unsubFallback) unsubFallback();
  };
}
