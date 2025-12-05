// app.js - UPDATED: Enhanced memory display with location and date
const WS_URL = window.location.hostname === 'localhost' 
  ? 'ws://localhost:5000' 
  : `wss://${window.location.hostname}`;

let ws = null;
let audioContext = null;
let micContext = null;
let audioWorkletNode = null;
let mediaStream = null;
let isLive = false;
let isConnected = false;
let selectedVoice = 'en-US-terrell';
let sessionId = null;

// Audio playback queue
let audioQueue = [];
let isPlaying = false;

// DOM elements
const statusBar = document.getElementById('statusBar');
const statusText = document.getElementById('statusText');
const liveBtn = document.getElementById('liveBtn');
const btnIcon = document.getElementById('btnIcon');
const btnText = document.getElementById('btnText');
const transcriptArea = document.getElementById('transcriptArea');
const replyArea = document.getElementById('replyArea');
const memoryArea = document.getElementById('memoryArea');
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const voiceSelector = document.getElementById('voiceSelector');

console.log('🚀 Gyaanchand Voice AI - Initializing');

// Initialize session ID
function initSessionId() {
  sessionId = sessionStorage.getItem('sessionId');
  if (!sessionId) {
    sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(7);
    sessionStorage.setItem('sessionId', sessionId);
  }
  console.log('🔑 Session ID:', sessionId);
  return sessionId;
}

// Voice selection handler
voiceSelector.onchange = (e) => {
  selectedVoice = e.target.value;
  const voiceName = voiceSelector.options[voiceSelector.selectedIndex].text;
  
  console.log('🎵 Voice changed to:', selectedVoice);
  
  voiceSelector.style.transform = 'scale(1.05)';
  setTimeout(() => {
    voiceSelector.style.transform = 'scale(1)';
  }, 200);
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ 
      type: 'voice_change', 
      voice: selectedVoice,
      sessionId: sessionId
    }));
  }
  
  const originalHTML = statusText.innerHTML;
  updateStatus(`🎵 Voice: ${voiceName}`, 'connected');
  
  setTimeout(() => {
    if (!isLive) {
      statusText.innerHTML = originalHTML;
    }
  }, 2500);
};

// Initialize WebSocket connection
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 2000;

function connectWebSocket() {
  ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    isConnected = true;
    liveBtn.disabled = false;
    reconnectAttempts = 0;

    ws.send(JSON.stringify({
      type: "handshake",
      sessionId,
      voice: selectedVoice
    }));

    updateStatus("✅ Connected - Ready to start", "connected");
    console.log("✅ WebSocket connected");
  };

  ws.onclose = () => {
    isConnected = false;
    liveBtn.disabled = true;
    console.log('❌ Disconnected');
    
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      const delay = RECONNECT_DELAY * reconnectAttempts;
      updateStatus(`🔄 Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`, '');
      
      setTimeout(() => {
        if (!isConnected) {
          console.log(`🔄 Reconnection attempt ${reconnectAttempts}`);
          connectWebSocket();
        }
      }, delay);
    } else {
      updateStatus('❌ Connection failed. Refresh page.', 'error');
    }
  };

  ws.onerror = (e) => {
    console.error('❌ WebSocket error:', e);
    updateStatus('⚠️ Connection error', 'error');
  };

  ws.onmessage = async (evt) => {
    if (typeof evt.data === "string") {
      const msg = JSON.parse(evt.data);
      handleMessage(msg);
    } else {
      await handleAudioData(evt.data);
    }
  };
}

// Handle JSON messages
function handleMessage(msg) {
  switch (msg.type) {
    case 'status':
      const statusClass = getStatusClass(msg.status);
      updateStatus(msg.status, statusClass);
      break;

    case 'transcript':
      displayTranscript(msg.text, msg.isFinal);
      break;

    case 'reply':
      displayReply(msg.text, msg.route);
      break;

    case 'memory_update':
      displayMemory(msg.memory);
      break;

    case 'stop_audio':
      stopAudio();
      break;

    case 'tts_end':
      console.log('🎵 TTS complete');
      break;

    case 'error':
      console.error('❌ Server error:', msg.message);
      
      let userMessage = msg.message;
      if (msg.message.includes('Deepgram')) {
        userMessage = 'Speech recognition error. Please try again.';
      } else if (msg.message.includes('Murf') || msg.message.includes('TTS')) {
        userMessage = 'Voice synthesis error. Please try again.';
      } else if (msg.message.includes('session')) {
        userMessage = 'Session error. Please refresh the page.';
      }
      
      updateStatus('❌ ' + userMessage, 'error');
      break;
      
    case 'voice_changed':
      console.log('✅ Voice confirmed:', msg.voice);
      break;
      
    case 'session_confirmed':
      console.log('✅ Session confirmed:', msg.sessionId);
      break;
  }
}

// Handle audio data
async function handleAudioData(data) {
  try {
    const arrayBuffer = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
    console.log(`📥 Audio: ${(arrayBuffer.byteLength / 1024).toFixed(1)}KB`);
    audioQueue.push(arrayBuffer);
    processAudioQueue();
  } catch (err) {
    console.error('❌ Audio receive error:', err);
  }
}

// Process audio queue
let queueLock = false;

async function processAudioQueue() {
  if (queueLock || audioQueue.length === 0) return;

  queueLock = true;
  isPlaying = true;

  try {
    while (audioQueue.length > 0) {
      const audioData = audioQueue.shift();
      try {
        await playAudioChunk(audioData);
      } catch (err) {
        console.error("❌ Playback error:", err);
      }
    }
  } finally {
    isPlaying = false;
    queueLock = false;
  }
}

// Play audio chunk
async function playAudioChunk(arrayBuffer) {
  try {
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioContext.state === 'suspended') {
      console.log('⏸️ Resuming AudioContext...');
      await audioContext.resume();
    }

    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);

    return new Promise((resolve, reject) => {
      source.onended = resolve;
      source.onerror = reject;
      source.start(0);
    });
  } catch (err) {
    console.error('❌ Playback error:', err);
    throw err;
  }
}

// Stop audio
function stopAudio() {
  audioQueue = [];
  isPlaying = false;
  console.log('🛑 Audio queue cleared');
}

// Improved microphone cleanup
async function cleanupMicrophone() {
  console.log('🧹 Cleaning up microphone...');
  
  // Stop AudioWorklet
  if (audioWorkletNode) {
    try {
      audioWorkletNode.port.onmessage = null;
      audioWorkletNode.disconnect();
    } catch (e) {
      console.log('⚠️ AudioWorklet cleanup warning:', e);
    }
    audioWorkletNode = null;
  }

  // Close AudioContext
  if (micContext && micContext.state !== 'closed') {
    try {
      await micContext.close();
    } catch (e) {
      console.log('⚠️ AudioContext close warning:', e);
    }
    micContext = null;
  }

  // Stop media tracks
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => {
      track.stop();
      console.log('🛑 Track stopped:', track.label);
    });
    mediaStream = null;
  }
  
  console.log('✅ Microphone cleanup complete');
}

// Start live recording
async function startLive() {
  try {
    console.log('🎤 Requesting microphone...');
    updateStatus('🎤 Requesting microphone...', 'thinking');
    
    await cleanupMicrophone();
    
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 16000
      }
    });

    console.log('✅ Microphone granted');

    micContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000
    });

    console.log(`🎵 AudioContext: ${micContext.sampleRate}Hz`);

    const audioProcessorCode = `
class AudioProcessor extends AudioWorkletProcessor {
  float32ToInt16(float32Array) {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      let val = Math.max(-1, Math.min(1, float32Array[i]));
      int16[i] = val < 0 ? val * 0x8000 : val * 0x7FFF;
    }
    return int16;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0]) {
      const pcmData = this.float32ToInt16(input[0]);
      this.port.postMessage({ audio: pcmData.buffer }, [pcmData.buffer]);
    }
    return true;
  }
}
registerProcessor('audio-processor', AudioProcessor);
`;

    const blob = new Blob([audioProcessorCode], { type: 'application/javascript' });
    const blobURL = URL.createObjectURL(blob);

    try {
      await micContext.audioWorklet.addModule(blobURL);
      console.log('✅ AudioWorklet loaded');
    } catch (err) {
      console.error('❌ AudioWorklet failed:', err);
      URL.revokeObjectURL(blobURL);
      throw err;
    }

    URL.revokeObjectURL(blobURL);

    audioWorkletNode = new AudioWorkletNode(micContext, 'audio-processor');
    
    let chunkCount = 0;
    audioWorkletNode.port.onmessage = (event) => {
      if (!isLive || !ws || ws.readyState !== WebSocket.OPEN) return;
      
      try {
        ws.send(event.data.audio);
        chunkCount++;
        if (chunkCount % 100 === 0) {
          console.log(`📤 ${chunkCount} chunks sent`);
        }
      } catch (err) {
        console.error('❌ Send error:', err);
      }
    };

    const source = micContext.createMediaStreamSource(mediaStream);
    source.connect(audioWorkletNode);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ 
        type: 'start_live',
        sessionId: sessionId
      }));
    }

    isLive = true;
    btnIcon.textContent = '🛑';
    btnText.textContent = 'Stop';
    liveBtn.className = 'btn-main btn-stop';
    
    liveBtn.style.transform = 'scale(1.1)';
    setTimeout(() => {
      liveBtn.style.transform = 'scale(1)';
    }, 200);

    console.log('✅ Live recording started');

  } catch (err) {
    console.error('❌ Microphone error:', err);
    updateStatus('❌ Microphone access denied', 'error');
    alert('Microphone access required: ' + err.message);
    
    await cleanupMicrophone();
  }
}

// Stop live recording
async function stopLive() {
  console.log('🛑 Stopping...');
  updateStatus('🛑 Stopping...', 'thinking');
  
  isLive = false;

  await cleanupMicrophone();
  
  stopAudio();

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'stop_live' }));
  }

  btnIcon.textContent = '🎤';
  btnText.textContent = 'Start Live';
  liveBtn.className = 'btn-main btn-start';
  
  liveBtn.style.transform = 'scale(1.1)';
  setTimeout(() => {
    liveBtn.style.transform = 'scale(1)';
  }, 200);

  updateStatus('✅ Stopped - Ready to restart', 'connected');
  console.log('✅ Stopped');
}

// Toggle live recording
liveBtn.onclick = async () => {
  liveBtn.disabled = true;
  try {
    if (!isLive) {
      await startLive();
    } else {
      await stopLive();
    }
  } catch (err) {
    console.error('❌ Toggle error:', err);
    updateStatus('❌ Error: ' + err.message, 'error');
    await cleanupMicrophone();
  } finally {
    liveBtn.disabled = false;
  }
};

// File upload
fileInput.onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('document', file);

  try {
    updateStatus('📤 Uploading document...', 'thinking');
    
    const UPLOAD_URL = window.location.hostname === 'localhost'
      ? 'http://localhost:5000/upload'
      : `https://${window.location.hostname}/upload`;

    const response = await fetch(UPLOAD_URL, {
      method: 'POST',
      body: formData,
      headers: {
        'x-session-id': sessionId
      }
    });

    const result = await response.json();
    
    if (result.success) {
      fileInfo.innerHTML = `✅ ${file.name}<br><small>${Math.round(file.size / 1024)}KB • ${result.extracted} chars extracted</small>`;
      updateStatus('✅ Document ready!', 'connected');
      
      uploadZone.style.borderColor = '#34d399';
      setTimeout(() => {
        uploadZone.style.borderColor = '';
      }, 2000);
    } else {
      throw new Error(result.error || 'Upload failed');
    }
  } catch (err) {
    console.error('❌ Upload error:', err);
    updateStatus('❌ Upload failed', 'error');
    alert('Upload failed: ' + err.message);
  }
};

// Drag and drop
uploadZone.ondragover = (e) => {
  e.preventDefault();
  uploadZone.classList.add('dragging');
};

uploadZone.ondragleave = () => {
  uploadZone.classList.remove('dragging');
};

uploadZone.ondrop = (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragging');
  const file = e.dataTransfer.files[0];
  if (file) {
    fileInput.files = e.dataTransfer.files;
    fileInput.onchange({ target: fileInput });
  }
};

// Display functions
function displayTranscript(text, isFinal) {
  if (transcriptArea.querySelector('.empty-state')) {
    transcriptArea.innerHTML = '';
  }

  if (isFinal) {
    const interim = transcriptArea.querySelector('.interim');
    if (interim) interim.remove();

    const div = document.createElement('div');
    div.className = 'message final';
    div.innerHTML = `<strong>You:</strong> ${text}`;
    transcriptArea.insertBefore(div, transcriptArea.firstChild);
  } else {
    let interim = transcriptArea.querySelector('.interim');
    if (!interim) {
      interim = document.createElement('div');
      interim.className = 'message interim';
      transcriptArea.insertBefore(interim, transcriptArea.firstChild);
    }
    interim.innerHTML = `<strong>You:</strong> ${text}...`;
  }
}

function displayReply(text, route) {
  if (replyArea.querySelector('.empty-state')) {
    replyArea.innerHTML = '';
  }

  const div = document.createElement('div');
  div.className = 'message reply';
  div.innerHTML = `<strong>Gyaanchand:</strong><div style="margin-top: 8px;">${text}</div>`;
  replyArea.insertBefore(div, replyArea.firstChild);
}

// ✅ UPDATED: Enhanced memory display with location and date
function displayMemory(memory) {
  if (!memory || (!memory.userName && !memory.location && !memory.date && (!memory.history || memory.history.length === 0))) {
    memoryArea.innerHTML = '<div class="empty-state">Conversation memory will appear here...</div>';
    return;
  }

  let html = '';

  // Display user name
  if (memory.userName) {
    html += `<div class="memory-item">
      <div class="memory-label">👤 User</div>
      <div style="font-size: 1.1rem; font-weight: 600;">${memory.userName}</div>
    </div>`;
  }

  // Display location
  if (memory.location) {
    html += `<div class="memory-item">
      <div class="memory-label">📍 Location</div>
      <div style="font-size: 1rem; font-weight: 600; color: #00d4ff;">${memory.location}</div>
    </div>`;
  }

  // Display date
  if (memory.date) {
    html += `<div class="memory-item">
      <div class="memory-label">📅 Date</div>
      <div style="font-size: 0.95rem; color: #ccc;">${memory.date}</div>
    </div>`;
  }

  // Display recent conversation
  if (memory.history && memory.history.length > 0) {
    html += `<div class="memory-item">
      <div class="memory-label">💬 Recent</div>`;
    html += memory.history.slice(-3).map(h => 
      `<div style="font-size: 0.9rem; color: #ccc; margin: 6px 0;">• ${h.user?.substring(0, 50)}...</div>`
    ).join('');
    html += '</div>';
  }

  memoryArea.innerHTML = html;
}

function updateStatus(message, className) {
  const icons = {
    connected: '✅',
    listening: '👂',
    thinking: '🤔',
    speaking: '🗣️',
    error: '❌'
  };
  
  const icon = icons[className] || '⏳';
  statusText.innerHTML = `<span class="status-icon">${icon}</span><span>${message}</span>`;
  statusBar.className = 'status-bar ' + className;
}

function getStatusClass(status) {
  if (status.includes('Listening')) return 'listening';
  if (status.includes('Thinking')) return 'thinking';
  if (status.includes('Speaking')) return 'speaking';
  if (status.includes('Error')) return 'error';
  if (status.includes('Connected')) return 'connected';
  return '';
}

// Initialize
initSessionId();
connectWebSocket();
console.log('✅ App initialized');