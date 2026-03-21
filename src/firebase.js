import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore, initializeFirestore,
  collection, doc, getDoc, setDoc, addDoc,
  getDocs, deleteDoc, onSnapshot, updateDoc, arrayUnion, arrayRemove, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyBvHUMHCfhfpNWO7jJ0VGKd85GQ5B_LxGs",
  authDomain: "dulce-rosa.firebaseapp.com",
  projectId: "dulce-rosa",
  storageBucket: "dulce-rosa.firebasestorage.app",
  messagingSenderId: "40527565108",
  appId: "1:40527565108:web:7ee0e93d1f9334bf969561"
};

const app = initializeApp(firebaseConfig);

// experimentalForceLongPolling evita problemas de WebSocket/offline en entornos de producción
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true
});

export {
  collection, doc, getDoc, setDoc, addDoc, getDocs, deleteDoc,
  onSnapshot, updateDoc, arrayUnion, arrayRemove, serverTimestamp
};
