// ============================================================
//  WalkWorld — firebase-config.js
//  Firebase config values come from config.js, which is
//  populated by GitHub Actions secrets at deploy time.
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

import {
  FIREBASE_API_KEY,
  FIREBASE_AUTH_DOMAIN,
  FIREBASE_DATABASE_URL,
  FIREBASE_PROJECT_ID,
  FIREBASE_STORAGE_BUCKET,
  FIREBASE_MESSAGING_SENDER_ID,
  FIREBASE_APP_ID,
} from './config.js';

const firebaseConfig = {
  apiKey:            FIREBASE_API_KEY,
  authDomain:        FIREBASE_AUTH_DOMAIN,
  databaseURL:       FIREBASE_DATABASE_URL,
  projectId:         FIREBASE_PROJECT_ID,
  storageBucket:     FIREBASE_STORAGE_BUCKET,
  messagingSenderId: FIREBASE_MESSAGING_SENDER_ID,
  appId:             FIREBASE_APP_ID,
};

let app  = null;
let db   = null;
let auth = null;

const isConfigured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('REPLACE_WITH');

if (isConfigured) {
  app  = initializeApp(firebaseConfig);
  db   = getDatabase(app);
  auth = getAuth(app);
} else {
  console.warn(
    '[WalkWorld] Firebase not configured.\n' +
    'Add your Firebase secrets in GitHub repo → Settings → Secrets and variables → Actions.\n' +
    'See js/config.js for the list of required secrets.'
  );
}

export { app, db, auth, isConfigured, signInAnonymously, signInWithPopup, linkWithPopup, GoogleAuthProvider, onAuthStateChanged };
