// ============================================================
//  WalkWorld — firebase-config.js
//  Part 7: Added Firebase Auth (anonymous + Google link)
// ============================================================

import { initializeApp }     from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase }       from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
  getAuth,
  signInAnonymously,
  signInWithPopup,
  linkWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDU-rtxp20m2f6XdVPzs8MJ6UsiOpPvMWY",
  authDomain:        "infinite-craft-remake-56705.firebaseapp.com",
  databaseURL:       "https://infinite-craft-remake-56705-default-rtdb.firebaseio.com",
  projectId:         "infinite-craft-remake-56705",
  storageBucket:     "infinite-craft-remake-56705.firebasestorage.app",
  messagingSenderId: "347877015349",
  appId:             "1:347877015349:web:bea7754ad38990b97cd67c",
};

let app  = null;
let db   = null;
let auth = null;

const isConfigured = firebaseConfig.apiKey !== "YOUR_API_KEY";

if (isConfigured) {
  app  = initializeApp(firebaseConfig);
  db   = getDatabase(app);
  auth = getAuth(app);
} else {
  console.warn("[WalkWorld] Firebase not configured!\nOpen js/firebase-config.js and paste your Firebase project config.");
}

export { app, db, auth, isConfigured, signInAnonymously, signInWithPopup, linkWithPopup, GoogleAuthProvider, onAuthStateChanged };
