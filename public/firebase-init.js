// Este archivo está en /public/ — Vite NO lo procesa
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  initializeFirestore, collection, doc, getDoc, setDoc, addDoc,
  getDocs, deleteDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, serverTimestamp,
  query, where, orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getAuth,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const app = initializeApp({
  apiKey: "AIzaSyBvHUMHCfhfpNWO7jJ0VGKd85GQ5B_LxGs",
  authDomain: "dulce-rosa.firebaseapp.com",
  projectId: "dulce-rosa",
  storageBucket: "dulce-rosa.firebasestorage.app",
  messagingSenderId: "40527565108",
  appId: "1:40527565108:web:7ee0e93d1f9334bf969561"
});

window.__db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false
});

window.__auth = getAuth(app);
window.__authReadyPromise = setPersistence(window.__auth, browserLocalPersistence).catch((error) => {
  console.error('No se pudo activar la persistencia de Firebase Auth:', error);
});

window.__fb = {
  collection, doc, getDoc, setDoc, addDoc,
  getDocs, deleteDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, serverTimestamp,
  query, where, orderBy
};

window.__authApi = {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
};

window.dispatchEvent(new CustomEvent('fb-ready'));
