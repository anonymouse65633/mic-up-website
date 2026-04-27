import { initializeApp }  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase }    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDU-rtxp20m2f6XdVPzs8MJ6UsiOpPvMWY",
  authDomain:        "infinite-craft-remake-56705.firebaseapp.com",
  databaseURL:       "https://infinite-craft-remake-56705-default-rtdb.firebaseio.com",
  projectId:         "infinite-craft-remake-56705",
  storageBucket:     "infinite-craft-remake-56705.firebasestorage.app",
  messagingSenderId: "347877015349",
  appId:             "1:347877015349:web:bea7754ad38990b97cd67c",
};

let app = null;
let db  = null;

const isConfigured = true;

app = initializeApp(firebaseConfig);
db  = getDatabase(app);

export { app, db, isConfigured };
