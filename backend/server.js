// backend/server.js — Groq-primary pipeline, safe interrupts, improved logging
require("dotenv").config({ path: __dirname + "/.env" });
const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const path = require("path");

const getAIResponse = require("./llm");
const murfStreamSentences = require("./ttsStreamSentences");

const DEEPGRAM_KEY = process.env.DEEPGRAM_API_KEY;
if (!DEEPGRAM_KEY) {
  console.error("❌ DEEPGRAM_API_KEY not found in .env");
  process.exit(1);
}

const app = express();
app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function openDeepgramSocket(clientWs) {
  const url =
    `wss://api.deepgram.com/v1/listen?` +
    `model=nova-2&` +
    `language=en-IN&` +
    `encoding=linear16&` +
    `sample_rate=16000&` +
    `channels=1`;

  console.log("🔗 Connecting to Deepgram with URL:", url.substring(0, 120) + "...");

  const dgWs = new WebSocket(url, {
    headers: { Authorization: `Token ${DEEPGRAM_KEY}` },
  });

  let processingAudio = false;
  let isOpen = false;
  let keepAliveInterval = null;
  let lastTranscript = "";
  let transcriptTimeout = null;

  // Keep a place to cancel current TTS when interrupted
  let currentTTSController = null;

  dgWs.on("open", () => {
    isOpen = true;
    console.log("✅ Deepgram connected (nova-2, en-IN, enhanced settings)");
    clientWs.send(JSON.stringify({ type: "status", status: "Listening - Start speaking" }));

    keepAliveInterval = setInterval(() => {
      if (isOpen && dgWs.readyState === WebSocket.OPEN) {
        try { dgWs.send(JSON.stringify({ type: "KeepAlive" })); } catch (err) { console.error("❌ Keepalive error:", err.message); }
      }
    }, 5000);
  });

  dgWs.on("message", async (msg) => {
    if (!isOpen) return;
    try {
      const data = JSON.parse(msg.toString());

      if (data.type === "Results") {
        const channel = data.channel;
        if (!channel || !channel.alternatives || channel.alternatives.length === 0) return;

        const transcript = channel.alternatives[0].transcript || "";
        const isFinal = data.is_final || false;
        const speechFinal = data.speech_final || false;
        const confidence = channel.alternatives[0].confidence || 0;

        // INTERRUPT HANDLING — safe placement (uses transcript & isFinal that exist)
        if (processingAudio && !isFinal && transcript.length > 3) {
          console.log("⛔ USER INTERRUPTED — stopping current TTS");
          // Cancel ongoing TTS generation/stream
          try {
            if (currentTTSController) currentTTSController.abort();
          } catch (e) {}
          // notify client to stop playback
          try { clientWs.send(JSON.stringify({ type: "stop_audio" })); } catch(e){}
          processingAudio = false;
        }

        // Ignore very low confidence tiny fragments
        if (confidence < 0.5 && transcript.length < 3) return;

        if (transcript && transcript.trim()) {
          if (!isFinal) {
            // interim
            clientWs.send(JSON.stringify({ type: "transcript", text: transcript, isFinal: false }));
            return;
          }

          // final transcripts
          if (isFinal && transcript.trim().length > 1) {
            console.log(`✅ FINAL: "${transcript}" (confidence: ${confidence.toFixed(2)})`);
            if (transcriptTimeout) { clearTimeout(transcriptTimeout); }

            clientWs.send(JSON.stringify({ type: "transcript", text: transcript, isFinal: true }));

            const shouldProcess =
              speechFinal ||
              transcript.length > 10 ||
              transcript.includes("?") ||
              transcript.includes(".") ||
              confidence > 0.9;

            if (shouldProcess && !processingAudio) {
              // small debounce to catch immediate trailing speech
              transcriptTimeout = setTimeout(async () => {
                if (processingAudio) return;
                processingAudio = true;
                lastTranscript = transcript;

                console.log("🤖 Sending to LLM:", transcript);
                clientWs.send(JSON.stringify({ type: "status", status: "Thinking..." }));

                try {
                  let aiReply = await getAIResponse(transcript);

                  // conversational smoothing (but remove fragile intros for TTS)
                  const conversationalize = require("./voiceStyle");
                  aiReply = conversationalize(aiReply);
                  aiReply = aiReply
                    .replace(/Hmm…/g, "")
                    .replace(/Sure,.*?\./, "")
                    .replace(/Alright,.*?\./, "")
                    .trim();

                  console.log("💬 AI replied:", aiReply);
                  clientWs.send(JSON.stringify({ type: "reply", text: aiReply }));
                  clientWs.send(JSON.stringify({ type: "status", status: "Speaking..." }));

                  // create abort controller for this TTS job
                  currentTTSController = new AbortController();
                  await murfStreamSentences(aiReply, clientWs, { signal: currentTTSController.signal });
                  currentTTSController = null;

                  console.log("✅ TTS complete");
                  clientWs.send(JSON.stringify({ type: "status", status: "Listening..." }));
                  processingAudio = false;
                } catch (err) {
                  console.error("❌ Processing error:", err?.message || err);
                  clientWs.send(JSON.stringify({ type: "error", message: "Processing error: " + (err?.message || err) }));
                  clientWs.send(JSON.stringify({ type: "status", status: "Listening..." }));
                  processingAudio = false;
                }
              }, speechFinal ? 80 : 400);
            }
          }
        }
      }

      if (data.type === "Metadata") {
        console.log("📋 Deepgram ready:", data.request_id);
      }
    } catch (e) {
      console.error("❌ Deepgram parse error:", e.message || e);
    }
  });

  dgWs.on("close", (code) => {
    isOpen = false;
    if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null; }
    if (transcriptTimeout) { clearTimeout(transcriptTimeout); transcriptTimeout = null; }
    console.log(`❌ Deepgram closed: ${code}`);
    if (code !== 1000) {
      clientWs.send(JSON.stringify({ type: "error", message: `Deepgram disconnected: ${code}` }));
    }
  });

  dgWs.on("error", (e) => {
    isOpen = false;
    console.error("❌ Deepgram error:", e.message || e);
    clientWs.send(JSON.stringify({ type: "error", message: "Deepgram connection error: " + (e.message || e) }));
  });

  return { dgWs, isOpen: () => isOpen, cancelCurrentTTS: () => { try { if (currentTTSController) currentTTSController.abort(); } catch(e){} } };
}

wss.on("connection", (ws) => {
  console.log("👤 Client connected");
  let dgConnection = null;
  let audioChunkCount = 0;
  let totalBytesReceived = 0;

  ws.on("message", async (data, isBinary) => {
    // Audio binary frames -> forward to Deepgram
    if (isBinary && dgConnection && dgConnection.isOpen()) {
      try {
        const audioBuffer = Buffer.from(data);
        dgConnection.dgWs.send(audioBuffer);
        audioChunkCount++;
        totalBytesReceived += audioBuffer.length;
        if (audioChunkCount % 100 === 0) console.log(`📤 Sent ${audioChunkCount} PCM chunks (${totalBytesReceived} bytes)`);
      } catch (err) {
        console.error("❌ Error forwarding to Deepgram:", err.message || err);
      }
      return;
    }

    // Control messages
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "start_live") {
        console.log("🎙️ Starting live conversation");
        audioChunkCount = 0; totalBytesReceived = 0;
        ws.send(JSON.stringify({ type: "status", status: "Connecting to Deepgram..." }));
        dgConnection = openDeepgramSocket(ws);
      }

      if (msg.type === "stop_live") {
        console.log("🛑 Stopping live conversation");
        if (dgConnection) {
          try {
            if (dgConnection.isOpen()) { dgConnection.dgWs.send(JSON.stringify({ type: "CloseStream" })); setTimeout(() => { try { dgConnection.dgWs.close(); } catch(e){} }, 120); }
          } catch (err) { console.error("❌ Error closing Deepgram:", err.message || err); }
          dgConnection = null;
        }
        ws.send(JSON.stringify({ type: "status", status: "Stopped - Click Start to resume" }));
      }

      if (msg.type === "client_stop_tts") {
        // client asked server to stop TTS (safety)
        console.log("⛔ client requested TTS stop");
        if (dgConnection) dgConnection.cancelCurrentTTS();
        try { ws.send(JSON.stringify({ type: "stop_audio" })); } catch(e){}
      }
    } catch (e) {
      // ignore non-JSON
    }
  });

  ws.on("close", () => {
    console.log("👋 Client disconnected");
    if (dgConnection && dgConnection.isOpen()) {
      try { dgConnection.dgWs.close(); } catch (e) { console.error("❌ Error closing Deepgram:", e.message || e); }
    }
  });

  ws.on("error", (e) => {
    console.error("❌ WebSocket error:", e.message || e);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Gyaanchand server running on http://localhost:${PORT}`);
  console.log(`📋 Deepgram: nova-2, en-IN, 16kHz, Enhanced VAD`);
  console.log(`🗣️ Murf AI: Natural voice synthesis`);
  console.log(`🔑 Make sure your .env has valid API keys`);
});
