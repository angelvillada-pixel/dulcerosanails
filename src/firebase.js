import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBvHUMHCfhfpNWO7jJ0VGKd85GQ5B_LxGs",
  authDomain: "dulce-rosa.firebaseapp.com",
  projectId: "dulce-rosa",
  storageBucket: "dulce-rosa.firebasestorage.app",
  messagingSenderId: "40527565108",
  appId: "1:40527565108:web:7ee0e93d1f9334bf969561"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export {
  collection, doc, getDoc, setDoc, addDoc, getDocs, deleteDoc,
  onSnapshot, updateDoc, arrayUnion, arrayRemove, serverTimestamp
} from 'firebase/firestore';
