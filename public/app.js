/**
 * OBS Stream Dashboard — Frontend App
 * =====================================
 * This file handles:
 *   1. WebSocket connection to our Node.js server
 *   2. Updating the UI based on OBS state changes
 *   3. Sending user actions to the server → OBS
 *
 * Architecture:
 *   Browser (this file) <--WS--> server.js <--WS--> OBS Studio
 */

const App = (() => {
  // ── State ────────────────────────────────────────────────────
  let ws = null;
  let isStreaming = false;
  let isRecording = false;
  let currentScene = null;
  let scenes = [];
  let streamTimer = null;
  let streamSeconds = 0;

  // Scene icons — auto-assigned based on keywords in scene name
  const SCENE_ICONS = {
    cam:     '🎥', camera: '🎥', webcam: '🎥',
    game:    '🎮', gaming: '🎮', play:   '🎮',
    brb:     '☕', away:   '☕', break:  '☕',
    screen:  '🖥', desktop:'🖥', share:  '🖥',
    music:   '🎵', audio:  '🎵',
    chat:    '💬', talk:   '💬',
    intro:   '✨', start:  '✨', opening:'✨',
    end:     '🏁', outro:  '🏁', ending: '🏁',
    alert:   '🔔',
    irl:     '🌍', outdoor:'🌍',
    default: '📺',
  };

  // Macros — map name → actions array
  const MACROS = {
    brb:   [{ type: 'SWITCH_SCENE', sceneName: 'BRB' }],
    intro: [{ type: 'SWITCH_SCENE', sceneName: 'Intro' }],
    alert: [{ type: 'SWITCH_SCENE', sceneName: 'Alert' }],
    end:   [{ type: 'SWITCH_SCENE', sceneName: 'Outro' }],
  };

  // ── Init ─────────────────────────────────────────────────────
  function init() {
    connectWebSocket();
    updateUI();
  }

  // ── WebSocket Connection ──────────────────────────────────────
  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}`;

    console.log(`[WS] Connecting to ${wsUrl}...`);
    setConnectionStatus('connecting');

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WS] Connected to dashboard server');
      // Server auto-connects to OBS, but we trigger if needed
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch (e) {
        console.error('[WS] Failed to parse message:', e);
      }
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected from server');
      setConnectionStatus('disconnected');
      // Auto-reconnect to server after 2s
      setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
    };
  }

  // ── Message Handler ──────────────────────────────────────────
  function handleMessage(msg) {
    switch (msg.type) {

      case 'CONNECTION_STATUS':
        setConnectionStatus(msg.connected ? 'connected' : 'disconnected');
        if (!msg.connected) {
          showToast('⚠️ Lost connection to OBS', 'warn');
        }
        break;

      case 'SCENE_CHANGED':
        currentScene = msg.sceneName;
        updateSceneButtons();
        updateCurrentSceneBadge();
        break;

      case 'SCENE_LIST':
        scenes = msg.scenes;
        renderSceneGrid();
        break;

      case 'STREAM_STATE':
        isStreaming = msg.active;
        updateStreamButton();
        if (msg.active) {
          startTimer();
          showToast('🔴 Stream is now LIVE', 'success');
        } else {
          stopTimer();
          if (msg.state !== undefined) {
            showToast('⬛ Stream stopped', 'info');
          }
        }
        break;

      case 'RECORD_STATE':
        isRecording = msg.active;
        updateRecordButton();
        if (msg.active) {
          showToast('⏺ Recording started', 'info');
        }
        break;

      case 'ERROR':
        showToast(`❌ ${msg.message}`, 'error', 6000);
        break;

      default:
        console.log('[MSG] Unknown:', msg);
    }
  }

  // ── Send to Server ────────────────────────────────────────────
  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    } else {
      showToast('⚠️ Not connected to server', 'warn');
    }
  }

  // ── Actions ──────────────────────────────────────────────────
  function toggleStream() {
    if (isStreaming) {
      // Confirm before stopping
      const confirmed = confirm('Stop the live stream?');
      if (!confirmed) return;
      send({ type: 'STOP_STREAM' });
    } else {
      send({ type: 'START_STREAM' });
      showToast('⏳ Starting stream…', 'info');
    }
  }

  function toggleRecord() {
    if (isRecording) {
      send({ type: 'STOP_RECORDING' });
    } else {
      send({ type: 'START_RECORDING' });
    }
  }

  function switchScene(sceneName) {
    send({ type: 'SWITCH_SCENE', sceneName });
    // Optimistic update
    currentScene = sceneName;
    updateSceneButtons();
    updateCurrentSceneBadge();
  }

  function reconnect() {
    send({ type: 'CONNECT_OBS' });
    showToast('🔌 Reconnecting to OBS…', 'info');
  }

  function macro(name) {
    const actions = MACROS[name];
    if (!actions) { showToast(`⚠️ Macro "${name}" not configured`, 'warn'); return; }
    actions.forEach((action) => send(action));
    showToast(`⚡ Macro: ${name.toUpperCase()}`, 'success');
  }

  function playSound(name) {
    // Soundboard placeholder — in a real app you'd play an audio file
    showToast(`🔊 Sound: ${name} (connect audio API to enable)`, 'info');
    console.log(`[SOUND] Would play: ${name}`);
  }

  function sendChat() {
    const input = document.getElementById('chat-msg');
    const msg = input.value.trim();
    if (!msg) return;

    // Placeholder — connect Twitch/YouTube API here
    addChatMessage('You', msg);
    input.value = '';
    showToast('💬 Chat integration: connect API to send', 'info');
  }

  // ── UI Updaters ───────────────────────────────────────────────
  function setConnectionStatus(status) {
    const pill = document.getElementById('conn-status');
    const dot = pill.querySelector('.status-pill__dot');
    const label = pill.querySelector('.status-pill__label');

    pill.className = 'status-pill';

    switch (status) {
      case 'connected':
        pill.classList.add('connected');
        label.textContent = 'OBS CONNECTED';
        break;
      case 'disconnected':
        pill.classList.add('disconnected');
        label.textContent = 'OBS OFFLINE';
        break;
      case 'connecting':
        label.textContent = 'CONNECTING…';
        break;
    }
  }

  function updateStreamButton() {
    const btn = document.getElementById('btn-stream');
    const label = document.getElementById('btn-stream-label');
    const badge = document.getElementById('stream-badge');

    if (isStreaming) {
      btn.className = 'btn btn--stream btn--stop';
      label.textContent = 'END STREAM';
      badge.textContent = '● LIVE';
      badge.className = 'control-card__badge live';
    } else {
      btn.className = 'btn btn--stream btn--go';
      label.textContent = 'GO LIVE';
      badge.textContent = 'OFFLINE';
      badge.className = 'control-card__badge';
    }
  }

  function updateRecordButton() {
    const btn = document.getElementById('btn-record');
    const label = document.getElementById('btn-record-label');
    const badge = document.getElementById('record-badge');

    if (isRecording) {
      btn.classList.add('active');
      label.textContent = 'STOP REC';
      badge.textContent = '● REC';
      badge.className = 'control-card__badge recording';
    } else {
      btn.classList.remove('active');
      label.textContent = 'START REC';
      badge.textContent = 'IDLE';
      badge.className = 'control-card__badge';
    }
  }

  function renderSceneGrid() {
    const grid = document.getElementById('scene-grid');
    grid.innerHTML = '';

    if (scenes.length === 0) {
      grid.innerHTML = '<div class="scene-grid__empty"><span>No scenes found in OBS</span></div>';
      return;
    }

    scenes.forEach((sceneName) => {
      const btn = document.createElement('button');
      btn.className = 'scene-btn';
      btn.dataset.scene = sceneName;

      if (sceneName === currentScene) {
        btn.classList.add('active');
      }

      btn.innerHTML = `
        <span class="scene-btn__live-dot"></span>
        <span class="scene-btn__icon">${getSceneIcon(sceneName)}</span>
        <span class="scene-btn__name">${sceneName}</span>
      `;

      btn.onclick = () => switchScene(sceneName);
      grid.appendChild(btn);
    });
  }

  function updateSceneButtons() {
    document.querySelectorAll('.scene-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.scene === currentScene);
    });
  }

  function updateCurrentSceneBadge() {
    document.getElementById('current-scene-name').textContent = currentScene || '—';
  }

  function updateUI() {
    updateStreamButton();
    updateRecordButton();
    updateCurrentSceneBadge();
  }

  // ── Stream Timer ──────────────────────────────────────────────
  function startTimer() {
    const timerEl = document.getElementById('stream-timer');
    const display = document.getElementById('timer-display');
    timerEl.style.display = 'inline-flex';
    streamSeconds = 0;

    clearInterval(streamTimer);
    streamTimer = setInterval(() => {
      streamSeconds++;
      display.textContent = formatTime(streamSeconds);
    }, 1000);
  }

  function stopTimer() {
    clearInterval(streamTimer);
    document.getElementById('stream-timer').style.display = 'none';
    streamSeconds = 0;
  }

  function formatTime(seconds) {
    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  // ── Toast Notifications ───────────────────────────────────────
  function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toast-out 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ── Helpers ───────────────────────────────────────────────────
  function getSceneIcon(name) {
    const lower = name.toLowerCase();
    for (const [keyword, icon] of Object.entries(SCENE_ICONS)) {
      if (keyword !== 'default' && lower.includes(keyword)) {
        return icon;
      }
    }
    return SCENE_ICONS.default;
  }

  function addChatMessage(user, text) {
    const feed = document.getElementById('chat-feed');
    const placeholder = feed.querySelector('.chat__placeholder');
    if (placeholder) placeholder.remove();

    const msg = document.createElement('div');
    msg.className = 'chat__message';
    msg.innerHTML = `
      <span class="chat__message-user">${escapeHtml(user)}:</span>
      <span class="chat__message-text">${escapeHtml(text)}</span>
    `;
    feed.appendChild(msg);
    feed.scrollTop = feed.scrollHeight;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Public API ────────────────────────────────────────────────
  return {
    init,
    toggleStream,
    toggleRecord,
    switchScene,
    reconnect,
    macro,
    playSound,
    sendChat,
  };

})();

// Start on page load
document.addEventListener('DOMContentLoaded', App.init);

// Send chat on Enter key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement.id === 'chat-msg') {
    App.sendChat();
  }
});
