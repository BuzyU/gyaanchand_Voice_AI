// backend/server-enhanced.js - FIXED: Memory with location/date + Better interrupts
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
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
app.use(express.static(path.join(__dirname, "..")));

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
  },
});

// Session management with enhanced memory
const sessionData = new Map();

function getOrCreateSession(sessionId) {
  if (!sessionData.has(sessionId)) {
    sessionData.set(sessionId, {
      document: null,
      voiceId: "en-US-terrell",
      memory: {
        userName: null,
        location: null,
        date: new Date().toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        }),
        lastUserMessages: [],
        lastBotMessages: [],
      },
      createdAt: Date.now(),
      lastActivity: Date.now(),
    });
    console.log(`🆕 [SESSION] Created: ${sessionId}`);
  } else {
    sessionData.get(sessionId).lastActivity = Date.now();
  }
  return sessionData.get(sessionId);
}

app.post("/upload", upload.single("document"), async (req, res) => {
  console.log("\n" + "=".repeat(70));
  console.log("📄 [UPLOAD] Request received");

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }

    console.log(`📁 [FILE] ${req.file.originalname} (${(req.file.size / 1024).toFixed(2)} KB)`);

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let documentText = "";

    const startTime = Date.now();

    if (ext === ".pdf") {
      console.log("📖 [PDF] Parsing...");
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      documentText = pdfData.text;
      console.log(`✅ [PDF] ${pdfData.numpages} pages, ${documentText.length} chars (${Date.now() - startTime}ms)`);
    } else if (ext === ".docx" || ext === ".doc") {
      console.log("📝 [DOCX] Parsing...");
      const result = await mammoth.extractRawText({ path: filePath });
      documentText = result.value;
      console.log(`✅ [DOCX] ${documentText.length} chars (${Date.now() - startTime}ms)`);
    }

    const sessionId = req.headers["x-session-id"];
    if (!sessionId) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        success: false,
        error: "Session ID required",
      });
    }

    const session = getOrCreateSession(sessionId);
    session.document = {
      filename: req.file.originalname,
      content: documentText,
      uploadedAt: new Date().toISOString(),
      size: req.file.size,
    };

    console.log(`💾 [SESSION] Document stored: ${sessionId}`);
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      filename: req.file.originalname,
      size: req.file.size,
      extracted: documentText.length,
      sessionId: sessionId,
    });

    console.log("=".repeat(70) + "\n");

  } catch (err) {
    console.error(`❌ [UPLOAD] ${err.message}`);

    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {}
    }

    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/health", (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    status: "ok",
    timestamp: new Date(),
    uptime: process.uptime(),
    sessions: sessionData.size,
    memory: {
      heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`,
    },
  });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function extractLocation(text) {
  const locationPatterns = [
    /(?:in|at|for)\s+([A-Z][a-zA-Z\s]+?)(?:\s+city)?(?:\?|$|,|\s+what|\s+how)/i,
    /(?:weather|temperature|forecast)\s+(?:in|at|for)\s+([A-Z][a-zA-Z\s]+)/i,
    /(?:city|location|place)\s+(?:is|:)\s+([A-Z][a-zA-Z\s]+)/i
  ];

  for (const pattern of locationPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const location = match[1].trim();
      if (location.length > 2 && location.length < 30) {
        return location;
      }
    }
  }
  
  return null;
}

function openDeepgramSocket(clientWs, sessionId) {
  console.log("\n" + "=".repeat(70));
  console.log("🎙️ [DEEPGRAM] Starting ASR");
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
    `endpointing=250&` +
    `vad_events=true&` +
    `smart_format=true`;

  const dgWs = new WebSocket(url, {
    headers: { Authorization: `Token ${DEEPGRAM_KEY}` },
  });

  let processingAudio = false;
  let isOpen = false;
  let keepAliveInterval = null;
  let transcriptTimeout = null;
  let currentTTSController = null;
  
  // Get session memory
  const session = getOrCreateSession(sessionId);
  const memory = session.memory;

  const updateMemory = (userMsg, botMsg) => {
    if (userMsg) {
      memory.lastUserMessages.push(userMsg);
      if (memory.lastUserMessages.length > 4) memory.lastUserMessages.shift();
      
      // Extract and save location
      const location = extractLocation(userMsg);
      if (location) {
        memory.location = location;
        console.log(`📍 [MEMORY] Location saved: ${location}`);
      }
    }
    
    if (botMsg) {
      memory.lastBotMessages.push(botMsg);
      if (memory.lastBotMessages.length > 4) memory.lastBotMessages.shift();
    }

    try {
      clientWs.send(
        JSON.stringify({
          type: "memory_update",
          memory: {
            userName: memory.userName,
            location: memory.location,
            date: memory.date,
            history: memory.lastUserMessages.slice(-3).map((msg, i) => ({
              user: msg,
              assistant: memory.lastBotMessages[i] || "",
            })),
          },
        })
      );
    } catch (e) {}
  };

  dgWs.on("open", () => {
    isOpen = true;
    console.log("✅ [DEEPGRAM] Connected");
    clientWs.send(JSON.stringify({ type: "status", status: "Listening..." }));

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

        // ✅ IMPROVED: Better interrupt handling
        if (processingAudio && !isFinal && transcript.length > 3) {
          console.log("\n⛔ [INTERRUPT] User speaking detected\n");

          // Cancel current TTS
          if (currentTTSController) {
            console.log("🛑 [INTERRUPT] Aborting TTS");
            currentTTSController.abort();
            currentTTSController = null;
          }

          // Stop audio playback on client
          try {
            clientWs.send(JSON.stringify({ type: "stop_audio" }));
          } catch (e) {}

          processingAudio = false;
          
          // Clear any pending transcript timeout
          if (transcriptTimeout) {
            clearTimeout(transcriptTimeout);
            transcriptTimeout = null;
          }
        }

        if (confidence < 0.5 && transcript.length < 3) return;

        if (transcript?.trim()) {
          if (!isFinal) {
            clientWs.send(
              JSON.stringify({
                type: "transcript",
                text: transcript,
                isFinal: false,
              })
            );
            return;
          }

          if (isFinal && transcript.trim().length > 1) {
            console.log(`\n🎤 [SPEECH] "${transcript}" (${(confidence * 100).toFixed(1)}%)`);

            if (transcriptTimeout) clearTimeout(transcriptTimeout);

            clientWs.send(
              JSON.stringify({
                type: "transcript",
                text: transcript,
                isFinal: true,
              })
            );

            // Detect name
            const nameMatch = transcript.match(
              /(?:my name is|i am|i'm|call me)\s+([A-Za-z]+)/i
            );
            if (nameMatch && nameMatch[1].length > 2) {
              memory.userName = nameMatch[1];
              console.log(`👤 [MEMORY] Name: ${memory.userName}`);
            }

            const shouldProcess =
              data.speech_final ||
              transcript.length > 8 ||
              transcript.includes("?") ||
              confidence > 0.9;

            if (shouldProcess && !processingAudio) {
              transcriptTimeout = setTimeout(
                async () => {
                  if (processingAudio) return;
                  processingAudio = true;

                  console.log(`\n⏳ [PROCESSING] Starting AI pipeline`);
                  clientWs.send(
                    JSON.stringify({ type: "status", status: "Thinking..." })
                  );

                  try {
                    // Build memory context with location and date
                    let memoryContext = "";
                    if (memory.userName) {
                      memoryContext += `User: ${memory.userName}\n`;
                    }
                    if (memory.location) {
                      memoryContext += `Location: ${memory.location}\n`;
                    }
                    if (memory.date) {
                      memoryContext += `Date: ${memory.date}\n`;
                    }
                    if (memory.lastUserMessages.length) {
                      const recent = memory.lastUserMessages.slice(-2).join(" | ");
                      memoryContext += `Recent: ${recent.substring(0, 150)}\n`;
                    }

                    let documentContent = null;
                    if (session?.document?.content) {
                      documentContent = session.document.content;
                      console.log(`📄 [DOCUMENT] Using: ${session.document.filename}`);
                    }

                    currentTTSController = new AbortController();

                    const aiReply = await routeRequest(
                      transcript,
                      memoryContext,
                      documentContent,
                      currentTTSController.signal
                    );

                    console.log(`💬 [AI] ${aiReply.length} chars`);

                    updateMemory(transcript, aiReply);

                    clientWs.send(
                      JSON.stringify({
                        type: "reply",
                        text: aiReply,
                      })
                    );
                    clientWs.send(
                      JSON.stringify({ type: "status", status: "Speaking..." })
                    );

                    const voiceId = session?.voiceId || "en-US-terrell";

                    await murfStreamSentences(aiReply, clientWs, {
                      signal: currentTTSController.signal,
                      voiceId: voiceId,
                    });

                    currentTTSController = null;

                    console.log(`✅ [CYCLE] Complete\n`);

                    clientWs.send(
                      JSON.stringify({ type: "status", status: "Listening..." })
                    );
                    processingAudio = false;
                  } catch (err) {
                    if (err.name === "AbortError") {
                      console.log(`⛔ [ABORT] Interrupted by user\n`);
                    } else {
                      console.error(`❌ [ERROR] ${err.message}`);
                      clientWs.send(
                        JSON.stringify({
                          type: "error",
                          message: "Processing error",
                        })
                      );
                    }
                    clientWs.send(
                      JSON.stringify({ type: "status", status: "Listening..." })
                    );
                    processingAudio = false;
                    currentTTSController = null;
                  }
                },
                data.speech_final ? 50 : 200
              );
            }
          }
        }
      }
    } catch (e) {
      console.error(`❌ [DEEPGRAM] ${e.message}`);
    }
  });

  dgWs.on("close", (code) => {
    isOpen = false;
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    if (transcriptTimeout) clearTimeout(transcriptTimeout);
    console.log(`\n❌ [DEEPGRAM] Closed: ${code}\n`);
  });

  dgWs.on("error", (e) => {
    isOpen = false;
    console.error(`\n❌ [DEEPGRAM] ${e.message}\n`);
  });

  return {
    dgWs,
    isOpen: () => isOpen,
    cancelCurrentTTS: () => {
      if (currentTTSController) {
        console.log("🛑 [MANUAL-STOP] Canceling TTS");
        currentTTSController.abort();
        currentTTSController = null;
      }
    },
  };
}

wss.on("connection", (ws) => {
  let sessionId = null;
  let dgConnection = null;

  console.log(`\n👤 [CLIENT] Connected\n`);

  ws.on("message", async (data, isBinary) => {
    if (isBinary && dgConnection?.isOpen()) {
      try {
        dgConnection.dgWs.send(Buffer.from(data));
      } catch (err) {}
      return;
    }

    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "handshake") {
        sessionId = msg.sessionId;
        getOrCreateSession(sessionId);
        console.log(`🤝 [HANDSHAKE] ${sessionId}`);

        if (msg.voice) {
          const session = sessionData.get(sessionId);
          if (session) {
            session.voiceId = msg.voice;
          }
        }

        ws.send(
          JSON.stringify({
            type: "session_confirmed",
            sessionId: sessionId,
          })
        );
        return;
      }

      if (msg.type === "start_live") {
        if (msg.sessionId) {
          sessionId = msg.sessionId;
        }

        if (!sessionId) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "No session ID",
            })
          );
          return;
        }

        console.log(`🎙️ [START] ${sessionId}`);
        ws.send(JSON.stringify({ type: "status", status: "Connecting..." }));
        dgConnection = openDeepgramSocket(ws, sessionId);
      }

      if (msg.type === "stop_live") {
        console.log(`\n🛑 [STOP] ${sessionId}\n`);
        if (dgConnection?.isOpen()) {
          try {
            dgConnection.cancelCurrentTTS();
            dgConnection.dgWs.close();
          } catch (e) {}
        }
        dgConnection = null;
        ws.send(JSON.stringify({ type: "status", status: "Stopped" }));
      }

      if (msg.type === "client_stop_tts") {
        console.log(`⛔ [STOP-TTS] ${sessionId}`);
        if (dgConnection) {
          dgConnection.cancelCurrentTTS();
        }
        try {
          ws.send(JSON.stringify({ type: "stop_audio" }));
        } catch (e) {}
      }

      if (msg.type === "voice_change") {
        const sid = msg.sessionId || sessionId;
        if (sid) {
          const session = getOrCreateSession(sid);
          session.voiceId = msg.voice;
          console.log(`🎵 [VOICE] ${msg.voice}`);
          ws.send(JSON.stringify({ type: "voice_changed", voice: msg.voice }));
        }
      }
    } catch (e) {}
  });

  ws.on("close", () => {
    console.log(`\n👋 [CLIENT] Disconnected: ${sessionId || "unknown"}\n`);

    if (dgConnection) {
      if (dgConnection.isOpen()) {
        try {
          dgConnection.cancelCurrentTTS();
          dgConnection.dgWs.close();
        } catch (e) {}
      }
      dgConnection = null;
    }

    if (sessionId) {
      setTimeout(() => {
        if (sessionData.has(sessionId)) {
          const session = sessionData.get(sessionId);
          if (Date.now() - session.lastActivity > 5 * 60 * 1000) {
            sessionData.delete(sessionId);
            console.log(`🗑️ [CLEANUP] ${sessionId}`);
          }
        }
      }, 5 * 60 * 1000);
    }
  });
});

// Cleanup old sessions
setInterval(() => {
  const now = Date.now();
  const timeout = 30 * 60 * 1000;
  let cleaned = 0;

  for (const [sessionId, session] of sessionData.entries()) {
    if (now - session.lastActivity > timeout) {
      sessionData.delete(sessionId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`🧹 [CLEANUP] Removed ${cleaned} sessions`);
  }
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log("\n" + "=".repeat(70));
  console.log("🚀 Gyaanchand Voice AI");
  console.log("=".repeat(70));
  console.log(`📡 WebSocket: ws://localhost:${PORT}`);
  console.log(`📤 Upload: http://localhost:${PORT}/upload`);
  console.log(`💚 Health: http://localhost:${PORT}/health`);
  console.log(`\n🎙️ STACK:`);
  console.log(`   • Creator: Umer Zingu`);
  console.log(`   • ASR: Deepgram Nova-2`);
  console.log(`   • TTS: Murf AI`);
  console.log(`   • AI: Gemini 1.5 + Groq Llama 3.3`);
  console.log("=".repeat(70) + "\n");
});

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`\n📴 [SHUTDOWN] ${signal}`);
  
  wss.close(() => {
    console.log("✅ WebSocket closed");
  });

  server.close(() => {
    console.log("✅ Server closed");
    sessionData.clear();
    process.exit(0);
  });

  setTimeout(() => {
    console.error("⚠️ Forced shutdown");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));