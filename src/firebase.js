// ╔══════════════════════════════════════════════╗
// ║  FIRESTORE REST API — sin SDK, sin errores  ║
// ╚══════════════════════════════════════════════╝
const PROJECT = 'dulce-rosa';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// ── Sentinels ──
export function serverTimestamp() { return { _t: 'ts' }; }
export function arrayUnion(...items) { return { _t: 'union', items }; }
export function arrayRemove(...items) { return { _t: 'remove', items }; }

// ── Referencias ──
export const db = { _ref: 'db' };

export function collection(_db, path) {
  return { _ref: 'col', path };
}

export function doc(_dbOrRef, ...rest) {
  if (_dbOrRef?._ref === 'col') return { _ref: 'doc', path: `${_dbOrRef.path}/${rest[0]}` };
  return { _ref: 'doc', path: rest.join('/') };
}

// ── Conversión JS ↔ Firestore REST ──
function toV(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v?._t === 'ts') return { timestampValue: new Date().toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toV) } };
  if (typeof v === 'object') return { mapValue: { fields: toF(v) } };
  return { stringValue: String(v) };
}

function toF(obj) {
  const f = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v?._t === 'union' || v?._t === 'remove') continue; // handled in updateDoc
    f[k] = toV(v);
  }
  return f;
}

function fromV(v) {
  if (!v) return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return parseInt(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromV);
  if ('mapValue' in v) return fromF(v.mapValue.fields || {});
  return null;
}

function fromF(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields || {})) obj[k] = fromV(v);
  return obj;
}

function makeDocSnap(restDoc, fallbackId) {
  if (!restDoc?.name) return { exists: () => false, data: () => null, id: fallbackId || '' };
  const id = restDoc.name.split('/').pop();
  const data = fromF(restDoc.fields || {});
  return { exists: () => true, data: () => data, id };
}

// ── CRUD ──
export async function getDoc(ref) {
  const r = await fetch(`${BASE}/${ref.path}`);
  if (r.status === 404) return makeDocSnap(null, ref.path.split('/').pop());
  const j = await r.json();
  return makeDocSnap(j);
}

export async function setDoc(ref, data) {
  await fetch(`${BASE}/${ref.path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toF(data) })
  });
}

export async function addDoc(colRef, data) {
  const r = await fetch(`${BASE}/${colRef.path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toF(data) })
  });
  const j = await r.json();
  const id = j.name?.split('/').pop() || '';
  return { id };
}

export async function getDocs(colRef) {
  const r = await fetch(`${BASE}/${colRef.path}`);
  const j = await r.json();
  const docs = (j.documents || []).map(d => makeDocSnap(d));
  return { docs, empty: docs.length === 0 };
}

export async function deleteDoc(ref) {
  await fetch(`${BASE}/${ref.path}`, { method: 'DELETE' });
}

export async function updateDoc(ref, data) {
  // Leer primero para arrayUnion/arrayRemove
  const hasSpecial = Object.values(data).some(v => v?._t === 'union' || v?._t === 'remove');
  if (hasSpecial) {
    const snap = await getDoc(ref);
    const cur = snap.exists() ? snap.data() : {};
    const merged = { ...cur };
    for (const [k, v] of Object.entries(data)) {
      if (v?._t === 'union') {
        const arr = Array.isArray(merged[k]) ? [...merged[k]] : [];
        for (const item of v.items) if (!arr.includes(item)) arr.push(item);
        merged[k] = arr;
      } else if (v?._t === 'remove') {
        const arr = Array.isArray(merged[k]) ? merged[k] : [];
        merged[k] = arr.filter(i => !v.items.includes(i));
      } else {
        merged[k] = v;
      }
    }
    return setDoc(ref, merged);
  }
  return setDoc(ref, data);
}

// ── onSnapshot vía polling cada 4s ──
export function onSnapshot(ref, callback) {
  let last = null;

  async function poll() {
    try {
      let snap;
      if (ref._ref === 'doc') {
        snap = await getDoc(ref);
        const sig = JSON.stringify(snap.data());
        if (sig === last) return;
        last = sig;
        callback(snap);
      } else {
        snap = await getDocs(ref);
        const sig = JSON.stringify(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        if (sig === last) return;
        last = sig;
        callback(snap);
      }
    } catch (e) { console.warn('poll:', e); }
  }

  poll(); // inmediato
  const id = setInterval(poll, 4000);
  return () => clearInterval(id);
}