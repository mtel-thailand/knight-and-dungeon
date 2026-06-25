import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, User } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDqQjSER7fAPa1_A8b-ykCAOnHV4-iD0tU",
  authDomain: "knight-and-dungeon.firebaseapp.com",
  projectId: "knight-and-dungeon",
  storageBucket: "knight-and-dungeon.firebasestorage.app",
  messagingSenderId: "891132970457",
  appId: "1:891132970457:web:4d8354a081b3cae3de85c8",
  measurementId: "G-GRKJP37VEQ",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);

export { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged };
export type { User };
