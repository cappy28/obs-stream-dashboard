/**
 * OBS Stream Dashboard — Backend Server
 * =======================================
 * This Node.js server does two things:
 *   1. Serves the static frontend files (HTML/CSS/JS)
 *   2. Acts as a WebSocket bridge between the browser and OBS Studio
 *
 * WHY a bridge?
 *   OBS WebSocket runs on ws://localhost:4455 on the SAME machine as OBS.
 *   If you open the dashboard from another device (phone, tablet), it can't
 *   reach OBS directly. This server relays messages both ways.
 *
 * Flow:
 *   Browser <--WS--> This Server <--WS--> OBS Studio
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// ─── Configuration ────────────────────────────────────────────────────────────
const CONFIG = {
  PORT: process.env.PORT || 3000,
  OBS_HOST: process.env.OBS_HOST || 'localhost',
  OBS_PORT: process.env.OBS_PORT || 4455,
  OBS_PASSWORD: process.env.OBS_PASSWORD || '', // Set your OBS WebSocket password here
};

// ─── Express App (serves static files) ───────────────────────────────────────
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer(app);

// ─── WebSocket Server (listens for browser connections) ───────────────────────
const wss = new WebSocket.Server({ server });

console.log('🎬 OBS Stream Dashboard Server');
console.log('================================');
console.log(`📡 Listening on http://localhost:${CONFIG.PORT}`);
console.log(`🔗 Will connect to OBS at ws://${CONFIG.OBS_HOST}:${CONFIG.OBS_PORT}`);
console.log('');

// ─── Handle each browser client ───────────────────────────────────────────────
wss.on('connection', (browserSocket) => {
  console.log('✅ Browser client connected');

  let obsSocket = null;
  let isObsConnected = false;

  // Helper: send a message to the browser
  function sendToBrowser(data) {
    if (browserSocket.readyState === WebSocket.OPEN) {
      browserSocket.send(JSON.stringify(data));
    }
  }

  // Helper: send a message to OBS
  function sendToObs(data) {
    if (obsSocket && obsSocket.readyState === WebSocket.OPEN) {
      obsSocket.send(JSON.stringify(data));
    }
  }

  // ─── Connect to OBS Studio ──────────────────────────────────────────────────
  function connectToObs() {
    const obsUrl = `ws://${CONFIG.OBS_HOST}:${CONFIG.OBS_PORT}`;
    console.log(`🔌 Connecting to OBS at ${obsUrl}...`);

    obsSocket = new WebSocket(obsUrl);

    obsSocket.on('open', () => {
      console.log('✅ Connected to OBS Studio');
      isObsConnected = true;
      sendToBrowser({ type: 'CONNECTION_STATUS', connected: true });
    });

    // ── OBS → Browser relay ────────────────────────────────────────────────────
    obsSocket.on('message', (rawData) => {
      try {
        const obsMessage = JSON.parse(rawData.toString());
        handleObsMessage(obsMessage);
      } catch (e) {
        console.error('Failed to parse OBS message:', e.message);
      }
    });

    obsSocket.on('close', () => {
      console.log('⚠️  OBS connection closed');
      isObsConnected = false;
      sendToBrowser({ type: 'CONNECTION_STATUS', connected: false });
      // Auto-reconnect after 3 seconds
      setTimeout(() => {
        if (browserSocket.readyState === WebSocket.OPEN) {
          connectToObs();
        }
      }, 3000);
    });

    obsSocket.on('error', (err) => {
      console.error('❌ OBS WebSocket error:', err.message);
      sendToBrowser({
        type: 'ERROR',
        message: `Cannot connect to OBS: ${err.message}. Make sure OBS is running with WebSocket enabled.`,
      });
    });
  }

  // ─── Handle messages coming FROM OBS ──────────────────────────────────────
  function handleObsMessage(msg) {
    /**
     * OBS WebSocket v5 protocol uses:
     *   op: 0 = Hello (server sends its info)
     *   op: 2 = Identified (auth successful)
     *   op: 5 = Event (OBS state changes)
     *   op: 7 = RequestResponse (response to our request)
     */
    switch (msg.op) {
      case 0: // Hello — OBS asks us to identify
        handleHello(msg.d);
        break;

      case 2: // Identified — auth succeeded, request initial state
        console.log('🔑 OBS authentication successful');
        requestInitialState();
        break;

      case 5: // Event — something changed in OBS
        handleObsEvent(msg.d);
        break;

      case 7: // RequestResponse — answer to our request
        handleObsResponse(msg.d);
        break;

      default:
        // Forward unknown messages to browser for debugging
        sendToBrowser({ type: 'OBS_RAW', data: msg });
    }
  }

  // ─── OBS Auth Handshake ────────────────────────────────────────────────────
  function handleHello(data) {
    const identifyPayload = {
      op: 1, // Identify
      d: { rpcVersion: 1 },
    };

    // If OBS has a password set, we need to hash it
    if (data.authentication && CONFIG.OBS_PASSWORD) {
      const crypto = require('crypto');
      const { challenge, salt } = data.authentication;

      const secretBase64 = crypto
        .createHash('sha256')
        .update(CONFIG.OBS_PASSWORD + salt)
        .digest('base64');

      const authString = crypto
        .createHash('sha256')
        .update(secretBase64 + challenge)
        .digest('base64');

      identifyPayload.d.authentication = authString;
    }

    sendToObs(identifyPayload);
  }

  // ─── Request current OBS state on connect ─────────────────────────────────
  function requestInitialState() {
    // Ask OBS for: current scene, stream status, scene list
    const requests = [
      { requestType: 'GetCurrentProgramScene', requestId: 'init_scene' },
      { requestType: 'GetStreamStatus', requestId: 'init_stream' },
      { requestType: 'GetRecordStatus', requestId: 'init_record' },
      { requestType: 'GetSceneList', requestId: 'init_scenelist' },
    ];

    requests.forEach((req) => {
      sendToObs({ op: 6, d: { ...req, requestData: {} } });
    });
  }

  // ─── Handle OBS Events (real-time changes) ────────────────────────────────
  function handleObsEvent(eventData) {
    const { eventType, eventData: data } = eventData;

    switch (eventType) {
      case 'CurrentProgramSceneChanged':
        sendToBrowser({
          type: 'SCENE_CHANGED',
          sceneName: data.sceneName,
        });
        break;

      case 'StreamStateChanged':
        sendToBrowser({
          type: 'STREAM_STATE',
          active: data.outputActive,
          state: data.outputState,
        });
        break;

      case 'RecordStateChanged':
        sendToBrowser({
          type: 'RECORD_STATE',
          active: data.outputActive,
          state: data.outputState,
        });
        break;

      case 'SceneListChanged':
        sendToBrowser({
          type: 'SCENE_LIST',
          scenes: data.scenes.map((s) => s.sceneName),
        });
        break;

      default:
        // Forward all other events to browser
        sendToBrowser({ type: 'OBS_EVENT', eventType, data });
    }
  }

  // ─── Handle OBS Responses ─────────────────────────────────────────────────
  function handleObsResponse(responseData) {
    const { requestId, requestStatus, responseData: data } = responseData;

    if (!requestStatus.result) {
      console.error(`❌ OBS request failed [${requestId}]:`, requestStatus.comment);
      return;
    }

    switch (requestId) {
      case 'init_scene':
        sendToBrowser({
          type: 'SCENE_CHANGED',
          sceneName: data.currentProgramSceneName,
        });
        break;

      case 'init_stream':
        sendToBrowser({
          type: 'STREAM_STATE',
          active: data.outputActive,
          timecode: data.outputTimecode,
        });
        break;

      case 'init_record':
        sendToBrowser({
          type: 'RECORD_STATE',
          active: data.outputActive,
        });
        break;

      case 'init_scenelist':
        sendToBrowser({
          type: 'SCENE_LIST',
          scenes: data.scenes.map((s) => s.sceneName).reverse(),
        });
        break;

      default:
        sendToBrowser({ type: 'REQUEST_RESPONSE', requestId, data });
    }
  }

  // ─── Handle messages FROM the Browser ─────────────────────────────────────
  browserSocket.on('message', (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString());
      handleBrowserMessage(msg);
    } catch (e) {
      console.error('Failed to parse browser message:', e.message);
    }
  });

  function handleBrowserMessage(msg) {
    switch (msg.type) {
      case 'CONNECT_OBS':
        connectToObs();
        break;

      case 'START_STREAM':
        sendToObs({
          op: 6,
          d: { requestType: 'StartStream', requestId: 'start_stream', requestData: {} },
        });
        break;

      case 'STOP_STREAM':
        sendToObs({
          op: 6,
          d: { requestType: 'StopStream', requestId: 'stop_stream', requestData: {} },
        });
        break;

      case 'START_RECORDING':
        sendToObs({
          op: 6,
          d: { requestType: 'StartRecord', requestId: 'start_record', requestData: {} },
        });
        break;

      case 'STOP_RECORDING':
        sendToObs({
          op: 6,
          d: { requestType: 'StopRecord', requestId: 'stop_record', requestData: {} },
        });
        break;

      case 'SWITCH_SCENE':
        sendToObs({
          op: 6,
          d: {
            requestType: 'SetCurrentProgramScene',
            requestId: 'switch_scene',
            requestData: { sceneName: msg.sceneName },
          },
        });
        break;

      case 'TOGGLE_MUTE':
        sendToObs({
          op: 6,
          d: {
            requestType: 'ToggleInputMute',
            requestId: 'toggle_mute',
            requestData: { inputName: msg.inputName },
          },
        });
        break;

      default:
        console.log('Unknown message from browser:', msg.type);
    }
  }

  // ─── Cleanup when browser disconnects ─────────────────────────────────────
  browserSocket.on('close', () => {
    console.log('👋 Browser client disconnected');
    if (obsSocket) {
      obsSocket.close();
    }
  });

  // Auto-connect to OBS when browser connects
  connectToObs();
});

// ─── Start server ─────────────────────────────────────────────────────────────
server.listen(CONFIG.PORT, () => {
  console.log(`🚀 Dashboard running → http://localhost:${CONFIG.PORT}`);
  console.log('');
  console.log('📋 Make sure OBS Studio is:');
  console.log('   1. Open and running');
  console.log('   2. Tools → WebSocket Server Settings → Enable WebSocket server');
  console.log('   3. Default port: 4455');
  console.log('');
});
