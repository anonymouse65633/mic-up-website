// ============================================================
//  WalkWorld — config.js
//  Central configuration file. API keys are injected here by
//  GitHub Actions before deployment — never commit real keys.
//
//  ┌─ HOW GITHUB SECRETS WORK ──────────────────────────────┐
//  │  1. Go to your GitHub repo → Settings → Secrets and    │
//  │     variables → Actions → New repository secret        │
//  │  2. Add each secret listed below                       │
//  │  3. Push to main — GitHub Actions auto-deploys with    │
//  │     the real keys injected                             │
//  │                                                        │
//  │  Secrets to add:                                       │
//  │    GEMINI_API_KEY          (from aistudio.google.com)  │
//  │    FIREBASE_API_KEY                                    │
//  │    FIREBASE_AUTH_DOMAIN                               │
//  │    FIREBASE_DATABASE_URL                              │
//  │    FIREBASE_PROJECT_ID                                │
//  │    FIREBASE_STORAGE_BUCKET                            │
//  │    FIREBASE_MESSAGING_SENDER_ID                       │
//  │    FIREBASE_APP_ID                                    │
//  └────────────────────────────────────────────────────────┘
//
//  For local dev: replace the placeholder strings directly
//  in this file. DO NOT commit your real keys to git.
// ============================================================

// Google Gemini API key — https://aistudio.google.com/app/apikey
export const GEMINI_API_KEY = 'REPLACE_WITH_GEMINI_KEY';

// Firebase — https://console.firebase.google.com → Project settings → Your apps
export const FIREBASE_API_KEY             = 'REPLACE_WITH_FIREBASE_API_KEY';
export const FIREBASE_AUTH_DOMAIN         = 'REPLACE_WITH_FIREBASE_AUTH_DOMAIN';
export const FIREBASE_DATABASE_URL        = 'REPLACE_WITH_FIREBASE_DATABASE_URL';
export const FIREBASE_PROJECT_ID          = 'REPLACE_WITH_FIREBASE_PROJECT_ID';
export const FIREBASE_STORAGE_BUCKET      = 'REPLACE_WITH_FIREBASE_STORAGE_BUCKET';
export const FIREBASE_MESSAGING_SENDER_ID = 'REPLACE_WITH_FIREBASE_MESSAGING_SENDER_ID';
export const FIREBASE_APP_ID              = 'REPLACE_WITH_FIREBASE_APP_ID';
