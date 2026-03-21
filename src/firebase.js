// Firebase wrapper — usa window.__db (cargado en /public/firebase-init.js)
// Las funciones ignoran el argumento 'db' pasado y usan window.__db directamente

export const db = { __isProxy: true }; // placeholder — solo para imports

const fns = () => window.__fb;
const realDb = () => window.__db;

// collection(db, path) → usa window.__db
export function collection(_db, ...rest) {
  return fns().collection(realDb(), ...rest);
}
export function doc(_db, ...rest) {
  // doc puede recibir (db, col, id) o (collectionRef, id)
  if (_db && _db.__isProxy) return fns().doc(realDb(), ...rest);
  return fns().doc(_db, ...rest); // collectionRef pasado directamente
}
export async function getDoc(ref) { return fns().getDoc(ref); }
export async function setDoc(ref, data, opts) { return opts ? fns().setDoc(ref, data, opts) : fns().setDoc(ref, data); }
export async function addDoc(ref, data) { return fns().addDoc(ref, data); }
export async function getDocs(ref) { return fns().getDocs(ref); }
export async function deleteDoc(ref) { return fns().deleteDoc(ref); }
export function onSnapshot(ref, cb) { return fns().onSnapshot(ref, cb); }
export async function updateDoc(ref, data) { return fns().updateDoc(ref, data); }
export function arrayUnion(...a) { return fns().arrayUnion(...a); }
export function arrayRemove(...a) { return fns().arrayRemove(...a); }
export function serverTimestamp() { return fns().serverTimestamp(); }