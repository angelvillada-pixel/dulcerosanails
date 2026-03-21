// ══════════════════════════════════════════
//  API CLIENT → Render backend
// ══════════════════════════════════════════
const API = 'https://dulce-rosa-api.onrender.com';

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

async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${API}${url}`, opts);
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${r.status}`);
  }
  return r.json();
}

export async function getDoc(ref) {
  try {
    const data = await api('GET', `/${ref.path}`);
    const isEmpty = !data || Object.keys(data).length === 0;
    return { exists: () => !isEmpty, data: () => data, id: ref.path.split('/').pop() };
  } catch {
    return { exists: () => false, data: () => null, id: ref.path.split('/').pop() };
  }
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

export function onSnapshot(ref, callback) {
  let last = null;
  async function poll() {
    try {
      if (ref._ref === 'doc') {
        const snap = await getDoc(ref);
        const sig = JSON.stringify(snap.data());
        if (sig === last) return;
        last = sig; callback(snap);
      } else {
        const snap = await getDocs(ref);
        const sig = JSON.stringify(snap.docs.map(d => d.data()));
        if (sig === last) return;
        last = sig; callback(snap);
      }
    } catch (e) { console.warn('poll:', e?.message); }
  }
  poll();
  const id = setInterval(poll, 4000);
  return () => clearInterval(id);
}
