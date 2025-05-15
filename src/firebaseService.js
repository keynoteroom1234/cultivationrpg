import { initializeApp } from "firebase/app";
import { 
    getFirestore, 
    doc, 
    setDoc, 
    getDoc, 
    collection, 
    query, 
    where, 
    getDocs, 
    addDoc, 
    serverTimestamp as fsServerTimestamp, // renamed to avoid conflict
    runTransaction, 
    limitToLast, 
    onSnapshot, 
    orderBy 
} from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyBHSlX7zLuA37k9SyJqYXmV3IjUK3D-ZLg", 
    authDomain: "cultivation-480d8.firebaseapp.com",
    projectId: "cultivation-480d8",
    storageBucket: "cultivation-480d8.appspot.com",
    messagingSenderId: "901657097350",
    appId: "1:901657097350:web:98c13aee51f9c7d1fc0d07",
    measurementId: "G-66ZMDER5X4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Export Firestore instance and functions
export { 
    db, 
    doc, 
    setDoc, 
    getDoc, 
    collection, 
    query, 
    where, 
    getDocs, 
    addDoc, 
    fsServerTimestamp, 
    runTransaction, 
    limitToLast, 
    onSnapshot, 
    orderBy 
};

// Helper to generate a client-side ID for a new document
export function generateFirestoreId(collectionPath) {
    return doc(collection(db, collectionPath)).id;
}