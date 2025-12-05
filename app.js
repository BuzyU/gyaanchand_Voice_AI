// app.js - Optimized with functional voice toggle and better UX
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

// Voice selection handler with immediate feedback
voiceSelector.onchange = (e) => {
  selectedVoice = e.target.value;
  const voiceName = voiceSelector.options[voiceSelector.selectedIndex].text;
  
  console.log('🎵 Voice changed to:', selectedVoice);
  
  // Visual feedback with animation
  voiceSelector.style.transform = 'scale(1.05)';
  setTimeout(() => {
    voiceSelector.style.transform = 'scale(1)';
  }, 200);
  
  // Send to server if connected
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ 
      type: 'voice_change', 
      voice: selectedVoice 
    }));
  }
  
  // Show temporary confirmation
  const originalHTML = statusText.innerHTML;
  updateStatus(`🎵 Voice: ${voiceName}`, 'connected');
  
  setTimeout(() => {
    if (!isLive) {
      statusText.innerHTML = originalHTML;
    }
  }, 2500);
};

// Initialize WebSocket connection
function connectWebSocket() {
  ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    isConnected = true;
    updateStatus('✅ Connected - Ready to start', 'connected');
    liveBtn.disabled = false;
    console.log('✅ Connected to', WS_URL);
    
    // Send initial voice preference
    ws.send(JSON.stringify({ 
      type: 'voice_change', 
      voice: selectedVoice 
    }));
  };

  ws.onclose = () => {
    isConnected = false;
    updateStatus('❌ Disconnected - Reconnecting...', '');
    liveBtn.disabled = true;
    console.log('❌ Disconnected');
    
    // Auto-reconnect after 2 seconds
    setTimeout(() => {
      if (!isConnected) {
        console.log('🔄 Attempting reconnection...');
        connectWebSocket();
      }
    }, 2000);
  };

  ws.onerror = (e) => {
    console.error('❌ WebSocket error:', e);
    updateStatus('⚠️ Connection error', 'error');
  };

  ws.onmessage = async (evt) => {
    if (typeof evt.data === 'string') {
      try {
        const msg = JSON.parse(evt.data);
        handleMessage(msg);
      } catch (e) {
        console.error('❌ Parse error:', e);
      }
    } else {
      // Binary audio data
      await handleAudioData(evt.data);
    }
  };
}

// Handle JSON messages from server
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
      console.log('🎵 TTS stream complete');
      break;

    case 'error':
      console.error('❌ Server error:', msg.message);
      updateStatus('❌ Error: ' + msg.message, 'error');
      break;
      
    case 'voice_changed':
      console.log('✅ Server confirmed voice:', msg.voice);
      break;
  }
}

// Handle binary audio data
async function handleAudioData(data) {
  try {
    const arrayBuffer = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
    console.log(`📥 Audio chunk: ${(arrayBuffer.byteLength / 1024).toFixed(1)}KB`);
    audioQueue.push(arrayBuffer);
    processAudioQueue();
  } catch (err) {
    console.error('❌ Audio receive error:', err);
  }
}

// Process audio queue sequentially
async function processAudioQueue() {
  if (isPlaying || audioQueue.length === 0) return;

  isPlaying = true;

  while (audioQueue.length > 0) {
    const audioData = audioQueue.shift();
    try {
      await playAudioChunk(audioData);
    } catch (err) {
      console.error('❌ Playback error:', err);
    }
  }

  isPlaying = false;
}

// Play individual audio chunk
async function playAudioChunk(arrayBuffer) {
  try {
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);

    return new Promise((resolve) => {
      source.onended = () => {
        console.log(`✅ Played ${audioBuffer.duration.toFixed(2)}s`);
        resolve();
      };
      source.start(0);
    });
  } catch (err) {
    console.error('❌ Decode/play error:', err);
    throw err;
  }
}

// Stop audio playback
function stopAudio() {
  audioQueue = [];
  isPlaying = false;
  console.log('🛑 Audio queue cleared');
}

// Start live recording
async function startLive() {
  try {
    console.log('🎤 Requesting microphone...');
    updateStatus('🎤 Requesting microphone access...', 'thinking');
    
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

    // AudioWorklet processor
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
      ws.send(JSON.stringify({ type: 'start_live' }));
    }

    isLive = true;
    btnIcon.textContent = '🛑';
    btnText.textContent = 'Stop';
    liveBtn.className = 'btn-main btn-stop';
    
    // Animate button
    liveBtn.style.transform = 'scale(1.1)';
    setTimeout(() => {
      liveBtn.style.transform = 'scale(1)';
    }, 200);

    console.log('✅ Live recording started');

  } catch (err) {
    console.error('❌ Microphone error:', err);
    updateStatus('❌ Microphone access denied', 'error');
    alert('Microphone access required: ' + err.message);
  }
}

// Stop live recording
async function stopLive() {
  console.log('🛑 Stopping...');
  updateStatus('🛑 Stopping...', 'thinking');
  
  isLive = false;

  if (audioWorkletNode) {
    try {
      audioWorkletNode.disconnect();
      audioWorkletNode.port.onmessage = null;
    } catch (e) {}
    audioWorkletNode = null;
  }

  if (micContext && micContext.state !== 'closed') {
    try {
      await micContext.close();
    } catch (e) {}
    micContext = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  stopAudio();

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'stop_live' }));
  }

  btnIcon.textContent = '🎤';
  btnText.textContent = 'Start Live';
  liveBtn.className = 'btn-main btn-start';
  
  // Animate button
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
  if (!isLive) {
    await startLive();
  } else {
    await stopLive();
  }
  liveBtn.disabled = false;
};

// File upload handling
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
        'x-session-id': getSessionId()
      }
    });

    const result = await response.json();
    
    if (result.success) {
      fileInfo.innerHTML = `✅ ${file.name}<br><small>${Math.round(file.size / 1024)}KB • ${result.extracted} chars extracted</small>`;
      updateStatus('✅ Document ready - Ask me about it!', 'connected');
      console.log('✅ Document uploaded:', result);
      
      // Animate upload zone
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

// Session ID management
function getSessionId() {
  let sessionId = sessionStorage.getItem('sessionId');
  if (!sessionId) {
    sessionId = Math.random().toString(36).substring(7);
    sessionStorage.setItem('sessionId', sessionId);
  }
  return sessionId;
}

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

// Display transcript
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

// Display reply
function displayReply(text, route) {
  if (replyArea.querySelector('.empty-state')) {
    replyArea.innerHTML = '';
  }

  const div = document.createElement('div');
  div.className = 'message reply';
  div.innerHTML = `
    <strong>Gyaanchand:</strong>
    ${route ? `<span style="float: right; font-size: 0.75rem; color: #c084fc; background: rgba(168,85,247,0.1); padding: 3px 8px; border-radius: 8px;">${route}</span>` : ''}
    <div style="margin-top: 8px;">${text}</div>
  `;
  replyArea.insertBefore(div, replyArea.firstChild);
}

// Display memory
function displayMemory(memory) {
  if (!memory || (!memory.userName && !memory.topic && (!memory.history || memory.history.length === 0))) {
    memoryArea.innerHTML = '<div class="empty-state">Gyaanchand will remember your conversation...</div>';
    return;
  }

  let html = '';

  if (memory.userName) {
    html += `
      <div class="memory-item">
        <div class="memory-label">👤 User Name</div>
        <div style="font-size: 1.1rem; font-weight: 600;">${memory.userName}</div>
      </div>
    `;
  }

  if (memory.topic) {
    html += `
      <div class="memory-item">
        <div class="memory-label">💡 Current Topic</div>
        <div>${memory.topic}</div>
      </div>
    `;
  }

  if (memory.history && memory.history.length > 0) {
    html += `
      <div class="memory-item">
        <div class="memory-label">💬 Recent Context</div>
        <div style="font-size: 0.9rem; color: #ccc; line-height: 1.6;">
          ${memory.history.slice(-4).map(h => `<div style="margin: 6px 0;">• ${h.user?.substring(0, 50)}${h.user?.length > 50 ? '...' : ''}</div>`).join('')}
        </div>
      </div>
    `;
  }

  memoryArea.innerHTML = html;
}

// Update status with icon
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

// Get status class
function getStatusClass(status) {
  if (status.includes('Listening')) return 'listening';
  if (status.includes('Thinking')) return 'thinking';
  if (status.includes('Speaking')) return 'speaking';
  if (status.includes('Error') || status.includes('failed')) return 'error';
  if (status.includes('Connected') || status.includes('Ready')) return 'connected';
  return '';
}

// Initialize
connectWebSocket();
console.log('✅ App initialized - Voice:', selectedVoice);