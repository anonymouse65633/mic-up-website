# 🌍 WalkWorld

A free, open, browser-based multiplayer world — walk around, chat, and see other players in real time.  
Hosted on **GitHub Pages** (free). Multiplayer powered by **Firebase Realtime Database** (free tier).

---

## 📁 File Structure

```
walkworld/
├── index.html              ← Login / lobby page
├── game.html               ← Game canvas page
├── css/
│   ├── style.css           ← Global styles + login page
│   └── game.css            ← HUD, chat panel, overlays
└── js/
    ├── firebase-config.js  ← ✏️  YOUR Firebase credentials go here
    ├── network.js          ← Firebase multiplayer logic
    ├── world.js            ← Tile map, decorations, collision
    ├── renderer.js         ← Canvas drawing engine
    ├── player.js           ← Movement + input
    └── game.js             ← Main game loop + init
```

---

## 🚀 Quick Start (3 steps)

### Step 1 — Set up Firebase (5 minutes, free)

Firebase is what makes the game multiplayer. You get a free database that syncs all players in real time.

1. Go to **[https://console.firebase.google.com](https://console.firebase.google.com)**
2. Click **"Add project"** → give it a name (e.g. `walkworld`) → click through the setup
3. Once inside your project, click the **`</>`** (Web) icon to add a web app
4. Give the app a nickname (e.g. `walkworld-web`) → click **"Register app"**
5. You'll see a `firebaseConfig` object — **copy it**, you'll need it in a moment
6. In the left sidebar go to **Build → Realtime Database**
7. Click **"Create database"** → choose a region near you → select **"Start in test mode"** → click **Enable**

> ⚠️ Test mode allows anyone to read/write for 30 days. See [Lock Down Firebase](#-lock-down-firebase-optional) below to secure it properly.

---

### Step 2 — Paste your Firebase config

Open `js/firebase-config.js` and replace the placeholder values with the config you copied:

```js
const firebaseConfig = {
  apiKey:            "AIzaSy...",          // ← paste your values
  authDomain:        "walkworld.firebaseapp.com",
  databaseURL:       "https://walkworld-default-rtdb.firebaseio.com",
  projectId:         "walkworld",
  storageBucket:     "walkworld.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc123",
};
```

Save the file. That's the only file you need to edit.

---

### Step 3 — Deploy to GitHub Pages (free hosting)

#### Option A — GitHub website (easiest, no terminal needed)

1. Go to **[https://github.com](https://github.com)** and sign in (or create a free account)
2. Click **"+"** → **"New repository"**
3. Name it `walkworld` → set to **Public** → click **"Create repository"**
4. Click **"uploading an existing file"** on the empty repo page
5. Drag and drop your entire `walkworld/` folder contents (all files + `css/` and `js/` folders)
6. Scroll down → click **"Commit changes"**
7. Go to **Settings** → **Pages** (left sidebar)
8. Under **"Branch"**, select `main` → folder `/root` → click **Save**
9. Wait ~60 seconds, then your site is live at:

```
https://YOUR-USERNAME.github.io/walkworld/
```

#### Option B — Git terminal (if you have Git installed)

```bash
# 1. Inside your walkworld folder:
git init
git add .
git commit -m "Initial WalkWorld commit"

# 2. Create a repo on GitHub (https://github.com/new), then:
git remote add origin https://github.com/YOUR-USERNAME/walkworld.git
git branch -M main
git push -u origin main

# 3. Enable GitHub Pages:
#    GitHub → your repo → Settings → Pages → Branch: main → Save
```

Your live URL will be `https://YOUR-USERNAME.github.io/walkworld/`

---

## 🎮 Controls

| Key | Action |
|-----|--------|
| `W` `A` `S` `D` | Move |
| `↑` `←` `↓` `→` | Move (arrow keys) |
| `T` | Open chat |
| `Enter` | Send chat message |
| `ESC` | Close chat |

Mobile: tap to move (coming soon via virtual joystick using `setTouchInput` in `player.js`).

---

## 🔒 Lock Down Firebase (optional but recommended)

Once you're done testing, replace the default Realtime Database rules to stop strangers from dumping junk data.

In **Firebase Console → Realtime Database → Rules**, paste:

```json
{
  "rules": {
    "players": {
      "$uid": {
        ".read":  true,
        ".write": true,
        ".validate": "newData.hasChildren(['name','colour','x','y'])
                      && newData.child('name').val().length <= 16
                      && newData.child('x').isNumber()
                      && newData.child('y').isNumber()"
      }
    },
    "chat": {
      ".read":  true,
      "$msgId": {
        ".write": true,
        ".validate": "newData.hasChildren(['text','name'])
                      && newData.child('text').val().length <= 80"
      }
    }
  }
}
```

Click **Publish**. This:
- Allows everyone to read (so players can see each other ✅)
- Validates player data so no one can write garbage ✅
- Caps message length at 80 characters ✅

---

## 💸 Will this cost anything?

No — as long as you stay within Firebase's **Spark (free) plan** limits:

| Resource | Free limit | WalkWorld usage |
|----------|-----------|-----------------|
| Realtime DB storage | 1 GB | ~1 KB per player |
| DB bandwidth | 10 GB/month | ~1 MB per 1,000 player-minutes |
| Simultaneous connections | 100 | Fine for a small game |
| GitHub Pages bandwidth | 100 GB/month | Easily enough |

For a hobby game with friends these limits are virtually impossible to hit.

---

## 🛠️ Customisation Tips

**Change the world size** — edit `WORLD_W` and `WORLD_H` in `js/world.js`

**Change spawn point** — edit the `SPAWN` export at the bottom of `js/world.js`

**Change player speed** — edit `BASE_SPEED` in `js/player.js`

**Add a new tile type** — add an entry to `TILE` and `TILE_DEF` in `js/world.js`, then use it in the `tileMap` builder

**Change colours / fonts** — all design tokens are CSS variables in `css/style.css` under `:root`

---

## 🐛 Troubleshooting

**"Firebase not configured" warning in console**
→ You haven't pasted your config into `js/firebase-config.js` yet.

**Players can't see each other**
→ Check your Firebase Realtime Database is created and in **test mode** (or has rules that allow reads).

**Page shows a blank screen**
→ Open browser DevTools (F12) → Console tab. The error message will tell you which file has a problem.

**GitHub Pages shows a 404**
→ Make sure `index.html` is in the **root** of the repo (not inside a subfolder). Check Settings → Pages → Branch is set to `main`.

**Game works locally but not on GitHub Pages**
→ This is almost always a file path issue. All paths in the HTML files use relative paths (`./js/`, `./css/`) which work on both local and Pages.

---

## 📜 Licence

MIT — do whatever you like with it.
