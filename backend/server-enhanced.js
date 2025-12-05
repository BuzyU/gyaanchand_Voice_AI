// backend/server-enhanced.js - PRODUCTION with comprehensive logging
require("dotenv").config({ path: require('path').join(__dirname, '../.env') });
const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const path = require("path");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const fs = require("fs");

const routeRequest = require("./intelligentRouter");
const murfStreamSentences = require("./ttsStreamSentences");
const { handleAction } = require("./actionHandler");

const DEEPGRAM_KEY = process.env.DEEPGRAM_API_KEY;
if (!DEEPGRAM_KEY) {
  console.error("❌ DEEPGRAM_API_KEY not found");
  process.exit(1);
}

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, x-session-id");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".pdf", ".docx", ".doc"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and DOCX files allowed"));
    }
  }
});

const sessionData = new Map();

app.post("/upload", upload.single("document"), async (req, res) => {
  console.log("\n" + "=".repeat(70));
  console.log("📄 [DOCUMENT-UPLOAD] Request received");
  console.log("=".repeat(70));
  
  try {
    if (!req.file) {
      console.log("❌ [UPLOAD-ERROR] No file provided");
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }

    console.log(`📁 [FILE-INFO] Name: ${req.file.originalname}`);
    console.log(`📊 [FILE-INFO] Size: ${(req.file.size / 1024).toFixed(2)} KB`);
    console.log(`🏷️ [FILE-INFO] Type: ${req.file.mimetype}`);

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let documentText = "";

    const startTime = Date.now();

    if (ext === ".pdf") {
      console.log("🔍 [PDF-PARSER] Extracting content...");
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      documentText = pdfData.text;
      const elapsed = Date.now() - startTime;
      console.log(`✅ [PDF-PARSER] Success: ${pdfData.numpages} pages, ${documentText.length} chars in ${elapsed}ms`);
    } else if (ext === ".docx" || ext === ".doc") {
      console.log("🔍 [DOCX-PARSER] Extracting content...");
      const result = await mammoth.extractRawText({ path: filePath });
      documentText = result.value;
      const elapsed = Date.now() - startTime;
      console.log(`✅ [DOCX-PARSER] Success: ${documentText.length} chars in ${elapsed}ms`);
    }

    const sessionId = req.headers["x-session-id"] || "default";
    
    // Store in sessions
    let stored = 0;
    for (const [sid, session] of sessionData.entries()) {
      if (sid === sessionId || stored === 0) {
        session.document = {
          filename: req.file.originalname,
          content: documentText,
          uploadedAt: new Date()
        };
        console.log(`💾 [SESSION-STORE] Stored in session: ${sid}`);
        stored++;
      }
    }
    
    if (stored === 0) {
      sessionData.set(sessionId, { 
        document: {
          filename: req.file.originalname,
          content: documentText,
          uploadedAt: new Date()
        }, 
        voiceId: 'en-US-terrell' 
      });
      console.log(`💾 [SESSION-STORE] Created new session: ${sessionId}`);
    }

    fs.unlinkSync(filePath);
    console.log(`🗑️ [CLEANUP] Temporary file removed`);
    
    console.log("=".repeat(70) + "\n");

    res.json({
      success: true,
      filename: req.file.originalname,
      size: req.file.size,
      extracted: documentText.length
    });
  } catch (err) {
    console.error(`❌ [UPLOAD-CRITICAL] ${err.message}`);
    console.log("=".repeat(70) + "\n");
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date(), sessions: sessionData.size });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function openDeepgramSocket(clientWs, sessionId) {
  console.log("\n" + "=".repeat(70));
  console.log("🎙️ [DEEPGRAM-INIT] Starting ASR connection");
  console.log(`   Session: ${sessionId}`);
  console.log("=".repeat(70));
  
  const url =
    `wss://api.deepgram.com/v1/listen?` +
    `model=nova-2&` +
    `language=en-IN&` +
    `encoding=linear16&` +
    `sample_rate=16000&` +
    `channels=1&` +
    `punctuate=true&` +
    `interim_results=true&` +
    `endpointing=350&` +
    `vad_events=true`;

  const dgWs = new WebSocket(url, {
    headers: { Authorization: `Token ${DEEPGRAM_KEY}` },
  });

  let processingAudio = false;
  let isOpen = false;
  let keepAliveInterval = null;
  let transcriptTimeout = null;
  let currentTTSController = null;
  let audioChunksSent = 0;

  // Session memory
  let memory = {
    userName: null,
    lastUserMessages: [],
    lastBotMessages: []
  };

  const updateMemory = (userMsg, botMsg) => {
    if (userMsg) {
      memory.lastUserMessages.push(userMsg);
      if (memory.lastUserMessages.length > 4) memory.lastUserMessages.shift();
    }
    if (botMsg) {
      memory.lastBotMessages.push(botMsg);
      if (memory.lastBotMessages.length > 4) memory.lastBotMessages.shift();
    }

    try {
      clientWs.send(JSON.stringify({
        type: "memory_update",
        memory: {
          userName: memory.userName,
          history: memory.lastUserMessages.slice(-3).map((msg, i) => ({
            user: msg,
            assistant: memory.lastBotMessages[i] || ""
          }))
        }
      }));
    } catch (e) {}
  };

  dgWs.on("open", () => {
    isOpen = true;
    console.log("✅ [DEEPGRAM] WebSocket connected");
    console.log(`📡 [DEEPGRAM] Ready to receive audio\n`);
    
    clientWs.send(JSON.stringify({ type: "status", status: "Listening - Start speaking" }));

    keepAliveInterval = setInterval(() => {
      if (isOpen && dgWs.readyState === WebSocket.OPEN) {
        try { 
          dgWs.send(JSON.stringify({ type: "KeepAlive" }));
        } catch (err) {}
      }
    }, 5000);
  });

  dgWs.on("message", async (msg) => {
    if (!isOpen) return;
    
    try {
      const data = JSON.parse(msg.toString());

      if (data.type === "Results") {
        const channel = data.channel;
        if (!channel?.alternatives?.[0]) return;

        const transcript = channel.alternatives[0].transcript || "";
        const isFinal = data.is_final || false;
        const confidence = channel.alternatives[0].confidence || 0;

        // Interrupt handling
        if (processingAudio && !isFinal && transcript.length > 2) {
          console.log("\n⛔ [USER-INTERRUPT] Detected - Canceling TTS\n");
          
          if (currentTTSController) {
            currentTTSController.abort();
            currentTTSController = null;
          }
          
          try { 
            clientWs.send(JSON.stringify({ type: "stop_audio" })); 
          } catch (e) {}
          
          processingAudio = false;
        }

        if (confidence < 0.5 && transcript.length < 3) return;

        if (transcript?.trim()) {
          if (!isFinal) {
            clientWs.send(JSON.stringify({ type: "transcript", text: transcript, isFinal: false }));
            return;
          }

          if (isFinal && transcript.trim().length > 1) {
            console.log(`\n${'='.repeat(70)}`);
            console.log(`🎤 [SPEECH-RECOGNIZED]`);
            console.log(`   Text: "${transcript}"`);
            console.log(`   Confidence: ${(confidence * 100).toFixed(1)}%`);
            console.log(`   Final: ${isFinal}`);
            console.log(`${'='.repeat(70)}`);
            
            if (transcriptTimeout) clearTimeout(transcriptTimeout);

            clientWs.send(JSON.stringify({ type: "transcript", text: transcript, isFinal: true }));

            // Detect name
            const nameMatch = transcript.match(/(?:my name is|i am|i'm|call me)\s+([A-Za-z]+)/i);
            if (nameMatch && nameMatch[1].length > 2) {
              memory.userName = nameMatch[1];
              console.log(`👤 [MEMORY] User name detected: ${memory.userName}`);
            }

            const shouldProcess =
              data.speech_final ||
              transcript.length > 8 ||
              transcript.includes("?") ||
              confidence > 0.9;

            if (shouldProcess && !processingAudio) {
              transcriptTimeout = setTimeout(async () => {
                if (processingAudio) return;
                processingAudio = true;

                console.log(`\n⏳ [PROCESSING] Starting AI pipeline`);
                clientWs.send(JSON.stringify({ type: "status", status: "Thinking..." }));

                try {
                  // Build memory context
                  let memoryContext = "";
                  if (memory.userName) {
                    memoryContext += `User: ${memory.userName}\n`;
                  }
                  if (memory.lastUserMessages.length) {
                    const recent = memory.lastUserMessages.slice(-2).join(" | ");
                    memoryContext += `Recent: ${recent.substring(0, 150)}\n`;
                  }

                  // Get document
                  let documentContent = null;
                  const session = sessionData.get(sessionId);
                  
                  if (session?.document?.content) {
                    documentContent = session.document.content;
                    console.log(`📄 [DOCUMENT] Using uploaded document: ${session.document.filename}`);
                  }

                  // Check for action requests (email/calendar)
                  const actionResult = await handleAction(transcript, transcript);
                  
                  if (actionResult) {
                    console.log(`🎯 [ACTION] Action detected and processed`);
                    
                    clientWs.send(JSON.stringify({ 
                      type: "reply", 
                      text: actionResult.message
                    }));
                    clientWs.send(JSON.stringify({ type: "status", status: "Speaking..." }));

                    updateMemory(transcript, actionResult.message);

                    const voiceId = session?.voiceId || 'en-US-terrell';
                    currentTTSController = new AbortController();

                    await murfStreamSentences(actionResult.message, clientWs, { 
                      signal: currentTTSController.signal,
                      voiceId: voiceId
                    });
                    
                    currentTTSController = null;
                    processingAudio = false;
                    clientWs.send(JSON.stringify({ type: "status", status: "Listening..." }));
                    
                    console.log(`✅ [CYCLE] Action cycle complete\n`);
                    return;
                  }

                  // Start AI processing
                  currentTTSController = new AbortController();
                  
                  console.log(`🤖 [AI-REQUEST] Sending to intelligent router`);
                  const aiReply = await routeRequest(
                    transcript, 
                    memoryContext, 
                    documentContent,
                    currentTTSController.signal
                  );

                  console.log(`💬 [AI-REPLY] "${aiReply.substring(0, 100)}${aiReply.length > 100 ? '...' : ''}"`);
                  console.log(`📊 [AI-STATS] ${aiReply.length} chars | ${aiReply.split(' ').length} words`);

                  updateMemory(transcript, aiReply);

                  clientWs.send(JSON.stringify({ 
                    type: "reply", 
                    text: aiReply
                  }));
                  clientWs.send(JSON.stringify({ type: "status", status: "Speaking..." }));

                  const voiceId = session?.voiceId || 'en-US-terrell';

                  await murfStreamSentences(aiReply, clientWs, { 
                    signal: currentTTSController.signal,
                    voiceId: voiceId
                  });
                  
                  currentTTSController = null;

                  console.log(`✅ [CYCLE] Processing cycle complete\n`);
                  
                  clientWs.send(JSON.stringify({ type: "status", status: "Listening..." }));
                  processingAudio = false;
                  
                } catch (err) {
                  if (err.name === 'AbortError') {
                    console.log(`⛔ [ABORT] Request aborted by user\n`);
                  } else {
                    console.error(`❌ [PROCESSING-ERROR] ${err.message}`);
                    console.error(err.stack);
                    clientWs.send(JSON.stringify({ 
                      type: "error", 
                      message: "Processing error: " + err.message 
                    }));
                  }
                  clientWs.send(JSON.stringify({ type: "status", status: "Listening..." }));
                  processingAudio = false;
                  currentTTSController = null;
                }
              }, data.speech_final ? 100 : 400);
            }
          }
        }
      }
    } catch (e) {
      console.error(`❌ [DEEPGRAM-ERROR] Parse error: ${e.message}`);
    }
  });

  dgWs.on("close", (code) => {
    isOpen = false;
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    if (transcriptTimeout) clearTimeout(transcriptTimeout);
    console.log(`\n❌ [DEEPGRAM] Connection closed: Code ${code}`);
    console.log(`📊 [STATS] Audio chunks sent: ${audioChunksSent}\n`);
  });

  dgWs.on("error", (e) => {
    isOpen = false;
    console.error(`\n❌ [DEEPGRAM-ERROR] ${e.message}\n`);
  });

  return { 
    dgWs, 
    isOpen: () => isOpen, 
    cancelCurrentTTS: () => { 
      if (currentTTSController) {
        currentTTSController.abort(); 
        currentTTSController = null;
      }
    },
    incrementAudioChunks: () => { audioChunksSent++; }
  };
}

wss.on("connection", (ws) => {
  const sessionId = Math.random().toString(36).substring(7);
  console.log(`\n👤 [CLIENT-CONNECT] New connection [${sessionId}]\n`);
  
  if (!sessionData.has(sessionId)) {
    sessionData.set(sessionId, { document: null, voiceId: 'en-US-terrell' });
  }
  
  let dgConnection = null;

  ws.on("message", async (data, isBinary) => {
    if (isBinary && dgConnection?.isOpen()) {
      try {
        dgConnection.dgWs.send(Buffer.from(data));
        dgConnection.incrementAudioChunks();
      } catch (err) {
        console.error(`❌ [WS-ERROR] Audio forward failed: ${err.message}`);
      }
      return;
    }

    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.type === "start_live") {
        console.log(`🎙️ [CLIENT-REQUEST] Starting live transcription [${sessionId}]`);
        ws.send(JSON.stringify({ type: "status", status: "Connecting..." }));
        dgConnection = openDeepgramSocket(ws, sessionId);
      }

      if (msg.type === "stop_live") {
        console.log(`\n🛑 [CLIENT-REQUEST] Stopping live transcription [${sessionId}]\n`);
        if (dgConnection?.isOpen()) {
          try { dgConnection.dgWs.close(); } catch (e) {}
        }
        dgConnection = null;
        ws.send(JSON.stringify({ type: "status", status: "Stopped" }));
      }

      if (msg.type === "client_stop_tts") {
        console.log(`⛔ [CLIENT-REQUEST] Stop TTS [${sessionId}]`);
        if (dgConnection) dgConnection.cancelCurrentTTS();
        try { ws.send(JSON.stringify({ type: "stop_audio" })); } catch (e) {}
      }

      if (msg.type === "voice_change") {
        const session = sessionData.get(sessionId);
        if (session) {
          session.voiceId = msg.voice;
          console.log(`🎵 [VOICE-CHANGE] Updated to: ${msg.voice} [${sessionId}]`);
          ws.send(JSON.stringify({ type: "voice_changed", voice: msg.voice }));
        }
      }
    } catch (e) {}
  });

  ws.on("close", () => {
    console.log(`\n👋 [CLIENT-DISCONNECT] Session ended [${sessionId}]\n`);
    if (dgConnection?.isOpen()) {
      try { dgConnection.dgWs.close(); } catch (e) {}
    }
    setTimeout(() => {
      sessionData.delete(sessionId);
      console.log(`🗑️ [CLEANUP] Session ${sessionId} removed from memory`);
    }, 5 * 60 * 1000);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log("\n" + "=".repeat(70));
  console.log("🚀 Gyaanchand - Production Voice AI Assistant");
  console.log("=".repeat(70));
  console.log(`📡 WebSocket Server: ws://localhost:${PORT}`);
  console.log(`📤 Document Upload: http://localhost:${PORT}/upload`);
  console.log(`💚 Health Check: http://localhost:${PORT}/health`);
  console.log(`\n🎙️ TECHNOLOGY STACK:`);
  console.log(`   • Creator: Umer Zingu`);
  console.log(`   • ASR: Deepgram Nova-2 (Best-in-class speech recognition)`);
  console.log(`   • TTS: Murf AI (Fastest, most efficient text-to-speech)`);
  console.log(`   • AI: Google Gemini 1.5 Flash/Pro + Groq Llama 3.3 70B`);
  console.log(`\n⚡ FEATURES:`);
  console.log(`   • Smart response caching (5min TTL)`);
  console.log(`   • Compact memory context`);
  console.log(`   • Smooth voice transitions`);
  console.log(`   • Interrupt handling`);
  console.log(`   • Document analysis (PDF/DOCX)`);
  console.log(`   • Gmail integration`);
  console.log(`   • Google Calendar integration`);
  console.log(`   • 9 natural voices`);
  console.log("=".repeat(70) + "\n");
});