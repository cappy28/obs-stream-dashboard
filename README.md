# 🎬 OBS Stream Dashboard

A web-based OBS Studio control panel — like a browser Stream Deck.
Control your stream from any device on your local network.

---

## 📁 Folder Structure

```
obs-dashboard/
├── server.js          ← Node.js backend (WebSocket bridge)
├── package.json       ← Dependencies
├── .env               ← Your config (OBS password etc.)
└── public/
    ├── index.html     ← Dashboard UI
    ├── style.css      ← Dark streaming theme
    └── app.js         ← Frontend logic (WebSocket client)
```

---

## 🚀 Setup (5 minutes)

### 1. Enable OBS WebSocket
1. Open OBS Studio
2. Go to **Tools → WebSocket Server Settings**
3. Check **"Enable WebSocket server"**
4. Port: `4455` (default)
5. Set a password (optional but recommended)
6. Click OK

### 2. Install & Run the Dashboard

```bash
# Install dependencies
npm install

# Start the server
npm start

# For development (auto-restart on changes)
npm run dev
```

### 3. Open the Dashboard
Go to: **http://localhost:3000**

To access from phone/tablet on same Wi-Fi:
→ Find your PC's IP: `ipconfig` (Windows) or `ifconfig` (Mac/Linux)
→ Open `http://YOUR_IP:3000` on any device

---

## ⚙️ Configuration

Edit `server.js` top section or use environment variables:

```bash
# Windows
set OBS_PASSWORD=your_password && npm start

# Mac/Linux
OBS_PASSWORD=your_password npm start
```

| Variable       | Default       | Description                 |
|----------------|---------------|-----------------------------|
| `PORT`         | `3000`        | Dashboard web port          |
| `OBS_HOST`     | `localhost`   | OBS machine IP              |
| `OBS_PORT`     | `4455`        | OBS WebSocket port          |
| `OBS_PASSWORD` | _(empty)_     | OBS WebSocket password      |

---

## 🏗 Architecture

```
Browser                   Node.js Server              OBS Studio
────────                  ──────────────              ──────────
 app.js  ←──WebSocket──→  server.js  ←──WebSocket──→  :4455
(UI/UX)                   (Bridge)                   (Source)
```

**Why a Node.js bridge?**
- OBS WebSocket only listens on `localhost:4455`
- If you open the dashboard from your phone, it can't reach OBS directly
- The Node.js server sits in the middle and relays messages both ways
- This also lets you add authentication, logging, and macros server-side

**OBS WebSocket Protocol (v5)**

Every message has an `op` (opcode) number:
| op | Direction | Meaning              |
|----|-----------|----------------------|
| 0  | OBS→You   | Hello (send auth)    |
| 1  | You→OBS   | Identify (auth)      |
| 2  | OBS→You   | Identified (success) |
| 5  | OBS→You   | Event (state change) |
| 6  | You→OBS   | Request              |
| 7  | OBS→You   | RequestResponse      |

---

## ✨ Adding New Features

### Add a new scene button action
Scenes are loaded automatically from OBS. Just create them in OBS and they appear!

### Add a new macro button
In `public/app.js`, find the `MACROS` object:
```js
const MACROS = {
  brb:   [{ type: 'SWITCH_SCENE', sceneName: 'BRB' }],
  // Add yours:
  highlight: [
    { type: 'SWITCH_SCENE', sceneName: 'Highlight Cam' },
  ],
};
```

Then add a button in `index.html`:
```html
<button class="macro-btn macro-btn--green" onclick="App.macro('highlight')">
  <span class="macro-btn__icon">⭐</span>
  <span class="macro-btn__label">HIGHLIGHT</span>
</button>
```

### Add a new OBS action type
In `server.js`, add to `handleBrowserMessage()`:
```js
case 'TOGGLE_SOURCE':
  sendToObs({
    op: 6,
    d: {
      requestType: 'SetSceneItemEnabled',
      requestId: 'toggle_source',
      requestData: {
        sceneName: msg.sceneName,
        sceneItemId: msg.itemId,
        sceneItemEnabled: msg.enabled,
      },
    },
  });
  break;
```

---

## 🗺 Roadmap (Next Improvements)

### Phase 2 — More OBS Control
- [ ] Volume mixer (audio sources)
- [ ] Source visibility toggles
- [ ] Filter management
- [ ] Virtual camera toggle
- [ ] Studio mode (preview → program)

### Phase 3 — Stream Info
- [ ] Live viewer count (Twitch/YouTube API)
- [ ] Stream health metrics (FPS, bitrate, dropped frames)
- [ ] Stream duration from OBS

### Phase 4 — Chat Integration
- [ ] Twitch chat via IRC/EventSub
- [ ] YouTube Live chat API
- [ ] Chat commands / bot responses

### Phase 5 — Advanced
- [ ] Drag-and-drop scene grid reordering
- [ ] Custom hotkey profiles
- [ ] Scene transition selector
- [ ] OBS replay buffer control
- [ ] Multi-OBS instance support
- [ ] PWA (installable on phone home screen)

---

## 🐛 Troubleshooting

**"Cannot connect to OBS"**
→ Make sure OBS is open
→ Check Tools → WebSocket Server Settings → Enable is checked
→ Firewall may be blocking port 4455

**"Dashboard won't load"**
→ Make sure `npm install` ran successfully
→ Check port 3000 isn't in use: `npx kill-port 3000`

**"Scenes not showing"**
→ OBS may still be authenticating — wait 2-3 seconds and refresh
→ Check OBS has at least one scene created

---

## 📦 Dependencies

| Package   | Purpose                              |
|-----------|--------------------------------------|
| `express` | Serves the frontend HTML/CSS/JS      |
| `ws`      | WebSocket server + OBS client        |
| `nodemon` | Auto-restart during development      |
