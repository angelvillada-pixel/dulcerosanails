const API = 'https://dulce-rosa-api.onrender.com';
const HEALTH_TIMEOUT_MS = 8000;
const UPLOAD_TIMEOUT_MS = 20000;
const UPLOAD_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCurrentAdminUser() {
  const auth = window.__ensureAuth ? window.__ensureAuth() : window.__auth;
  return window.__adminUser || auth?.currentUser || null;
}

async function getAdminToken() {
  const user = getCurrentAdminUser();
  if (!user || typeof user.getIdToken !== 'function') {
    throw new Error('Debes iniciar sesion como admin para subir imagenes.');
  }
  return user.getIdToken();
}

function normalizeFolder(folder = 'general') {
  const value = String(folder || 'general').trim().toLowerCase();
  if (['logos', 'servicios', 'galeria', 'general'].includes(value)) return value;
  return 'general';
}

async function parseApiResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = UPLOAD_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Render no respondio a tiempo durante la subida.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function shouldRetryUpload(error) {
  const message = String(error?.message || '');
  return (
    message.includes('Render no respondio a tiempo') ||
    message.includes('Failed to fetch') ||
    message.includes('No se pudo conectar') ||
    /^HTTP 5\d\d/.test(message) ||
    /^HTTP 429/.test(message)
  );
}

async function getAdminTokenWithRefresh(forceRefresh = false) {
  const user = getCurrentAdminUser();
  if (!user || typeof user.getIdToken !== 'function') {
    throw new Error('Debes iniciar sesion como admin para subir imagenes.');
  }
  return user.getIdToken(forceRefresh);
}

export async function ensureRemoteStorageReady() {
  const response = await fetchWithTimeout(
    `${API}/health`,
    {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    },
    HEALTH_TIMEOUT_MS,
  );
  const payload = await parseApiResponse(response);
  const storage = payload?.storage || null;

  if (!storage) {
    throw new Error('Render no reporto el estado del storage.');
  }

  if (storage.provider !== 'r2' || storage.ready !== true) {
    throw new Error('El storage remoto no esta listo en Render.');
  }

  return storage;
}

export function mediaUrl(media) {
  if (!media) return '';
  if (typeof media === 'string') return media;
  if (typeof media?.url === 'string') return media.url;
  return '';
}

export function mediaKey(media) {
  if (!media || typeof media === 'string') return '';
  return String(media.key || '');
}

export function mediaBlur(media) {
  if (!media || typeof media === 'string') return '';
  return String(media.blurDataURL || '');
}

export async function uploadAdminMedia(file, { folder = 'general', filename = '' } = {}) {
  const form = new FormData();
  form.append('file', file);
  form.append('folder', normalizeFolder(folder));
  if (filename) form.append('filename', filename);
  await ensureRemoteStorageReady();

  let lastError = null;

  for (let attempt = 0; attempt < UPLOAD_RETRIES; attempt += 1) {
    try {
      const token = await getAdminTokenWithRefresh(attempt > 0);
      const response = await fetchWithTimeout(`${API}/media/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      });

      return await parseApiResponse(response);
    } catch (error) {
      lastError = error;
      if (attempt === UPLOAD_RETRIES - 1 || !shouldRetryUpload(error)) break;
      await sleep(1200 * (attempt + 1));
    }
  }

  throw lastError || new Error('No se pudo subir la imagen al storage remoto.');
}

export async function deleteAdminMedia(mediaOrKey) {
  const key = typeof mediaOrKey === 'string' ? mediaOrKey : mediaKey(mediaOrKey);
  const url = typeof mediaOrKey === 'object' && mediaOrKey ? mediaUrl(mediaOrKey) : '';
  if (!key && !url) return { ok: true };

  const token = await getAdminTokenWithRefresh();
  const response = await fetchWithTimeout(`${API}/media`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(key ? { key } : { url }),
  });

  return parseApiResponse(response);
}
