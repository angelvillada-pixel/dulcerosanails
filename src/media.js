const API = 'https://dulce-rosa-api.onrender.com';

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
  const token = await getAdminToken();
  const form = new FormData();
  form.append('file', file);
  form.append('folder', normalizeFolder(folder));
  if (filename) form.append('filename', filename);

  const response = await fetch(`${API}/media/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  return parseApiResponse(response);
}

export async function deleteAdminMedia(mediaOrKey) {
  const key = typeof mediaOrKey === 'string' ? mediaOrKey : mediaKey(mediaOrKey);
  const url = typeof mediaOrKey === 'object' && mediaOrKey ? mediaUrl(mediaOrKey) : '';
  if (!key && !url) return { ok: true };

  const token = await getAdminToken();
  const response = await fetch(`${API}/media`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(key ? { key } : { url }),
  });

  return parseApiResponse(response);
}
