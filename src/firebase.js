// Wrapper sobre window.__db y window.__fb (inicializados en /firebase-init.js)
// Espera a que Firebase esté listo antes de exportar

function waitReady(fn) {
  if (window.__db) return fn();
  return new Promise(r => window.addEventListener('fb-ready', () => r(fn()), { once: true }));
}

export function getDb() { return window.__db; }
export const db = new Proxy({}, {
  get(_, prop) { return window.__db?.[prop]; }
});

// Re-exportar todas las funciones de Firestore
export function collection(...a) { return window.__fb.collection(...a); }
export function doc(...a) { return window.__fb.doc(...a); }
export async function getDoc(...a) { return window.__fb.getDoc(...a); }
export async function setDoc(...a) { return window.__fb.setDoc(...a); }
export async function addDoc(...a) { return window.__fb.addDoc(...a); }
export async function getDocs(...a) { return window.__fb.getDocs(...a); }
export async function deleteDoc(...a) { return window.__fb.deleteDoc(...a); }
export function onSnapshot(...a) { return window.__fb.onSnapshot(...a); }
export async function updateDoc(...a) { return window.__fb.updateDoc(...a); }
export function arrayUnion(...a) { return window.__fb.arrayUnion(...a); }
export function arrayRemove(...a) { return window.__fb.arrayRemove(...a); }
export function serverTimestamp() { return window.__fb.serverTimestamp(); }
